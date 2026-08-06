import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { ModelInvocationRepository } from "../src/stage3a/model-invocation-repository.js";
import { ShadowRunConflictError } from "../src/stage3a/run-repository.js";
import { buildPrimaryVerifierRequest } from "../src/stage3a/primary-verifier-request.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPaths = [
  "0001_shadow_engine.sql", "0002_source_collection.sql",
  "0003_candidate_resolution.sql", "0004_candidate_pool.sql",
  "0005_artifact_evidence.sql", "0006_model_invocation_slots.sql",
].map((name) => path.join(root, "migrations", "stage3a", name));
const now = "2026-08-06T00:00:00.000Z";

test("reserves one idempotent primary invocation per case and attempt", async () => {
  const fixture = await createFixture();
  try {
    const envelope = await requestEnvelope("Evidence line.");
    const first = await fixture.repository.reservePrimary({
      runId: "run-1", envelope, attemptNo: 1, now,
    });
    const replay = await fixture.repository.reservePrimary({
      runId: "run-1", envelope, attemptNo: 1, now,
    });
    assert.deepEqual(replay, first);
    assert.equal(first.status, "reserved");
    assert.equal(count(fixture.db, "model_invocations"), 1);

    const different = await requestEnvelope("Different evidence line.");
    await assert.rejects(
      fixture.repository.reservePrimary({ runId: "run-1", envelope: different, attemptNo: 1, now }),
      (error) => error instanceof ShadowRunConflictError && /immutable drift/.test(error.message),
    );
    assert.equal(count(fixture.db, "model_invocations"), 1);
  } finally {
    fixture.db.close();
  }
});

test("rejects tampered requests and cases outside the verifying shadow state", async () => {
  const fixture = await createFixture();
  try {
    const envelope = await requestEnvelope("Evidence line.");
    const tampered = structuredClone(envelope);
    tampered.request.max_output_tokens = 10;
    await assert.rejects(
      fixture.repository.reservePrimary({ runId: "run-1", envelope: tampered, now }),
      /request hash is invalid/,
    );
    fixture.db.prepare("UPDATE engine_runs SET status = 'editing' WHERE id = 'run-1'").run();
    await assert.rejects(
      fixture.repository.reservePrimary({ runId: "run-1", envelope, now }),
      /pending evidence-backed shadow case/,
    );
    await assert.rejects(
      fixture.repository.reservePrimary({ runId: "run-1", envelope, attemptNo: 3, now }),
      /reservation contract is invalid/,
    );
    assert.equal(count(fixture.db, "model_invocations"), 0);
  } finally {
    fixture.db.close();
  }
});

async function createFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migrationPath of migrationPaths) db.exec(await fs.readFile(migrationPath, "utf8"));
  db.prepare(`INSERT INTO engine_runs (
    id, channel, report_date, mode, contract_version, config_hash,
    model_policy_hash, source_policy_hash, status, publication_state,
    budget_soft_usd_micros, budget_hard_usd_micros, source_collection_status,
    created_at, updated_at
  ) VALUES (
    'run-1', 'skill-radar', '2026-08-06', 'shadow', 'engine-shadow-result-v1',
    'config', 'model', 'source', 'verifying', 'blocked_shadow',
    1000000, 2000000, 'complete', ?, ?
  )`).run(now, now);
  db.prepare(`INSERT INTO source_fetches (
    id, run_id, request_key, normalized_url, purpose, provenance_class,
    request_policy_json, task_id, attempt_no, fetch_status, cache_status,
    retryable, candidate_signals_json, created_at
  ) VALUES (
    'fetch-1', 'run-1', 'request-1', 'https://source.example/',
    'candidate_discovery', 'fixture', '{}', 'task-1', 1, 'succeeded',
    'fresh', 0, '[]', ?
  )`).run(now);
  db.prepare(`INSERT INTO candidate_resolution_batches (
    id, run_id, task_id, source_fetch_id, filter_pass, contract_version,
    input_signal_count, resolved_signal_count, unresolved_signal_count,
    signal_budget, budget_exhausted, resolution_hash, result_json, created_at
  ) VALUES (
    'batch-1', 'run-1', 'task-1', 'fetch-1', 1, 'candidate-resolution-v1',
    0, 0, 0, 1, 0, ?, '{}', ?
  )`).run("a".repeat(64), now);
  db.prepare(`INSERT INTO artifacts (
    id, artifact_key, canonical_repository_url, artifact_path, artifact_type,
    container_type, provenance, first_seen_at, last_seen_at
  ) VALUES (
    'artifact-1', 'artifact-key-1', 'https://github.com/example/rules',
    'skills/browser/SKILL.md', 'skill', 'artifact_file', 'fixture', ?, ?
  )`).run(now, now);
  db.prepare(`INSERT INTO candidate_discoveries (
    id, batch_id, run_id, candidate_id, artifact_id, exact_signal_id,
    lane, source_id, source_rank, candidate_snapshot_json, evidence_hash, created_at
  ) VALUES (
    'discovery-1', 'batch-1', 'run-1', 'candidate-1', 'artifact-1', 'signal-1',
    'registryPulse', 'source-1', 1, '{}', ?, ?
  )`).run("b".repeat(64), now);
  db.prepare(`INSERT INTO evidence_bundles (
    id, run_id, candidate_id, artifact_id, source_discovery_id, contract_version,
    repository_url, artifact_path, blob_sha, api_url, observed_at,
    source_byte_count, content_sha256, content_text, metadata_json,
    evidence_hash, created_at
  ) VALUES (
    'evidence-1', 'run-1', 'candidate-1', 'artifact-1', 'discovery-1',
    'artifact-evidence-bundle-v1', 'https://github.com/example/rules',
    'skills/browser/SKILL.md', ?, 'https://api.github.com/blob', ?,
    1, ?, 'x', '{}', ?, ?
  )`).run("b".repeat(40), now, "c".repeat(64), "d".repeat(64), now);
  db.prepare(`INSERT INTO verification_cases (
    id, run_id, candidate_id, original_identity_json, evidence_bundle_id,
    disposition, created_at, updated_at
  ) VALUES ('case-1', 'run-1', 'candidate-1', '{}', 'evidence-1', 'pending', ?, ?)
  `).run(now, now);
  return { db, repository: new ModelInvocationRepository(new SqliteD1(db)) };
}

async function requestEnvelope(contentText) {
  const repositoryUrl = "https://github.com/example/rules";
  const artifactPath = "skills/browser/SKILL.md";
  const blobSha = "b".repeat(40);
  const bytes = new TextEncoder().encode(contentText);
  return buildPrimaryVerifierRequest({
    contractVersion: "primary-verifier-input-v1",
    runId: "run-1",
    caseId: "case-1",
    candidateId: "candidate-1",
    identity: {
      candidateId: "candidate-1", repositoryUrl, artifactPath, blobSha,
      evidenceBundleId: "evidence-1",
    },
    repository: {
      fullName: "example/rules", htmlUrl: repositoryUrl, archived: false,
      disabled: false, pushedAt: now, updatedAt: now,
    },
    source: {
      evidenceBundleId: "evidence-1", repositoryUrl, artifactPath,
      locatorUrl: `${repositoryUrl}/blob/main/${artifactPath}`, blobSha,
      apiUrl: "https://api.github.com/blob", observedAt: now,
      byteCount: bytes.byteLength, contentSha256: await sha256(contentText),
      evidenceHash: "d".repeat(64), contentText, untrustedSourceContent: true,
    },
  });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0")).join("");
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

class SqliteD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new SqliteD1Statement(this.database.prepare(sql)); }
}

class SqliteD1Statement {
  constructor(statement, values = []) { this.statement = statement; this.values = values; }
  bind(...values) { return new SqliteD1Statement(this.statement, values); }
  async first() { return this.statement.get(...this.values) ?? null; }
  async run() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}
