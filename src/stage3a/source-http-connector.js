const RETRYABLE_STATUS = new Set([408, 425, 429]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const SUPPORTED_CONTENT_TYPES = [
  "application/json", "text/html", "text/markdown", "text/plain",
];
export const SOURCE_RETRY_LIMIT = 3;

export function shouldRetrySourceResult(result, attemptNo) {
  return result?.status === "failed"
    && result.retryable === true
    && Number.isInteger(attemptNo)
    && attemptNo >= 1
    && attemptNo < SOURCE_RETRY_LIMIT;
}

export async function fetchSourceTaskOnce({
  task,
  fetchImpl = fetch,
  cache = null,
  now = new Date(),
}) {
  assertSafeTask(task);
  const headers = new Headers({
    accept: "text/html,application/json,text/plain,text/markdown;q=0.9",
  });
  if (cache?.etag) headers.set("if-none-match", cache.etag);
  if (cache?.lastModified) headers.set("if-modified-since", cache.lastModified);
  let currentUrl = task.url;
  let response;
  try {
    for (let redirectCount = 0; redirectCount <= task.maxRedirects; redirectCount += 1) {
      response = await fetchImpl(currentUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(task.timeoutMs),
      });
      if (!REDIRECT_STATUS.has(response.status)) break;
      if (redirectCount === task.maxRedirects) {
        return failure(task, "REDIRECT_LIMIT", "Source exceeded its redirect limit", false, response.status);
      }
      const location = response.headers.get("location");
      const target = location ? new URL(location, currentUrl) : null;
      if (!target || target.protocol !== "https:" || !sameHostFamily(task.url, target.href)) {
        return failure(task, "UNSAFE_REDIRECT", "Source redirected outside its approved host", false, response.status);
      }
      currentUrl = target.href;
    }
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return failure(
      task,
      timedOut ? "SOURCE_TIMEOUT" : "SOURCE_NETWORK_ERROR",
      timedOut ? "Source request timed out" : "Source request failed before a response",
      true,
      null,
    );
  }

  if (response.status === 304) {
    if (!validCache(cache)) {
      return failure(task, "CACHE_MISS_ON_304", "Source returned 304 without validated cache", false, 304);
    }
    return success(task, {
      httpStatus: 304,
      contentHash: cache.contentHash,
      boundedExcerpt: cache.boundedExcerpt,
      candidateSignals: cache.candidateSignals || [],
      cacheStatus: "validated_304",
      etag: response.headers.get("etag") || cache.etag || null,
      lastModified: response.headers.get("last-modified") || cache.lastModified || null,
      fetchedAt: now.toISOString(),
      redirectTarget: currentUrl === task.url ? null : currentUrl,
    });
  }
  if (!response.ok) return classifyHttpFailure(task, response);

  const contentType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!SUPPORTED_CONTENT_TYPES.includes(contentType)) {
    return failure(task, "UNSUPPORTED_CONTENT_TYPE", `Unsupported content type: ${contentType || "missing"}`, false, response.status);
  }
  const body = await readResponseBody(response, task.maxResponseBytes);
  if (!body.ok) return failure(task, body.errorClass, body.message, false, response.status);
  const contentHash = await sha256(body.bytes);
  return success(task, {
    httpStatus: response.status,
    contentHash,
    boundedExcerpt: utf8Prefix(body.bytes, task.maxExcerptBytes),
    candidateSignals: [],
    cacheStatus: "fresh",
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    fetchedAt: now.toISOString(),
    redirectTarget: currentUrl === task.url ? null : currentUrl,
  });
}

export function staleCacheFallback(task, cache, sourceFailure, now = new Date()) {
  if (!validCache(cache)) throw new TypeError("validated cache is required for degraded fallback");
  return {
    taskId: task.taskId,
    lane: task.lane,
    sourceId: task.sourceId,
    status: "degraded_cached",
    httpStatus: sourceFailure?.httpStatus ?? null,
    contentHash: cache.contentHash,
    boundedExcerpt: cache.boundedExcerpt,
    candidateSignals: cache.candidateSignals || [],
    cacheStatus: "stale_fallback",
    retryable: false,
    errorClass: sourceFailure?.errorClass || "SOURCE_RETRY_EXHAUSTED",
    errorMessage: sourceFailure?.errorMessage || "Fresh source collection failed",
    etag: cache.etag || null,
    lastModified: cache.lastModified || null,
    fetchedAt: now.toISOString(),
    redirectTarget: null,
  };
}

function assertSafeTask(task) {
  const url = new URL(task?.url || "");
  if (url.protocol !== "https:") throw new TypeError("source task URL must use HTTPS");
  if (!Number.isInteger(task?.maxRedirects) || task.maxRedirects < 0 || task.maxRedirects > 3) {
    throw new TypeError("source task maxRedirects must be zero to three");
  }
  if (!Number.isInteger(task?.timeoutMs) || task.timeoutMs < 1000 || task.timeoutMs > 30_000) {
    throw new TypeError("source task timeoutMs must be 1000-30000");
  }
  if (!Number.isInteger(task?.maxResponseBytes)
    || task.maxResponseBytes < task.maxExcerptBytes
    || task.maxResponseBytes > 1_048_576) {
    throw new TypeError("source task response byte limit is invalid");
  }
}

function classifyHttpFailure(task, response) {
  const retryable = RETRYABLE_STATUS.has(response.status) || response.status >= 500;
  const errorClass = response.status === 401 || response.status === 403
    ? "SOURCE_AUTHORIZATION"
    : response.status === 404
      ? "SOURCE_NOT_FOUND"
      : response.status === 429
        ? "SOURCE_RATE_LIMIT"
        : response.status >= 500
          ? "SOURCE_UPSTREAM_ERROR"
          : "SOURCE_HTTP_ERROR";
  return failure(task, errorClass, `Source returned HTTP ${response.status}`, retryable, response.status);
}

async function readResponseBody(response, maximumBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    return { ok: false, errorClass: "SOURCE_BODY_TOO_LARGE", message: "Source body exceeds its byte limit" };
  }
  if (!response.body) return { ok: true, bytes: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("source body limit reached");
      return { ok: false, errorClass: "SOURCE_BODY_TOO_LARGE", message: "Source body exceeds its byte limit" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function success(task, values) {
  return {
    taskId: task.taskId,
    lane: task.lane,
    sourceId: task.sourceId,
    status: "succeeded",
    retryable: false,
    errorClass: null,
    errorMessage: null,
    ...values,
  };
}

function failure(task, errorClass, errorMessage, retryable, httpStatus) {
  return {
    taskId: task.taskId,
    lane: task.lane,
    sourceId: task.sourceId,
    status: "failed",
    httpStatus,
    contentHash: null,
    boundedExcerpt: null,
    candidateSignals: [],
    cacheStatus: "none",
    retryable,
    errorClass,
    errorMessage,
    etag: null,
    lastModified: null,
    fetchedAt: null,
    redirectTarget: null,
  };
}

function validCache(cache) {
  return /^[a-f0-9]{64}$/.test(cache?.contentHash || "")
    && typeof cache?.boundedExcerpt === "string"
    && Array.isArray(cache?.candidateSignals);
}

function sameHostFamily(original, redirected) {
  const normalize = (hostname) => hostname.toLowerCase().replace(/^www\./, "");
  return normalize(new URL(original).hostname) === normalize(new URL(redirected).hostname);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function utf8Prefix(bytes, maximumBytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, maximumBytes));
}
