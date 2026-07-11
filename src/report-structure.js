export const STRUCTURED_REPORT_SCHEMA_VERSION = 2;
export const MAX_REPORT_ITEMS = 6;
export const MIN_BASE_SCORE = 70;

export const SCORE_MAXIMUMS = Object.freeze({
  valueClarity: 20,
  nativeUsabilityPortability: 20,
  implementationQuality: 15,
  maintenanceHealth: 10,
  communityValidation: 15,
  trustSafetyLicense: 10,
  differentiation: 10,
});

export const ARTIFACT_SCOPES = new Set([
  "individual_skill",
  "focused_skill_pack",
  "general_skill_collection",
  "official_catalog",
  "curated_list",
  "mixed_toolkit",
]);

export const SUPPORTED_PLATFORMS = new Set([
  "codex",
  "claude-code",
  "cursor",
  "cline",
  "roo-code",
  "hermes",
  "github-copilot",
  "gemini-cli",
  "generic-agent",
  "other",
]);

export const REPORT_STATUSES = new Set(["published", "no_update"]);
export const RECOMMENDATIONS = new Set(["install", "adapt", "watch", "skip"]);
export const DISCOVERY_TYPES = new Set(["github", "web", "x", "inbox"]);

export function calculateQualityScore(evidence = {}) {
  const valueClarity = sumChecks(evidence.value, {
    specificTaskDefined: 4,
    targetUserDefined: 2,
    inputsOutputsDefined: 3,
    workflowImprovementDefined: 3,
    officialDemonstration: 4,
    independentOutcomeEvidence: 4,
  });

  const usability = evidence.usability || {};
  const nativeUsabilityPortability = sumChecks(usability, {
    reusableContentPresent: 4,
    targetPlatformsDocumented: 2,
    nativeInstallInstructions: 3,
    nativeUsageExample: 3,
    dependenciesAndPermissionsDocumented: 2,
    validationMethodAvailable: 2,
    coreInstructionsPortable: 2,
  }) + (isMet(usability.multiPlatformSupport) || isMet(usability.adaptationGuideAvailable) ? 2 : 0);

  const implementationQuality = sumChecks(evidence.implementation, {
    documentedStructureMatches: 3,
    coreFilesSubstantive: 3,
    triggerOrScopeDefined: 2,
    executableStepsDefined: 2,
    constraintsAndFailureModesDefined: 2,
    testsOrReviewableExamples: 3,
  });

  const maintenance = evidence.maintenance || {};
  let maintenanceHealth = 0;
  if (numberAtLeast(maintenance.commitCount90d, 1)) maintenanceHealth += 2;
  if (numberAtLeast(maintenance.activeMonths12m, 3)) maintenanceHealth += 1;
  if (numberAtLeast(maintenance.activeMonths12m, 6)) maintenanceHealth += 1;
  if (numberAtLeast(maintenance.releaseCount12m, 1)) maintenanceHealth += 1;
  if (numberAtLeast(maintenance.contributorCount12m, 2)) maintenanceHealth += 1;
  if (numberAtLeast(maintenance.independentIssueOrPrParticipants90d, 1)) maintenanceHealth += 1;
  if (maintenance.hasUnresolvedBlockingIssues === false) maintenanceHealth += 1;
  if (maintenance.archived === false && maintenance.maintenanceEnded === false) maintenanceHealth += 2;
  if (maintenance.archived === true) maintenanceHealth = Math.min(maintenanceHealth, 3);
  if (numberBelow(maintenance.repositoryAgeDays, 90)) maintenanceHealth = Math.min(maintenanceHealth, 8);

  const community = evidence.community || {};
  let starPoints = calculateStarPoints(community.stars);
  if (evidence.artifactScope === "general_skill_collection" && !isMet(community.itemLevelAdoptionEvidence)) {
    starPoints = Math.min(starPoints, 4);
  }
  if (evidence.artifactScope === "mixed_toolkit" && !isMet(community.skillSpecificAttentionEvidence)) {
    starPoints = Math.min(starPoints, 3);
  }
  if (evidence.artifactScope === "curated_list") starPoints = 0;

  let participationPoints = 0;
  if (numberAtLeast(community.contributors, 2)) participationPoints += 1;
  if (numberAtLeast(community.contributors, 5)) participationPoints += 1;
  if (numberAtLeast(community.independentParticipants90d, 3)) participationPoints += 1;

  let adoptionPoints = 0;
  if (numberAtLeast(community.independentAdoptions, 1)) adoptionPoints += 2;
  if (numberAtLeast(community.independentAdoptions, 2)) adoptionPoints += 1;
  if (isMet(community.credibleOrganizationBacking)) adoptionPoints += 1;
  if (isMet(community.verifiableUsageCase)) adoptionPoints += 1;

  let growthPoints = 0;
  const stars = numeric(community.stars);
  const growth30d = numeric(community.starsGrowth30d);
  if (stars !== null && growth30d !== null && growth30d >= 10 && growth30d >= stars * 0.1) growthPoints += 1;
  if (numberAtLeast(community.starsGrowth90d, 1) && numberAtLeast(community.independentParticipants90d, 1)) growthPoints += 1;
  const communityValidation = Math.min(15, starPoints + participationPoints + adoptionPoints + growthPoints);

  const security = evidence.security || {};
  let trustSafetyLicense = sumChecks(security, {
    licensePresent: 2,
    permissionsDocumented: 2,
    externalBehaviorDocumented: 1,
    dangerousActionsRequireConfirmation: 2,
    installationAuditable: 2,
  });
  if (isMet(security.securityPolicyPresent) || isMet(security.applicableOpenSsfEvidence)) trustSafetyLicense += 1;
  if (!isMet(security.licensePresent)) trustSafetyLicense = Math.min(trustSafetyLicense, 6);
  if (security.permissionsDocumented === "unknown" || security.externalBehaviorDocumented === "unknown") {
    trustSafetyLicense = Math.min(trustSafetyLicense, 5);
  }

  const differentiation = sumChecks(evidence.differentiation, {
    newProblemCoverage: 2,
    newAgentFormatOrWorkflow: 2,
    fewerAdaptationSteps: 2,
    newValidationMechanism: 2,
    newSecurityOrCollaborationBoundary: 2,
  });
  const boundedDifferentiation = Array.isArray(evidence.differentiation?.comparisonSources)
    && evidence.differentiation.comparisonSources.length
    ? differentiation
    : Math.min(differentiation, 2);

  const dimensions = {
    valueClarity,
    nativeUsabilityPortability,
    implementationQuality,
    maintenanceHealth,
    communityValidation,
    trustSafetyLicense,
    differentiation: boundedDifferentiation,
  };
  return {
    dimensions,
    baseScore: Object.values(dimensions).reduce((sum, value) => sum + value, 0),
  };
}

export function calculateBaseScore(value = {}) {
  if (value?.evidence) return calculateQualityScore(value.evidence).baseScore;
  return Object.entries(SCORE_MAXIMUMS).reduce((sum, [name, maximum]) => {
    const score = Number(value[name]);
    return sum + (Number.isFinite(score) ? Math.max(0, Math.min(maximum, score)) : 0);
  }, 0);
}

export function calculateStarPoints(value) {
  const stars = numeric(value);
  if (stars === null || stars < 50) return 0;
  if (stars < 200) return 1;
  if (stars < 1000) return 2;
  if (stars < 5000) return 3;
  if (stars < 10000) return 4;
  return 5;
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
    const score = calculateQualityScore(item.quality?.evidence);
    const baseScore = score.baseScore;
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
        dimensions: score.dimensions,
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
    validateQualityEvidence(item, label, errors);
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

function validateQualityEvidence(item, label, errors) {
  const quality = item.quality || {};
  const evidence = quality.evidence || {};
  const dimensions = quality.dimensions || {};
  if (!ARTIFACT_SCOPES.has(evidence.artifactScope)) errors.push(`${label}: unsupported artifactScope`);
  if (!Array.isArray(evidence.declaredPlatforms) || evidence.declaredPlatforms.length === 0) {
    errors.push(`${label}: at least one declared platform is required`);
  } else if (evidence.declaredPlatforms.some((platform) => !SUPPORTED_PLATFORMS.has(platform))) {
    errors.push(`${label}: unsupported declared platform`);
  }
  if (!isMet(evidence.value?.specificTaskDefined)) errors.push(`${label}: specific task evidence is required`);
  if (!isMet(evidence.usability?.reusableContentPresent)) errors.push(`${label}: reusable content evidence is required`);
  if (!isMet(evidence.implementation?.coreFilesSubstantive)) errors.push(`${label}: substantive core files are required`);
  if (hasSecurityBlocker(evidence.security)) errors.push(`${label}: unacceptable security behavior detected`);
  if (Number(dimensions.valueClarity) < 10) errors.push(`${label}: value clarity is below 10`);
  if (Number(dimensions.nativeUsabilityPortability) < 11) errors.push(`${label}: native usability and portability is below 11`);
  if (Number(dimensions.implementationQuality) < 8) errors.push(`${label}: implementation quality is below 8`);
  if (Number(dimensions.trustSafetyLicense) < 6) errors.push(`${label}: trust, safety, and license is below 6`);

  const community = evidence.community || {};
  const lowValidation = numeric(community.stars) !== null
    && numeric(community.stars) < 50
    && !numberAtLeast(community.independentAdoptions, 1);
  if (item.recommendation === "install" && lowValidation) {
    errors.push(`${label}: install requires at least 50 stars or independent adoption evidence`);
  }
  if (item.recommendation === "install" && !isMet(evidence.security?.licensePresent)) {
    errors.push(`${label}: install requires a declared license`);
  }
}

function hasSecurityBlocker(security = {}) {
  return [
    "secretExposureRequested",
    "destructiveByDefault",
    "unreviewedRemoteExecution",
    "unnecessaryElevatedPermissions",
    "safetyReviewBypass",
    "knownMaliciousBehavior",
  ].some((field) => isMet(security[field]));
}

function isMet(value) {
  return value === "met";
}

function sumChecks(group = {}, points = {}) {
  return Object.entries(points).reduce((sum, [field, value]) => sum + (isMet(group?.[field]) ? value : 0), 0);
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function numberAtLeast(value, threshold) {
  const result = numeric(value);
  return result !== null && result >= threshold;
}

function numberBelow(value, threshold) {
  const result = numeric(value);
  return result !== null && result < threshold;
}

export function normalizeSegment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
