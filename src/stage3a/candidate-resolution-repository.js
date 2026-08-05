import { validateSourceCandidateResolution } from "./candidate-resolver.js";
import { canonicalRepositoryUrl } from "./candidate-signals.js";
import {
  DEFAULT_GITHUB_TRAVERSAL_LIMITS,
  GITHUB_TREE_BYTE_LIMIT,
} from "./github-source-adapter.js";
import { ShadowRunConflictError } from "./run-repository.js";

const RESOLUTION_CONTRACT = "candidate-resolution-v1";

export class CandidateResolutionRepository {
  constructor(database) {
    if (!database?.prepare || !database?.batch) {
      throw new TypeError("A D1-compatible database binding with batch support is required");
    }
    this.database = database;
  }

  async persistBatch({
    runId,
    task,
    sourceFetchId,
    filterPass,
    inputSignals,
    resolution,
    githubSnapshots,
    now,
  }) {
    assertPersistenceInputs({ runId, task, filterPass, inputSignals, resolution, now });
    await this.requireSuccessfulSourceFetch({
      sourceFetchId, runId, taskId: task.taskId, inputSignals,
    });
    const sourceEvidence = await resolvedSourceEvidence(
      resolution.resolvedSignals, githubSnapshots, filterPass,
    );
    const payload = {
      contractVersion: RESOLUTION_CONTRACT,
      runId,
      taskId: task.taskId,
      sourceFetchId,
      filterPass,
      inputSignals,
      resolution,
      sourceEvidence,
    };
    const resultJson = stableJson(payload);
    if (new TextEncoder().encode(resultJson).byteLength > 262_144) {
      throw new TypeError("candidate resolution payload exceeds its byte limit");
    }
    const resolutionHash = await sha256(resultJson);
    const batchKey = await sha256(`${runId}\n${task.taskId}\n${filterPass}`);
    const batchId = `resolution_${batchKey.slice(0, 32)}`;
    const existing = await this.findBatch({ runId, taskId: task.taskId, filterPass });
    if (existing) {
      assertMatchingBatch(existing, resolutionHash, resultJson);
      assertBatchMetadata(existing, sourceFetchId, inputSignals, resolution);
      await this.verifyChildren({ batchId: existing.id, resolution, sourceEvidence });
      return summary(existing, false);
    }

    const unresolvedCount = resolution.trajectories.filter((item) =>
      ["unresolved", "ambiguous", "not_resolved"].includes(item.status)).length;
    const statements = [this.database.prepare(`
      INSERT INTO candidate_resolution_batches (
        id, run_id, task_id, source_fetch_id, filter_pass, contract_version,
        input_signal_count, resolved_signal_count, unresolved_signal_count,
        signal_budget, budget_exhausted, resolution_hash, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, task_id, filter_pass) DO NOTHING
    `).bind(
      batchId,
      runId,
      task.taskId,
      sourceFetchId,
      filterPass,
      RESOLUTION_CONTRACT,
      inputSignals.length,
      resolution.resolvedSignals.length,
      unresolvedCount,
      resolution.signalBudget,
      resolution.budgetExhausted ? 1 : 0,
      resolutionHash,
      resultJson,
      now,
    )];

    for (const item of resolution.trajectories) {
      const trajectoryJson = stableJson(item);
      const trajectoryHash = await sha256(trajectoryJson);
      const id = `trajectory_${(await sha256(`${batchId}\n${item.signalId}`)).slice(0, 32)}`;
      statements.push(this.database.prepare(`
        INSERT INTO candidate_resolution_trajectories (
          id, batch_id, run_id, input_signal_id, signal_kind, status, reason,
          matched_paths_json, generated_signal_ids_json, trajectory_hash, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM candidate_resolution_batches
          WHERE id = ? AND resolution_hash = ?
        )
        ON CONFLICT(batch_id, input_signal_id) DO NOTHING
      `).bind(
        id,
        batchId,
        runId,
        item.signalId,
        item.signalKind,
        item.status,
        item.reason,
        JSON.stringify(item.matchedPaths),
        JSON.stringify(item.generatedSignalIds),
        trajectoryHash,
        now,
        batchId,
        resolutionHash,
      ));
    }

    for (const evidence of sourceEvidence) {
      statements.push(...await this.discoveryStatements({
        batchId, runId, task, resolutionHash, evidence, now,
      }));
    }
    const results = await this.database.batch(statements);
    const stored = await this.findBatch({ runId, taskId: task.taskId, filterPass });
    if (!stored) throw new Error("candidate resolution batch was not persisted");
    assertMatchingBatch(stored, resolutionHash, resultJson);
    assertBatchMetadata(stored, sourceFetchId, inputSignals, resolution);
    await this.verifyChildren({ batchId: stored.id, resolution, sourceEvidence });
    return summary(stored, Number(results?.[0]?.meta?.changes || 0) === 1);
  }

  async discoveryStatements({ batchId, runId, task, resolutionHash, evidence, now }) {
    const signal = evidence.signal;
    const discoveryId = `discovery_${(await sha256(`${batchId}\n${signal.signalId}`)).slice(0, 32)}`;
    const guard = `
      SELECT 1 FROM candidate_resolution_batches
      WHERE id = ? AND resolution_hash = ?
    `;
    return [
      this.database.prepare(`
        INSERT INTO artifacts (
          id, artifact_key, canonical_repository_url, artifact_path,
          artifact_type, container_type, provenance, first_seen_at, last_seen_at
        )
        SELECT ?, ?, ?, ?, ?, 'artifact_file', ?, ?, ?
        WHERE EXISTS (${guard})
        ON CONFLICT(artifact_key) DO UPDATE SET
          last_seen_at = CASE
            WHEN excluded.last_seen_at > artifacts.last_seen_at
            THEN excluded.last_seen_at ELSE artifacts.last_seen_at END
      `).bind(
        evidence.artifactId,
        evidence.artifactKey,
        signal.repositoryUrl,
        signal.artifactPath,
        signal.artifactType,
        task.provenancePolicy || task.lane,
        now,
        now,
        batchId,
        resolutionHash,
      ),
      this.database.prepare(`
        INSERT INTO candidate_discoveries (
          id, batch_id, run_id, candidate_id, artifact_id, exact_signal_id,
          lane, source_id, source_rank, candidate_snapshot_json,
          evidence_hash, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (${guard})
        ON CONFLICT(batch_id, exact_signal_id) DO NOTHING
      `).bind(
        discoveryId,
        batchId,
        runId,
        evidence.candidateId,
        evidence.artifactId,
        signal.signalId,
        task.lane,
        task.sourceId,
        signal.sourceRank,
        evidence.candidateSnapshotJson,
        evidence.evidenceHash,
        now,
        batchId,
        resolutionHash,
      ),
    ];
  }

  async findBatch({ runId, taskId, filterPass }) {
    return this.database.prepare(`
      SELECT id, run_id, task_id, source_fetch_id, filter_pass, resolution_hash, result_json,
        input_signal_count, resolved_signal_count, unresolved_signal_count,
        signal_budget, budget_exhausted
      FROM candidate_resolution_batches
      WHERE run_id = ? AND task_id = ? AND filter_pass = ?
    `).bind(runId, taskId, filterPass).first();
  }

  async requireSuccessfulSourceFetch({ sourceFetchId, runId, taskId, inputSignals }) {
    if (typeof sourceFetchId !== "string" || !sourceFetchId) {
      throw new TypeError("sourceFetchId is required");
    }
    const row = await this.database.prepare(`
      SELECT id, run_id, task_id, fetch_status, candidate_signals_json
      FROM source_fetches WHERE id = ?
    `).bind(sourceFetchId).first();
    if (!row || row.run_id !== runId || row.task_id !== taskId || row.fetch_status !== "succeeded") {
      throw new TypeError("resolution requires a succeeded source fetch for the same run and task");
    }
    let storedSignals;
    try { storedSignals = JSON.parse(row.candidate_signals_json); } catch { /* rejected below */ }
    if (!Array.isArray(storedSignals) || stableJson(storedSignals) !== stableJson(inputSignals)) {
      throw new TypeError("resolution input signals do not match their source fetch");
    }
  }

  async verifyChildren({ batchId, resolution, sourceEvidence }) {
    const counts = await this.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM candidate_resolution_trajectories WHERE batch_id = ?) AS trajectory_count,
        (SELECT COUNT(*) FROM candidate_discoveries WHERE batch_id = ?) AS discovery_count
    `).bind(batchId, batchId).first();
    if (Number(counts?.trajectory_count) !== resolution.trajectories.length
      || Number(counts?.discovery_count) !== sourceEvidence.length) {
      throw new ShadowRunConflictError("candidate resolution children are incomplete");
    }
    for (const evidence of sourceEvidence) {
      const row = await this.database.prepare(`
        SELECT evidence_hash FROM candidate_discoveries
        WHERE batch_id = ? AND exact_signal_id = ?
      `).bind(batchId, evidence.signal.signalId).first();
      if (row?.evidence_hash !== evidence.evidenceHash) {
        throw new ShadowRunConflictError("candidate discovery evidence has immutable drift");
      }
    }
    for (const item of resolution.trajectories) {
      const expectedHash = await sha256(stableJson(item));
      const row = await this.database.prepare(`
        SELECT trajectory_hash FROM candidate_resolution_trajectories
        WHERE batch_id = ? AND input_signal_id = ?
      `).bind(batchId, item.signalId).first();
      if (row?.trajectory_hash !== expectedHash) {
        throw new ShadowRunConflictError("candidate resolution trajectory has immutable drift");
      }
    }
  }
}

function assertPersistenceInputs({ runId, task, filterPass, inputSignals, resolution, now }) {
  if (typeof runId !== "string" || !runId || runId.length > 100) throw new TypeError("runId is invalid");
  if (!Number.isInteger(filterPass) || filterPass < 1 || filterPass > 3) {
    throw new TypeError("filterPass must be one to three");
  }
  if (!Array.isArray(inputSignals) || inputSignals.length > task?.maxCandidateSignals) {
    throw new TypeError("inputSignals exceed their task budget");
  }
  const errors = validateSourceCandidateResolution(resolution, task, inputSignals);
  if (errors.length) throw new TypeError(errors.join("\n"));
  if (!Number.isFinite(Date.parse(now))) throw new TypeError("created timestamp is invalid");
}

async function resolvedSourceEvidence(signals, snapshots, filterPass) {
  return Promise.all(signals.map(async (signal) => {
    const snapshot = snapshots instanceof Map
      ? snapshots.get(signal.repositoryUrl)
      : snapshots?.[signal.repositoryUrl];
    let locatorRepository = null;
    try { locatorRepository = canonicalRepositoryUrl(signal.locatorUrl); } catch { /* validated below */ }
    if (!snapshot || snapshot.version !== 1 || snapshot.repositoryUrl !== signal.repositoryUrl
      || locatorRepository !== signal.repositoryUrl
      || typeof snapshot.defaultBranch !== "string" || !snapshot.defaultBranch
      || snapshot.defaultBranch.length > 255
      || !/^[a-f0-9]{40}$/i.test(snapshot.treeSha || "")
      || !["recursive", "bounded_traversal"].includes(snapshot.collectionMode)
      || !validSnapshotAccounting(snapshot)) {
      throw new TypeError(`exact signal ${signal.signalId} lacks a valid GitHub tree snapshot`);
    }
    const entry = snapshot.entries?.find((item) =>
      item.type === "blob" && item.path === signal.artifactPath);
    if (!entry || !/^[a-f0-9]{40}$/i.test(entry.sha || "")) {
      throw new TypeError(`exact signal ${signal.signalId} lacks immutable blob evidence`);
    }
    const artifactKey = `${signal.repositoryUrl}#artifact=${signal.artifactPath}`;
    const artifactHash = await sha256(artifactKey);
    const evidence = {
      signal,
      artifactKey,
      artifactId: `artifact_${artifactHash.slice(0, 32)}`,
      candidateId: `candidate_${artifactHash.slice(0, 32)}`,
      repositoryUrl: snapshot.repositoryUrl,
      defaultBranch: snapshot.defaultBranch,
      treeSha: snapshot.treeSha.toLowerCase(),
      artifactPath: signal.artifactPath,
      blobSha: entry.sha.toLowerCase(),
      collectionMode: snapshot.collectionMode,
      treeRequests: snapshot.treeRequests,
      collectedTreeBytes: snapshot.collectedTreeBytes ?? null,
    };
    const candidateSnapshot = {
      contractVersion: "candidate-discovery-v1",
      candidateId: evidence.candidateId,
      artifactKey,
      filterPass,
      exactSignal: signal,
      sourceEvidence: {
        repositoryUrl: evidence.repositoryUrl,
        defaultBranch: evidence.defaultBranch,
        treeSha: evidence.treeSha,
        artifactPath: evidence.artifactPath,
        blobSha: evidence.blobSha,
        collectionMode: evidence.collectionMode,
        treeRequests: evidence.treeRequests,
        collectedTreeBytes: evidence.collectedTreeBytes,
      },
    };
    evidence.candidateSnapshotJson = stableJson(candidateSnapshot);
    if (new TextEncoder().encode(evidence.candidateSnapshotJson).byteLength > 65_536) {
      throw new TypeError("candidate discovery snapshot exceeds its byte limit");
    }
    evidence.evidenceHash = await sha256(evidence.candidateSnapshotJson);
    return evidence;
  }));
}

function validSnapshotAccounting(snapshot) {
  if (!Number.isInteger(snapshot.treeRequests) || snapshot.treeRequests < 1) return false;
  if (snapshot.collectionMode === "recursive") {
    return snapshot.treeRequests === 1
      && (snapshot.collectedTreeBytes === null
        || (Number.isInteger(snapshot.collectedTreeBytes)
          && snapshot.collectedTreeBytes >= 0
          && snapshot.collectedTreeBytes <= GITHUB_TREE_BYTE_LIMIT));
  }
  return snapshot.treeRequests <= DEFAULT_GITHUB_TRAVERSAL_LIMITS.maximumRequests
    && Number.isInteger(snapshot.collectedTreeBytes)
    && snapshot.collectedTreeBytes >= 0
    && snapshot.collectedTreeBytes <= DEFAULT_GITHUB_TRAVERSAL_LIMITS.maximumBytes;
}

function assertMatchingBatch(row, resolutionHash, resultJson) {
  if (row.resolution_hash !== resolutionHash || row.result_json !== resultJson) {
    throw new ShadowRunConflictError("resolution key already has a different immutable result");
  }
}

function assertBatchMetadata(row, sourceFetchId, inputSignals, resolution) {
  const unresolvedCount = resolution.trajectories.filter((item) =>
    ["unresolved", "ambiguous", "not_resolved"].includes(item.status)).length;
  if (row.source_fetch_id !== sourceFetchId
    || Number(row.input_signal_count) !== inputSignals.length
    || Number(row.resolved_signal_count) !== resolution.resolvedSignals.length
    || Number(row.unresolved_signal_count) !== unresolvedCount
    || Number(row.signal_budget) !== resolution.signalBudget
    || Boolean(row.budget_exhausted) !== resolution.budgetExhausted) {
    throw new ShadowRunConflictError("candidate resolution batch metadata has immutable drift");
  }
}

function summary(row, created) {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    filterPass: Number(row.filter_pass),
    resolutionHash: row.resolution_hash,
    resolvedSignalCount: Number(row.resolved_signal_count),
    unresolvedSignalCount: Number(row.unresolved_signal_count),
    created,
  };
}

async function sha256(value) {
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
