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
const validator = path.join(root, "tools", "quality", "validate-multi-agent-shadow.mjs");

test("accepts a complete adversarial verifier result and rejects unsafe routing", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "radar-multi-agent-"));
  const resultPath = path.join(temp, "result.json");
  let result = validResult();
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");

  const accepted = await execFileAsync(process.execPath, [validator, "--result", resultPath], { cwd: root });
  assert.match(accepted.stdout, /Valid multi-agent adversarial shadow result/);

  result = validResult();
  result.cases.find((item) => item.id === "ambiguous-successor").parent = {
    disposition: "evaluate_current",
    decisionSourceUrl: "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-use",
    reason: "Selected one related project despite unresolved ambiguity."
  };
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [validator, "--result", resultPath], { cwd: root }),
    /parent disposition does not follow reconciled evidence/
  );

  result = validResult();
  result.cases.find((item) => item.id === "deprecated-source-migration").parent.decisionSourceUrl =
    "https://github.com/openai/skills/tree/main/skills/.curated/figma-implement-design";
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [validator, "--result", resultPath], { cwd: root }),
    /parent did not use the reconciled current URL/
  );

  result = validResult();
  const migration = result.cases.find((item) => item.id === "deprecated-source-migration");
  migration.specialist.currentUrl =
    "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-use";
  migration.specialist.artifactPath = "plugins/figma/skills/figma-use";
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [validator, "--result", resultPath], { cwd: root }),
    /disagreement flag does not match verifier outputs/
  );

  result = validResult();
  const cosmeticDifference = result.cases.find((item) => item.id === "deprecated-source-migration");
  cosmeticDifference.specialist.currentTitle = "Implement a Figma Design as Code (Design to Code)";
  cosmeticDifference.specialist.artifactPath =
    "plugins/figma/skills/figma-design-to-code/SKILL.md";
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  const normalized = await execFileAsync(
    process.execPath,
    [validator, "--result", resultPath],
    { cwd: root }
  );
  assert.match(normalized.stdout, /Valid multi-agent adversarial shadow result/);

  result = validResult();
  result.cases.find((item) => item.id === "deprecated-source-migration").reconciled.repositoryStatus =
    "deprecated";
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [validator, "--result", resultPath], { cwd: root }),
    /expected repository status current/
  );

  result = validResult();
  result.cases.find((item) => item.id === "same-repository-path-continuity").primary.identityChanged = true;
  result.cases.find((item) => item.id === "same-repository-path-continuity").reconciled.identityChanged = true;
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [validator, "--result", resultPath], { cwd: root }),
    /same-repository-path-continuity: expected identityChanged false, received true/
  );

  result = validResult();
  result.cases.pop();
  await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [validator, "--result", resultPath], { cwd: root }),
    /Expected 7 cases, received 6/
  );

  await fs.rm(temp, { recursive: true, force: true });
});

function validResult() {
  const evidence = (overrides = {}) => ({
    verdict: "verified_current",
    originalUrlStatus: 200,
    currentTitle: "Frontend Design",
    currentUrl: "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
    artifactPath: "skills/frontend-design",
    skillMdVerified: true,
    repositoryStatus: "current",
    identityChanged: false,
    evidence: ["Verified the exact first-party directory.", "Verified the current SKILL.md content."],
    ...overrides
  });
  const route = (disposition, decisionSourceUrl) => ({
    disposition,
    decisionSourceUrl,
    reason: "The route follows the reconciled source evidence."
  });
  const cases = [
    {
      id: "current-valid",
      title: "Frontend Design",
      primary: evidence(),
      specialist: null,
      reconciled: { ...evidence(), disagreement: false },
      parent: route("evaluate_current", "https://github.com/anthropics/skills/tree/main/skills/frontend-design")
    },
    {
      id: "same-repository-relocation",
      title: "Figma Design to Code",
      primary: evidence({
        verdict: "recovered_current",
        originalUrlStatus: 404,
        currentTitle: "Figma Design to Code",
        currentUrl: "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-design-to-code",
        artifactPath: "plugins/figma/skills/figma-design-to-code"
      }),
      specialist: null,
      reconciled: {
        ...evidence({
          verdict: "recovered_current",
          originalUrlStatus: 404,
          currentTitle: "Figma Design to Code",
          currentUrl: "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-design-to-code",
          artifactPath: "plugins/figma/skills/figma-design-to-code"
        }),
        disagreement: false
      },
      parent: route("evaluate_current", "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-design-to-code")
    },
    {
      id: "deprecated-source-migration",
      title: "Figma Implement Design",
      primary: evidence({
        verdict: "migrated",
        originalUrlStatus: 404,
        currentTitle: "Figma Design to Code",
        currentUrl: "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-design-to-code",
        artifactPath: "plugins/figma/skills/figma-design-to-code",
        identityChanged: true
      }),
      specialist: evidence({
        verdict: "migrated",
        originalUrlStatus: 404,
        currentTitle: "Figma Design to Code",
        currentUrl: "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-design-to-code",
        artifactPath: "plugins/figma/skills/figma-design-to-code",
        identityChanged: true
      }),
      reconciled: {
        ...evidence({
          verdict: "migrated",
          originalUrlStatus: 404,
          currentTitle: "Figma Design to Code",
          currentUrl: "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-design-to-code",
          artifactPath: "plugins/figma/skills/figma-design-to-code",
          identityChanged: true
        }),
        disagreement: false
      },
      parent: route("evaluate_current", "https://github.com/openai/plugins/tree/main/plugins/figma/skills/figma-design-to-code")
    },
    {
      id: "same-repository-path-continuity",
      title: "Grill With Docs",
      primary: evidence({
        verdict: "recovered_current",
        originalUrlStatus: 404,
        currentTitle: "Grill With Docs",
        currentUrl: "https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs",
        artifactPath: "skills/engineering/grill-with-docs",
        identityChanged: false
      }),
      specialist: null,
      reconciled: {
        ...evidence({
          verdict: "recovered_current",
          originalUrlStatus: 404,
          currentTitle: "Grill With Docs",
          currentUrl: "https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs",
          artifactPath: "skills/engineering/grill-with-docs",
          identityChanged: false
        }),
        disagreement: false
      },
      parent: route("evaluate_current", "https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs")
    },
    {
      id: "deprecated-no-successor",
      title: "Retired Phantom Skill",
      primary: evidence({
        verdict: "invalid",
        originalUrlStatus: 404,
        currentTitle: null,
        currentUrl: null,
        artifactPath: null,
        skillMdVerified: false,
        repositoryStatus: "deprecated"
      }),
      specialist: null,
      reconciled: {
        ...evidence({
          verdict: "invalid",
          originalUrlStatus: 404,
          currentTitle: null,
          currentUrl: null,
          artifactPath: null,
          skillMdVerified: false,
          repositoryStatus: "deprecated"
        }),
        disagreement: false
      },
      parent: route("reject_invalid", null)
    },
    {
      id: "ambiguous-successor",
      title: "Figma Workflow",
      primary: evidence({
        verdict: "ambiguous",
        originalUrlStatus: 404,
        currentTitle: null,
        currentUrl: null,
        artifactPath: null,
        skillMdVerified: false,
        repositoryStatus: "deprecated"
      }),
      specialist: evidence({
        verdict: "ambiguous",
        originalUrlStatus: 404,
        currentTitle: null,
        currentUrl: null,
        artifactPath: null,
        skillMdVerified: false,
        repositoryStatus: "deprecated"
      }),
      reconciled: {
        ...evidence({
          verdict: "ambiguous",
          originalUrlStatus: 404,
          currentTitle: null,
          currentUrl: null,
          artifactPath: null,
          skillMdVerified: false,
          repositoryStatus: "deprecated"
        }),
        disagreement: false
      },
      parent: route("defer_ambiguous", null)
    },
    {
      id: "directory-without-skill",
      title: "Figma Plugin Root",
      primary: evidence({
        verdict: "invalid",
        currentTitle: null,
        currentUrl: null,
        artifactPath: null,
        skillMdVerified: false
      }),
      specialist: null,
      reconciled: {
        ...evidence({
          verdict: "invalid",
          currentTitle: null,
          currentUrl: null,
          artifactPath: null,
          skillMdVerified: false
        }),
        disagreement: false
      },
      parent: route("reject_invalid", null)
    }
  ];
  return {
    version: 1,
    testDate: "2026-07-28",
    testType: "multi-agent-adversarial-verification",
    primaryVerifier: {
      attempted: true,
      available: true,
      completed: true,
      freshContextRequested: true,
      retryCount: 0,
      notes: []
    },
    specialistVerifier: {
      attempted: true,
      available: true,
      completed: true,
      freshContextRequested: true,
      retryCount: 0,
      notes: []
    },
    cases,
    safety: {
      productionFilesChanged: false,
      trackedFilesChangedByTest: false,
      workerCalled: false,
      forwarderCalled: false
    }
  };
}
