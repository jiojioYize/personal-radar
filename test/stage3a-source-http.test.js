import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { logicalRunId, validateShadowRunParams } from "../src/stage3a/run-identity.js";
import { ShadowRunConflictError, ShadowRunRepository } from "../src/stage3a/run-repository.js";
import { SourceFetchRepository } from "../src/stage3a/source-fetch-repository.js";
import {
  fetchSourceTaskOnce,
  shouldRetrySourceResult,
  staleCacheFallback,
} from "../src/stage3a/source-http-connector.js";
import {
  collectionTasksForPlan,
  createSourcePortfolioPlan,
  deriveSourceCollectionStatus,
  validateCollectionResult,
} from "../src/stage3a/source-portfolio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPaths = ["0001_shadow_engine.sql", "0002_source_collection.sql"]
  .map((name) => path.join(root, "migrations", "stage3a", name));

test("treats a fresh valid response as source success even with zero candidates", async () => {
  const task = sourceTask();
  const result = await fetchSourceTaskOnce({
    task,
    fetchImpl: async () => new Response("current source body", {
      status: 200,
      headers: { "content-type": "text/plain", etag: '"v1"' },
    }),
    now: new Date("2026-08-04T00:00:00.000Z"),
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.cacheStatus, "fresh");
  assert.deepEqual(result.candidateSignals, []);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateCollectionResult(task, result), []);
});

test("counts 304 with validated cache as success but stale fallback as degraded", async () => {
  const task = sourceTask();
  const cache = validCache();
  const confirmed = await fetchSourceTaskOnce({
    task,
    cache,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.get("if-none-match"), '"cached"');
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(confirmed.status, "succeeded");
  assert.equal(confirmed.cacheStatus, "validated_304");

  const failed = await fetchSourceTaskOnce({
    task,
    cache,
    fetchImpl: async () => { throw new TypeError("offline"); },
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.retryable, true);
  const fallback = staleCacheFallback(task, cache, failed);
  assert.equal(fallback.status, "degraded_cached");
  assert.equal(fallback.cacheStatus, "stale_fallback");
  assert.deepEqual(validateCollectionResult(task, fallback), []);
});

test("rejects a 304 cache entry whose candidate signals fail the current contract", async () => {
  const task = sourceTask();
  const result = await fetchSourceTaskOnce({
    task,
    cache: { ...validCache(), candidateSignals: [{ invented: true }] },
    fetchImpl: async () => new Response(null, { status: 304 }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorClass, "CACHE_MISS_ON_304");
});

test("classifies retryable and terminal HTTP failures without hiding them as empty results", async () => {
  const task = sourceTask();
  const rateLimited = await fetchStatus(task, 429);
  const upstream = await fetchStatus(task, 503);
  const missing = await fetchStatus(task, 404);
  const unauthorized = await fetchStatus(task, 403);

  assert.equal(rateLimited.errorClass, "SOURCE_RATE_LIMIT");
  assert.equal(rateLimited.retryable, true);
  assert.equal(shouldRetrySourceResult(rateLimited, 1), true);
  assert.equal(shouldRetrySourceResult(rateLimited, 2), true);
  assert.equal(shouldRetrySourceResult(rateLimited, 3), false);
  assert.equal(upstream.retryable, true);
  assert.equal(missing.errorClass, "SOURCE_NOT_FOUND");
  assert.equal(missing.retryable, false);
  assert.equal(unauthorized.errorClass, "SOURCE_AUTHORIZATION");
  assert.ok([rateLimited, upstream, missing, unauthorized]
    .every((result) => result.status === "failed" && result.candidateSignals.length === 0));
});

test("rejects unsupported, oversized, and cross-host redirect responses", async () => {
  const task = sourceTask();
  const unsupported = await fetchSourceTaskOnce({
    task,
    fetchImpl: async () => new Response("binary", {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }),
  });
  assert.equal(unsupported.errorClass, "UNSUPPORTED_CONTENT_TYPE");

  const oversized = await fetchSourceTaskOnce({
    task: { ...task, maxResponseBytes: task.maxExcerptBytes },
    fetchImpl: async () => new Response("x", {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "content-length": String(task.maxExcerptBytes + 1),
      },
    }),
  });
  assert.equal(oversized.errorClass, "SOURCE_BODY_TOO_LARGE");

  const redirected = await fetchSourceTaskOnce({
    task,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/collect" },
    }),
  });
  assert.equal(redirected.errorClass, "UNSAFE_REDIRECT");
});

test("distinguishes complete, degraded, and source-incomplete collection", () => {
  const plan = createSourcePortfolioPlan({ reportDate: "2026-08-04", completedRunCount: 0 });
  const tasks = collectionTasksForPlan(plan);
  const success = (task) => ({
    taskId: task.taskId,
    lane: task.lane,
    sourceId: task.sourceId,
    status: "succeeded",
  });
  assert.equal(deriveSourceCollectionStatus(tasks, tasks.map(success)), "complete");
  assert.equal(deriveSourceCollectionStatus(tasks, [
    tasks[0], tasks[1], tasks[2], tasks[4],
  ].map(success)), "degraded");
  assert.equal(deriveSourceCollectionStatus(tasks, [tasks[0], tasks[1], tasks[4]].map(success)),
    "source_incomplete");
});

test("persists immutable source attempts and one collection status", async () => {
  const fixture = await repositoryFixture();
  try {
    const params = validParams();
    const runId = await logicalRunId(params);
    const now = "2026-08-04T00:00:00.000Z";
    await fixture.runRepository.createOrGetRun({ runId, params, now });
    await fixture.runRepository.markClaimed({ runId, now });
    await fixture.runRepository.transitionStatus({
      runId,
      from: "claimed",
      to: "collecting",
      now,
    });
    const task = sourceTask();
    const result = await fetchSourceTaskOnce({
      task,
      fetchImpl: async () => new Response("source", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    });
    const first = await fixture.fetchRepository.recordAttempt({
      runId, task, attemptNo: 1, result, now,
    });
    const repeated = await fixture.fetchRepository.recordAttempt({
      runId, task, attemptNo: 1, result, now,
    });
    assert.equal(first.created, true);
    assert.equal(repeated.created, false);
    const storedSignals = fixture.db.prepare(`
      SELECT candidate_signals_json, result_hash FROM source_fetches WHERE id = ?
    `).get(first.id);
    assert.equal(storedSignals.candidate_signals_json, "[]");
    assert.match(storedSignals.result_hash, /^[a-f0-9]{64}$/);

    await fixture.runRepository.setSourceCollectionStatus({
      runId, status: "degraded", now,
    });
    await assert.rejects(
      fixture.runRepository.setSourceCollectionStatus({
        runId, status: "complete", now,
      }),
      (error) => error instanceof ShadowRunConflictError,
    );
  } finally {
    fixture.db.close();
  }
});

function sourceTask() {
  const plan = createSourcePortfolioPlan({ reportDate: "2026-08-04", completedRunCount: 0 });
  return collectionTasksForPlan(plan)[0];
}

async function fetchStatus(task, status) {
  return fetchSourceTaskOnce({
    task,
    fetchImpl: async () => new Response("failure", { status }),
  });
}

function validCache() {
  return {
    contentHash: "a".repeat(64),
    boundedExcerpt: "cached evidence",
    candidateSignals: [],
    etag: '"cached"',
    lastModified: null,
  };
}

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
  for (const migrationPath of migrationPaths) {
    db.exec(await fs.readFile(migrationPath, "utf8"));
  }
  const d1 = new SqliteD1(db);
  return {
    db,
    runRepository: new ShadowRunRepository(d1),
    fetchRepository: new SourceFetchRepository(d1),
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
