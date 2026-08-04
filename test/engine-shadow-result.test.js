import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { enrichCuratedReport } from "../src/curated-report.js";
import {
  deriveCoverageStatus,
  validateEngineShadowResult,
} from "../src/engine/shadow-result.js";
import { curatedFixture } from "../test-support/curated-report.js";
import { validateVerificationHarnessV2 } from "../tools/quality/validate-verification-harness-v2.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("accepts one to four complete shadow decisions without claiming public v3 compatibility", async () => {
  for (let decisionCount = 1; decisionCount <= 4; decisionCount += 1) {
    const result = shadowResult(decisionCount);

    assert.equal(deriveCoverageStatus(result.candidateStats), "exhausted_below_target");
    assert.equal(result.runStatus, "shadow_ready");
    assert.equal(result.publicV3Compatible, false);
    assert.deepEqual(validateEngineShadowResult(result), []);
    assert.equal(await validatesShadowSchema(result), true);
  }
});

test("marks five complete decisions as target met and public-v3 compatible", async () => {
  const result = shadowResult(5);

  assert.equal(result.coverageStatus, "target_met");
  assert.equal(result.publicV3Compatible, true);
  assert.deepEqual(validateEngineShadowResult(result), []);
  assert.equal(await validatesShadowSchema(result), true);
});

test("accepts zero eligible candidates as a valid no-update after complete exhaustion", async () => {
  const result = shadowResult(0);

  assert.equal(result.coverageStatus, "exhausted_below_target");
  assert.equal(result.runStatus, "valid_no_update");
  assert.equal(result.content.status, "no_update");
  assert.deepEqual(result.content.decisions, []);
  assert.deepEqual(validateEngineShadowResult(result), []);
  assert.equal(await validatesShadowSchema(result), true);
});

test("keeps incomplete source collection distinct from no-update", async () => {
  const failed = sourceIncompleteResult();

  assert.deepEqual(validateEngineShadowResult(failed), []);
  assert.equal(await validatesShadowSchema(failed), true);

  const disguisedNoUpdate = {
    ...failed,
    runStatus: "valid_no_update",
    content: shadowResult(0).content,
    failure: null,
  };
  assert.ok(validateEngineShadowResult(disguisedNoUpdate).some((error) =>
    error.includes("source_incomplete must fail")));
  assert.ok(validateEngineShadowResult(disguisedNoUpdate).some((error) =>
    error.includes("cannot create shadow content")));
});

test("allows Stage 3A Harness v2 evidence below five while production default stays at five", async () => {
  const candidates = candidateFixture(3);
  const evidence = evidenceFixture(candidates);
  const draft = draftFixture(candidates, evidence);

  await assert.rejects(
    validateVerificationHarnessV2({ evidence, candidates, draft }),
    /results must NOT have fewer than 5 items|candidates must contain five to twenty eligible candidates/,
  );
  await validateVerificationHarnessV2({
    evidence,
    candidates,
    draft,
    minimumEligibleCandidates: 0,
  });

  const emptyCandidates = candidateFixture(0);
  const emptyEvidence = evidenceFixture(emptyCandidates);
  await validateVerificationHarnessV2({
    evidence: emptyEvidence,
    candidates: emptyCandidates,
    draft: { decisions: [] },
    minimumEligibleCandidates: 0,
  });
});

function shadowResult(decisionCount) {
  const full = enrichCuratedReport(curatedFixture());
  const decisions = full.decisions.slice(0, decisionCount);
  const selectedIds = new Set(decisions
    .filter((decision) => decision.decision === "recommend")
    .map((decision) => decision.id));
  const items = full.items.filter((item) => selectedIds.has(item.id));
  const targetMet = decisionCount >= 5;
  return {
    contractVersion: "engine-shadow-result-v1",
    channel: "skill-radar",
    reportDate: full.reportDate,
    mode: "shadow",
    coverageStatus: targetMet ? "target_met" : "exhausted_below_target",
    publicationState: "blocked_shadow",
    runStatus: items.length ? "shadow_ready" : "valid_no_update",
    candidateStats: {
      initialCount: 8,
      cumulativeCount: targetMet ? 8 : 20,
      eligibleCount: decisions.length,
      filterPasses: targetMet ? 1 : 3,
      requiredSourcesComplete: true,
      replenishmentStopReason: targetMet ? "target_met" : "candidate_limit",
    },
    publicV3Compatible: targetMet,
    content: {
      readerContractVersion: 2,
      status: items.length ? "published" : "no_update",
      channel: full.channel,
      reportDate: full.reportDate,
      summary: full.summary,
      conclusion: full.conclusion,
      stats: {
        reviewedCount: decisions.length,
        candidateCount: targetMet ? 8 : 20,
        selectedCount: items.length,
        duplicateCount: 0,
        deferredCount: decisions.filter((entry) => entry.decision === "defer").length,
        rejectedCount: decisions.filter((entry) => entry.decision === "reject").length,
        sourceCounts: { registryPulse: targetMet ? 8 : 20 },
      },
      items,
      decisions,
    },
    failure: null,
  };
}

function sourceIncompleteResult() {
  return {
    contractVersion: "engine-shadow-result-v1",
    channel: "skill-radar",
    reportDate: "2026-08-04",
    mode: "shadow",
    coverageStatus: "source_incomplete",
    publicationState: "blocked_shadow",
    runStatus: "failed",
    candidateStats: {
      initialCount: 0,
      cumulativeCount: 0,
      eligibleCount: 0,
      filterPasses: 0,
      requiredSourcesComplete: false,
      replenishmentStopReason: "source_incomplete",
    },
    publicV3Compatible: false,
    content: null,
    failure: {
      class: "SOURCE_COLLECTION_INCOMPLETE",
      message: "A required source lane did not complete.",
      retryable: true,
    },
  };
}

function candidateFixture(count) {
  return {
    asOf: "2026-08-04",
    eligibleCandidates: Array.from({ length: count }, (_, index) => ({
      id: `src_0000000${index}`,
      title: `Skill ${index}`,
      sourceUrl: `https://github.com/example/repo${index}/tree/main/skills/skill-${index}`,
      artifactPath: `skills/skill-${index}`,
      artifactKey: `https://github.com/example/repo${index}#artifact=skills/skill-${index}`,
    })),
  };
}

function evidenceFixture(candidates) {
  const results = candidates.eligibleCandidates.map((candidate) => {
    const verified = verificationEvidence(candidate);
    return {
      candidateId: candidate.id,
      artifactKey: candidate.artifactKey,
      title: candidate.title,
      originalSourceUrl: candidate.sourceUrl,
      originalArtifactPath: candidate.artifactPath,
      primary: verified,
      specialistRequired: false,
      specialist: null,
      disagreementFields: [],
      dispute: null,
      adjudicationRequired: false,
      adjudication: null,
      reconciled: verified,
      disposition: "retained",
      removalReason: null,
      requiresFollowup: false,
    };
  });
  return {
    version: 2,
    reportDate: candidates.asOf,
    profile: "multi-agent-harness-v2",
    runs: {
      primary: results.length ? completedRun() : unusedRun(),
      specialist: unusedRun(),
      adjudicator: unusedRun(),
    },
    results,
  };
}

function verificationEvidence(candidate) {
  return {
    verdict: "verified_current",
    originalUrlStatus: 200,
    currentTitle: candidate.title,
    currentUrl: candidate.sourceUrl,
    artifactPath: candidate.artifactPath,
    skillMdVerified: true,
    repositoryStatus: "current",
    sourceRepositoryChanged: false,
    identityChanged: false,
    license: "MIT",
    capability: "Provides a concrete reusable workflow.",
    usability: "Can be used directly from its instruction file.",
    portability: "Can be adapted across compatible agent products.",
    maintenance: "Current first-party maintenance evidence was inspected.",
    trustCaveat: "Review dependencies and instructions before enabling it.",
    evidence: [
      "The exact first-party artifact directory was inspected.",
      "The current instruction file and repository status were verified.",
      "Identity, maintenance, dependencies, and trust boundaries were checked.",
    ],
  };
}

function completedRun() {
  return {
    attempted: true,
    available: true,
    completed: true,
    freshContextRequested: true,
    retryCount: 0,
    notes: [],
  };
}

function unusedRun() {
  return {
    attempted: false,
    available: false,
    completed: false,
    freshContextRequested: false,
    retryCount: 0,
    notes: [],
  };
}

function draftFixture(candidates, evidence) {
  return {
    decisions: candidates.eligibleCandidates.map((candidate) => {
      const result = evidence.results.find((entry) => entry.candidateId === candidate.id);
      return {
        title: candidate.title,
        sourceUrl: candidate.sourceUrl,
        artifactPath: candidate.artifactPath,
        verification: {
          candidateId: candidate.id,
          verdict: result.reconciled.verdict,
          currentUrl: result.reconciled.currentUrl,
        },
      };
    }),
  };
}

async function validatesShadowSchema(result) {
  const [schema, publicV3Schema] = await Promise.all([
    readJson(path.join(root, "schemas", "engine-shadow-result-v1.schema.json")),
    readJson(path.join(root, "schemas", "skill-radar-report-v3.schema.json")),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(publicV3Schema);
  const validate = ajv.compile(schema);
  const valid = validate(result);
  assert.deepEqual(validate.errors, null);
  return valid;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
