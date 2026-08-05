import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidatePoolPass } from "../src/stage3a/candidate-pool.js";

const tasks = ["registryPulse:skillsSh", "officialRotation:one", "communityTrend:one"];

test("builds a deterministic 12-candidate initial pool without treating it as a recommendation cap", () => {
  const discoveries = [
    ...many("registryPulse:skillsSh", "registryPulse", "skillsSh", 8),
    ...many("officialRotation:one", "officialRotation", "one", 8, 100),
    ...many("communityTrend:one", "communityTrend", "one", 8, 200),
  ];
  const result = buildCandidatePoolPass(base({ discoveries }));
  assert.equal(result.selectedCount, 12);
  assert.equal(result.eligibleTotal, 12);
  assert.equal(result.cumulativeTotal, 12);
  assert.equal(result.nextAction, "verify");
  assert.deepEqual(result.selected.slice(0, 6).map((item) => item.lane), [
    "registryPulse", "officialRotation", "communityTrend",
    "registryPulse", "officialRotation", "communityTrend",
  ]);
  assert.equal(result.events.filter((item) => item.disposition === "deferred_initial_limit").length, 12);
});

test("deduplicates one artifact across sources while retaining corroborating discovery evidence", () => {
  const first = discovery("registryPulse:skillsSh", "registryPulse", "skillsSh", 1, 1);
  const corroboration = {
    ...first,
    id: "discovery-corroboration",
    taskId: "officialRotation:one",
    lane: "officialRotation",
    sourceId: "one",
    sourceRank: 2,
  };
  const result = buildCandidatePoolPass(base({ discoveries: [corroboration, first] }));
  assert.equal(result.selectedCount, 1);
  assert.equal(result.selected[0].primaryDiscoveryId, first.id);
  assert.deepEqual(result.selected[0].corroboratingDiscoveryIds, [corroboration.id]);
});

test("ports production history, repository frequency, review cooldown, and evidenced-change rules", () => {
  const discoveries = many("registryPulse:skillsSh", "registryPulse", "skillsSh", 4);
  const result = buildCandidatePoolPass(base({
    discoveries,
    artifactHistory: [
      history(discoveries[0], "2026-07-20"),
      history({ ...discoveries[1], artifactId: "other-a" }, "2026-08-01"),
      history({ ...discoveries[1], artifactId: "other-b" }, "2026-08-03"),
      history(discoveries[3], "2026-07-25"),
    ],
    reviewState: [{
      artifactId: discoveries[2].artifactId,
      latestDecision: "defer",
      reviewAfter: "2026-08-10",
    }],
    materialChangeClaims: {
      [discoveries[3].candidateId]: { evidenced: true, evidence: "new immutable blob SHA" },
    },
  }));
  assert.deepEqual(result.selected.map((item) => [item.eligible, item.exclusionReason]), [
    [false, "exact-artifact-within-30-days"],
    [false, "repository-appeared-twice-within-7-days"],
    [false, "defer-until-2026-08-10"],
    [true, null],
  ]);
  assert.equal(result.nextAction, "replenish");
});

test("a replenishment pass stops adding candidates as soon as five are eligible", () => {
  const existingCandidates = Array.from({ length: 4 }, (_, index) => ({
    candidateId: `existing-${index}`,
    eligible: true,
  }));
  const result = buildCandidatePoolPass(base({
    filterPass: 2,
    existingCandidates,
    discoveries: many("officialRotation:one", "officialRotation", "one", 5),
  }));
  assert.equal(result.selectedCount, 1);
  assert.equal(result.eligibleTotal, 5);
  assert.equal(result.nextAction, "verify");
  assert.equal(result.events.filter((item) => item.disposition === "deferred_target_met").length, 4);
});

test("a later pass can consume discoveries deferred by the initial twelve-candidate limit", () => {
  const discoveries = many("registryPulse:skillsSh", "registryPulse", "skillsSh", 14);
  const existingCandidates = discoveries.slice(0, 12).map((item, index) => ({
    candidateId: item.candidateId,
    eligible: index < 4,
  }));
  const result = buildCandidatePoolPass(base({
    filterPass: 2,
    existingCandidates,
    discoveries,
  }));
  assert.equal(result.selectedCount, 1);
  assert.equal(result.selected[0].candidateId, discoveries[12].candidateId);
  assert.equal(result.eligibleTotal, 5);
  assert.equal(result.events.filter((item) => item.disposition === "duplicate_existing").length, 12);
  assert.equal(result.events.filter((item) => item.disposition === "deferred_target_met").length, 1);
});

test("the third pass preserves a valid below-target exhaustion instead of inventing candidates", () => {
  const existingCandidates = Array.from({ length: 3 }, (_, index) => ({
    candidateId: `existing-${index}`,
    eligible: true,
  }));
  const result = buildCandidatePoolPass(base({
    filterPass: 3,
    existingCandidates,
    discoveries: [],
  }));
  assert.equal(result.eligibleTotal, 3);
  assert.equal(result.nextAction, "verify_below_target");
});

function base(overrides) {
  return {
    reportDate: "2026-08-05",
    filterPass: 1,
    discoveries: [],
    existingCandidates: [],
    artifactHistory: [],
    reviewState: [],
    sourceTaskOrder: tasks,
    ...overrides,
  };
}

function many(taskId, lane, sourceId, count, offset = 0) {
  return Array.from({ length: count }, (_, index) =>
    discovery(taskId, lane, sourceId, index + 1, offset + index));
}

function discovery(taskId, lane, sourceId, sourceRank, suffix) {
  const repository = suffix === 1 ? "shared" : `repo-${suffix}`;
  return {
    id: `discovery-${taskId}-${suffix}`,
    taskId,
    candidateId: `candidate-${suffix}`,
    artifactId: `artifact-${suffix}`,
    artifactKey: `https://github.com/example/${repository}#artifact=skills/${suffix}/SKILL.md`,
    canonicalRepositoryUrl: `https://github.com/example/${repository}`,
    artifactPath: `skills/${suffix}/SKILL.md`,
    lane,
    sourceId,
    sourceRank,
  };
}

function history(discoveryItem, reportDate) {
  return {
    artifactId: discoveryItem.artifactId,
    canonicalRepositoryUrl: discoveryItem.canonicalRepositoryUrl,
    reportDate,
  };
}
