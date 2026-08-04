import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { logicalRunId, validateShadowRunParams } from "../src/stage3a/run-identity.js";
import { ShadowRunConflictError, ShadowRunRepository } from "../src/stage3a/run-repository.js";
import { assertRunTransition } from "../src/stage3a/run-state.js";
import { SourcePlanRepository } from "../src/stage3a/source-plan-repository.js";
import {
  CANDIDATE_BUDGET,
  collectionTasksForPlan,
  createSourcePortfolioPlan,
  sourcePlanHash,
  validateCollectionCoverage,
  validateCollectionResult,
  validateSourcePortfolioPlan,
} from "../src/stage3a/source-portfolio.js";
import {
  bootstrapShadowWorkflow,
  prepareShadowSourcePlan,
} from "../src/stage3a/workflow-core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "migrations", "stage3a", "0001_shadow_engine.sql");

test("matches the validated production portfolio-v1 rotation without changing the production CLI", () => {
  const first = createSourcePortfolioPlan({ reportDate: "2026-08-04", completedRunCount: 0 });
  const second = createSourcePortfolioPlan({ reportDate: "2026-08-05", completedRunCount: 1 });

  assert.equal(first.registryFocus, "all_time");
  assert.deepEqual(first.officialSources.map((source) => source.id), [
    "anthropicSkills", "openAiPlugins", "githubAwesomeCopilot",
  ]);
  assert.equal(second.registryFocus, "trending");
  assert.deepEqual(second.officialSources.map((source) => source.id), [
    "cursorMarketplace", "geminiExtensions", "nvidiaSkills",
  ]);
  assert.deepEqual(validateSourcePortfolioPlan(first), []);
});

test("creates deterministic plan hashes and rejects rotation drift", async () => {
  const plan = createSourcePortfolioPlan({ reportDate: "2026-08-04", completedRunCount: 0 });
  assert.equal(await sourcePlanHash(plan), await sourcePlanHash(structuredClone(plan)));

  const drifted = structuredClone(plan);
  drifted.officialSources.reverse();
  assert.match(validateSourcePortfolioPlan(drifted).join("\n"), /deterministic completed-run rotation/);
  await assert.rejects(sourcePlanHash(drifted), /deterministic completed-run rotation/);
});

test("builds bounded collection tasks and requires completed source lanes", () => {
  const plan = createSourcePortfolioPlan({ reportDate: "2026-08-04", completedRunCount: 0 });
  const tasks = collectionTasksForPlan(plan);
  assert.equal(tasks.length, 6);
  assert.deepEqual(countBy(tasks, (task) => task.lane), {
    registryPulse: 1,
    officialRotation: 3,
    communityTrend: 2,
  });
  assert.ok(tasks.every((task) =>
    task.maxExcerptBytes === 32_768 && task.maxCandidateSignals === 4));
  assert.deepEqual(CANDIDATE_BUDGET, {
    initialMinimum: 8,
    initialMaximum: 12,
    replenishmentTarget: 5,
    maximumFilterPasses: 3,
    maximumCumulativeCandidates: 20,
  });

  const enough = [tasks[0], tasks[1], tasks[2], tasks[4]].map((task) => ({
    lane: task.lane,
    sourceId: task.sourceId,
    status: "succeeded",
  }));
  assert.deepEqual(validateCollectionCoverage(enough), []);
  assert.match(validateCollectionCoverage(enough.filter((result) =>
    result.sourceId !== tasks[2].sourceId)).join("\n"), /officialRotation requires 2/);
  assert.match(validateCollectionCoverage([]).join("\n"), /registryPulse requires 1/);

  const result = {
    taskId: tasks[0].taskId,
    lane: tasks[0].lane,
    sourceId: tasks[0].sourceId,
    status: "succeeded",
    retryable: false,
    cacheStatus: "fresh",
    contentHash: "a".repeat(64),
    boundedExcerpt: "bounded evidence",
    candidateSignals: Array.from({ length: 4 }, (_, index) => ({ title: `Signal ${index}` })),
  };
  assert.deepEqual(validateCollectionResult(tasks[0], result), []);
  result.candidateSignals.push({ title: "Too many" });
  assert.match(validateCollectionResult(tasks[0], result).join("\n"), /exceeds 4 candidate signals/);
});

test("persists one authoritative source plan and rejects same-run plan replacement", async () => {
  const fixture = await repositoryFixture();
  try {
    const params = validParams();
    const runId = await logicalRunId(params);
    const now = "2026-08-04T00:00:00.000Z";
    await fixture.runRepository.createOrGetRun({ runId, params, now });
    const plan = createSourcePortfolioPlan({ reportDate: params.reportDate, completedRunCount: 0 });
    const first = await fixture.sourcePlanRepository.createOrGetPlan({ runId, plan, now });
    const repeated = await fixture.sourcePlanRepository.createOrGetPlan({ runId, plan, now });

    assert.equal(first.created, true);
    assert.equal(repeated.created, false);
    assert.equal(first.planHash, repeated.planHash);

    const replacement = createSourcePortfolioPlan({
      reportDate: params.reportDate,
      completedRunCount: 1,
    });
    await assert.rejects(
      fixture.sourcePlanRepository.createOrGetPlan({ runId, plan: replacement, now }),
      (error) => error instanceof ShadowRunConflictError
        && /different authoritative source plan/.test(error.message),
    );
  } finally {
    fixture.db.close();
  }
});

test("advances the shadow workflow from claimed to collecting only after persisting its plan", async () => {
  const fixture = await repositoryFixture();
  try {
    const step = immediateWorkflowStep();
    const now = new Date("2026-08-04T00:00:00.000Z");
    const params = validParams();
    const run = await bootstrapShadowWorkflow({
      event: { instanceId: "workflow-source-plan", payload: params },
      step,
      repository: fixture.runRepository,
      now,
    });
    const planned = await prepareShadowSourcePlan({
      run,
      reportDate: params.reportDate,
      step,
      runRepository: fixture.runRepository,
      sourcePlanRepository: fixture.sourcePlanRepository,
      now,
    });

    assert.equal(planned.status, "collecting");
    assert.equal(planned.nextStage, "source_collection");
    assert.match(planned.sourcePlanHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(step.names.slice(-3), [
      "count completed source rotations",
      "persist authoritative source plan",
      "enter source collection state",
    ]);
    const stored = fixture.db.prepare("SELECT status FROM engine_runs WHERE id = ?").get(run.runId);
    assert.equal(stored.status, "collecting");
  } finally {
    fixture.db.close();
  }
});

test("rejects skipped or backwards run-state transitions", () => {
  assert.doesNotThrow(() => assertRunTransition("claimed", "collecting"));
  assert.throws(() => assertRunTransition("collecting", "editing"), /is not allowed/);
  assert.throws(() => assertRunTransition("shadow_ready", "verifying"), /is not allowed/);
});

function validParams() {
  return validateShadowRunParams({
    reportDate: "2026-08-04",
    configHash: "a".repeat(64),
    modelPolicyHash: "b".repeat(64),
    sourcePolicyHash: "c".repeat(64),
  });
}

async function repositoryFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(await fs.readFile(migrationPath, "utf8"));
  const d1 = new SqliteD1(db);
  return {
    db,
    runRepository: new ShadowRunRepository(d1),
    sourcePlanRepository: new SourcePlanRepository(d1),
  };
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

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
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
