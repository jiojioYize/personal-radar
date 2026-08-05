import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { CandidatePoolRepository } from "../src/stage3a/candidate-pool-repository.js";
import { ShadowRunConflictError } from "../src/stage3a/run-repository.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrations = [
  "0001_shadow_engine.sql", "0002_source_collection.sql",
  "0003_candidate_resolution.sql", "0004_candidate_pool.sql",
].map((name) => path.join(root, "migrations", "stage3a", name));
const now = "2026-08-05T00:00:00.000Z";
const taskIds = ["registryPulse:skillsSh", "officialRotation:one"];

test("atomically materializes an idempotent global pool and updates run totals", async () => {
  const fixture = await createFixture();
  try {
    insertDiscovery(fixture.db, taskIds[0], 1, 1);
    insertDiscovery(fixture.db, taskIds[1], 1, 2);
    const request = materializeRequest();
    const first = await fixture.repository.materializePass(request);
    const replay = await fixture.repository.materializePass(request);
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(first.selectedCount, 2);
    assert.equal(first.nextAction, "replenish");
    assert.equal(count(fixture.db, "candidate_pool_passes"), 1);
    assert.equal(count(fixture.db, "candidate_filter_events"), 2);
    assert.equal(count(fixture.db, "run_candidates"), 2);
    const run = fixture.db.prepare(`
      SELECT candidate_total, eligible_total FROM engine_runs WHERE id = 'run-1'
    `).get();
    assert.equal(run.candidate_total, 2);
    assert.equal(run.eligible_total, 2);
  } finally {
    fixture.db.close();
  }
});

test("retains corroboration but counts the same candidate only once", async () => {
  const fixture = await createFixture();
  try {
    insertDiscovery(fixture.db, taskIds[0], 1, 1);
    insertDiscovery(fixture.db, taskIds[1], 1, 1);
    const result = await fixture.repository.materializePass(materializeRequest());
    assert.equal(result.selectedCount, 1);
    const snapshot = JSON.parse(fixture.db.prepare(`
      SELECT snapshot_json FROM run_candidates
    `).get().snapshot_json);
    assert.equal(snapshot.corroboratingDiscoveryIds.length, 1);
    assert.equal(count(fixture.db, "candidate_discoveries"), 2);
  } finally {
    fixture.db.close();
  }
});

test("fails closed when an expected source resolution batch is missing", async () => {
  const fixture = await createFixture();
  try {
    insertDiscovery(fixture.db, taskIds[0], 1, 1);
    insertSourceFetchOnly(fixture.db, taskIds[1], 1);
    await assert.rejects(
      fixture.repository.materializePass(materializeRequest()),
      /one resolution batch for every expected source task/,
    );
    assert.equal(count(fixture.db, "candidate_pool_passes"), 0);
  } finally {
    fixture.db.close();
  }
});

test("detects immutable filter-event corruption on replay", async () => {
  const fixture = await createFixture();
  try {
    insertDiscovery(fixture.db, taskIds[0], 1, 1);
    insertEmptyResolution(fixture.db, taskIds[1], 1);
    const request = materializeRequest();
    await fixture.repository.materializePass(request);
    fixture.db.prepare(`UPDATE candidate_filter_events SET event_hash = ?`).run("f".repeat(64));
    await assert.rejects(
      fixture.repository.materializePass(request),
      (error) => error instanceof ShadowRunConflictError && /filter event/.test(error.message),
    );
  } finally {
    fixture.db.close();
  }
});

test("detects request-policy and selected-candidate drift on replay", async () => {
  const fixture = await createFixture();
  try {
    insertDiscovery(fixture.db, taskIds[0], 1, 1);
    insertEmptyResolution(fixture.db, taskIds[1], 1);
    const request = materializeRequest();
    await fixture.repository.materializePass(request);
    await assert.rejects(
      fixture.repository.materializePass({
        ...request,
        sourceTaskOrder: [...taskIds].reverse(),
      }),
      (error) => error instanceof ShadowRunConflictError && /request/.test(error.message),
    );
    fixture.db.prepare(`UPDATE run_candidates SET snapshot_json = '{}'`).run();
    await assert.rejects(
      fixture.repository.materializePass(request),
      (error) => error instanceof ShadowRunConflictError && /candidate snapshot/.test(error.message),
    );
  } finally {
    fixture.db.close();
  }
});

test("D1 transaction rollback leaves no partial pool when a child insert fails", async () => {
  const fixture = await createFixture();
  try {
    insertDiscovery(fixture.db, taskIds[0], 1, 1);
    insertEmptyResolution(fixture.db, taskIds[1], 1);
    fixture.db.exec(`
      CREATE TRIGGER reject_filter_event BEFORE INSERT ON candidate_filter_events
      BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END
    `);
    await assert.rejects(
      fixture.repository.materializePass(materializeRequest()),
      /fixture rejection/,
    );
    assert.equal(count(fixture.db, "candidate_pool_passes"), 0);
    assert.equal(count(fixture.db, "run_candidates"), 0);
  } finally {
    fixture.db.close();
  }
});

function materializeRequest() {
  return {
    runId: "run-1",
    reportDate: "2026-08-05",
    filterPass: 1,
    sourceTaskOrder: taskIds,
    expectedResolutionTaskIds: taskIds,
    now,
  };
}

async function createFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.exec(await fs.readFile(migration, "utf8"));
  db.prepare(`
    INSERT INTO engine_runs (
      id, channel, report_date, mode, contract_version, config_hash,
      model_policy_hash, source_policy_hash, status, publication_state,
      budget_soft_usd_micros, budget_hard_usd_micros,
      source_collection_status, created_at, updated_at
    ) VALUES (
      'run-1', 'skill-radar', '2026-08-05', 'shadow', 'engine-shadow-result-v1',
      'config', 'model', 'source', 'filtering', 'blocked_shadow',
      3000000, 5000000, 'complete', ?, ?
    )
  `).run(now, now);
  return { db, repository: new CandidatePoolRepository(new SqliteD1(db)) };
}

function insertDiscovery(db, taskId, filterPass, suffix) {
  const fetchId = `fetch-${taskId}-${filterPass}`;
  const batchId = `batch-${taskId}-${filterPass}`;
  if (!db.prepare(`SELECT id FROM source_fetches WHERE id = ?`).get(fetchId)) {
    db.prepare(`
      INSERT INTO source_fetches (
        id, run_id, request_key, normalized_url, purpose, provenance_class,
        request_policy_json, created_at, task_id, attempt_no, fetch_status,
        cache_status, retryable, result_hash, candidate_signals_json
      ) VALUES (?, 'run-1', ?, 'https://source.example/', 'candidate_discovery',
        'fixture', '{}', ?, ?, 1, 'succeeded', 'fresh', 0, ?, '[]')
    `).run(fetchId, `request-${fetchId}`, now, taskId, "a".repeat(64));
    insertResolutionRow(db, batchId, taskId, fetchId, filterPass);
  }
  const artifactId = `artifact-${suffix}`;
  const candidateId = `candidate-${suffix}`;
  db.prepare(`
    INSERT INTO artifacts (
      id, artifact_key, canonical_repository_url, artifact_path,
      artifact_type, container_type, provenance, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, 'skill', 'artifact_file', 'fixture', ?, ?)
    ON CONFLICT(artifact_key) DO NOTHING
  `).run(
    artifactId,
    `https://github.com/example/repo-${suffix}#artifact=skills/${suffix}/SKILL.md`,
    `https://github.com/example/repo-${suffix}`,
    `skills/${suffix}/SKILL.md`, now, now,
  );
  db.prepare(`
    INSERT INTO candidate_discoveries (
      id, batch_id, run_id, candidate_id, artifact_id, exact_signal_id,
      lane, source_id, source_rank, candidate_snapshot_json, evidence_hash, created_at
    ) VALUES (?, ?, 'run-1', ?, ?, ?, ?, ?, 1, '{}', ?, ?)
  `).run(
    `discovery-${taskId}-${suffix}`, batchId, candidateId, artifactId,
    `signal-${taskId}-${suffix}`,
    taskId.split(":")[0], taskId.split(":")[1], "b".repeat(64), now,
  );
}

function insertEmptyResolution(db, taskId, filterPass) {
  const { fetchId, batchId } = insertSourceFetchOnly(db, taskId, filterPass);
  insertResolutionRow(db, batchId, taskId, fetchId, filterPass);
}

function insertSourceFetchOnly(db, taskId, filterPass) {
  const fetchId = `fetch-${taskId}-${filterPass}`;
  const batchId = `batch-${taskId}-${filterPass}`;
  db.prepare(`
    INSERT INTO source_fetches (
      id, run_id, request_key, normalized_url, purpose, provenance_class,
      request_policy_json, created_at, task_id, attempt_no, fetch_status,
      cache_status, retryable, result_hash, candidate_signals_json
    ) VALUES (?, 'run-1', ?, 'https://source.example/', 'candidate_discovery',
      'fixture', '{}', ?, ?, 1, 'succeeded', 'fresh', 0, ?, '[]')
  `).run(fetchId, `request-${fetchId}`, now, taskId, "a".repeat(64));
  return { fetchId, batchId };
}

function insertResolutionRow(db, batchId, taskId, fetchId, filterPass) {
  db.prepare(`
    INSERT INTO candidate_resolution_batches (
      id, run_id, task_id, source_fetch_id, filter_pass, contract_version,
      input_signal_count, resolved_signal_count, unresolved_signal_count,
      signal_budget, budget_exhausted, resolution_hash, result_json, created_at
    ) VALUES (?, 'run-1', ?, ?, ?, 'candidate-resolution-v1',
      0, 0, 0, 4, 0, ?, '{}', ?)
  `).run(batchId, taskId, fetchId, filterPass, "c".repeat(64), now);
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

class SqliteD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new SqliteD1Statement(this.database.prepare(sql)); }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class SqliteD1Statement {
  constructor(statement, values = []) { this.statement = statement; this.values = values; }
  bind(...values) { return new SqliteD1Statement(this.statement, values); }
  execute() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
  async first() { return this.statement.get(...this.values) ?? null; }
  async all() { return { success: true, results: this.statement.all(...this.values) }; }
}
