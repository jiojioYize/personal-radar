import { artifactKeyFor, canonicalizeUrl, stableSourceId } from "./report-structure.js";

const DECISIONS = new Set(["recommend", "defer", "reject"]);
const COLLECTION_SCOPES = new Set(["general_skill_collection", "official_catalog", "mixed_toolkit"]);
const DISPLAY_FIELDS = [
  "oneLiner", "whyNow", "bestFor", "action", "primaryCaution",
  "problem", "usability", "adaptation", "trust",
];
const INTERNAL_PUBLIC_COPY_PATTERNS = [
  /(?:三个|3\s*个|three)\s*(?:固定|指定|required|fixed|specified)?\s*(?:目录|来源|directories|sources)/i,
  /候选池|候选数量|代码过滤|过滤轮次|逐项核验|内部评分|candidate pool|candidate count|code[- ]owned filter|filter pass/i,
  /\b(?:Sidecar|sourceCounts|eligibleCandidates|schemaVersion)\b/i,
  /(?:其余|剩余).{0,24}(?:暂缓|拒绝)|(?:remaining|other) items?.{0,24}(?:defer|reject)/i,
  /`(?:recommend|defer|reject)`/i,
];

export function enrichCuratedReport(input, { recentSources = [] } = {}) {
  const draft = structuredClone(input || {});
  const decisions = Array.isArray(draft.decisions) ? draft.decisions : [];
  const recent = new Map(recentSources.map((entry) => [entry.artifactKey, entry]));

  const enrichedDecisions = decisions.map((decision) => {
    const sourceUrl = String(decision.sourceUrl || "");
    const artifactScope = String(decision.artifactScope || "individual_skill");
    const artifactPath = decision.artifactPath == null ? null : String(decision.artifactPath);
    const identityInput = {
      sourceUrl,
      quality: { evidence: { artifactScope, artifactPath } },
    };
    const canonicalUrl = canonicalizeUrl(sourceUrl);
    const artifactKey = artifactKeyFor(identityInput);
    const prior = recent.get(artifactKey);
    return {
      ...decision,
      sourceUrl,
      artifactScope,
      artifactPath,
      canonicalUrl,
      artifactKey,
      id: stableSourceId(artifactKey),
      history: {
        exactDuplicate: Boolean(prior),
        previousDates: prior?.dates || [],
      },
    };
  });

  const selected = enrichedDecisions.filter((decision) => decision.decision === "recommend");
  const items = selected.map((decision, index) => ({
    id: decision.id,
    rank: index + 1,
    title: decision.title,
    category: decision.category,
    sourceUrl: decision.sourceUrl,
    canonicalUrl: decision.canonicalUrl,
    artifactKey: decision.artifactKey,
    discovery: decision.discovery,
    display: decision.display,
    quality: {
      sourceCheckedAt: decision.sourceCheckedAt,
      license: decision.license ?? null,
      history: decision.history,
    },
  }));

  return {
    schemaVersion: 3,
    status: items.length ? "published" : "no_update",
    channel: "skill-radar",
    reportDate: String(draft.reportDate || ""),
    summary: draft.summary,
    conclusion: draft.conclusion,
    stats: {
      reviewedCount: enrichedDecisions.length,
      candidateCount: Number(draft.candidateCount || 0),
      selectedCount: items.length,
      duplicateCount: Number(draft.duplicateCount || 0),
      deferredCount: enrichedDecisions.filter((entry) => entry.decision === "defer").length,
      rejectedCount: enrichedDecisions.filter((entry) => entry.decision === "reject").length,
      sourceCounts: draft.sourceCounts || {},
    },
    items,
    decisions: enrichedDecisions,
  };
}

export function validateCuratedReport(report, { sourceProfile = null } = {}) {
  const errors = [];
  sourceProfile ||= Object.hasOwn(report.stats?.sourceCounts || {}, "registryPulse")
    ? "portfolio-v1"
    : "legacy-v3";
  if (report.schemaVersion !== 3) errors.push("schemaVersion must be 3");
  if (report.channel !== "skill-radar") errors.push("channel must be skill-radar");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.reportDate || "")) errors.push("reportDate must use YYYY-MM-DD");
  if (!localized(report.summary) || !localized(report.conclusion)) errors.push("summary and conclusion must be bilingual");
  for (const [field, value] of publicCopyFields(report)) {
    if (containsInternalProcessLanguage(value)) errors.push(`${field} must use reader-facing language`);
  }
  if (report.stats?.candidateCount < 8 || report.stats?.candidateCount > 20) errors.push("candidateCount must be 8-20");
  if (!Array.isArray(report.decisions) || report.decisions.length < 5 || report.decisions.length > 20) errors.push("five to twenty verified decisions are required");
  if (!Array.isArray(report.items) || report.items.length > 20) errors.push("items must contain at most twenty recommendations");
  if (report.stats?.reviewedCount !== report.decisions.length) errors.push("reviewedCount must match decisions");
  if (report.stats?.reviewedCount > report.stats?.candidateCount) errors.push("reviewedCount cannot exceed candidateCount");
  if (report.status === "published" && report.items.length < 1) errors.push("published requires at least one item");
  if (report.status === "no_update" && report.items.length !== 0) errors.push("no_update requires zero items");
  if (report.stats?.selectedCount !== report.items.length) errors.push("selectedCount must match items");
  const requiredSources = sourceProfile === "portfolio-v1"
    ? ["registryPulse", "officialRotation", "communityTrend"]
    : ["awesomeClaudeSkills", "agentPlugins", "openAgentSkill"];
  for (const source of requiredSources) {
    if (Number(report.stats?.sourceCounts?.[source] || 0) < 1) errors.push(`sourceCounts.${source} must be at least 1`);
  }
  const sourceTotal = Object.values(report.stats?.sourceCounts || {}).reduce((total, value) => total + Number(value || 0), 0);
  if (sourceTotal !== report.stats?.candidateCount) errors.push("sourceCounts must sum to candidateCount");

  const selectedIds = new Set(report.items.map((item) => item.id));
  const decisionArtifacts = new Set();
  const repositories = new Set();
  for (const [index, decision] of (report.decisions || []).entries()) {
    const label = `decisions[${index}]`;
    if (!DECISIONS.has(decision.decision)) errors.push(`${label}.decision is invalid`);
    if (!text(decision.title) || !text(decision.category) || !text(decision.reason)) errors.push(`${label} requires title, category, and reason`);
    if (!https(decision.sourceUrl) || !https(decision.discovery?.url)) errors.push(`${label} sources must use HTTPS`);
    if (decision.officialSourceVerified !== true || !dateTime(decision.sourceCheckedAt)) errors.push(`${label} requires verified primary-source evidence`);
    if (sourceProfile === "portfolio-v1" && !validSourceContext(decision.sourceContext)) {
      errors.push(`${label}.sourceContext is incomplete`);
    }
    if (COLLECTION_SCOPES.has(decision.artifactScope) && !text(decision.artifactPath)) errors.push(`${label}.artifactPath is required for collection scope`);
    if (decision.history?.exactDuplicate === true) errors.push(`${label} repeats an exact artifact within 30 days`);
    if (decisionArtifacts.has(decision.artifactKey)) errors.push(`${label} repeats another verified artifact`);
    decisionArtifacts.add(decision.artifactKey);
    if (decision.decision === "recommend") {
      if (!localizedDisplay(decision.display)) errors.push(`${label}.display must contain all bilingual fields`);
      if (!selectedIds.has(decision.id)) errors.push(`${label} is missing from selected items`);
      if (repositories.has(decision.canonicalUrl)) errors.push("only one recommended artifact per repository is allowed");
      repositories.add(decision.canonicalUrl);
    }
  }
  return errors;
}

function publicCopyFields(report) {
  const fields = [
    ["summary.zh", report.summary?.zh], ["summary.en", report.summary?.en],
    ["conclusion.zh", report.conclusion?.zh], ["conclusion.en", report.conclusion?.en],
  ];
  for (const [index, decision] of (report.decisions || []).entries()) {
    if (decision.decision !== "recommend") continue;
    for (const language of ["zh", "en"]) {
      for (const field of DISPLAY_FIELDS) {
        fields.push([`decisions[${index}].display.${language}.${field}`, decision.display?.[language]?.[field]]);
      }
    }
  }
  return fields;
}

function containsInternalProcessLanguage(value) {
  const content = String(value || "");
  return INTERNAL_PUBLIC_COPY_PATTERNS.some((pattern) => pattern.test(content));
}

function validSourceContext(value) {
  return text(value?.lane)
    && text(value?.sourceId)
    && text(value?.containerType)
    && https(value?.containerUrl)
    && text(value?.artifactType)
    && text(value?.provenance)
    && Array.isArray(value?.discoverySignals)
    && value.discoverySignals.length > 0
    && Array.isArray(value?.dependencies)
    && value.dependencies.length > 0
    && (value.registryView === null || ["all_time", "trending", "hot", "official"].includes(value.registryView));
}

function localized(value) {
  return text(value?.zh) && text(value?.en);
}

function localizedDisplay(value) {
  return ["zh", "en"].every((language) => DISPLAY_FIELDS.every((field) => text(value?.[language]?.[field])));
}

function text(value) {
  return Boolean(String(value || "").trim());
}

function https(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function dateTime(value) {
  return text(value) && !Number.isNaN(new Date(value).getTime());
}
