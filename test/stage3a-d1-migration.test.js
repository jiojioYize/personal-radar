import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(root, "migrations", "stage3a", "0001_shadow_engine.sql");
const sourceMigrationPath = path.join(root, "migrations", "stage3a", "0002_source_collection.sql");
const resolutionMigrationPath = path.join(root, "migrations", "stage3a", "0003_candidate_resolution.sql");
const poolMigrationPath = path.join(root, "migrations", "stage3a", "0004_candidate_pool.sql");

test("creates the complete Stage 3A shadow persistence model and required indexes", async () => {
  const db = await migratedDatabase();
  try {
    const tables = new Set(db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all().map((row) => row.name));
    for (const table of [
      "engine_runs", "workflow_attempts", "source_plans", "source_rotation_entries",
      "source_fetches", "artifacts", "run_candidates", "verification_cases",
      "verification_outputs", "quality_decisions", "report_artifacts", "artifact_history",
      "review_state", "preference_signals", "model_invocations", "production_baselines",
      "shadow_comparisons", "incidents",
      "candidate_resolution_batches", "candidate_resolution_trajectories",
      "candidate_discoveries",
      "candidate_pool_passes", "candidate_filter_events",
    ]) {
      assert.ok(tables.has(table), `missing table ${table}`);
    }

    const indexes = new Set(db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index'
    `).all().map((row) => row.name));
    for (const index of [
      "idx_engine_runs_date_status", "idx_artifacts_repository_seen",
      "idx_run_candidates_run_disposition", "idx_verification_cases_run_disposition",
      "idx_model_invocations_run_role", "idx_review_state_review_after",
      "idx_incidents_status_last",
    ]) {
      assert.ok(indexes.has(index), `missing index ${index}`);
    }
    assert.ok(indexes.has("idx_source_fetches_run_task_attempt"));
    assert.ok(indexes.has("idx_resolution_batches_run_pass"));
    assert.ok(indexes.has("idx_candidate_discoveries_run_candidate"));
    assert.ok(indexes.has("idx_candidate_pool_passes_run_pass"));
    assert.ok(indexes.has("idx_candidate_filter_events_run_disposition"));
    const runColumns = new Set(db.prepare("PRAGMA table_info(engine_runs)").all()
      .map((column) => column.name));
    assert.ok(runColumns.has("source_collection_status"));
  } finally {
    db.close();
  }
});

test("enforces one logical shadow run per date and a blocked publication state", async () => {
  const db = await migratedDatabase();
  try {
    insertRun(db, "run-1");
    assert.throws(() => insertRun(db, "run-2"), /UNIQUE constraint failed/);
    assert.throws(() => insertRun(db, "run-3", { publicationState: "publish_enabled" }),
      /CHECK constraint failed/);
  } finally {
    db.close();
  }
});

test("enforces idempotent workflow, model request, output, artifact, and comparison keys", async () => {
  const db = await migratedDatabase();
  try {
    insertRun(db, "run-1");
    const now = "2026-08-04T00:00:00.000Z";
    db.prepare(`INSERT INTO workflow_attempts
      (workflow_instance_id, run_id, attempt_no, status, created_at)
      VALUES (?, 'run-1', 1, 'claimed', ?)`
    ).run("workflow-1", now);
    assert.throws(() => db.prepare(`INSERT INTO workflow_attempts
      (workflow_instance_id, run_id, attempt_no, status, created_at)
      VALUES (?, 'run-1', 1, 'claimed', ?)`
    ).run("workflow-2", now), /UNIQUE constraint failed/);

    db.prepare(`INSERT INTO verification_cases
      (id, run_id, candidate_id, original_identity_json, disposition, created_at, updated_at)
      VALUES ('case-1', 'run-1', 'candidate-1', '{}', 'pending', ?, ?)`
    ).run(now, now);
    insertInvocation(db, "invocation-1", "request-hash-1");
    assert.throws(() => insertInvocation(db, "invocation-2", "request-hash-1"),
      /UNIQUE constraint failed/);

    insertOutput(db, "output-1", "invocation-1");
    insertInvocation(db, "invocation-2", "request-hash-2", 2);
    assert.throws(() => insertOutput(db, "output-2", "invocation-2"),
      /UNIQUE constraint failed/);

    db.prepare(`INSERT INTO report_artifacts
      (id, run_id, format, body, content_hash, coverage_status, publication_state,
       validated_at, created_at)
      VALUES ('artifact-1', 'run-1', 'engine_shadow_v1', '{}', 'hash-1',
       'target_met', 'blocked_shadow', ?, ?)`
    ).run(now, now);
    assert.throws(() => db.prepare(`INSERT INTO report_artifacts
      (id, run_id, format, body, content_hash, coverage_status, publication_state,
       validated_at, created_at)
      VALUES ('artifact-2', 'run-1', 'engine_shadow_v1', '{}', 'hash-2',
       'target_met', 'blocked_shadow', ?, ?)`
    ).run(now, now), /UNIQUE constraint failed/);

    db.prepare(`INSERT INTO production_baselines
      (id, channel, report_date, status, selected_items_json, source_hash, captured_at)
      VALUES ('baseline-1', 'skill-radar', '2026-08-04', 'published', '[]', 'baseline-hash', ?)`
    ).run(now);
    insertComparison(db, "comparison-1");
    assert.throws(() => insertComparison(db, "comparison-2"), /UNIQUE constraint failed/);
  } finally {
    db.close();
  }
});

test("rejects invalid coverage, budget, and no-backfill states", async () => {
  const db = await migratedDatabase();
  try {
    assert.throws(() => insertRun(db, "bad-coverage", { coverageStatus: "candidate_shortage" }),
      /CHECK constraint failed/);
    assert.throws(() => insertRun(db, "bad-budget", { hardBudget: 2_000_000 }),
      /CHECK constraint failed/);
    insertRun(db, "run-1");
    const now = "2026-08-04T00:00:00.000Z";
    assert.throws(() => db.prepare(`INSERT INTO incidents
      (id, run_id, failure_class, scope, retryable, status, first_occurred_at,
       last_occurred_at, no_backfill, created_at, updated_at)
      VALUES ('incident-1', 'run-1', 'SOURCE_FAILURE', 'source', 1, 'open',
       ?, ?, 0, ?, ?)`
    ).run(now, now, now, now), /CHECK constraint failed/);
  } finally {
    db.close();
  }
});

async function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(await fs.readFile(migrationPath, "utf8"));
  db.exec(await fs.readFile(sourceMigrationPath, "utf8"));
  db.exec(await fs.readFile(resolutionMigrationPath, "utf8"));
  db.exec(await fs.readFile(poolMigrationPath, "utf8"));
  return db;
}

function insertRun(db, id, {
  publicationState = "blocked_shadow",
  coverageStatus = null,
  hardBudget = 5_000_000,
} = {}) {
  const now = "2026-08-04T00:00:00.000Z";
  db.prepare(`INSERT INTO engine_runs
    (id, channel, report_date, mode, contract_version, config_hash,
     model_policy_hash, source_policy_hash, status, publication_state,
     coverage_status, budget_soft_usd_micros, budget_hard_usd_micros, created_at, updated_at)
    VALUES (?, 'skill-radar', '2026-08-04', 'shadow', 'engine-shadow-result-v1',
     'config-hash', 'model-hash', 'source-hash', 'scheduled', ?, ?, 3000000, ?, ?, ?)`
  ).run(id, publicationState, coverageStatus, hardBudget, now, now);
}

function insertInvocation(db, id, requestHash, attemptNo = 1) {
  const now = "2026-08-04T00:00:00.000Z";
  db.prepare(`INSERT INTO model_invocations
    (id, run_id, verification_case_id, candidate_id, role, attempt_no,
     request_hash, provider, model, model_policy, prompt_version, status, created_at)
    VALUES (?, 'run-1', 'case-1', 'candidate-1', 'primary', ?, ?,
     'openai', 'gpt-test', 'policy-v1', 'prompt-v1', 'completed', ?)`
  ).run(id, attemptNo, requestHash, now);
}

function insertOutput(db, id, invocationId) {
  const now = "2026-08-04T00:00:00.000Z";
  db.prepare(`INSERT INTO verification_outputs
    (id, case_id, invocation_id, role, attempt_no, prompt_version, model_policy,
     response_hash, evidence_json, semantic_valid, created_at)
    VALUES (?, 'case-1', ?, 'primary', 1, 'prompt-v1', 'policy-v1',
     'response-hash', '{}', 1, ?)`
  ).run(id, invocationId, now);
}

function insertComparison(db, id) {
  const now = "2026-08-04T00:00:00.000Z";
  db.prepare(`INSERT INTO shadow_comparisons
    (id, shadow_run_id, production_baseline_id, production_baseline_hash,
     comparison_version, metrics_json, findings_json, created_at)
    VALUES (?, 'run-1', 'baseline-1', 'baseline-hash', 'comparison-v1', '{}', '[]', ?)`
  ).run(id, now);
}
