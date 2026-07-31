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
const validator = path.join(root, "tools", "quality", "validate-verification-evidence.mjs");

test("requires complete evidence and links it to every draft decision", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "radar-verification-"));
  const candidatePath = path.join(temp, "candidates.json");
  const evidencePath = path.join(temp, "evidence.json");
  const draftPath = path.join(temp, "draft.json");
  const candidates = candidateFixture();
  const evidence = evidenceFixture(candidates.eligibleCandidates);
  const draft = draftFixture(candidates.eligibleCandidates, evidence.results);
  await Promise.all([
    fs.writeFile(candidatePath, JSON.stringify(candidates), "utf8"),
    fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8"),
    fs.writeFile(draftPath, JSON.stringify(draft), "utf8"),
  ]);

  const accepted = await execFileAsync(process.execPath, [
    validator, "--evidence", evidencePath, "--candidates", candidatePath, "--draft", draftPath,
  ], { cwd: root });
  assert.match(accepted.stdout, /Valid multi-agent verification evidence/);

  evidence.results[0].reconciled.currentUrl = "https://github.com/example/wrong/tree/main/skills/wrong";
  await fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath, "--draft", draftPath,
    ], { cwd: root }),
    /verified current URL does not match filtered candidate/
  );

  await fs.rm(temp, { recursive: true, force: true });
});

test("treats GitHub blob and raw URLs for the same artifact as equivalent", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "radar-verification-github-"));
  const candidatePath = path.join(temp, "candidates.json");
  const evidencePath = path.join(temp, "evidence.json");
  const candidates = candidateFixture();
  candidates.eligibleCandidates[0].sourceUrl =
    "https://github.com/example/repo0/blob/main/skills/skill-0/SKILL.md";
  const evidence = evidenceFixture(candidates.eligibleCandidates);
  evidence.results[0].primary.currentUrl =
    "https://raw.githubusercontent.com/example/repo0/main/skills/skill-0/SKILL.md";
  evidence.results[0].reconciled.currentUrl =
    "https://raw.githubusercontent.com/example/repo0/main/skills/skill-0/SKILL.md";

  await Promise.all([
    fs.writeFile(candidatePath, JSON.stringify(candidates), "utf8"),
    fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8"),
  ]);

  const accepted = await execFileAsync(process.execPath, [
    validator, "--evidence", evidencePath, "--candidates", candidatePath,
  ], { cwd: root });
  assert.match(accepted.stdout, /Valid multi-agent verification evidence/);

  evidence.results[0].primary.currentUrl =
    "https://raw.githubusercontent.com/other/repo0/main/skills/skill-0/SKILL.md";
  evidence.results[0].reconciled.currentUrl =
    "https://raw.githubusercontent.com/other/repo0/main/skills/skill-0/SKILL.md";
  await fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath,
    ], { cwd: root }),
    /verified current URL does not match filtered candidate/
  );

  await fs.rm(temp, { recursive: true, force: true });
});

test("requires specialist disagreement removals to remain auditable", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "radar-verification-removal-"));
  const candidatePath = path.join(temp, "candidates.json");
  const evidencePath = path.join(temp, "evidence.json");
  const candidates = candidateFixture();
  const evidence = evidenceFixture(candidates.eligibleCandidates);
  evidence.removals.push({
    candidateId: "src_deadbeef",
    title: "Removed Skill",
    originalSourceUrl: "https://github.com/example/removed/tree/main/skills/removed",
    originalArtifactPath: "skills/removed",
    stage: "specialist_reconciliation",
    reason: "specialist_disagreement",
    primaryVerdict: "migrated",
    specialistVerdict: "recovered_current",
    disagreementFields: ["verdict", "identityChanged"],
    requiresFollowup: true,
  });

  await Promise.all([
    fs.writeFile(candidatePath, JSON.stringify(candidates), "utf8"),
    fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8"),
  ]);
  const accepted = await execFileAsync(process.execPath, [
    validator, "--evidence", evidencePath, "--candidates", candidatePath,
  ], { cwd: root });
  assert.match(accepted.stdout, /Valid multi-agent verification evidence/);

  evidence.removals[0].requiresFollowup = false;
  await fs.writeFile(evidencePath, JSON.stringify(evidence), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      validator, "--evidence", evidencePath, "--candidates", candidatePath,
    ], { cwd: root }),
    /specialist disagreement must be auditable and require follow-up/
  );

  await fs.rm(temp, { recursive: true, force: true });
});

function candidateFixture() {
  const eligibleCandidates = Array.from({ length: 5 }, (_, index) => ({
    id: `src_0000000${index}`,
    title: `Skill ${index}`,
    sourceUrl: `https://github.com/example/repo${index}/tree/main/skills/skill-${index}`,
    artifactPath: `skills/skill-${index}`,
    artifactKey: `https://github.com/example/repo${index}#artifact=skills/skill-${index}`,
  }));
  return { asOf: "2026-07-28", eligibleCandidates };
}

function evidenceFixture(candidates) {
  const run = {
    attempted: true, available: true, completed: true,
    freshContextRequested: true, retryCount: 0, notes: [],
  };
  return {
    version: 1,
    reportDate: "2026-07-28",
    profile: "multi-agent-verifier-v1",
    primaryVerifier: run,
    specialistVerifier: {
      attempted: false, available: false, completed: false,
      freshContextRequested: false, retryCount: 0, notes: [],
    },
    removals: [],
    results: candidates.map((candidate) => {
      const verified = {
        verdict: "verified_current",
        originalUrlStatus: 200,
        currentTitle: candidate.title,
        currentUrl: candidate.sourceUrl,
        artifactPath: candidate.artifactPath,
        skillMdVerified: true,
        repositoryStatus: "current",
        identityChanged: false,
        license: "MIT",
        capability: "Provides a concrete reusable workflow.",
        usability: "Can be used directly from its documented skill file.",
        portability: "Instructions can be adapted across compatible agents.",
        maintenance: "The primary repository is current and active.",
        trustCaveat: "Review instructions and dependencies before enabling them.",
        evidence: [
          "Primary artifact directory and exact instruction file were verified.",
          "Repository status and recent maintenance evidence were inspected.",
          "Dependencies, permissions, and portability boundaries were reviewed.",
        ],
      };
      return {
        candidateId: candidate.id,
        artifactKey: candidate.artifactKey,
        originalSourceUrl: candidate.sourceUrl,
        primary: verified,
        specialistRequired: false,
        specialist: null,
        reconciled: verified,
      };
    }),
  };
}

function draftFixture(candidates, results) {
  return {
    decisions: candidates.map((candidate) => {
      const evidence = results.find((item) => item.candidateId === candidate.id);
      return {
        title: candidate.title,
        sourceUrl: candidate.sourceUrl,
        artifactPath: candidate.artifactPath,
        verification: {
          candidateId: candidate.id,
          verdict: evidence.reconciled.verdict,
          currentUrl: evidence.reconciled.currentUrl,
        },
      };
    }),
  };
}
