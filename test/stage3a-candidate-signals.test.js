import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  createCandidateSignal,
  partitionCandidateSignals,
  validateCandidateSignal,
} from "../src/stage3a/candidate-signals.js";
import {
  parseCommunityDirectory,
  parseGithubTree,
  parseSkillsShDirectory,
} from "../src/stage3a/source-parsers.js";
import { fetchSourceTaskOnce } from "../src/stage3a/source-http-connector.js";

const observedAt = "2026-08-05T00:00:00.000Z";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("skills.sh entries remain artifact leads until an exact repository path is resolved", async () => {
  const task = sourceTask("registryPulse", "skillsSh", "https://www.skills.sh/");
  const html = `
    <a href="/vercel-labs/skills/find-skills"><strong>find-skills</strong></a>
    <a href="/anthropics/skills/frontend-design">frontend-design</a>
  `;
  const signals = await parseSkillsShDirectory({ task, content: html, observedAt });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.signalKind === "artifact_lead"));
  assert.ok(signals.every((signal) => signal.artifactPath === null));
  assert.equal(signals[0].repositoryUrl, "https://github.com/vercel-labs/skills");
  assert.deepEqual(partitionCandidateSignals(signals).candidates, []);
});

test("GitHub tree parsing emits exact supported artifacts but not generic Markdown", async () => {
  const task = sourceTask("officialRotation", "githubAwesomeCopilot", "https://github.com/github/awesome-copilot");
  const content = JSON.stringify({
    branch: "main",
    tree: [
      { type: "blob", path: "skills/refactor/SKILL.md" },
      { type: "blob", path: ".github/instructions/typescript.instructions.md" },
      { type: "blob", path: ".github/agents/planner.agent.md" },
      { type: "blob", path: "README.md" },
      { type: "tree", path: "skills/empty" },
    ],
  });
  const signals = await parseGithubTree({ task, content, observedAt });
  assert.deepEqual(signals.map((signal) => signal.artifactPath), [
    "skills/refactor/SKILL.md",
    ".github/instructions/typescript.instructions.md",
    ".github/agents/planner.agent.md",
  ]);
  assert.ok(signals.every((signal) => signal.signalKind === "exact_artifact"));
  assert.equal(partitionCandidateSignals(signals).candidates.length, 3);
});

test("community repository links are container leads, not candidates", async () => {
  const task = sourceTask("communityTrend", "awesomeClaudeSkills", "https://awesomeclaudeskills.com/");
  const content = `
    <a href="https://github.com/example/skill-collection">Skill collection</a>
    <a href="https://github.com/example/rules/blob/main/.cursor/rules/testing.mdc">Testing rule</a>
  `;
  const signals = await parseCommunityDirectory({ task, content, observedAt });
  assert.equal(signals[0].signalKind, "container_lead");
  assert.equal(signals[0].artifactPath, null);
  assert.equal(signals[1].signalKind, "exact_artifact");
  const partitioned = partitionCandidateSignals(signals);
  assert.equal(partitioned.pendingSignals.length, 1);
  assert.equal(partitioned.candidates.length, 1);
});

test("deduplicates only the same exact artifact and preserves its trajectory", async () => {
  const taskA = sourceTask("officialRotation", "official", "https://github.com/example/rules");
  const taskB = sourceTask("communityTrend", "community", "https://directory.example/");
  const first = await exactSignal(taskA, "skills/a/SKILL.md");
  const duplicate = await exactSignal(taskB, "skills/a/SKILL.md");
  const sibling = await exactSignal(taskB, "skills/b/SKILL.md");
  const result = partitionCandidateSignals([first, duplicate, sibling]);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].corroboratingSignals.length, 1);
  assert.equal(result.duplicateTrajectories.length, 1);
  assert.equal(result.duplicateTrajectories[0].retainedBySignalId, first.signalId);
});

test("connector parses in memory and fails closed on invalid or excessive output", async () => {
  const task = sourceTask("registryPulse", "skillsSh", "https://www.skills.sh/");
  const html = '<a href="/vercel-labs/skills/find-skills">find-skills</a>';
  const succeeded = await fetchSourceTaskOnce({
    task,
    fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }),
    parse: parseSkillsShDirectory,
    now: new Date(observedAt),
  });
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.candidateSignals.length, 1);
  assert.ok(!Object.hasOwn(succeeded, "rawBody"));

  const invalid = await fetchSourceTaskOnce({
    task,
    fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }),
    parse: async () => [{ invented: true }],
  });
  assert.equal(invalid.status, "failed");
  assert.equal(invalid.errorClass, "SOURCE_PARSE_ERROR");

  const signal = succeeded.candidateSignals[0];
  const excessive = await fetchSourceTaskOnce({
    task,
    fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }),
    parse: async () => Array.from({ length: 5 }, () => signal),
  });
  assert.equal(excessive.errorClass, "SOURCE_PARSE_ERROR");
});

test("candidate signal schema and manual validator agree", async () => {
  const signal = await exactSignal(
    sourceTask("officialRotation", "official", "https://github.com/example/rules"),
    "skills/a/SKILL.md",
  );
  assert.deepEqual(validateCandidateSignal(signal), []);
  const schema = JSON.parse(await fs.readFile(path.join(root, "schemas", "candidate-signal-v1.schema.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  assert.equal(ajv.compile(schema)(signal), true);
});

function sourceTask(lane, sourceId, url) {
  return {
    taskId: `${lane}:${sourceId}`,
    lane,
    sourceId,
    url,
    maxCandidateSignals: 4,
    maxExcerptBytes: 32768,
    maxResponseBytes: 1048576,
    maxRedirects: 2,
    timeoutMs: 15000,
  };
}

function exactSignal(task, artifactPath) {
  return createCandidateSignal({
    task,
    signalKind: "exact_artifact",
    title: artifactPath.split("/").at(-2),
    locatorUrl: `https://github.com/example/rules/blob/main/${artifactPath}`,
    repositoryUrl: "https://github.com/example/rules",
    artifactPath,
    artifactType: "skill",
    evidenceText: `Exact path ${artifactPath}`,
    sourceRank: 1,
    observedAt,
  });
}
