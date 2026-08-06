import {
  GITHUB_ARTIFACT_BYTE_LIMIT,
  githubRepositoryIdentity,
} from "./github-source-adapter.js";
import { ShadowRunConflictError } from "./run-repository.js";

const TASK_CONTRACT = "artifact-evidence-task-v1";
const BUNDLE_CONTRACT = "artifact-evidence-bundle-v1";
const PRIMARY_INPUT_CONTRACT = "primary-verifier-input-v1";

export class EvidenceBundleRepository {
  constructor(database) {
    if (!database?.prepare || !database?.batch) {
      throw new TypeError("A D1-compatible database binding with batch support is required");
    }
    this.database = database;
  }

  async prepareTasks({ runId }) {
    assertRunId(runId);
    await this.requireEvidenceStage(runId);
    const rows = await all(this.database.prepare(`
      SELECT candidate_id FROM run_candidates
      WHERE run_id = ? AND eligible = 1 AND final_disposition = 'eligible'
      ORDER BY candidate_id
    `).bind(runId));
    const tasks = [];
    for (const row of rows) tasks.push(await this.loadTask(runId, row.candidate_id));
    const run = await this.database.prepare(`
      SELECT eligible_total FROM engine_runs WHERE id = ?
    `).bind(runId).first();
    if (Number(run?.eligible_total) !== tasks.length) {
      throw new ShadowRunConflictError("eligible candidate total does not match evidence tasks");
    }
    return tasks;
  }

  async persistEvidence({ task, evidence, now }) {
    assertPersistenceInputs({ task, evidence, now });
    await this.requireEvidenceStage(task.runId);
    const authoritativeTask = await this.loadTask(task.runId, task.candidateId);
    if (stableJson(authoritativeTask) !== stableJson(task)) {
      throw new ShadowRunConflictError("artifact evidence task has immutable drift");
    }
    const contentBytes = new TextEncoder().encode(evidence.contentText);
    if (contentBytes.byteLength !== evidence.byteCount
      || contentBytes.byteLength < 1 || contentBytes.byteLength > GITHUB_ARTIFACT_BYTE_LIMIT) {
      throw new TypeError("artifact evidence byte count is invalid");
    }
    const contentSha256 = await sha256Bytes(contentBytes);
    if (contentSha256 !== evidence.contentSha256) {
      throw new TypeError("artifact evidence content hash is invalid");
    }
    const bundleId = `evidence_${(await sha256(`${task.runId}\n${task.candidateId}`)).slice(0, 32)}`;
    const metadata = {
      contractVersion: BUNDLE_CONTRACT,
      task,
      source: {
        contractVersion: evidence.contractVersion,
        sourceType: evidence.sourceType,
        repositoryUrl: evidence.repositoryUrl,
        artifactPath: evidence.artifactPath,
        blobSha: evidence.blobSha,
        apiUrl: evidence.apiUrl,
        observedAt: evidence.observedAt,
        byteCount: evidence.byteCount,
        contentSha256: evidence.contentSha256,
        untrustedSourceContent: evidence.untrustedSourceContent,
      },
      contentPolicy: {
        mode: "exact_artifact_full_bounded",
        maximumBytes: GITHUB_ARTIFACT_BYTE_LIMIT,
        executable: false,
      },
    };
    const metadataJson = stableJson(metadata);
    if (new TextEncoder().encode(metadataJson).byteLength > 65_536) {
      throw new TypeError("artifact evidence metadata exceeds its byte limit");
    }
    const evidenceHash = await sha256(stableJson({ metadata, contentText: evidence.contentText }));
    const existing = await this.findBundle(task.runId, task.candidateId);
    if (existing) {
      assertMatchingBundle(existing, { evidenceHash, metadataJson, evidence, task });
      await this.verifyCase(existing, task);
      return summary(existing, false);
    }

    const caseId = `case_${(await sha256(`${task.runId}\n${task.candidateId}`)).slice(0, 32)}`;
    const originalIdentityJson = stableJson({
      contractVersion: "verification-case-identity-v1",
      candidateId: task.candidateId,
      artifactId: task.artifactId,
      artifactKey: task.artifactKey,
      repositoryUrl: task.repositoryUrl,
      artifactPath: task.artifactPath,
      locatorUrl: task.locatorUrl,
      treeSha: task.treeSha,
      blobSha: task.blobSha,
      evidenceBundleId: bundleId,
    });
    const statements = [
      this.database.prepare(`
        INSERT INTO evidence_bundles (
          id, run_id, candidate_id, artifact_id, source_discovery_id,
          contract_version, repository_url, artifact_path, blob_sha, api_url,
          observed_at, source_byte_count, content_sha256, content_text,
          metadata_json, evidence_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        bundleId, task.runId, task.candidateId, task.artifactId,
        task.primaryDiscoveryId, BUNDLE_CONTRACT, task.repositoryUrl,
        task.artifactPath, task.blobSha, evidence.apiUrl, evidence.observedAt,
        evidence.byteCount, evidence.contentSha256, evidence.contentText,
        metadataJson, evidenceHash, now,
      ),
      this.database.prepare(`
        INSERT INTO verification_cases (
          id, run_id, candidate_id, original_identity_json, evidence_bundle_id,
          disposition, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      `).bind(
        caseId, task.runId, task.candidateId, originalIdentityJson, bundleId, now, now,
      ),
    ];
    try {
      await this.database.batch(statements);
    } catch (error) {
      const raced = await this.findBundle(task.runId, task.candidateId);
      if (!raced) throw error;
      assertMatchingBundle(raced, { evidenceHash, metadataJson, evidence, task });
      await this.verifyCase(raced, task);
      return summary(raced, false);
    }
    const stored = await this.findBundle(task.runId, task.candidateId);
    if (!stored) throw new Error("artifact evidence bundle was not persisted");
    assertMatchingBundle(stored, { evidenceHash, metadataJson, evidence, task });
    await this.verifyCase(stored, task);
    return summary(stored, true);
  }

  async preparePrimaryVerifierInputs({ runId }) {
    assertRunId(runId);
    await this.requireEvidenceStage(runId);
    const rows = await all(this.database.prepare(`
      SELECT c.id AS case_id, c.candidate_id, c.original_identity_json,
        c.disposition, b.id AS bundle_id, b.repository_url, b.artifact_path,
        b.blob_sha, b.api_url, b.observed_at, b.source_byte_count,
        b.content_sha256, b.content_text, b.metadata_json, b.evidence_hash
      FROM verification_cases c
      JOIN evidence_bundles b ON b.id = c.evidence_bundle_id
      WHERE c.run_id = ? AND c.disposition = 'pending'
      ORDER BY c.candidate_id
    `).bind(runId));
    return Promise.all(rows.map((row) => primaryVerifierInput(row, runId)));
  }

  async requireEvidenceStage(runId) {
    const row = await this.database.prepare(`
      SELECT r.id, r.mode, r.publication_state, r.source_collection_status,
        p.next_action
      FROM engine_runs r
      JOIN candidate_pool_passes p ON p.run_id = r.id
      WHERE r.id = ?
      ORDER BY p.filter_pass DESC LIMIT 1
    `).bind(runId).first();
    if (!row || row.mode !== "shadow" || row.publication_state !== "blocked_shadow"
      || !["complete", "degraded"].includes(row.source_collection_status)
      || !["verify", "verify_below_target"].includes(row.next_action)) {
      throw new TypeError("artifact evidence requires a completed shadow candidate pool");
    }
  }

  async loadTask(runId, candidateId) {
    const candidate = await this.database.prepare(`
      SELECT id, artifact_id, snapshot_json FROM run_candidates
      WHERE run_id = ? AND candidate_id = ? AND eligible = 1
        AND final_disposition = 'eligible'
    `).bind(runId, candidateId).first();
    if (!candidate) throw new TypeError("artifact evidence requires an eligible run candidate");
    const snapshot = parseJson(candidate.snapshot_json, "candidate pool snapshot");
    if (snapshot.contractVersion !== "candidate-pool-snapshot-v1"
      || snapshot.candidateId !== candidateId || snapshot.artifactId !== candidate.artifact_id
      || typeof snapshot.primaryDiscoveryId !== "string") {
      throw new ShadowRunConflictError("candidate pool snapshot cannot create evidence");
    }
    const discovery = await this.database.prepare(`
      SELECT candidate_snapshot_json FROM candidate_discoveries
      WHERE id = ? AND run_id = ? AND candidate_id = ? AND artifact_id = ?
    `).bind(
      snapshot.primaryDiscoveryId, runId, candidateId, candidate.artifact_id,
    ).first();
    if (!discovery) throw new ShadowRunConflictError("primary candidate discovery is missing");
    const source = parseJson(discovery.candidate_snapshot_json, "candidate discovery snapshot");
    if (source.contractVersion !== "candidate-discovery-v1"
      || source.candidateId !== candidateId
      || source.artifactKey !== snapshot.artifactKey
      || source.sourceEvidence?.repositoryUrl !== snapshot.canonicalRepositoryUrl
      || source.sourceEvidence?.artifactPath !== snapshot.artifactPath
      || !/^[a-f0-9]{40}$/i.test(source.sourceEvidence?.treeSha || "")
      || !/^[a-f0-9]{40}$/i.test(source.sourceEvidence?.blobSha || "")
      || !validRepositoryEvidence(
        source.sourceEvidence?.repository,
        snapshot.canonicalRepositoryUrl,
      )) {
      throw new ShadowRunConflictError("candidate discovery evidence cannot create a task");
    }
    return {
      contractVersion: TASK_CONTRACT,
      runId,
      candidateId,
      artifactId: candidate.artifact_id,
      artifactKey: snapshot.artifactKey,
      repositoryUrl: snapshot.canonicalRepositoryUrl,
      artifactPath: snapshot.artifactPath,
      locatorUrl: source.exactSignal?.locatorUrl || null,
      primaryDiscoveryId: snapshot.primaryDiscoveryId,
      treeSha: source.sourceEvidence.treeSha.toLowerCase(),
      blobSha: source.sourceEvidence.blobSha.toLowerCase(),
      repository: source.sourceEvidence.repository,
    };
  }

  async findBundle(runId, candidateId) {
    return this.database.prepare(`
      SELECT id, run_id, candidate_id, artifact_id, source_discovery_id,
        repository_url, artifact_path, blob_sha, api_url, observed_at,
        source_byte_count, content_sha256, content_text, metadata_json,
        evidence_hash
      FROM evidence_bundles WHERE run_id = ? AND candidate_id = ?
    `).bind(runId, candidateId).first();
  }

  async verifyCase(bundle, task) {
    const row = await this.database.prepare(`
      SELECT run_id, candidate_id, evidence_bundle_id, original_identity_json
      FROM verification_cases WHERE run_id = ? AND candidate_id = ?
    `).bind(task.runId, task.candidateId).first();
    if (!row || row.evidence_bundle_id !== bundle.id) {
      throw new ShadowRunConflictError("verification case is not linked to its evidence bundle");
    }
    const identity = parseJson(row.original_identity_json, "verification case identity");
    if (identity.evidenceBundleId !== bundle.id || identity.candidateId !== task.candidateId
      || identity.artifactId !== task.artifactId || identity.artifactKey !== task.artifactKey
      || identity.repositoryUrl !== task.repositoryUrl || identity.artifactPath !== task.artifactPath
      || identity.blobSha !== task.blobSha) {
      throw new ShadowRunConflictError("verification case identity has immutable drift");
    }
  }
}

async function primaryVerifierInput(row, runId) {
  const identity = parseJson(row.original_identity_json, "verification case identity");
  const metadata = parseJson(row.metadata_json, "artifact evidence metadata");
  const repository = metadata.task?.repository;
  const contentBytes = new TextEncoder().encode(row.content_text);
  const contentSha256 = await sha256Bytes(contentBytes);
  const evidenceHash = await sha256(stableJson({ metadata, contentText: row.content_text }));
  if (identity.evidenceBundleId !== row.bundle_id || identity.candidateId !== row.candidate_id
    || identity.repositoryUrl !== row.repository_url || identity.artifactPath !== row.artifact_path
    || identity.blobSha !== row.blob_sha || metadata.contractVersion !== BUNDLE_CONTRACT
    || metadata.task?.contractVersion !== TASK_CONTRACT
    || metadata.task?.candidateId !== row.candidate_id
    || metadata.source?.contentSha256 !== row.content_sha256
    || Number(metadata.source?.byteCount) !== Number(row.source_byte_count)
    || contentBytes.byteLength !== Number(row.source_byte_count)
    || contentSha256 !== row.content_sha256 || evidenceHash !== row.evidence_hash
    || !validRepositoryEvidence(repository, row.repository_url)) {
    throw new ShadowRunConflictError("artifact evidence is not ready for primary verification");
  }
  return {
    contractVersion: PRIMARY_INPUT_CONTRACT,
    runId,
    caseId: row.case_id,
    candidateId: row.candidate_id,
    identity,
    repository,
    source: {
      evidenceBundleId: row.bundle_id,
      repositoryUrl: row.repository_url,
      artifactPath: row.artifact_path,
      locatorUrl: metadata.task.locatorUrl,
      blobSha: row.blob_sha,
      apiUrl: row.api_url,
      observedAt: row.observed_at,
      byteCount: Number(row.source_byte_count),
      contentSha256: row.content_sha256,
      evidenceHash: row.evidence_hash,
      contentText: row.content_text,
      untrustedSourceContent: true,
    },
  };
}

function validRepositoryEvidence(repository, repositoryUrl) {
  if (!repository || typeof repository !== "object"
    || repository.htmlUrl !== repositoryUrl
    || typeof repository.fullName !== "string" || !repository.fullName
    || typeof repository.archived !== "boolean"
    || typeof repository.disabled !== "boolean") return false;
  for (const field of ["pushedAt", "updatedAt"]) {
    if (repository[field] !== null && !Number.isFinite(Date.parse(repository[field]))) return false;
  }
  return true;
}

function assertPersistenceInputs({ task, evidence, now }) {
  if (!task || task.contractVersion !== TASK_CONTRACT) throw new TypeError("artifact evidence task is invalid");
  if (!evidence || evidence.contractVersion !== "github-blob-evidence-v1"
    || evidence.sourceType !== "github_blob" || evidence.untrustedSourceContent !== true) {
    throw new TypeError("GitHub blob evidence contract is invalid");
  }
  if (evidence.repositoryUrl !== task.repositoryUrl || evidence.artifactPath !== task.artifactPath
    || evidence.blobSha !== task.blobSha) {
    throw new TypeError("GitHub blob evidence identity does not match its task");
  }
  if (!Number.isFinite(Date.parse(evidence.observedAt)) || !Number.isFinite(Date.parse(now))) {
    throw new TypeError("artifact evidence timestamps are invalid");
  }
  const expectedApiUrl = `${githubRepositoryIdentity(task.repositoryUrl).apiUrl}/git/blobs/${task.blobSha}`;
  if (evidence.apiUrl !== expectedApiUrl) {
    throw new TypeError("artifact evidence API URL is invalid");
  }
}

function assertMatchingBundle(row, { evidenceHash, metadataJson, evidence, task }) {
  if (row.evidence_hash !== evidenceHash || row.metadata_json !== metadataJson
    || row.content_text !== evidence.contentText || row.content_sha256 !== evidence.contentSha256
    || Number(row.source_byte_count) !== evidence.byteCount
    || row.blob_sha !== evidence.blobSha || row.api_url !== evidence.apiUrl
    || row.observed_at !== evidence.observedAt || row.run_id !== task.runId
    || row.candidate_id !== task.candidateId || row.artifact_id !== task.artifactId
    || row.source_discovery_id !== task.primaryDiscoveryId
    || row.repository_url !== task.repositoryUrl || row.artifact_path !== task.artifactPath) {
    throw new ShadowRunConflictError("artifact evidence bundle has immutable drift");
  }
}

function summary(row, created) {
  return {
    id: row.id,
    runId: row.run_id,
    candidateId: row.candidate_id,
    evidenceHash: row.evidence_hash,
    contentSha256: row.content_sha256,
    byteCount: Number(row.source_byte_count),
    created,
  };
}

function parseJson(value, label) {
  try { return JSON.parse(value); } catch {
    throw new ShadowRunConflictError(`${label} is invalid JSON`);
  }
}

function assertRunId(value) {
  if (typeof value !== "string" || !value || value.length > 100) throw new TypeError("runId is invalid");
}

async function all(statement) {
  const value = await statement.all();
  return Array.isArray(value) ? value : value?.results || [];
}

async function sha256(value) {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
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
