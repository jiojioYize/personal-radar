export const STRUCTURED_REPORT_SCHEMA_VERSION = 1;
export const MAX_REPORT_ITEMS = 6;
export const MIN_BASE_SCORE = 70;

export const SCORE_WEIGHTS = Object.freeze({
  relevance: 25,
  reusability: 20,
  maintenanceEvidence: 15,
  novelty: 15,
  adaptationFeasibility: 15,
  trustSafety: 10,
});

export const REPORT_STATUSES = new Set(["published", "no_update"]);
export const RECOMMENDATIONS = new Set(["install", "adapt", "watch", "skip"]);
export const DISCOVERY_TYPES = new Set(["github", "web", "x", "inbox"]);

export function calculateBaseScore(dimensions = {}) {
  const total = Object.entries(SCORE_WEIGHTS).reduce((sum, [name, weight]) => {
    const value = Number(dimensions[name]);
    if (!Number.isFinite(value)) return sum;
    return sum + (Math.max(0, Math.min(5, value)) / 5) * weight;
  }, 0);
  return Math.round(total);
}

export function canonicalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error(`Invalid URL: ${value || "<empty>"}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Only HTTPS sources are allowed: ${parsed.href}`);
  }

  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";

  const host = parsed.hostname.toLowerCase();
  if (host === "github.com" || host === "www.github.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`GitHub source must identify a repository: ${parsed.href}`);
    }
    const owner = segments[0].toLowerCase();
    const repository = segments[1].replace(/\.git$/i, "").toLowerCase();
    return `https://github.com/${owner}/${repository}`;
  }

  parsed.hostname = host;
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

export function stableSourceId(canonicalUrl) {
  const text = canonicalizeUrl(canonicalUrl);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `src_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function calculatePreferenceAdjustment(item, feedbackEntries = []) {
  let adjustment = 0;
  const category = String(item.category || "").toLowerCase();

  for (const entry of feedbackEntries) {
    if (String(entry.category || "").toLowerCase() !== category) continue;
    if (entry.rating === "interested") adjustment += 1;
    if (entry.rating === "not_interested") adjustment -= 1;
  }

  return Math.max(-5, Math.min(5, adjustment));
}

export function enrichStructuredReport(input, { feedbackEntries = [], preservePreference = false } = {}) {
  const report = structuredClone(input);
  report.schemaVersion = STRUCTURED_REPORT_SCHEMA_VERSION;
  report.status = REPORT_STATUSES.has(report.status) ? report.status : "published";
  report.channel = normalizeSegment(report.channel || "skill-radar");
  report.items = Array.isArray(report.items) ? report.items : [];
  report.socialDecisions = Array.isArray(report.socialDecisions) ? report.socialDecisions : [];

  report.items = report.items.map((item, index) => {
    const canonicalUrl = canonicalizeUrl(item.sourceUrl || item.canonicalUrl);
    const baseScore = calculateBaseScore(item.quality?.dimensions);
    const preferenceAdjustment = preservePreference
      ? Math.max(-5, Math.min(5, Number(item.quality?.preferenceAdjustment || 0)))
      : calculatePreferenceAdjustment(item, feedbackEntries);
    return {
      ...item,
      id: stableSourceId(canonicalUrl),
      rank: index + 1,
      sourceUrl: String(item.sourceUrl || canonicalUrl),
      canonicalUrl,
      quality: {
        ...item.quality,
        baseScore,
        preferenceAdjustment,
        finalRankScore: baseScore + preferenceAdjustment,
      },
    };
  });

  report.stats = {
    reviewedCount: Number(report.stats?.reviewedCount || 0),
    selectedCount: report.items.length,
    duplicateCount: Number(report.stats?.duplicateCount || 0),
    rejectedCount: Number(report.stats?.rejectedCount || 0),
    sourceCounts: report.stats?.sourceCounts || {},
    xDiscovery: normalizeXDiscovery(report.stats?.xDiscovery),
  };

  return report;
}

export function normalizeXDiscovery(value = {}) {
  return {
    searched: Boolean(value.searched),
    candidateCount: Number(value.candidateCount || 0),
    verifiedCount: Number(value.verifiedCount || 0),
    selectedCount: Number(value.selectedCount || 0),
    rejectedCount: Number(value.rejectedCount || 0),
    deferredCount: Number(value.deferredCount || 0),
  };
}

export function validateStructuredSemantics(report, { recentSources = [] } = {}) {
  const errors = [];
  const items = Array.isArray(report.items) ? report.items : [];
  const recent = new Map(
    recentSources.map((entry) => [
      String(entry.canonicalUrl || ""),
      Array.isArray(entry.dates) ? entry.dates : [entry.reportDate].filter(Boolean),
    ]),
  );
  const seen = new Set();

  if (!REPORT_STATUSES.has(report.status)) {
    errors.push(`Unsupported report status: ${report.status}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(report.reportDate || ""))) {
    errors.push("reportDate must use YYYY-MM-DD");
  }
  if (report.status === "published" && (items.length < 1 || items.length > MAX_REPORT_ITEMS)) {
    errors.push(`published reports must contain 1-${MAX_REPORT_ITEMS} items`);
  }
  if (report.status === "no_update" && items.length !== 0) {
    errors.push("no_update reports must contain zero items");
  }
  if (Number(report.stats?.selectedCount) !== items.length) {
    errors.push("stats.selectedCount must match items.length");
  }
  if (Number(report.stats?.reviewedCount) < 8) {
    errors.push("stats.reviewedCount must be at least 8");
  }
  if (report.stats?.xDiscovery?.searched !== true) {
    errors.push("stats.xDiscovery.searched must be true for Stage 2 reports");
  }
  const xSelectedItems = items.filter((item) => ["x", "inbox"].includes(item.discovery?.type)).length;
  if (Number(report.stats?.xDiscovery?.selectedCount || 0) !== xSelectedItems) {
    errors.push("stats.xDiscovery.selectedCount must match x/inbox selected items");
  }
  if (Number(report.stats?.xDiscovery?.candidateCount || 0) < Number(report.stats?.xDiscovery?.selectedCount || 0)) {
    errors.push("stats.xDiscovery.candidateCount must be at least selectedCount");
  }

  for (const [index, item] of items.entries()) {
    const label = `items[${index}]`;
    let canonicalUrl;
    try {
      canonicalUrl = canonicalizeUrl(item.sourceUrl);
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
      continue;
    }

    if (item.canonicalUrl !== canonicalUrl) {
      errors.push(`${label}: canonicalUrl does not match sourceUrl`);
    }
    if (item.id !== stableSourceId(canonicalUrl)) {
      errors.push(`${label}: id does not match canonicalUrl`);
    }
    if (seen.has(canonicalUrl)) {
      errors.push(`${label}: duplicate source in the same report`);
    }
    seen.add(canonicalUrl);

    if (!RECOMMENDATIONS.has(item.recommendation)) {
      errors.push(`${label}: unsupported recommendation`);
    }
    if (!DISCOVERY_TYPES.has(item.discovery?.type)) {
      errors.push(`${label}: unsupported discovery type`);
    }
    if (Number(item.quality?.baseScore) < MIN_BASE_SCORE) {
      errors.push(`${label}: base score is below ${MIN_BASE_SCORE}`);
    }
    if (item.quality?.skillLike !== true) {
      errors.push(`${label}: skillLike must be true`);
    }
    if (item.quality?.officialSourceVerified !== true) {
      errors.push(`${label}: officialSourceVerified must be true`);
    }
    if (!String(item.display?.zh?.primaryCaution || "").trim() || !String(item.display?.en?.primaryCaution || "").trim()) {
      errors.push(`${label}: bilingual primary caution is required`);
    }

    const previousDates = recent.get(canonicalUrl) || [];
    if (previousDates.length && item.quality?.history?.materialChange !== true) {
      errors.push(`${label}: source appeared within 30 days without a material change`);
    }
    if (item.quality?.history?.materialChange === true && !String(item.quality?.history?.changeEvidence || "").trim()) {
      errors.push(`${label}: material change requires evidence`);
    }
  }

  return errors;
}

export function normalizeSegment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
