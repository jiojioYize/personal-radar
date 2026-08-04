const COVERAGE_STATUSES = new Set([
  "target_met",
  "exhausted_below_target",
  "source_incomplete",
]);
const STOP_REASONS = new Set([
  "target_met",
  "pass_limit",
  "candidate_limit",
  "sources_exhausted",
  "source_incomplete",
]);
const EXHAUSTED_REASONS = new Set(["pass_limit", "candidate_limit", "sources_exhausted"]);

export function deriveCoverageStatus(candidateStats) {
  if (!candidateStats?.requiredSourcesComplete) return "source_incomplete";
  if (Number(candidateStats.eligibleCount) >= 5) return "target_met";
  return "exhausted_below_target";
}

export function deriveShadowContentStatus(decisions) {
  return (decisions || []).some((decision) => decision.decision === "recommend")
    ? "published"
    : "no_update";
}

export function validateEngineShadowResult(result) {
  const errors = [];
  if (result?.contractVersion !== "engine-shadow-result-v1") {
    errors.push("contractVersion must be engine-shadow-result-v1");
  }
  if (result?.channel !== "skill-radar" || result?.mode !== "shadow") {
    errors.push("channel and mode must identify the skill-radar shadow");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result?.reportDate || "")) {
    errors.push("reportDate must use YYYY-MM-DD");
  }
  if (!COVERAGE_STATUSES.has(result?.coverageStatus)) {
    errors.push("coverageStatus is invalid");
  }
  if (result?.publicationState !== "blocked_shadow") {
    errors.push("publicationState must remain blocked_shadow");
  }

  const stats = result?.candidateStats || {};
  const initialCount = Number(stats.initialCount);
  const cumulativeCount = Number(stats.cumulativeCount);
  const eligibleCount = Number(stats.eligibleCount);
  const filterPasses = Number(stats.filterPasses);
  if (![initialCount, cumulativeCount, eligibleCount, filterPasses].every(Number.isInteger)) {
    errors.push("candidateStats counts must be integers");
  }
  if (initialCount < 0 || initialCount > 12) errors.push("initialCount must be zero to twelve");
  if (cumulativeCount < initialCount || cumulativeCount > 20) {
    errors.push("cumulativeCount must be between initialCount and twenty");
  }
  if (eligibleCount < 0 || eligibleCount > cumulativeCount) {
    errors.push("eligibleCount must be between zero and cumulativeCount");
  }
  if (filterPasses < 0 || filterPasses > 3) errors.push("filterPasses must be zero to three");
  if (!STOP_REASONS.has(stats.replenishmentStopReason)) {
    errors.push("replenishmentStopReason is invalid");
  }

  const derivedCoverage = deriveCoverageStatus(stats);
  if (result?.coverageStatus !== derivedCoverage) {
    errors.push(`coverageStatus must be ${derivedCoverage}`);
  }
  if (stats.requiredSourcesComplete) {
    if (initialCount < 8) errors.push("complete source collection requires eight initial candidates");
    if (filterPasses < 1) errors.push("complete source collection requires at least one filter pass");
    if (derivedCoverage === "target_met" && stats.replenishmentStopReason !== "target_met") {
      errors.push("target_met coverage must stop replenishment immediately");
    }
    if (derivedCoverage === "exhausted_below_target"
      && !EXHAUSTED_REASONS.has(stats.replenishmentStopReason)) {
      errors.push("below-target coverage requires an exhausted replenishment reason");
    }
  } else if (stats.replenishmentStopReason !== "source_incomplete") {
    errors.push("incomplete source collection must use source_incomplete stop reason");
  }

  if (derivedCoverage === "source_incomplete") {
    if (result?.runStatus !== "failed") errors.push("source_incomplete must fail the run");
    if (result?.content !== null) errors.push("source_incomplete cannot create shadow content");
    if (!result?.failure) errors.push("source_incomplete requires failure metadata");
    if (result?.publicV3Compatible !== false) {
      errors.push("failed source collection cannot be public-v3 compatible");
    }
    return errors;
  }

  const content = result?.content;
  if (!content) {
    errors.push("complete source collection requires shadow content");
    return errors;
  }
  const decisions = Array.isArray(content.decisions) ? content.decisions : [];
  const items = Array.isArray(content.items) ? content.items : [];
  if (decisions.length !== eligibleCount) {
    errors.push("content decisions must cover every final eligible candidate");
  }
  const recommended = decisions.filter((decision) => decision.decision === "recommend");
  if (items.length !== recommended.length) {
    errors.push("content items must match recommend decisions");
  }
  const contentStatus = deriveShadowContentStatus(decisions);
  if (content.status !== contentStatus) errors.push(`content status must be ${contentStatus}`);
  if (result.runStatus !== (contentStatus === "no_update" ? "valid_no_update" : "shadow_ready")) {
    errors.push("runStatus must follow the content outcome");
  }
  if (content.reportDate !== result.reportDate || content.channel !== result.channel) {
    errors.push("content identity must match the engine result");
  }
  if (content.readerContractVersion !== 2) errors.push("readerContractVersion must be 2");
  if (content.stats?.reviewedCount !== decisions.length) {
    errors.push("reviewedCount must match decisions");
  }
  if (content.stats?.selectedCount !== items.length) errors.push("selectedCount must match items");
  if (result.publicV3Compatible !== (decisions.length >= 5)) {
    errors.push("publicV3Compatible must reflect the current five-decision minimum");
  }
  if (result.failure !== null) errors.push("successful shadow content cannot carry failure metadata");
  return errors;
}
