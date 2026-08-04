import { validateCollectionResult } from "./source-portfolio.js";
import { ShadowRunConflictError } from "./run-repository.js";

export class SourceFetchRepository {
  constructor(database) {
    if (!database?.prepare) throw new TypeError("A D1-compatible database binding is required");
    this.database = database;
  }

  async recordAttempt({ runId, task, attemptNo, result, now }) {
    const errors = validateCollectionResult(task, result);
    if (errors.length) throw new TypeError(errors.join("\n"));
    if (!Number.isInteger(attemptNo) || attemptNo < 1 || attemptNo > 3) {
      throw new TypeError("source attempt number must be one to three");
    }
    const requestKey = await sourceRequestKey(runId, task.taskId, attemptNo);
    const resultHash = await hashJson(result);
    const id = `fetch_${requestKey.slice(0, 32)}`;
    const requestPolicy = JSON.stringify({
      method: "GET",
      maxRedirects: task.maxRedirects,
      timeoutMs: task.timeoutMs,
      maxResponseBytes: task.maxResponseBytes,
      maxExcerptBytes: task.maxExcerptBytes,
    });
    const inserted = await this.database.prepare(`
      INSERT INTO source_fetches (
        id, run_id, request_key, normalized_url, purpose, provenance_class,
        request_policy_json, http_status, redirect_target, etag, last_modified,
        fetched_at, content_hash, bounded_excerpt, error_class, error_message,
        created_at, task_id, attempt_no, fetch_status, cache_status, retryable,
        result_hash, candidate_signals_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_key) DO NOTHING
    `).bind(
      id,
      runId,
      requestKey,
      task.url,
      task.purpose,
      task.provenancePolicy,
      requestPolicy,
      result.httpStatus,
      result.redirectTarget,
      result.etag,
      result.lastModified,
      result.fetchedAt,
      result.contentHash,
      result.boundedExcerpt,
      result.errorClass,
      result.errorMessage,
      now,
      task.taskId,
      attemptNo,
      result.status,
      result.cacheStatus,
      result.retryable ? 1 : 0,
      resultHash,
      JSON.stringify(result.candidateSignals),
    ).run();
    const row = await this.database.prepare(`
      SELECT id, run_id, task_id, attempt_no, fetch_status, content_hash,
        error_class, cache_status, retryable, result_hash
      FROM source_fetches WHERE request_key = ?
    `).bind(requestKey).first();
    if (!row) throw new Error("source fetch attempt was not persisted");
    if (row.run_id !== runId
      || row.task_id !== task.taskId
      || Number(row.attempt_no) !== attemptNo
      || row.fetch_status !== result.status
      || row.content_hash !== result.contentHash
      || row.error_class !== result.errorClass
      || row.result_hash !== resultHash) {
      throw new ShadowRunConflictError("source request key already has a different immutable result");
    }
    return {
      id: row.id,
      requestKey,
      status: row.fetch_status,
      cacheStatus: row.cache_status,
      retryable: Boolean(row.retryable),
      created: Number(inserted.meta?.changes || 0) === 1,
    };
  }
}

async function sourceRequestKey(runId, taskId, attemptNo) {
  const input = new TextEncoder().encode(`${runId}\n${taskId}\n${attemptNo}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function hashJson(value) {
  const input = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
