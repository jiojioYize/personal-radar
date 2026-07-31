import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validator = path.join(root, "tools", "quality", "validate-verification-harness-v2.mjs");
const targetedValidator = path.join(
  root,
  "tools",
  "quality",
  "validate-harness-adjudication.mjs"
);

test("accepts bounded adjudication and preserves an unresolved removal trajectory", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "radar-harness-v2-"));
  const candidatePath = path.join(temp, "candidates.json");
  const evidencePath = path.join(temp, "evidence.json");
  const draftPath = path.join(temp, "draft.json");
  const candidates = candidateFixture();
  let evidence = evidenceFixture(candidates.eligibleCandidates);
  const draft = draftFixture(candidates.eligibleCandidates, evidence.results);

  await Promise.all([
    fs.writeFile(candidatePath, JSON.stringify(candidates), "utf8"),
    fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8"),
    fs.writeFile(draftPath, JSON.stringify(draft), "utf8"),
  ]);
  const accepted = await execFileAsync(process.execPath, [
    validator, "--evidence", evidencePath, "--candidates", candidatePath, "--draft", draftPath,
  ], { cwd: root });
  assert.match(accepted.stdout, /Valid adjudicated verification harness evidence/);

  evidence = evidenceFixture(candidates.eligibleCandidates);
  evidence.results[0].disagreementFields = ["identityChanged", "verdict"];
  await fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath,
    ], { cwd: root }),
    /disagreementFields do not match verifier outputs/
  );

  evidence = evidenceFixture(candidates.eligibleCandidates);
  evidence.results[0].adjudicationRequired = false;
  await fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath,
    ], { cwd: root }),
    /adjudicationRequired does not match material disagreement/
  );

  evidence = evidenceFixture(candidates.eligibleCandidates);
  evidence.results[0].reconciled = evidence.results[0].primary;
  await fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath,
    ], { cwd: root }),
    /reconciled identity must follow the adjudication protocol/
  );

  evidence = evidenceFixture(candidates.eligibleCandidates);
  evidence.results.at(-1).requiresFollowup = false;
  await fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath,
    ], { cwd: root }),
    /unresolved adjudication must require follow-up/
  );

  evidence = evidenceFixture(candidates.eligibleCandidates);
  evidence.results.at(-1).primary.sourceRepositoryChanged = false;
  await fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath,
    ], { cwd: root }),
    /migrated verdict requires sourceRepositoryChanged true/
  );

  await fs.rm(temp, { recursive: true, force: true });
});

test("forbids unused specialist and adjudicator runs from being marked active", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "radar-harness-v2-unused-"));
  const candidatePath = path.join(temp, "candidates.json");
  const evidencePath = path.join(temp, "evidence.json");
  const candidates = candidateFixture();
  const evidence = evidenceFixtureWithoutRisks(candidates.eligibleCandidates);

  evidence.runs.adjudicator.attempted = true;
  await Promise.all([
    fs.writeFile(candidatePath, JSON.stringify(candidates), "utf8"),
    fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8"),
  ]);
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath,
    ], { cwd: root }),
    /runs.adjudicator must remain unused/
  );

  await fs.rm(temp, { recursive: true, force: true });
});

test("validates the targeted Remotion adjudication contract", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "radar-harness-targeted-"));
  const resultPath = path.join(temp, "result.json");
  const result = {
    version: 1,
    testDate: "2026-07-31",
    testType: "targeted-harness-adjudication",
    adjudicator: completedRun(),
    case: {
      id: "remotion-repository-migration-path",
      title: "Remotion Best Practices",
      adjudication: {
        verdict: "migrated",
        currentUrl:
          "https://github.com/remotion-dev/remotion/tree/main/packages/skills/skills/remotion-best-practices",
        artifactPath: "packages/skills/skills/remotion-best-practices",
        repositoryStatus: "current",
        sourceRepositoryChanged: true,
        identityChanged: false,
        skillMdVerified: true,
        evidence: [
          "The exact current first-party SKILL.md was verified.",
          "The old repository points to the current Remotion repository.",
        ],
      },
      parent: {
        disposition: "evaluate_current",
        decisionSourceUrl:
          "https://github.com/remotion-dev/remotion/tree/main/packages/skills/skills/remotion-best-practices",
        reason: "The adjudicated current artifact is verified and identity-continuous.",
      },
    },
    safety: {
      productionFilesChanged: false,
      workerCalled: false,
      forwarderCalled: false,
    },
  };
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  const accepted = await execFileAsync(process.execPath, [
    targetedValidator, "--result", resultPath,
  ], { cwd: root });
  assert.match(accepted.stdout, /Valid targeted harness adjudication result/);

  result.case.adjudication.identityChanged = true;
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [targetedValidator, "--result", resultPath], { cwd: root }),
    /identity-continuous repository migration must not change artifact identity/
  );

  await fs.rm(temp, { recursive: true, force: true });
});

function candidateFixture() {
  const eligibleCandidates = Array.from({ length: 5 }, (_, index) => {
    if (index === 0) {
      return {
        id: "src_00000000",
        title: "Grill With Docs",
        sourceUrl: "https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs",
        artifactPath: "skills/engineering/grill-with-docs",
        artifactKey: "https://github.com/mattpocock/skills#artifact=skills/engineering/grill-with-docs",
      };
    }
    return {
      id: `src_0000000${index}`,
      title: `Skill ${index}`,
      sourceUrl: `https://github.com/example/repo${index}/tree/main/skills/skill-${index}`,
      artifactPath: `skills/skill-${index}`,
      artifactKey: `https://github.com/example/repo${index}#artifact=skills/skill-${index}`,
    };
  });
  return { asOf: "2026-07-31", eligibleCandidates };
}

function evidenceFixture(candidates) {
  const normalResults = candidates.slice(1).map((candidate) => retainedResult(candidate));
  const grill = candidates[0];
  const recovered = evidence({
    verdict: "recovered_current",
    originalUrlStatus: 404,
    currentTitle: grill.title,
    currentUrl: grill.sourceUrl,
    artifactPath: grill.artifactPath,
    identityChanged: false,
  });
  const migrated = evidence({
    verdict: "recovered_current",
    originalUrlStatus: 404,
    currentTitle: grill.title,
    currentUrl: grill.sourceUrl,
    artifactPath: grill.artifactPath,
    identityChanged: true,
  });

  return {
    version: 2,
    reportDate: "2026-07-31",
    profile: "multi-agent-harness-v2",
    runs: {
      primary: completedRun(),
      specialist: completedRun(),
      adjudicator: completedRun(),
    },
    results: [
      {
        candidateId: grill.id,
        artifactKey: grill.artifactKey,
        title: grill.title,
        originalSourceUrl: "https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-with-docs",
        originalArtifactPath: "skills/productivity/grill-with-docs",
        primary: migrated,
        specialistRequired: true,
        specialist: recovered,
        disagreementFields: ["identityChanged"],
        dispute: dispute(["identityChanged"]),
        adjudicationRequired: true,
        adjudication: recovered,
        reconciled: recovered,
        disposition: "retained",
        removalReason: null,
        requiresFollowup: false,
      },
      ...normalResults,
      unresolvedRemoval(),
    ],
  };
}

function evidenceFixtureWithoutRisks(candidates) {
  return {
    version: 2,
    reportDate: "2026-07-31",
    profile: "multi-agent-harness-v2",
    runs: {
      primary: completedRun(),
      specialist: unusedRun(),
      adjudicator: unusedRun(),
    },
    results: candidates.map((candidate) => retainedResult(candidate)),
  };
}

function retainedResult(candidate) {
  const verified = evidence({
    currentTitle: candidate.title,
    currentUrl: candidate.sourceUrl,
    artifactPath: candidate.artifactPath,
  });
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
}

function unresolvedRemoval() {
  const migrated = evidence({
    verdict: "migrated",
    originalUrlStatus: 404,
    currentTitle: "Possible Successor",
    currentUrl: "https://github.com/example/new/tree/main/skills/possible",
    artifactPath: "skills/possible",
    sourceRepositoryChanged: true,
    identityChanged: true,
  });
  const recovered = evidence({
    verdict: "recovered_current",
    originalUrlStatus: 404,
    currentTitle: "Old Skill",
    currentUrl: "https://github.com/example/old/tree/main/skills/old",
    artifactPath: "skills/old",
    identityChanged: false,
  });
  const unresolved = evidence({
    verdict: "ambiguous",
    originalUrlStatus: 404,
    currentTitle: null,
    currentUrl: null,
    artifactPath: null,
    skillMdVerified: false,
    repositoryStatus: "deprecated",
    identityChanged: false,
  });
  const fields = [
    "verdict",
    "currentUrl",
    "artifactPath",
    "sourceRepositoryChanged",
    "identityChanged",
  ];
  return {
    candidateId: "src_deadbeef",
    artifactKey: "https://github.com/example/old#artifact=skills/old",
    title: "Old Skill",
    originalSourceUrl: "https://github.com/example/old/tree/main/skills/old",
    originalArtifactPath: "skills/old",
    primary: migrated,
    specialistRequired: true,
    specialist: recovered,
    disagreementFields: fields,
    dispute: dispute(fields),
    adjudicationRequired: true,
    adjudication: unresolved,
    reconciled: unresolved,
    disposition: "removed",
    removalReason: "adjudication_unresolved",
    requiresFollowup: true,
  };
}

function dispute(fields) {
  return {
    fields,
    questions: fields.map((field) => ({
      field,
      question: `Resolve the first-party evidence conflict for ${field}.`,
    })),
    evidencePolicy: "first_party_only",
    maxAdjudicationAttempts: 1,
  };
}

function evidence(overrides = {}) {
  return {
    verdict: "verified_current",
    originalUrlStatus: 200,
    currentTitle: "Skill",
    currentUrl: "https://github.com/example/repo/tree/main/skills/skill",
    artifactPath: "skills/skill",
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
    ...overrides,
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

function draftFixture(candidates, results) {
  return {
    decisions: candidates.map((candidate) => {
      const result = results.find((item) => item.candidateId === candidate.id);
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
