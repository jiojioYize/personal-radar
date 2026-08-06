import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createCandidateSignal } from "../src/stage3a/candidate-signals.js";
import { resolveSourceCandidateSignals } from "../src/stage3a/candidate-resolver.js";
import { CandidateResolutionRepository } from "../src/stage3a/candidate-resolution-repository.js";
import { ShadowRunConflictError } from "../src/stage3a/run-repository.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPaths = [
  "0001_shadow_engine.sql", "0002_source_collection.sql", "0003_candidate_resolution.sql",
].map((name) => path.join(root, "migrations", "stage3a", name));
const now = "2026-08-05T00:00:00.000Z";

test("atomically persists an immutable resolution batch, trajectory, artifact, and discovery", async () => {
  const fixture = await repositoryFixture();
  try {
    const prepared = await preparedResolution(fixture.db);
    const first = await fixture.repository.persistBatch({
      runId: "run-1",
      ...prepared,
      filterPass: 1,
      now,
    });
    const repeated = await fixture.repository.persistBatch({
      runId: "run-1",
      ...prepared,
      filterPass: 1,
      now,
    });
    assert.equal(first.created, true);
    assert.equal(repeated.created, false);
    assert.equal(first.resolvedSignalCount, 1);
    assert.match(first.resolutionHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(tableCounts(fixture.db), {
      batches: 1, trajectories: 1, discoveries: 1, artifacts: 1, candidates: 0,
    });
    const stored = fixture.db.prepare(`
      SELECT candidate_snapshot_json, evidence_hash FROM candidate_discoveries
    `).get();
    const snapshot = JSON.parse(stored.candidate_snapshot_json);
    assert.equal(snapshot.contractVersion, "candidate-discovery-v1");
    assert.equal(snapshot.sourceEvidence.treeSha, prepared.githubSnapshots.values().next().value.treeSha);
    assert.match(snapshot.sourceEvidence.blobSha, /^[a-f0-9]{40}$/);
    assert.match(stored.evidence_hash, /^[a-f0-9]{64}$/);
  } finally {
    fixture.db.close();
  }
});

test("rejects immutable evidence drift without adding child rows", async () => {
  const fixture = await repositoryFixture();
  try {
    const prepared = await preparedResolution(fixture.db);
    await fixture.repository.persistBatch({ runId: "run-1", ...prepared, filterPass: 1, now });
    const changedSnapshots = new Map(prepared.githubSnapshots);
    const changed = structuredClone(changedSnapshots.values().next().value);
    changed.treeSha = "f".repeat(40);
    changedSnapshots.set(changed.repositoryUrl, changed);
    await assert.rejects(
      fixture.repository.persistBatch({
        runId: "run-1",
        ...prepared,
        githubSnapshots: changedSnapshots,
        filterPass: 1,
        now,
      }),
      (error) => error instanceof ShadowRunConflictError,
    );
    assert.deepEqual(tableCounts(fixture.db), {
      batches: 1, trajectories: 1, discoveries: 1, artifacts: 1, candidates: 0,
    });
  } finally {
    fixture.db.close();
  }
});

test("detects stored trajectory corruption during an idempotent replay", async () => {
  const fixture = await repositoryFixture();
  try {
    const prepared = await preparedResolution(fixture.db);
    await fixture.repository.persistBatch({ runId: "run-1", ...prepared, filterPass: 1, now });
    fixture.db.prepare(`
      UPDATE candidate_resolution_trajectories SET trajectory_hash = ?
    `).run("f".repeat(64));
    await assert.rejects(
      fixture.repository.persistBatch({ runId: "run-1", ...prepared, filterPass: 1, now }),
      (error) => error instanceof ShadowRunConflictError && /trajectory/.test(error.message),
    );
  } finally {
    fixture.db.close();
  }
});

test("requires immutable blob evidence before starting a D1 batch", async () => {
  const fixture = await repositoryFixture();
  try {
    const prepared = await preparedResolution(fixture.db);
    const brokenSnapshots = new Map(prepared.githubSnapshots);
    const broken = structuredClone(brokenSnapshots.values().next().value);
    broken.entries = [];
    brokenSnapshots.set(broken.repositoryUrl, broken);
    await assert.rejects(
      fixture.repository.persistBatch({
        runId: "run-1",
        ...prepared,
        githubSnapshots: brokenSnapshots,
        filterPass: 1,
        now,
      }),
      /immutable blob evidence/,
    );
    assert.deepEqual(tableCounts(fixture.db), {
      batches: 0, trajectories: 0, discoveries: 0, artifacts: 0, candidates: 0,
    });
  } finally {
    fixture.db.close();
  }
});

test("does not resolve from failed or degraded source fetches", async () => {
  const fixture = await repositoryFixture();
  try {
    const prepared = await preparedResolution(fixture.db);
    fixture.db.prepare(`
      UPDATE source_fetches SET fetch_status = 'degraded_cached', cache_status = 'stale_fallback'
      WHERE id = 'fetch-1'
    `).run();
    await assert.rejects(
      fixture.repository.persistBatch({ runId: "run-1", ...prepared, filterPass: 1, now }),
      /requires a succeeded source fetch/,
    );
    assert.deepEqual(tableCounts(fixture.db), {
      batches: 0, trajectories: 0, discoveries: 0, artifacts: 0, candidates: 0,
    });
  } finally {
    fixture.db.close();
  }
});

test("does not accept signals that differ from the linked source fetch", async () => {
  const fixture = await repositoryFixture();
  try {
    const prepared = await preparedResolution(fixture.db);
    fixture.db.prepare(`
      UPDATE source_fetches SET candidate_signals_json = '[]' WHERE id = 'fetch-1'
    `).run();
    await assert.rejects(
      fixture.repository.persistBatch({ runId: "run-1", ...prepared, filterPass: 1, now }),
      /input signals do not match/,
    );
    assert.equal(count(fixture.db, "candidate_resolution_batches"), 0);
  } finally {
    fixture.db.close();
  }
});

test("retains two source discoveries for one artifact without racing run_candidates", async () => {
  const fixture = await repositoryFixture();
  try {
    const first = await preparedResolution(fixture.db);
    await fixture.repository.persistBatch({ runId: "run-1", ...first, filterPass: 1, now });
    const secondTask = sourceTask("communityTrend", "community", "https://directory.example/");
    const exact = await createCandidateSignal({
      task: secondTask,
      signalKind: "exact_artifact",
      title: "testing",
      locatorUrl: "https://github.com/example/rules/blob/main/skills/testing/SKILL.md",
      repositoryUrl: "https://github.com/example/rules",
      artifactPath: "skills/testing/SKILL.md",
      artifactType: "skill",
      evidenceText: "Community directory links to the exact artifact",
      sourceRank: 1,
      observedAt: now,
    });
    insertSourceFetch(fixture.db, "fetch-2", secondTask.taskId, "succeeded", [exact]);
    const snapshot = first.githubSnapshots.values().next().value;
    const secondResolution = await resolveSourceCandidateSignals({
      task: secondTask,
      signals: [exact],
      snapshots: new Map([[snapshot.repositoryUrl, snapshot]]),
      completedRunCount: 0,
      observedAt: now,
    });
    await fixture.repository.persistBatch({
      runId: "run-1",
      task: secondTask,
      sourceFetchId: "fetch-2",
      filterPass: 1,
      inputSignals: [exact],
      resolution: secondResolution,
      githubSnapshots: new Map([[snapshot.repositoryUrl, snapshot]]),
      now,
    });
    assert.deepEqual(tableCounts(fixture.db), {
      batches: 2, trajectories: 2, discoveries: 2, artifacts: 1, candidates: 0,
    });
    const distinctCandidates = fixture.db.prepare(`
      SELECT COUNT(DISTINCT candidate_id) AS count FROM candidate_discoveries
    `).get();
    assert.equal(Number(distinctCandidates.count), 1);
  } finally {
    fixture.db.close();
  }
});

test("rolls back the whole D1 batch when a later artifact statement fails", async () => {
  const fixture = await repositoryFixture();
  try {
    const prepared = await preparedResolution(fixture.db);
    const artifactKey = "https://github.com/example/rules#artifact=skills/testing/SKILL.md";
    const artifactHash = await sha256(artifactKey);
    fixture.db.prepare(`
      INSERT INTO artifacts (
        id, artifact_key, canonical_repository_url, artifact_path,
        artifact_type, container_type, provenance, first_seen_at, last_seen_at
      ) VALUES (?, 'https://github.com/conflict/repo#artifact=SKILL.md',
        'https://github.com/conflict/repo', 'SKILL.md', 'skill',
        'artifact_file', 'fixture', ?, ?)
    `).run(`artifact_${artifactHash.slice(0, 32)}`, now, now);
    await assert.rejects(
      fixture.repository.persistBatch({ runId: "run-1", ...prepared, filterPass: 1, now }),
      /UNIQUE constraint failed/,
    );
    assert.deepEqual(tableCounts(fixture.db), {
      batches: 0, trajectories: 0, discoveries: 0, artifacts: 1, candidates: 0,
    });
  } finally {
    fixture.db.close();
  }
});

async function preparedResolution(db) {
  const task = sourceTask();
  const lead = await createCandidateSignal({
    task,
    signalKind: "artifact_lead",
    title: "testing",
    locatorUrl: "https://www.skills.sh/example/rules/testing",
    repositoryUrl: "https://github.com/example/rules",
    artifactType: "skill",
    evidenceText: "Registry lists testing",
    sourceRank: 1,
    observedAt: now,
  });
  const snapshot = githubSnapshot();
  const githubSnapshots = new Map([[snapshot.repositoryUrl, snapshot]]);
  const resolution = await resolveSourceCandidateSignals({
    task,
    signals: [lead],
    snapshots: githubSnapshots,
    completedRunCount: 0,
    observedAt: now,
  });
  insertSourceFetch(db, "fetch-1", task.taskId, "succeeded", [lead]);
  return {
    task,
    sourceFetchId: "fetch-1",
    inputSignals: [lead],
    resolution,
    githubSnapshots,
  };
}

function githubSnapshot() {
  return {
    version: 1,
    repositoryUrl: "https://github.com/example/rules",
    defaultBranch: "main",
    treeSha: "a".repeat(40),
    collectionMode: "recursive",
    treeRequests: 1,
    collectedTreeBytes: null,
    entries: [{
      path: "skills/testing/SKILL.md",
      type: "blob",
      sha: "b".repeat(40),
      size: 120,
    }],
    repository: {
      fullName: "example/rules",
      htmlUrl: "https://github.com/example/rules",
      description: "Reusable agent rules.",
      archived: false,
      disabled: false,
      pushedAt: now,
      updatedAt: now,
      licenseSpdxId: "MIT",
      licenseName: "MIT License",
    },
  };
}

function sourceTask(lane = "registryPulse", sourceId = "skillsSh", url = "https://www.skills.sh/") {
  return {
    taskId: `${lane}:${sourceId}`,
    lane,
    sourceId,
    url,
    provenancePolicy: lane === "communityTrend" ? "independent" : "first_party_or_official",
    maxCandidateSignals: 4,
  };
}

function tableCounts(db) {
  return {
    batches: count(db, "candidate_resolution_batches"),
    trajectories: count(db, "candidate_resolution_trajectories"),
    discoveries: count(db, "candidate_discoveries"),
    artifacts: count(db, "artifacts"),
    candidates: count(db, "run_candidates"),
  };
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function repositoryFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migrationPath of migrationPaths) db.exec(await fs.readFile(migrationPath, "utf8"));
  insertRun(db);
  return { db, repository: new CandidateResolutionRepository(new SqliteD1(db)) };
}

function insertRun(db) {
  db.prepare(`
    INSERT INTO engine_runs (
      id, channel, report_date, mode, contract_version, config_hash,
      model_policy_hash, source_policy_hash, status, publication_state,
      budget_soft_usd_micros, budget_hard_usd_micros, created_at, updated_at
    ) VALUES (
      'run-1', 'skill-radar', '2026-08-05', 'shadow', 'engine-shadow-result-v1',
      'config', 'model', 'source', 'collecting', 'blocked_shadow',
      3000000, 5000000, ?, ?
    )
  `).run(now, now);
}

function insertSourceFetch(db, id, taskId, status = "succeeded", candidateSignals = []) {
  db.prepare(`
    INSERT INTO source_fetches (
      id, run_id, request_key, normalized_url, purpose, provenance_class,
      request_policy_json, created_at, task_id, attempt_no, fetch_status,
      cache_status, retryable, result_hash, candidate_signals_json
    ) VALUES (?, 'run-1', ?, 'https://source.example/', 'candidate_discovery',
      'fixture', '{}', ?, ?, 1, ?, 'fresh', 0, ?, ?)
  `).run(
    id,
    `request-${id}`,
    now,
    taskId,
    status,
    id.padEnd(64, "a").slice(0, 64),
    JSON.stringify(candidateSignals),
  );
}

class SqliteD1 {
  constructor(database) {
    this.database = database;
  }
  prepare(sql) {
    return new SqliteD1Statement(this.database.prepare(sql));
  }
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
  constructor(statement, values = []) {
    this.statement = statement;
    this.values = values;
  }
  bind(...values) {
    return new SqliteD1Statement(this.statement, values);
  }
  execute() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
  async run() {
    return this.execute();
  }
  async first() {
    return this.statement.get(...this.values) ?? null;
  }
}
