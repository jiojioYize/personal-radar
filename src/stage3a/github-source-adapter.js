import { canonicalRepositoryUrl } from "./candidate-signals.js";

export const DEFAULT_GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_METADATA_BYTE_LIMIT = 262_144;
export const GITHUB_TREE_BYTE_LIMIT = 1_048_576;

export class GithubSourceError extends Error {
  constructor(message, {
    errorClass,
    retryable = false,
    httpStatus = null,
    retryAt = null,
    requiresTraversal = false,
  }) {
    super(message);
    this.name = "GithubSourceError";
    this.errorClass = errorClass;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
    this.retryAt = retryAt;
    this.requiresTraversal = requiresTraversal;
  }
}

export async function fetchGithubTreeSnapshot({
  repositoryUrl,
  token,
  fetchImpl = fetch,
  apiVersion = DEFAULT_GITHUB_API_VERSION,
  timeoutMs = 15_000,
}) {
  const repository = githubRepositoryIdentity(repositoryUrl);
  const headers = githubReadHeaders({ token, apiVersion });
  const metadata = await githubJson(repository.apiUrl, {
    fetchImpl, headers, timeoutMs, maximumBytes: GITHUB_METADATA_BYTE_LIMIT,
    bodyErrorClass: "GITHUB_BODY_TOO_LARGE",
  });
  validateRepositoryMetadata(metadata, repository);
  const branch = validateRef(metadata.default_branch);
  const treeUrl = `${repository.apiUrl}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const tree = await githubJson(treeUrl, {
    fetchImpl, headers, timeoutMs, maximumBytes: GITHUB_TREE_BYTE_LIMIT,
    bodyErrorClass: "GITHUB_TREE_TOO_LARGE",
    requiresTraversal: true,
  });
  if (tree?.truncated === true) {
    throw new GithubSourceError("GitHub returned a truncated recursive tree", {
      errorClass: "GITHUB_TREE_TRUNCATED",
      requiresTraversal: true,
    });
  }
  if (tree?.truncated !== false || !Array.isArray(tree.tree)) {
    throw new GithubSourceError("GitHub tree response is missing completeness evidence", {
      errorClass: "GITHUB_TREE_CONTRACT",
    });
  }
  if (!validSha(tree.sha)) {
    throw new GithubSourceError("GitHub tree response is missing its immutable tree SHA", {
      errorClass: "GITHUB_TREE_CONTRACT",
    });
  }
  return {
    version: 1,
    repositoryUrl: repository.repositoryUrl,
    defaultBranch: branch,
    treeSha: tree.sha.toLowerCase(),
    entries: tree.tree.map(normalizeTreeEntry).filter(Boolean),
    repository: {
      fullName: metadata.full_name,
      archived: Boolean(metadata.archived),
      disabled: Boolean(metadata.disabled),
      pushedAt: metadata.pushed_at || null,
    },
  };
}

export function githubReadHeaders({ token, apiVersion = DEFAULT_GITHUB_API_VERSION } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(apiVersion)) throw new TypeError("GitHub API version is invalid");
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "personal-radar-stage3a-shadow/0.1",
    "X-GitHub-Api-Version": apiVersion,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function githubRepositoryIdentity(value) {
  const repositoryUrl = canonicalRepositoryUrl(value);
  const [owner, repo] = new URL(repositoryUrl).pathname.split("/").filter(Boolean);
  return {
    owner,
    repo,
    repositoryUrl,
    apiUrl: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  };
}

async function githubJson(url, {
  fetchImpl,
  headers,
  timeoutMs,
  maximumBytes,
  bodyErrorClass,
  requiresTraversal = false,
}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new GithubSourceError(timedOut ? "GitHub request timed out" : "GitHub request failed", {
      errorClass: timedOut ? "GITHUB_TIMEOUT" : "GITHUB_NETWORK_ERROR",
      retryable: true,
    });
  }
  if (!response.ok) throw classifyGithubHttpError(response);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new GithubSourceError("GitHub response exceeded its byte limit", {
      errorClass: bodyErrorClass,
      requiresTraversal,
    });
  }
  const bytes = await readBoundedResponse(response, maximumBytes, bodyErrorClass, requiresTraversal);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GithubSourceError("GitHub returned invalid JSON", {
      errorClass: "GITHUB_RESPONSE_CONTRACT",
    });
  }
}

async function readBoundedResponse(response, maximumBytes, errorClass, requiresTraversal) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("GitHub response byte limit reached");
      throw new GithubSourceError("GitHub response exceeded its byte limit", {
        errorClass,
        requiresTraversal,
      });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function classifyGithubHttpError(response) {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const rateLimited = response.status === 429 || (response.status === 403 && remaining === "0");
  const retryable = rateLimited || response.status >= 500;
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const retryAfter = Number(response.headers.get("retry-after"));
  const retryAt = Number.isFinite(retryAfter) && retryAfter >= 0
    ? new Date(Date.now() + retryAfter * 1000).toISOString()
    : Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null;
  const errorClass = rateLimited ? "GITHUB_RATE_LIMIT"
    : response.status === 404 ? "GITHUB_REPOSITORY_NOT_FOUND"
      : response.status === 401 || response.status === 403 ? "GITHUB_AUTHORIZATION"
        : response.status >= 500 ? "GITHUB_UPSTREAM_ERROR" : "GITHUB_HTTP_ERROR";
  return new GithubSourceError(`GitHub returned HTTP ${response.status}`, {
    errorClass, retryable, httpStatus: response.status, retryAt,
  });
}

function validateRepositoryMetadata(metadata, expected) {
  if (String(metadata?.full_name || "").toLowerCase() !== `${expected.owner}/${expected.repo}`.toLowerCase()) {
    throw new GithubSourceError("GitHub repository identity did not match the requested source", {
      errorClass: "GITHUB_IDENTITY_MISMATCH",
    });
  }
  if (metadata.private === true || metadata.visibility === "private") {
    throw new GithubSourceError("Private repositories are outside the shadow source policy", {
      errorClass: "GITHUB_PRIVATE_REPOSITORY",
    });
  }
}

function validateRef(value) {
  const ref = String(value || "");
  if (!ref || ref.length > 255 || /[\u0000-\u001f\u007f]/.test(ref) || ref.includes("..")) {
    throw new GithubSourceError("GitHub default branch is invalid", {
      errorClass: "GITHUB_RESPONSE_CONTRACT",
    });
  }
  return ref;
}

function normalizeTreeEntry(entry) {
  if (!entry || !["blob", "tree"].includes(entry.type) || typeof entry.path !== "string") return null;
  if (!entry.path || entry.path.length > 500 || entry.path.includes("..") || entry.path.includes("\\")) return null;
  return {
    path: entry.path,
    type: entry.type,
    sha: validSha(entry.sha) ? entry.sha : null,
    size: Number.isInteger(entry.size) && entry.size >= 0 ? entry.size : null,
  };
}

function validSha(value) {
  return /^[a-f0-9]{40}$/i.test(String(value || ""));
}
