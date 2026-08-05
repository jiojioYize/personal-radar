import test from "node:test";
import assert from "node:assert/strict";
import { createCandidateSignal } from "../src/stage3a/candidate-signals.js";
import {
  resolveSourceCandidateSignals,
  validateSourceCandidateResolution,
} from "../src/stage3a/candidate-resolver.js";
import {
  fetchGithubTreeSnapshot,
  GithubSourceError,
  githubReadHeaders,
  githubRepositoryIdentity,
} from "../src/stage3a/github-source-adapter.js";

const observedAt = "2026-08-05T00:00:00.000Z";

test("builds read-only GitHub API requests without exposing credentials in results", async () => {
  const calls = [];
  const snapshot = await fetchGithubTreeSnapshot({
    repositoryUrl: "https://github.com/Example/Rules/blob/main/README.md",
    token: "secret-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return jsonResponse({
        full_name: "Example/Rules",
        default_branch: "main",
        private: false,
        archived: false,
      });
      return jsonResponse({
        sha: "a".repeat(40),
        truncated: false,
        tree: [{ path: "skills/testing/SKILL.md", type: "blob", sha: "b".repeat(40), size: 120 }],
      });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.github.com/repos/Example/Rules");
  assert.equal(calls[1].url, "https://api.github.com/repos/Example/Rules/git/trees/main?recursive=1");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  assert.equal(JSON.stringify(snapshot).includes("secret-token"), false);
  assert.equal(snapshot.entries[0].path, "skills/testing/SKILL.md");
});

test("rejects identity drift, private repositories, and truncated trees", async () => {
  await assert.rejects(
    fetchGithubTreeSnapshot({
      repositoryUrl: "https://github.com/example/rules",
      fetchImpl: twoResponses(
        { full_name: "attacker/rules", default_branch: "main", private: false },
        { truncated: false, tree: [] },
      ),
    }),
    (error) => error instanceof GithubSourceError && error.errorClass === "GITHUB_IDENTITY_MISMATCH",
  );
  await assert.rejects(
    fetchGithubTreeSnapshot({
      repositoryUrl: "https://github.com/example/rules",
      fetchImpl: twoResponses(
        { full_name: "example/rules", default_branch: "main", private: true },
        { truncated: false, tree: [] },
      ),
    }),
    (error) => error.errorClass === "GITHUB_PRIVATE_REPOSITORY",
  );
  await assert.rejects(
    fetchGithubTreeSnapshot({
      repositoryUrl: "https://github.com/example/rules",
      fetchImpl: twoResponses(
        { full_name: "example/rules", default_branch: "main", private: false },
        { truncated: true, tree: [{ path: "skills/a/SKILL.md", type: "blob" }] },
      ),
    }),
    (error) => error.errorClass === "GITHUB_TREE_TRUNCATED"
      && error.retryable === false && error.requiresTraversal === true,
  );
});

test("classifies GitHub rate limiting as retryable with server timing", async () => {
  const reset = Math.floor(Date.now() / 1000) + 60;
  await assert.rejects(
    fetchGithubTreeSnapshot({
      repositoryUrl: "https://github.com/example/rules",
      fetchImpl: async () => new Response("rate limited", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
      }),
    }),
    (error) => error.errorClass === "GITHUB_RATE_LIMIT"
      && error.retryable === true && Boolean(error.retryAt),
  );
});

test("validates GitHub identity and API version inputs", () => {
  assert.deepEqual(githubRepositoryIdentity("https://github.com/openai/plugins/tree/main"), {
    owner: "openai",
    repo: "plugins",
    repositoryUrl: "https://github.com/openai/plugins",
    apiUrl: "https://api.github.com/repos/openai/plugins",
  });
  assert.throws(() => githubRepositoryIdentity("https://gitlab.com/openai/plugins"));
  assert.throws(() => githubReadHeaders({ apiVersion: "latest" }), /version/);
});

test("resolves a unique registry slug but preserves zero and multiple matches", async () => {
  const task = sourceTask();
  const unique = await lead(task, "find-skills", 1);
  const absent = await lead(task, "not-present", 2);
  const ambiguous = await lead(task, "testing", 3);
  const snapshot = treeSnapshot([
    "skills/find-skills/SKILL.md",
    "skills/testing/SKILL.md",
    "plugins/testing/SKILL.md",
  ]);
  const result = await resolveSourceCandidateSignals({
    task,
    signals: [unique, absent, ambiguous],
    snapshots: new Map([[snapshot.repositoryUrl, snapshot]]),
    completedRunCount: 0,
    observedAt,
  });
  assert.deepEqual(result.resolvedSignals.map((signal) => signal.artifactPath), [
    "skills/find-skills/SKILL.md",
  ]);
  assert.deepEqual(result.trajectories.map((item) => [item.status, item.reason]), [
    ["resolved", "exact_slug_match"],
    ["unresolved", "no_exact_slug_match"],
    ["ambiguous", "multiple_exact_slug_matches"],
  ]);
});

test("rotates container expansion between runs instead of fixing the first four paths", async () => {
  const task = sourceTask("communityTrend", "directory", "https://directory.example/");
  const container = await createCandidateSignal({
    task,
    signalKind: "container_lead",
    title: "Rules collection",
    locatorUrl: "https://github.com/example/rules",
    repositoryUrl: "https://github.com/example/rules",
    artifactType: "unknown",
    evidenceText: "Directory links to a repository collection",
    sourceRank: 1,
    observedAt,
  });
  const snapshot = treeSnapshot([
    "skills/a/SKILL.md", "skills/b/SKILL.md", "skills/c/SKILL.md",
    "skills/d/SKILL.md", "skills/e/SKILL.md", "README.md",
  ]);
  const first = await resolveRun(task, [container], snapshot, 0);
  const second = await resolveRun(task, [container], snapshot, 1);
  assert.deepEqual(first.resolvedSignals.map((item) => item.artifactPath), [
    "skills/a/SKILL.md", "skills/b/SKILL.md", "skills/c/SKILL.md", "skills/d/SKILL.md",
  ]);
  assert.deepEqual(second.resolvedSignals.map((item) => item.artifactPath), [
    "skills/e/SKILL.md", "skills/a/SKILL.md", "skills/b/SKILL.md", "skills/c/SKILL.md",
  ]);
  assert.equal(second.trajectories[0].reason, "deterministic_repository_rotation");
});

test("prioritizes already-exact and named leads before broad containers", async () => {
  const task = sourceTask();
  const exact = await createCandidateSignal({
    task,
    signalKind: "exact_artifact",
    title: "Exact",
    locatorUrl: "https://github.com/example/rules/blob/main/skills/exact/SKILL.md",
    repositoryUrl: "https://github.com/example/rules",
    artifactPath: "skills/exact/SKILL.md",
    artifactType: "skill",
    evidenceText: "Exact directory link",
    sourceRank: 3,
    observedAt,
  });
  const named = await lead(task, "named", 2);
  const container = await createCandidateSignal({
    task,
    signalKind: "container_lead",
    title: "Collection",
    locatorUrl: "https://github.com/example/rules",
    repositoryUrl: "https://github.com/example/rules",
    artifactType: "unknown",
    evidenceText: "Repository collection",
    sourceRank: 1,
    observedAt,
  });
  const snapshot = treeSnapshot([
    "skills/a/SKILL.md", "skills/b/SKILL.md", "skills/c/SKILL.md",
    "skills/exact/SKILL.md", "skills/named/SKILL.md",
  ]);
  const result = await resolveRun(task, [container, named, exact], snapshot, 0);
  assert.deepEqual(result.resolvedSignals.slice(0, 2).map((item) => item.artifactPath), [
    "skills/exact/SKILL.md", "skills/named/SKILL.md",
  ]);
  assert.equal(result.resolvedSignals.length, 4);
  assert.deepEqual(validateSourceCandidateResolution(result, task, [container, named, exact]), []);

  const missingTrajectory = structuredClone(result);
  missingTrajectory.trajectories.pop();
  assert.match(
    validateSourceCandidateResolution(missingTrajectory, task, [container, named, exact]).join("\n"),
    /cover every input signal/,
  );
});

function sourceTask(lane = "registryPulse", sourceId = "skillsSh", url = "https://www.skills.sh/") {
  return {
    taskId: `${lane}:${sourceId}`,
    lane,
    sourceId,
    url,
    maxCandidateSignals: 4,
  };
}

function lead(task, slug, sourceRank) {
  return createCandidateSignal({
    task,
    signalKind: "artifact_lead",
    title: slug,
    locatorUrl: `https://www.skills.sh/example/rules/${slug}`,
    repositoryUrl: "https://github.com/example/rules",
    artifactType: "skill",
    evidenceText: `Registry lists ${slug}`,
    sourceRank,
    observedAt,
  });
}

function treeSnapshot(paths) {
  return {
    version: 1,
    repositoryUrl: "https://github.com/example/rules",
    defaultBranch: "main",
    treeSha: "a".repeat(40),
    entries: paths.map((path, index) => ({
      path,
      type: "blob",
      sha: String(index).padStart(40, "0"),
      size: 100,
    })),
    repository: { fullName: "example/rules", archived: false, disabled: false, pushedAt: null },
  };
}

function resolveRun(task, signals, snapshot, completedRunCount) {
  return resolveSourceCandidateSignals({
    task,
    signals,
    snapshots: new Map([[snapshot.repositoryUrl, snapshot]]),
    completedRunCount,
    observedAt,
  });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function twoResponses(first, second) {
  let call = 0;
  return async () => jsonResponse(call++ === 0 ? first : second);
}
