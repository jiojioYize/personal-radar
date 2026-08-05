import { CANDIDATE_BUDGET } from "./source-portfolio.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function buildCandidatePoolPass({
  reportDate,
  filterPass,
  discoveries,
  existingCandidates = [],
  artifactHistory = [],
  reviewState = [],
  sourceTaskOrder,
  materialChangeClaims = {},
}) {
  assertInputs({ reportDate, filterPass, discoveries, existingCandidates, sourceTaskOrder });
  const existingIds = new Set(existingCandidates.map((item) => item.candidateId));
  const existingEligible = existingCandidates.filter((item) => item.eligible).length;
  const historyByArtifact = groupBy(artifactHistory, (item) => item.artifactId);
  const reviewByArtifact = new Map(reviewState.map((item) => [item.artifactId, item]));
  const taskPosition = new Map(sourceTaskOrder.map((taskId, index) => [taskId, index]));
  const groups = groupDiscoveries(discoveries, taskPosition);
  const ordered = fairSourceOrder(groups, taskPosition);
  const events = [];
  const selected = [];
  let eligibleTotal = existingEligible;
  let cumulativeTotal = existingCandidates.length;

  for (const group of ordered) {
    if (existingIds.has(group.candidateId)) {
      events.push(eventFor(group, "duplicate_existing", "duplicate-from-earlier-filter-pass"));
      continue;
    }
    if (filterPass > 1 && eligibleTotal >= CANDIDATE_BUDGET.replenishmentTarget) {
      events.push(eventFor(group, "deferred_target_met", "eligible-target-already-met"));
      continue;
    }
    const passLimitReached = filterPass === 1
      && selected.length >= CANDIDATE_BUDGET.initialMaximum;
    if (passLimitReached) {
      events.push(eventFor(group, "deferred_initial_limit", "initial-candidate-limit-reached"));
      continue;
    }
    if (cumulativeTotal >= CANDIDATE_BUDGET.maximumCumulativeCandidates) {
      events.push(eventFor(group, "deferred_candidate_limit", "cumulative-candidate-limit-reached"));
      continue;
    }

    const materialChange = materialClaimFor(materialChangeClaims, group);
    const history = historyByArtifact.get(group.artifactId) || [];
    const exactDuplicate = history.some((item) => withinPriorDays(item.reportDate, reportDate, 30));
    const repositoryAppearances7d = new Set(artifactHistory
      .filter((item) => item.canonicalRepositoryUrl === group.canonicalRepositoryUrl
        && withinPriorDays(item.reportDate, reportDate, 7))
      .map((item) => item.reportDate)).size;
    const review = reviewByArtifact.get(group.artifactId);
    const reviewBlocked = ["defer", "reject"].includes(review?.latestDecision)
      && review.reviewAfter > reportDate;
    const eligible = materialChange.evidenced
      || (!exactDuplicate && repositoryAppearances7d < 2 && !reviewBlocked);
    const exclusionReason = eligible ? null
      : exactDuplicate ? "exact-artifact-within-30-days"
        : repositoryAppearances7d >= 2 ? "repository-appeared-twice-within-7-days"
          : `${review.latestDecision}-until-${review.reviewAfter}`;
    const candidate = {
      candidateId: group.candidateId,
      artifactId: group.artifactId,
      artifactKey: group.artifactKey,
      canonicalRepositoryUrl: group.canonicalRepositoryUrl,
      artifactPath: group.artifactPath,
      lane: group.primary.lane,
      sourceId: group.primary.sourceId,
      filterPass,
      eligible,
      exclusionReason,
      materialChange,
      primaryDiscoveryId: group.primary.id,
      corroboratingDiscoveryIds: group.discoveries.slice(1).map((item) => item.id),
      history: {
        exactDuplicate,
        repositoryAppearances7d,
        previousOutcome: review?.latestDecision || null,
        reviewAfter: review?.reviewAfter || null,
      },
    };
    selected.push(candidate);
    events.push(eventFor(group, eligible ? "eligible" : "filtered_history", exclusionReason));
    cumulativeTotal += 1;
    if (eligible) eligibleTotal += 1;
  }

  const nextAction = eligibleTotal >= CANDIDATE_BUDGET.replenishmentTarget
    ? "verify"
    : filterPass >= CANDIDATE_BUDGET.maximumFilterPasses
      || cumulativeTotal >= CANDIDATE_BUDGET.maximumCumulativeCandidates
      ? "verify_below_target"
      : "replenish";
  return {
    contractVersion: "candidate-pool-v1",
    reportDate,
    filterPass,
    selected,
    events,
    selectedCount: selected.length,
    eligibleTotal,
    cumulativeTotal,
    nextAction,
  };
}

function groupDiscoveries(discoveries, taskPosition) {
  const groups = new Map();
  for (const discovery of discoveries) {
    if (!taskPosition.has(discovery.taskId)) {
      throw new TypeError(`discovery uses unplanned source task ${discovery.taskId}`);
    }
    const current = groups.get(discovery.candidateId) || [];
    current.push(discovery);
    groups.set(discovery.candidateId, current);
  }
  return [...groups.entries()].map(([candidateId, items]) => {
    const sorted = [...items].sort((left, right) => compareDiscovery(left, right, taskPosition));
    const primary = sorted[0];
    for (const item of sorted) {
      if (item.artifactId !== primary.artifactId || item.artifactKey !== primary.artifactKey) {
        throw new TypeError(`candidate ${candidateId} has inconsistent artifact identity`);
      }
    }
    return {
      candidateId,
      artifactId: primary.artifactId,
      artifactKey: primary.artifactKey,
      canonicalRepositoryUrl: primary.canonicalRepositoryUrl,
      artifactPath: primary.artifactPath,
      primary,
      discoveries: sorted,
    };
  });
}

function fairSourceOrder(groups, taskPosition) {
  const queues = new Map();
  for (const group of groups) {
    const taskId = group.primary.taskId;
    const queue = queues.get(taskId) || [];
    queue.push(group);
    queues.set(taskId, queue);
  }
  for (const queue of queues.values()) {
    queue.sort((left, right) => compareDiscovery(left.primary, right.primary, taskPosition));
  }
  const ordered = [];
  const taskIds = [...queues.keys()].sort((a, b) => taskPosition.get(a) - taskPosition.get(b));
  for (let index = 0; ; index += 1) {
    let added = false;
    for (const taskId of taskIds) {
      if (queues.get(taskId)[index]) {
        ordered.push(queues.get(taskId)[index]);
        added = true;
      }
    }
    if (!added) return ordered;
  }
}

function compareDiscovery(left, right, taskPosition) {
  return taskPosition.get(left.taskId) - taskPosition.get(right.taskId)
    || rank(left) - rank(right)
    || left.artifactKey.localeCompare(right.artifactKey)
    || left.id.localeCompare(right.id);
}

function rank(item) {
  return Number.isInteger(item.sourceRank) ? item.sourceRank : Number.MAX_SAFE_INTEGER;
}

function eventFor(group, disposition, exclusionReason) {
  return {
    candidateId: group.candidateId,
    artifactId: group.artifactId,
    disposition,
    exclusionReason,
    primaryDiscoveryId: group.primary.id,
    corroboratingDiscoveryIds: group.discoveries.slice(1).map((item) => item.id),
  };
}

function materialClaimFor(claims, group) {
  const claim = claims instanceof Map
    ? claims.get(group.candidateId) || claims.get(group.artifactId)
    : claims[group.candidateId] || claims[group.artifactId];
  if (!claim) return { evidenced: false, evidence: null };
  if (claim.evidenced !== true || typeof claim.evidence !== "string" || !claim.evidence.trim()) {
    throw new TypeError(`material change claim for ${group.candidateId} lacks evidence`);
  }
  return { evidenced: true, evidence: claim.evidence.trim() };
}

function withinPriorDays(value, reportDate, days) {
  if (!validDate(value)) return false;
  const current = Date.parse(`${reportDate}T00:00:00Z`);
  const prior = Date.parse(`${value}T00:00:00Z`);
  const delta = (current - prior) / 86_400_000;
  return delta > 0 && delta <= days;
}

function groupBy(items, keyFor) {
  const result = new Map();
  for (const item of items) {
    const key = keyFor(item);
    result.set(key, [...(result.get(key) || []), item]);
  }
  return result;
}

function validDate(value) {
  if (!DATE_PATTERN.test(String(value || ""))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function assertInputs({ reportDate, filterPass, discoveries, existingCandidates, sourceTaskOrder }) {
  if (!validDate(reportDate)) throw new TypeError("reportDate must be a real YYYY-MM-DD date");
  if (!Number.isInteger(filterPass) || filterPass < 1 || filterPass > 3) {
    throw new TypeError("filterPass must be one to three");
  }
  if (!Array.isArray(discoveries) || !Array.isArray(existingCandidates)) {
    throw new TypeError("candidate pool inputs must be arrays");
  }
  if (!Array.isArray(sourceTaskOrder) || new Set(sourceTaskOrder).size !== sourceTaskOrder.length) {
    throw new TypeError("sourceTaskOrder must contain distinct task IDs");
  }
  if (existingCandidates.length > CANDIDATE_BUDGET.maximumCumulativeCandidates) {
    throw new TypeError("existing candidate pool exceeds its cumulative limit");
  }
}
