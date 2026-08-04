import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { logicalRunId, validateShadowRunParams } from "../src/stage3a/run-identity.js";
import {
  ShadowRunConflictError,
  ShadowRunRepository,
} from "../src/stage3a/run-repository.js";
import {
  assertStage3AShadowGuard,
  bootstrapShadowWorkflow,
} from "../src/stage3a/workflow-core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "migrations", "stage3a", "0001_shadow_engine.sql");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

test("keeps shadow bindings and scheduling out of the production Wrangler config", async () => {
  const [shadowConfig, productionConfig] = await Promise.all([
    fs.readFile(path.join(root, "wrangler.stage3a.jsonc"), "utf8").then(JSON.parse),
    fs.readFile(path.join(root, "wrangler.toml"), "utf8"),
  ]);

  assert.equal(shadowConfig.name, "personal-radar-stage3a-shadow");
  assert.equal(shadowConfig.main, "src/stage3a/index.js");
  assert.equal(shadowConfig.workers_dev, false);
  assert.equal(shadowConfig.preview_urls, false);
  assert.equal(shadowConfig.vars.STAGE3A_EXECUTION_ENABLED, "false");
  assert.equal(shadowConfig.vars.PUBLICATION_ENABLED, "false");
  assert.equal(shadowConfig.d1_databases[0].database_id, "00000000-0000-0000-0000-000000000000");
  assert.equal(shadowConfig.workflows[0].schedules, undefined);
  assert.equal(shadowConfig.routes, undefined);
  assert.equal(shadowConfig.triggers, undefined);

  assert.doesNotMatch(productionConfig, /ENGINE_DB|SKILL_RADAR_SHADOW_WORKFLOW|stage3a/i);
  assert.match(productionConfig, /binding = "RADAR_STATE"/);
});

test("validates and deterministically identifies a logical shadow run", async () => {
  const params = validParams();
  const first = await logicalRunId(params);
  const second = await logicalRunId({ ...params });

  assert.equal(first, second);
  assert.match(first, /^run_[a-f0-9]{32}$/);
  assert.throws(() => validateShadowRunParams({ ...params, configHash: "short" }),
    /configHash must be a lowercase SHA-256/);
  assert.throws(() => validateShadowRunParams({ ...params, reportDate: "2026-8-4" }),
    /reportDate must use YYYY-MM-DD/);
});

test("fails closed unless execution is explicit and publication remains disabled", () => {
  assert.throws(() => assertStage3AShadowGuard({
    STAGE3A_EXECUTION_ENABLED: "false",
    PUBLICATION_ENABLED: "false",
  }), /execution is disabled/);
  assert.throws(() => assertStage3AShadowGuard({
    STAGE3A_EXECUTION_ENABLED: "true",
    PUBLICATION_ENABLED: "true",
  }), /PUBLICATION_ENABLED=false/);
  assert.doesNotThrow(() => assertStage3AShadowGuard({
    STAGE3A_EXECUTION_ENABLED: "true",
    PUBLICATION_ENABLED: "false",
  }));
});

test("creates one frozen logical run and rejects same-date configuration drift", async () => {
  const { db, repository } = await repositoryFixture();
  try {
    const params = validParams();
    const runId = await logicalRunId(params);
    const now = "2026-08-04T00:00:00.000Z";
    const created = await repository.createOrGetRun({ runId, params, now });
    const repeated = await repository.createOrGetRun({ runId, params, now });

    assert.equal(created.created, true);
    assert.equal(repeated.created, false);
    assert.equal(created.run.publicationState, "blocked_shadow");
    await assert.rejects(
      repository.createOrGetRun({
        runId,
        params: { ...params, modelPolicyHash: "d".repeat(64) },
        now,
      }),
      (error) => error instanceof ShadowRunConflictError
        && /different frozen model_policy_hash/.test(error.message),
    );
  } finally {
    db.close();
  }
});

test("bootstraps durable steps idempotently and rejects a competing first attempt", async () => {
  const { db, repository } = await repositoryFixture();
  try {
    const step = immediateWorkflowStep();
    const event = { instanceId: "workflow-1", payload: validParams() };
    const now = new Date("2026-08-04T00:00:00.000Z");
    const first = await bootstrapShadowWorkflow({ event, step, repository, now });
    const repeated = await bootstrapShadowWorkflow({ event, step, repository, now });

    assert.deepEqual(step.names.slice(0, 3), [
      "claim logical shadow run",
      "attach workflow attempt",
      "persist claimed state",
    ]);
    assert.equal(first.runId, repeated.runId);
    assert.equal(first.status, "claimed");
    assert.equal(first.publicationState, "blocked_shadow");
    assert.equal(first.nextStage, "source_plan");

    await assert.rejects(
      bootstrapShadowWorkflow({
        event: {
          instanceId: "workflow-competing",
          payload: { ...validParams(), attemptNo: 2 },
        },
        step: immediateWorkflowStep(),
        repository,
        now,
      }),
      (error) => error instanceof ShadowRunConflictError
        && /active workflow lease/.test(error.message),
    );
  } finally {
    db.close();
  }
});

test("allows an explicit recovery attempt without changing the logical run", async () => {
  const { db, repository } = await repositoryFixture();
  try {
    const now = new Date("2026-08-04T00:00:00.000Z");
    const first = await bootstrapShadowWorkflow({
      event: { instanceId: "workflow-1", payload: validParams() },
      step: immediateWorkflowStep(),
      repository,
      now,
    });
    const recovery = await bootstrapShadowWorkflow({
      event: { instanceId: "workflow-2", payload: { ...validParams(), attemptNo: 2 } },
      step: immediateWorkflowStep(),
      repository,
      now: new Date(now.getTime() + 6 * 60_000),
    });
    assert.equal(recovery.runId, first.runId);
    assert.equal(recovery.attemptNo, 2);
  } finally {
    db.close();
  }
});

function validParams() {
  return validateShadowRunParams({
    reportDate: "2026-08-04",
    configHash: HASH_A,
    modelPolicyHash: HASH_B,
    sourcePolicyHash: HASH_C,
  });
}

async function repositoryFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(await fs.readFile(migrationPath, "utf8"));
  return { db, repository: new ShadowRunRepository(new SqliteD1(db)) };
}

function immediateWorkflowStep() {
  return {
    names: [],
    async do(name, options, callback) {
      this.names.push(name);
      assert.equal(options.retries.limit, 3);
      return callback();
    },
  };
}

class SqliteD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database.prepare(sql));
  }
}

class SqliteD1Statement {
  constructor(statement, values = []) {
    this.statement = statement;
    this.values = values;
  }

  bind(...values) {
    return new SqliteD1Statement(this.statement, values);
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }

  async first() {
    return this.statement.get(...this.values) ?? null;
  }
}
