const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const REGISTRY_VIEWS = Object.freeze(["all_time", "trending", "hot", "official"]);

export const OFFICIAL_SOURCE_ROTATION = Object.freeze([
  { id: "anthropicSkills", url: "https://github.com/anthropics/skills" },
  { id: "openAiPlugins", url: "https://github.com/openai/plugins" },
  { id: "githubAwesomeCopilot", url: "https://github.com/github/awesome-copilot" },
  { id: "cursorMarketplace", url: "https://cursor.com/marketplace" },
  {
    id: "geminiExtensions",
    url: "https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/index.md",
  },
  { id: "nvidiaSkills", url: "https://github.com/NVIDIA/skills" },
  { id: "huggingFaceSkills", url: "https://github.com/huggingface/skills" },
  { id: "microsoftAgentSkills", url: "https://github.com/MicrosoftDocs/agent-skills" },
].map(Object.freeze));

export const COMMUNITY_SOURCES = Object.freeze([
  { id: "awesomeClaudeSkills", url: "https://awesomeclaudeskills.com/" },
  { id: "openAgentSkill", url: "https://www.openagentskill.com/skills" },
].map(Object.freeze));

export const CANDIDATE_BUDGET = Object.freeze({
  initialMinimum: 8,
  initialMaximum: 12,
  replenishmentTarget: 5,
  maximumFilterPasses: 3,
  maximumCumulativeCandidates: 20,
});

const PLAN_KEYS = [
  "communitySources", "completedRunCount", "minimumOfficialSources",
  "officialSources", "registryFocus", "registryUrl", "reportDate",
  "sourceProfile", "version",
];

export function createSourcePortfolioPlan({ reportDate, completedRunCount }) {
  if (!validDate(reportDate)) {
    throw new TypeError("reportDate must use YYYY-MM-DD");
  }
  if (!Number.isInteger(completedRunCount) || completedRunCount < 0) {
    throw new TypeError("completedRunCount must be a non-negative integer");
  }
  const registryFocus = REGISTRY_VIEWS[completedRunCount % REGISTRY_VIEWS.length];
  const officialSources = Array.from({ length: 3 }, (_, offset) =>
    OFFICIAL_SOURCE_ROTATION[
      (completedRunCount * 3 + offset) % OFFICIAL_SOURCE_ROTATION.length
    ]).map((source) => ({ ...source }));
  return {
    version: 1,
    sourceProfile: "portfolio-v1",
    reportDate,
    registryFocus,
    registryUrl: registryUrlFor(registryFocus),
    officialSources,
    minimumOfficialSources: 2,
    communitySources: COMMUNITY_SOURCES.map((source) => ({ ...source })),
    completedRunCount,
  };
}

export function validateSourcePortfolioPlan(plan) {
  const errors = [];
  if (!sameKeys(plan, PLAN_KEYS)) errors.push("plan contains unknown or missing fields");
  if (plan?.version !== 1 || plan?.sourceProfile !== "portfolio-v1") {
    errors.push("plan must use portfolio-v1 version 1");
  }
  if (!validDate(plan?.reportDate)) errors.push("reportDate must use a real YYYY-MM-DD date");
  if (!REGISTRY_VIEWS.includes(plan?.registryFocus)) errors.push("registryFocus is invalid");
  if (plan?.registryUrl !== registryUrlFor(plan?.registryFocus)) errors.push("registryUrl does not match registryFocus");
  if (!Array.isArray(plan?.officialSources) || plan.officialSources.length !== 3) {
    errors.push("officialSources must contain exactly three sources");
  } else {
    const allowed = new Map(OFFICIAL_SOURCE_ROTATION.map((source) => [source.id, source.url]));
    const ids = new Set();
    for (const source of plan.officialSources) {
      if (!sameKeys(source, ["id", "url"])) errors.push("official source contains unknown or missing fields");
      if (allowed.get(source?.id) !== source?.url) errors.push(`official source ${source?.id || "unknown"} is invalid`);
      ids.add(source?.id);
    }
    if (ids.size !== plan.officialSources.length) errors.push("officialSources must be distinct");
  }
  if (plan?.minimumOfficialSources !== 2) errors.push("minimumOfficialSources must be 2");
  if (JSON.stringify(plan?.communitySources) !== JSON.stringify(COMMUNITY_SOURCES)) {
    errors.push("communitySources do not match portfolio-v1");
  }
  if (!Number.isInteger(plan?.completedRunCount) || plan.completedRunCount < 0) {
    errors.push("completedRunCount must be a non-negative integer");
  } else if (validDate(plan?.reportDate)) {
    const expected = createSourcePortfolioPlan({
      reportDate: plan.reportDate,
      completedRunCount: plan.completedRunCount,
    });
    if (plan.registryFocus !== expected.registryFocus
      || JSON.stringify(plan.officialSources) !== JSON.stringify(expected.officialSources)) {
      errors.push("plan does not match the deterministic completed-run rotation");
    }
  }
  return errors;
}

export async function sourcePlanHash(plan) {
  const errors = validateSourcePortfolioPlan(plan);
  if (errors.length) throw new TypeError(errors.join("\n"));
  const data = new TextEncoder().encode(stableJson(plan));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function collectionTasksForPlan(plan) {
  const errors = validateSourcePortfolioPlan(plan);
  if (errors.length) throw new TypeError(errors.join("\n"));
  return [
    sourceTask("registryPulse", "skillsSh", plan.registryUrl, {
      registryView: plan.registryFocus,
    }),
    ...plan.officialSources.map((source) =>
      sourceTask("officialRotation", source.id, source.url)),
    ...plan.communitySources.map((source) =>
      sourceTask("communityTrend", source.id, source.url)),
  ];
}

export const COLLECTION_REQUIREMENTS = Object.freeze({
  registryPulse: Object.freeze({ minimumSuccessfulSources: 1 }),
  officialRotation: Object.freeze({ minimumSuccessfulSources: 2 }),
  communityTrend: Object.freeze({ minimumSuccessfulSources: 1 }),
});

export function validateCollectionCoverage(results) {
  const errors = [];
  for (const [lane, requirement] of Object.entries(COLLECTION_REQUIREMENTS)) {
    const successes = new Set((results || [])
      .filter((result) => result?.lane === lane && result.status === "succeeded")
      .map((result) => result.sourceId));
    if (successes.size < requirement.minimumSuccessfulSources) {
      errors.push(`${lane} requires ${requirement.minimumSuccessfulSources} successful source collection(s)`);
    }
  }
  return errors;
}

export function deriveSourceCollectionStatus(tasks, results) {
  const successfulTaskIds = new Set((results || [])
    .filter((result) => result?.status === "succeeded")
    .map((result) => result.taskId));
  const complete = tasks.length > 0
    && tasks.every((task) => successfulTaskIds.has(task.taskId));
  if (complete) return "complete";
  return validateCollectionCoverage(results).length === 0 ? "degraded" : "source_incomplete";
}

export function validateCollectionResult(task, result) {
  const errors = [];
  if (result?.taskId !== task?.taskId
    || result?.lane !== task?.lane
    || result?.sourceId !== task?.sourceId) {
    errors.push("collection result identity does not match its task");
  }
  if (!["succeeded", "failed", "degraded_cached"].includes(result?.status)) {
    errors.push("collection result status is invalid");
  }
  if (typeof result?.retryable !== "boolean") errors.push("collection result retryable must be boolean");
  if (!Array.isArray(result?.candidateSignals)) errors.push("candidateSignals must be an array");
  const signals = Array.isArray(result?.candidateSignals) ? result.candidateSignals : [];
  if (signals.length > task.maxCandidateSignals) {
    errors.push(`collection result exceeds ${task.maxCandidateSignals} candidate signals`);
  }
  if (new TextEncoder().encode(JSON.stringify(signals)).byteLength > 65_536) {
    errors.push("candidate signals exceed their total byte limit");
  }
  if (result?.status === "succeeded" && !/^[a-f0-9]{64}$/.test(result?.contentHash || "")) {
    errors.push("successful collection requires a SHA-256 content hash");
  }
  if (result?.status === "failed" && !result?.errorClass) {
    errors.push("failed collection requires an error class");
  }
  const expectedCacheStatuses = {
    succeeded: new Set(["fresh", "validated_304"]),
    failed: new Set(["none"]),
    degraded_cached: new Set(["stale_fallback"]),
  };
  if (!expectedCacheStatuses[result?.status]?.has(result?.cacheStatus)) {
    errors.push("collection cache status does not match result status");
  }
  if (new TextEncoder().encode(String(result?.boundedExcerpt || "")).byteLength
    > task.maxExcerptBytes) {
    errors.push("collection excerpt exceeds its byte limit");
  }
  return errors;
}

function sourceTask(lane, sourceId, url, extra = {}) {
  return {
    taskId: `${lane}:${sourceId}`,
    lane,
    sourceId,
    url,
    purpose: "candidate_discovery",
    provenancePolicy: lane === "communityTrend" ? "independent" : "first_party_or_official",
    maxExcerptBytes: 32_768,
    maxCandidateSignals: 4,
    maxResponseBytes: 1_048_576,
    maxRedirects: 2,
    timeoutMs: 15_000,
    ...extra,
  };
}

function validDate(value) {
  const text = String(value || "");
  if (!DATE_PATTERN.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function sameKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function registryUrlFor(view) {
  return view === "all_time" ? "https://www.skills.sh/" : `https://www.skills.sh/${view}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
