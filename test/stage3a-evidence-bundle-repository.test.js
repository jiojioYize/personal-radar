import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { EvidenceBundleRepository } from "../src/stage3a/evidence-bundle-repository.js";
import { fetchGithubBlobEvidence } from "../src/stage3a/github-source-adapter.js";
import { ShadowRunConflictError } from "../src/stage3a/run-repository.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrations = [
  "0001_shadow_engine.sql", "0002_source_collection.sql",
  "0003_candidate_resolution.sql", "0004_candidate_pool.sql",
  "0005_artifact_evidence.sql",
].map((name) => path.join(root, "migrations", "stage3a", name));
const now = "2026-08-05T00:00:00.000Z";
const blobSha = "b".repeat(40);

test("prepares exact eligible tasks and atomically persists evidence plus verification case", async () => {
  const fixture = await createFixture();
  try {
    const tasks = await fixture.repository.prepareTasks({ runId: "run-1" });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].blobSha, blobSha);
    const evidence = await evidenceFor(tasks[0], "# Testing\n\nUse a read-only test workflow.");
    const first = await fixture.repository.persistEvidence({ task: tasks[0], evidence, now });
    const replay = await fixture.repository.persistEvidence({ task: tasks[0], evidence, now });
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(count(fixture.db, "evidence_bundles"), 1);
    assert.equal(count(fixture.db, "verification_cases"), 1);
    const bundle = fixture.db.prepare(`
      SELECT content_text, metadata_json FROM evidence_bundles
    `).get();
    assert.equal(bundle.content_text, evidence.contentText);
    assert.equal(JSON.parse(bundle.metadata_json).contentPolicy.executable, false);
    const verificationCase = fixture.db.prepare(`
      SELECT id, evidence_bundle_id, original_identity_json FROM verification_cases
    `).get();
    assert.equal(verificationCase.evidence_bundle_id, first.id);
    assert.equal(JSON.parse(verificationCase.original_identity_json).blobSha, blobSha);
    const [primaryInput] = await fixture.repository.preparePrimaryVerifierInputs({ runId: "run-1" });
    assert.equal(primaryInput.contractVersion, "primary-verifier-input-v1");
    assert.equal(primaryInput.caseId, verificationCase.id);
    assert.equal(primaryInput.repository.licenseSpdxId, "MIT");
    assert.equal(primaryInput.source.contentText, evidence.contentText);
    assert.equal(primaryInput.source.untrustedSourceContent, true);
  } finally {
    fixture.db.close();
  }
});

test("never prepares history-filtered candidates for model verification", async () => {
  const fixture = await createFixture();
  try {
    insertCandidate(fixture.db, 2, false);
    const tasks = await fixture.repository.prepareTasks({ runId: "run-1" });
    assert.deepEqual(tasks.map((task) => task.candidateId), ["candidate-1"]);
  } finally {
    fixture.db.close();
  }
});

test("rejects evidence identity and content-hash drift before writing", async () => {
  const fixture = await createFixture();
  try {
    const [task] = await fixture.repository.prepareTasks({ runId: "run-1" });
    const evidence = await evidenceFor(task, "# Testing");
    await assert.rejects(
      fixture.repository.persistEvidence({
        task,
        evidence: { ...evidence, blobSha: "c".repeat(40) },
        now,
      }),
      /identity does not match/,
    );
    await assert.rejects(
      fixture.repository.persistEvidence({
        task,
        evidence: { ...evidence, contentSha256: "f".repeat(64) },
        now,
      }),
      /content hash is invalid/,
    );
    await assert.rejects(
      fixture.repository.persistEvidence({
        task,
        evidence: { ...evidence, apiUrl: "https://api.github.com/repos/other/repo/git/blobs/other" },
        now,
      }),
      /API URL is invalid/,
    );
    assert.equal(count(fixture.db, "evidence_bundles"), 0);
  } finally {
    fixture.db.close();
  }
});

test("detects stored evidence and verification-case drift on replay", async () => {
  const fixture = await createFixture();
  try {
    const [task] = await fixture.repository.prepareTasks({ runId: "run-1" });
    const evidence = await evidenceFor(task, "# Testing");
    await fixture.repository.persistEvidence({ task, evidence, now });
    fixture.db.prepare(`UPDATE evidence_bundles SET evidence_hash = ?`).run("f".repeat(64));
    await assert.rejects(
      fixture.repository.persistEvidence({ task, evidence, now }),
      (error) => error instanceof ShadowRunConflictError && /bundle/.test(error.message),
    );
    fixture.db.prepare(`UPDATE evidence_bundles SET evidence_hash = ?`).run(
      await evidenceHashFromStored(fixture.db),
    );
    fixture.db.prepare(`UPDATE verification_cases SET evidence_bundle_id = NULL`).run();
    await assert.rejects(
      fixture.repository.persistEvidence({ task, evidence, now }),
      (error) => error instanceof ShadowRunConflictError && /not linked/.test(error.message),
    );
  } finally {
    fixture.db.close();
  }
});

test("revalidates stored evidence before preparing primary model input", async () => {
  const fixture = await createFixture();
  try {
    const [task] = await fixture.repository.prepareTasks({ runId: "run-1" });
    const evidence = await evidenceFor(task, "# Testing");
    await fixture.repository.persistEvidence({ task, evidence, now });
    fixture.db.prepare("UPDATE evidence_bundles SET content_text = '# Drifted'").run();
    await assert.rejects(
      fixture.repository.preparePrimaryVerifierInputs({ runId: "run-1" }),
      (error) => error instanceof ShadowRunConflictError
        && /not ready for primary verification/.test(error.message),
    );
  } finally {
    fixture.db.close();
  }
});

test("D1 rollback leaves neither evidence nor a case when case creation fails", async () => {
  const fixture = await createFixture();
  try {
    const [task] = await fixture.repository.prepareTasks({ runId: "run-1" });
    const evidence = await evidenceFor(task, "# Testing");
    fixture.db.exec(`
      CREATE TRIGGER reject_case BEFORE INSERT ON verification_cases
      BEGIN SELECT RAISE(ABORT, 'fixture case rejection'); END
    `);
    await assert.rejects(
      fixture.repository.persistEvidence({ task, evidence, now }),
      /fixture case rejection/,
    );
    assert.equal(count(fixture.db, "evidence_bundles"), 0);
    assert.equal(count(fixture.db, "verification_cases"), 0);
  } finally {
    fixture.db.close();
  }
});

test("does not prepare evidence while the candidate pool still requires replenishment", async () => {
  const fixture = await createFixture();
  try {
    fixture.db.prepare(`UPDATE candidate_pool_passes SET next_action = 'replenish'`).run();
    await assert.rejects(
      fixture.repository.prepareTasks({ runId: "run-1" }),
      /completed shadow candidate pool/,
    );
  } finally {
    fixture.db.close();
  }
});

async function createFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.exec(await fs.readFile(migration, "utf8"));
  db.prepare(`
    INSERT INTO engine_runs (
      id, channel, report_date, mode, contract_version, config_hash,
      model_policy_hash, source_policy_hash, status, publication_state,
      budget_soft_usd_micros, budget_hard_usd_micros, candidate_total,
      eligible_total, source_collection_status, created_at, updated_at
    ) VALUES (
      'run-1', 'skill-radar', '2026-08-05', 'shadow', 'engine-shadow-result-v1',
      'config', 'model', 'source', 'filtering', 'blocked_shadow', 3000000,
      5000000, 1, 1, 'complete', ?, ?
    )
  `).run(now, now);
  db.prepare(`
    INSERT INTO candidate_pool_passes (
      id, run_id, filter_pass, contract_version, request_hash, input_hash,
      result_hash, result_json, selected_count, eligible_total,
      cumulative_total, next_action, created_at
    ) VALUES (
      'pool-1', 'run-1', 1, 'candidate-pool-v1', ?, ?, ?, '{}',
      1, 1, 1, 'verify', ?
    )
  `).run("a".repeat(64), "b".repeat(64), "c".repeat(64), now);
  insertCandidate(db, 1, true);
  return { db, repository: new EvidenceBundleRepository(new SqliteD1(db)) };
}

function insertCandidate(db, suffix, eligible) {
  const taskId = `registryPulse:source-${suffix}`;
  const fetchId = `fetch-${suffix}`;
  const batchId = `batch-${suffix}`;
  const artifactId = `artifact-${suffix}`;
  const candidateId = `candidate-${suffix}`;
  const discoveryId = `discovery-${suffix}`;
  const repositoryUrl = `https://github.com/example/repo-${suffix}`;
  const artifactPath = `skills/${suffix}/SKILL.md`;
  const artifactKey = `${repositoryUrl}#artifact=${artifactPath}`;
  db.prepare(`
    INSERT INTO source_fetches (
      id, run_id, request_key, normalized_url, purpose, provenance_class,
      request_policy_json, created_at, task_id, attempt_no, fetch_status,
      cache_status, retryable, result_hash, candidate_signals_json
    ) VALUES (?, 'run-1', ?, 'https://source.example/', 'candidate_discovery',
      'fixture', '{}', ?, ?, 1, 'succeeded', 'fresh', 0, ?, '[]')
  `).run(fetchId, `request-${suffix}`, now, taskId, "d".repeat(64));
  db.prepare(`
    INSERT INTO candidate_resolution_batches (
      id, run_id, task_id, source_fetch_id, filter_pass, contract_version,
      input_signal_count, resolved_signal_count, unresolved_signal_count,
      signal_budget, budget_exhausted, resolution_hash, result_json, created_at
    ) VALUES (?, 'run-1', ?, ?, 1, 'candidate-resolution-v1',
      1, 1, 0, 4, 0, ?, '{}', ?)
  `).run(batchId, taskId, fetchId, "e".repeat(64), now);
  db.prepare(`
    INSERT INTO artifacts (
      id, artifact_key, canonical_repository_url, artifact_path,
      artifact_type, container_type, provenance, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, 'skill', 'artifact_file', 'fixture', ?, ?)
  `).run(artifactId, artifactKey, repositoryUrl, artifactPath, now, now);
  const discoverySnapshot = JSON.stringify({
    contractVersion: "candidate-discovery-v1",
    candidateId,
    artifactKey,
    exactSignal: {
      locatorUrl: `${repositoryUrl}/blob/main/${artifactPath}`,
    },
    sourceEvidence: {
      repositoryUrl,
      artifactPath,
      treeSha: "a".repeat(40),
      blobSha,
      repository: {
        fullName: "example/rules",
        htmlUrl: repositoryUrl,
        description: "Reusable agent rules.",
        archived: false,
        disabled: false,
        pushedAt: now,
        updatedAt: now,
        licenseSpdxId: "MIT",
        licenseName: "MIT License",
      },
    },
  });
  db.prepare(`
    INSERT INTO candidate_discoveries (
      id, batch_id, run_id, candidate_id, artifact_id, exact_signal_id,
      lane, source_id, source_rank, candidate_snapshot_json, evidence_hash, created_at
    ) VALUES (?, ?, 'run-1', ?, ?, ?, 'registryPulse', ?, 1, ?, ?, ?)
  `).run(
    discoveryId, batchId, candidateId, artifactId, `signal-${suffix}`,
    `source-${suffix}`, discoverySnapshot, "f".repeat(64), now,
  );
  const poolSnapshot = JSON.stringify({
    contractVersion: "candidate-pool-snapshot-v1",
    candidateId,
    artifactId,
    artifactKey,
    canonicalRepositoryUrl: repositoryUrl,
    artifactPath,
    primaryDiscoveryId: discoveryId,
  });
  db.prepare(`
    INSERT INTO run_candidates (
      id, run_id, candidate_id, artifact_id, lane, source_id, filter_pass,
      snapshot_json, eligible, exclusion_reason, material_change_json,
      final_disposition, created_at, updated_at
    ) VALUES (?, 'run-1', ?, ?, 'registryPulse', ?, 1, ?, ?, ?, '{}', ?, ?, ?)
  `).run(
    `run-candidate-${suffix}`, candidateId, artifactId, `source-${suffix}`,
    poolSnapshot, eligible ? 1 : 0, eligible ? null : "history-filtered",
    eligible ? "eligible" : "filtered", now, now,
  );
}

async function evidenceFor(task, content) {
  return fetchGithubBlobEvidence({
    repositoryUrl: task.repositoryUrl,
    artifactPath: task.artifactPath,
    blobSha: task.blobSha,
    observedAt: now,
    fetchImpl: async () => new Response(JSON.stringify({
      sha: task.blobSha,
      size: new TextEncoder().encode(content).byteLength,
      encoding: "base64",
      content: btoa(content),
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
}

async function evidenceHashFromStored(db) {
  const row = db.prepare(`SELECT metadata_json, content_text FROM evidence_bundles`).get();
  const value = stableJson({ metadata: JSON.parse(row.metadata_json), contentText: row.content_text });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0")).join("");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
