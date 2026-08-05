import { buildCandidatePoolPass } from "./candidate-pool.js";
import { ShadowRunConflictError } from "./run-repository.js";

const POOL_CONTRACT = "candidate-pool-v1";

export class CandidatePoolRepository {
  constructor(database) {
    if (!database?.prepare || !database?.batch) {
      throw new TypeError("A D1-compatible database binding with batch support is required");
    }
    this.database = database;
  }

  async materializePass({
    runId,
    reportDate,
    filterPass,
    sourceTaskOrder,
    expectedResolutionTaskIds = sourceTaskOrder,
    materialChangeClaims = {},
    now,
  }) {
    assertRequest({
      runId, reportDate, filterPass, sourceTaskOrder, expectedResolutionTaskIds, now,
    });
    const normalizedMaterialChangeClaims = normalizeClaims(materialChangeClaims);
    const run = await this.requireRun(runId, reportDate);
    await this.requireExpectedSuccessfulTasks(runId, expectedResolutionTaskIds);
    await this.requireResolutionCoverage(runId, filterPass, expectedResolutionTaskIds);
    const requestHash = await sha256(stableJson({
      runId,
      reportDate,
      filterPass,
      sourceTaskOrder,
      expectedResolutionTaskIds,
      materialChangeClaims: normalizedMaterialChangeClaims,
      sourceCollectionStatus: run.source_collection_status,
    }));
    const existing = await this.findPass(runId, filterPass);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ShadowRunConflictError("candidate pool request has immutable drift");
      }
      if (await sha256(existing.result_json) !== existing.result_hash) {
        throw new ShadowRunConflictError("candidate pool result hash has immutable drift");
      }
      const storedResult = parseStoredResult(existing.result_json);
      assertResultMetadata(existing, storedResult);
      await this.verifyChildren(existing.id, storedResult, runId);
      return summary(existing, false);
    }
    const discoveries = await this.loadDiscoveries(runId, filterPass);
    const existingCandidates = await this.loadExistingCandidates(runId, filterPass);
    const cutoff = addDays(reportDate, -30);
    const artifactHistory = await this.loadArtifactHistory(reportDate, cutoff);
    const reviewState = await this.loadReviewState();
    const input = {
      runId,
      reportDate,
      filterPass,
      sourceTaskOrder,
      expectedResolutionTaskIds,
      discoveries,
      existingCandidates,
      artifactHistory,
      reviewState,
      materialChangeClaims: normalizedMaterialChangeClaims,
      sourceCollectionStatus: run.source_collection_status,
    };
    const inputHash = await sha256(stableJson(input));
    const result = buildCandidatePoolPass(input);
    const resultJson = stableJson(result);
    if (new TextEncoder().encode(resultJson).byteLength > 262_144) {
      throw new TypeError("candidate pool result exceeds its byte limit");
    }
    const resultHash = await sha256(resultJson);
    const passId = `pool_${(await sha256(`${runId}\n${filterPass}`)).slice(0, 32)}`;
    const statements = [this.database.prepare(`
      INSERT INTO candidate_pool_passes (
        id, run_id, filter_pass, contract_version, request_hash, input_hash, result_hash,
        result_json, selected_count, eligible_total, cumulative_total,
        next_action, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, filter_pass) DO NOTHING
    `).bind(
      passId, runId, filterPass, POOL_CONTRACT, requestHash, inputHash, resultHash, resultJson,
      result.selectedCount, result.eligibleTotal, result.cumulativeTotal,
      result.nextAction, now,
    )];

    for (const candidate of result.selected) {
      const snapshotJson = stableJson({
        contractVersion: "candidate-pool-snapshot-v1",
        ...candidate,
      });
      const rowId = `run_candidate_${(await sha256(`${runId}\n${candidate.candidateId}`)).slice(0, 32)}`;
      statements.push(this.database.prepare(`
        INSERT INTO run_candidates (
          id, run_id, candidate_id, artifact_id, lane, source_id, filter_pass,
          snapshot_json, eligible, exclusion_reason, material_change_json,
          final_disposition, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM candidate_pool_passes
          WHERE id = ? AND input_hash = ? AND result_hash = ?
        )
        ON CONFLICT(run_id, candidate_id) DO NOTHING
      `).bind(
        rowId, runId, candidate.candidateId, candidate.artifactId,
        candidate.lane, candidate.sourceId, filterPass, snapshotJson,
        candidate.eligible ? 1 : 0, candidate.exclusionReason,
        stableJson(candidate.materialChange),
        candidate.eligible ? "eligible" : "filtered", now, now,
        passId, inputHash, resultHash,
      ));
    }

    for (const event of result.events) {
      const eventJson = stableJson(event);
      const eventHash = await sha256(eventJson);
      const eventId = `filter_event_${(await sha256(`${passId}\n${event.candidateId}`)).slice(0, 32)}`;
      statements.push(this.database.prepare(`
        INSERT INTO candidate_filter_events (
          id, pool_pass_id, run_id, candidate_id, artifact_id, disposition,
          exclusion_reason, primary_discovery_id,
          corroborating_discovery_ids_json, event_hash, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM candidate_pool_passes
          WHERE id = ? AND input_hash = ? AND result_hash = ?
        )
        ON CONFLICT(pool_pass_id, candidate_id) DO NOTHING
      `).bind(
        eventId, passId, runId, event.candidateId, event.artifactId,
        event.disposition, event.exclusionReason, event.primaryDiscoveryId,
        stableJson(event.corroboratingDiscoveryIds), eventHash, now,
        passId, inputHash, resultHash,
      ));
    }
    statements.push(this.database.prepare(`
      UPDATE engine_runs SET
        candidate_total = (SELECT COUNT(*) FROM run_candidates WHERE run_id = ?),
        eligible_total = (SELECT COUNT(*) FROM run_candidates WHERE run_id = ? AND eligible = 1),
        updated_at = ?
      WHERE id = ? AND publication_state = 'blocked_shadow'
        AND EXISTS (
          SELECT 1 FROM candidate_pool_passes
          WHERE id = ? AND input_hash = ? AND result_hash = ?
        )
    `).bind(runId, runId, now, runId, passId, inputHash, resultHash));

    const batchResults = await this.database.batch(statements);
    const stored = await this.findPass(runId, filterPass);
    if (!stored) throw new Error("candidate pool pass was not persisted");
    assertMatchingPass(stored, requestHash, inputHash, resultHash, resultJson);
    await this.verifyChildren(stored.id, result, runId);
    return summary(stored, Number(batchResults?.[0]?.meta?.changes || 0) === 1);
  }

  async requireRun(runId, reportDate) {
    const row = await this.database.prepare(`
      SELECT id, report_date, mode, publication_state, source_collection_status
      FROM engine_runs WHERE id = ?
    `).bind(runId).first();
    if (!row || row.report_date !== reportDate || row.mode !== "shadow"
      || row.publication_state !== "blocked_shadow") {
      throw new TypeError("candidate pool requires the matching blocked shadow run");
    }
    if (!["complete", "degraded"].includes(row.source_collection_status)) {
      throw new TypeError("candidate pool requires completed minimum source coverage");
    }
    return row;
  }

  async requireResolutionCoverage(runId, filterPass, expectedTaskIds) {
    const rows = await all(this.database.prepare(`
      SELECT task_id FROM candidate_resolution_batches
      WHERE run_id = ? AND filter_pass = ? ORDER BY task_id
    `).bind(runId, filterPass));
    const actual = rows.map((row) => row.task_id).sort();
    const expected = [...expectedTaskIds].sort();
    if (stableJson(actual) !== stableJson(expected)) {
      throw new TypeError("candidate pool requires one resolution batch for every expected source task");
    }
  }

  async requireExpectedSuccessfulTasks(runId, expectedTaskIds) {
    const rows = await all(this.database.prepare(`
      SELECT DISTINCT task_id FROM source_fetches
      WHERE run_id = ? AND fetch_status = 'succeeded' AND task_id IS NOT NULL
      ORDER BY task_id
    `).bind(runId));
    const actual = rows.map((row) => row.task_id).sort();
    const expected = [...expectedTaskIds].sort();
    if (stableJson(actual) !== stableJson(expected)) {
      throw new TypeError("expected resolution tasks must equal the run's successful source tasks");
    }
  }

  async loadDiscoveries(runId, filterPass) {
    const rows = await all(this.database.prepare(`
      SELECT d.id, b.task_id, d.candidate_id, d.artifact_id, a.artifact_key,
        a.canonical_repository_url, a.artifact_path, d.lane, d.source_id,
        d.source_rank
      FROM candidate_discoveries d
      JOIN candidate_resolution_batches b ON b.id = d.batch_id
      JOIN artifacts a ON a.id = d.artifact_id
      WHERE d.run_id = ? AND b.filter_pass <= ?
    `).bind(runId, filterPass));
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      candidateId: row.candidate_id,
      artifactId: row.artifact_id,
      artifactKey: row.artifact_key,
      canonicalRepositoryUrl: row.canonical_repository_url,
      artifactPath: row.artifact_path,
      lane: row.lane,
      sourceId: row.source_id,
      sourceRank: row.source_rank == null ? null : Number(row.source_rank),
    }));
  }

  async loadExistingCandidates(runId, filterPass) {
    const rows = await all(this.database.prepare(`
      SELECT candidate_id, eligible FROM run_candidates
      WHERE run_id = ? AND filter_pass < ?
    `).bind(runId, filterPass));
    return rows.map((row) => ({ candidateId: row.candidate_id, eligible: Boolean(row.eligible) }));
  }

  async loadArtifactHistory(reportDate, cutoff) {
    const rows = await all(this.database.prepare(`
      SELECT h.artifact_id, a.canonical_repository_url, h.report_date
      FROM artifact_history h JOIN artifacts a ON a.id = h.artifact_id
      WHERE h.report_date >= ? AND h.report_date < ?
    `).bind(cutoff, reportDate));
    return rows.map((row) => ({
      artifactId: row.artifact_id,
      canonicalRepositoryUrl: row.canonical_repository_url,
      reportDate: row.report_date,
    }));
  }

  async loadReviewState() {
    const rows = await all(this.database.prepare(`
      SELECT artifact_id, latest_decision, review_after FROM review_state
    `));
    return rows.map((row) => ({
      artifactId: row.artifact_id,
      latestDecision: row.latest_decision,
      reviewAfter: row.review_after,
    }));
  }

  async findPass(runId, filterPass) {
    return this.database.prepare(`
      SELECT id, run_id, filter_pass, request_hash, input_hash, result_hash, result_json,
        selected_count, eligible_total, cumulative_total, next_action
      FROM candidate_pool_passes WHERE run_id = ? AND filter_pass = ?
    `).bind(runId, filterPass).first();
  }

  async verifyChildren(passId, result, runId) {
    const row = await this.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM candidate_filter_events WHERE pool_pass_id = ?) AS event_count,
        (SELECT COUNT(*) FROM run_candidates c
          JOIN candidate_filter_events e ON e.run_id = c.run_id AND e.candidate_id = c.candidate_id
          WHERE e.pool_pass_id = ? AND e.disposition IN ('eligible', 'filtered_history')) AS selected_count
    `).bind(passId, passId).first();
    if (Number(row?.event_count) !== result.events.length
      || Number(row?.selected_count) !== result.selected.length) {
      throw new ShadowRunConflictError("candidate pool children are incomplete");
    }
    for (const event of result.events) {
      const expectedHash = await sha256(stableJson(event));
      const stored = await this.database.prepare(`
        SELECT event_hash FROM candidate_filter_events
        WHERE pool_pass_id = ? AND candidate_id = ?
      `).bind(passId, event.candidateId).first();
      if (stored?.event_hash !== expectedHash) {
        throw new ShadowRunConflictError("candidate filter event has immutable drift");
      }
    }
    for (const candidate of result.selected) {
      const expectedSnapshot = stableJson({
        contractVersion: "candidate-pool-snapshot-v1",
        ...candidate,
      });
      const stored = await this.database.prepare(`
        SELECT snapshot_json, eligible, exclusion_reason, filter_pass
        FROM run_candidates WHERE run_id = ? AND candidate_id = ?
      `).bind(runId, candidate.candidateId).first();
      if (!stored || stored.snapshot_json !== expectedSnapshot
        || Boolean(stored.eligible) !== candidate.eligible
        || stored.exclusion_reason !== candidate.exclusionReason
        || Number(stored.filter_pass) !== result.filterPass) {
        throw new ShadowRunConflictError("run candidate snapshot has immutable drift");
      }
    }
  }
}

function assertRequest({ runId, reportDate, filterPass, sourceTaskOrder, expectedResolutionTaskIds, now }) {
  if (typeof runId !== "string" || !runId || runId.length > 100) throw new TypeError("runId is invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new TypeError("reportDate is invalid");
  if (!Number.isInteger(filterPass) || filterPass < 1 || filterPass > 3) {
    throw new TypeError("filterPass must be one to three");
  }
  if (!Array.isArray(sourceTaskOrder) || !sourceTaskOrder.length
    || new Set(sourceTaskOrder).size !== sourceTaskOrder.length) {
    throw new TypeError("sourceTaskOrder is invalid");
  }
  if (!Array.isArray(expectedResolutionTaskIds)
    || expectedResolutionTaskIds.some((id) => !sourceTaskOrder.includes(id))
    || new Set(expectedResolutionTaskIds).size !== expectedResolutionTaskIds.length) {
    throw new TypeError("expectedResolutionTaskIds must be a distinct subset of sourceTaskOrder");
  }
  if (!Number.isFinite(Date.parse(now))) throw new TypeError("created timestamp is invalid");
}

function assertMatchingPass(row, requestHash, inputHash, resultHash, resultJson) {
  if (row.request_hash !== requestHash || row.input_hash !== inputHash
    || row.result_hash !== resultHash || row.result_json !== resultJson) {
    throw new ShadowRunConflictError("candidate pool pass has immutable drift");
  }
}

function parseStoredResult(value) {
  let result;
  try { result = JSON.parse(value); } catch { /* rejected below */ }
  if (!result || result.contractVersion !== POOL_CONTRACT
    || !Array.isArray(result.selected) || !Array.isArray(result.events)) {
    throw new ShadowRunConflictError("stored candidate pool result is invalid");
  }
  return result;
}

function assertResultMetadata(row, result) {
  if (Number(row.selected_count) !== result.selectedCount
    || Number(row.eligible_total) !== result.eligibleTotal
    || Number(row.cumulative_total) !== result.cumulativeTotal
    || row.next_action !== result.nextAction) {
    throw new ShadowRunConflictError("candidate pool result metadata has immutable drift");
  }
}

function summary(row, created) {
  return {
    id: row.id,
    runId: row.run_id,
    filterPass: Number(row.filter_pass),
    selectedCount: Number(row.selected_count),
    eligibleTotal: Number(row.eligible_total),
    cumulativeTotal: Number(row.cumulative_total),
    nextAction: row.next_action,
    resultHash: row.result_hash,
    created,
  };
}

async function all(statement) {
  const value = await statement.all();
  return Array.isArray(value) ? value : value?.results || [];
}

function addDays(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function normalizeClaims(value) {
  if (value instanceof Map) return Object.fromEntries(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("materialChangeClaims must be an object or Map");
  }
  return value;
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
