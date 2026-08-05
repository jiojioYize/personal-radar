const SIGNAL_KINDS = new Set(["exact_artifact", "artifact_lead", "container_lead"]);
const SOURCE_LANES = new Set(["registryPulse", "officialRotation", "communityTrend"]);
const ARTIFACT_TYPES = new Set([
  "skill", "claude_instruction", "codex_instruction", "cursor_rule",
  "cline_rule", "roo_rule", "agent_definition", "instruction", "unknown",
]);

export async function createCandidateSignal({
  task,
  signalKind,
  title,
  locatorUrl,
  repositoryUrl = null,
  artifactPath = null,
  artifactType = "unknown",
  evidenceText,
  sourceRank = null,
  observedAt,
  parserVersion = "candidate-signal-parser-v1",
}) {
  const normalized = {
    version: 1,
    signalId: "pending",
    taskId: task?.taskId,
    lane: task?.lane,
    sourceId: task?.sourceId,
    signalKind,
    title: cleanText(title, 160),
    locatorUrl: canonicalHttps(locatorUrl),
    repositoryUrl: repositoryUrl ? canonicalRepositoryUrl(repositoryUrl) : null,
    artifactPath: artifactPath ? normalizeArtifactPath(artifactPath) : null,
    artifactType,
    evidenceText: cleanText(evidenceText, 500),
    sourceRank,
    observedAt: new Date(observedAt).toISOString(),
    parserVersion,
  };
  normalized.signalId = await stableSignalId(normalized);
  const errors = validateCandidateSignal(normalized, task);
  if (errors.length) throw new TypeError(errors.join("\n"));
  return normalized;
}

export function validateCandidateSignal(signal, task = null) {
  const errors = [];
  const expectedKeys = [
    "artifactPath", "artifactType", "evidenceText", "lane", "locatorUrl",
    "observedAt", "parserVersion", "repositoryUrl", "signalId", "signalKind",
    "sourceId", "sourceRank", "taskId", "title", "version",
  ];
  if (!sameKeys(signal, expectedKeys)) errors.push("candidate signal contains unknown or missing fields");
  if (signal?.version !== 1) errors.push("candidate signal version must be 1");
  if (task && (signal?.taskId !== task.taskId || signal?.lane !== task.lane
    || signal?.sourceId !== task.sourceId)) errors.push("candidate signal identity does not match its task");
  if (!SOURCE_LANES.has(signal?.lane)) errors.push("candidate signal lane is invalid");
  if (!SIGNAL_KINDS.has(signal?.signalKind)) errors.push("candidate signal kind is invalid");
  if (!ARTIFACT_TYPES.has(signal?.artifactType)) errors.push("candidate artifact type is invalid");
  if (!validText(signal?.title, 1, 160)) errors.push("candidate signal title is invalid");
  if (!validText(signal?.evidenceText, 1, 500)) errors.push("candidate signal evidence is invalid");
  if (!validHttps(signal?.locatorUrl)) errors.push("candidate locator must use HTTPS");
  if (signal?.repositoryUrl !== null && !validGithubRepository(signal.repositoryUrl)) {
    errors.push("candidate repository URL must identify a GitHub repository");
  }
  if (signal?.signalKind === "exact_artifact") {
    if (!signal.repositoryUrl || !validArtifactPath(signal.artifactPath)) {
      errors.push("exact artifact signals require a repository and safe artifact path");
    }
    if (signal.artifactType === "unknown") errors.push("exact artifacts require a known artifact type");
  } else if (signal?.artifactPath !== null) {
    errors.push("unresolved leads must not claim an artifact path");
  }
  if (signal?.sourceRank !== null
    && (!Number.isInteger(signal.sourceRank) || signal.sourceRank < 1 || signal.sourceRank > 10_000)) {
    errors.push("candidate source rank is invalid");
  }
  if (!Number.isFinite(Date.parse(signal?.observedAt))) errors.push("candidate observedAt is invalid");
  if (!validText(signal?.parserVersion, 1, 80)) errors.push("candidate parser version is invalid");
  if (!/^sig_[a-f0-9]{64}$/.test(signal?.signalId || "")) errors.push("candidate signal ID is invalid");
  return errors;
}

export function partitionCandidateSignals(signals) {
  const candidates = [];
  const pendingSignals = [];
  const duplicateTrajectories = [];
  const byKey = new Map();
  for (const signal of signals || []) {
    const errors = validateCandidateSignal(signal);
    if (errors.length) throw new TypeError(errors.join("\n"));
    if (signal.signalKind !== "exact_artifact") {
      pendingSignals.push({ signal, reason: "requires_artifact_resolution" });
      continue;
    }
    const candidateKey = `${signal.repositoryUrl}#artifact=${signal.artifactPath}`;
    const existing = byKey.get(candidateKey);
    if (existing) {
      existing.corroboratingSignals.push(signal);
      duplicateTrajectories.push({
        signalId: signal.signalId,
        candidateKey,
        reason: "duplicate_exact_artifact_signal",
        retainedBySignalId: existing.primarySignal.signalId,
      });
      continue;
    }
    const candidate = { candidateKey, primarySignal: signal, corroboratingSignals: [] };
    byKey.set(candidateKey, candidate);
    candidates.push(candidate);
  }
  return { candidates, pendingSignals, duplicateTrajectories };
}

export function canonicalRepositoryUrl(value) {
  const url = new URL(canonicalHttps(value));
  if (url.hostname.toLowerCase() !== "github.com") throw new TypeError("repository URL must use github.com");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) throw new TypeError("repository URL must include owner and repository");
  return `https://github.com/${segments[0]}/${segments[1].replace(/\.git$/i, "")}`;
}

export function normalizeArtifactPath(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!validArtifactPath(normalized)) throw new TypeError("artifact path is unsafe");
  return normalized;
}

async function stableSignalId(signal) {
  const identity = [
    signal.taskId, signal.signalKind, signal.locatorUrl,
    signal.repositoryUrl || "", signal.artifactPath || "",
  ].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return `sig_${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function cleanText(value, maximum) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function canonicalHttps(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new TypeError("URL must use HTTPS");
  url.hash = "";
  return url.href;
}

function validHttps(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function validGithubRepository(value) {
  try {
    return canonicalRepositoryUrl(value) === value;
  } catch {
    return false;
  }
}

function validArtifactPath(value) {
  const text = String(value || "");
  return Boolean(text) && text.length <= 500 && !text.includes("..")
    && !text.startsWith("/") && !text.endsWith("/") && !text.includes("\\");
}

function validText(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function sameKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
