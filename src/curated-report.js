import { artifactKeyFor, canonicalizeUrl, stableSourceId } from "./report-structure.js";

const DECISIONS = new Set(["recommend", "watch", "reject"]);
const ACTIONS = new Set(["install", "adapt"]);
const COLLECTION_SCOPES = new Set(["general_skill_collection", "official_catalog", "mixed_toolkit"]);
const DISPLAY_FIELDS = [
  "oneLiner", "whyNow", "bestFor", "action", "primaryCaution",
  "problem", "usability", "adaptation", "trust",
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
    recommendation: decision.recommendation,
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
      watchCount: enrichedDecisions.filter((entry) => entry.decision === "watch").length,
      rejectedCount: enrichedDecisions.filter((entry) => entry.decision === "reject").length,
      sourceCounts: draft.sourceCounts || {},
    },
    items,
    decisions: enrichedDecisions,
  };
}

export function validateCuratedReport(report) {
  const errors = [];
  if (report.schemaVersion !== 3) errors.push("schemaVersion must be 3");
  if (report.channel !== "skill-radar") errors.push("channel must be skill-radar");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.reportDate || "")) errors.push("reportDate must use YYYY-MM-DD");
  if (!localized(report.summary) || !localized(report.conclusion)) errors.push("summary and conclusion must be bilingual");
  if (report.stats?.candidateCount < 8 || report.stats?.candidateCount > 20) errors.push("candidateCount must be 8-20");
  if (!Array.isArray(report.decisions) || report.decisions.length !== 5) errors.push("exactly five verified decisions are required");
  if (!Array.isArray(report.items) || report.items.length > 5) errors.push("items must contain at most five recommendations");
  if (report.status === "published" && report.items.length < 1) errors.push("published requires at least one item");
  if (report.status === "no_update" && report.items.length !== 0) errors.push("no_update requires zero items");
  if (report.stats?.selectedCount !== report.items.length) errors.push("selectedCount must match items");
  for (const source of ["awesomeClaudeSkills", "agentPlugins", "openAgentSkill"]) {
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
    if (COLLECTION_SCOPES.has(decision.artifactScope) && !text(decision.artifactPath)) errors.push(`${label}.artifactPath is required for collection scope`);
    if (decision.history?.exactDuplicate === true) errors.push(`${label} repeats an exact artifact within 30 days`);
    if (decisionArtifacts.has(decision.artifactKey)) errors.push(`${label} repeats another verified artifact`);
    decisionArtifacts.add(decision.artifactKey);
    if (decision.decision === "recommend") {
      if (!ACTIONS.has(decision.recommendation)) errors.push(`${label}.recommendation must be install or adapt`);
      if (!localizedDisplay(decision.display)) errors.push(`${label}.display must contain all bilingual fields`);
      if (!selectedIds.has(decision.id)) errors.push(`${label} is missing from selected items`);
      if (repositories.has(decision.canonicalUrl)) errors.push("only one recommended artifact per repository is allowed");
      repositories.add(decision.canonicalUrl);
    }
  }
  return errors;
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
