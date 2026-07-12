import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectGithubCandidates, extractSkillArtifacts } from "../src/discovery/github.js";
import { DiscoveryStore } from "../src/discovery/store.js";

test("extracts concrete skill and rule artifacts from a GitHub tree", () => {
  const artifacts = extractSkillArtifacts([
    { type: "blob", path: "skills/pdf/SKILL.md", sha: "a" },
    { type: "blob", path: "CLAUDE.md", sha: "b" },
    { type: "blob", path: "src/index.js", sha: "c" },
  ], { full_name: "example/skills", default_branch: "main" });
  assert.deepEqual(artifacts.map((item) => item.kind), ["skill", "claude-rule"]);
  assert.equal(artifacts[0].directory, "skills/pdf");
  assert.match(artifacts[0].sourceUrl, /skills\/pdf\/SKILL\.md$/);
});

test("collects GitHub metadata and only keeps repositories with artifacts", async () => {
  const fetchImpl = async (url) => responseFor(url);
  const result = await collectGithubCandidates({
    fetchImpl,
    queries: ["agent skills"],
    maxRepositories: 2,
    now: new Date("2026-07-12T00:00:00Z"),
  });
  assert.equal(result.repositories.length, 1);
  assert.equal(result.repositories[0].fullName, "example/skills");
  assert.equal(result.repositories[0].artifacts[0].path, "skills/pdf/SKILL.md");
  assert.equal(result.repositories[0].commitCount90d, 2);
  assert.equal(result.repositories[0].releaseCount12m, 1);
});

test("stores snapshots and exports artifact-level candidates", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-radar-discovery-"));
  const filename = path.join(directory, "discovery.sqlite");
  const store = new DiscoveryStore(filename);
  try {
    store.saveCollection(collectionFixture("2026-06-01T00:00:00.000Z", 100));
    store.saveCollection(collectionFixture("2026-07-12T00:00:00.000Z", 180));
    assert.deepEqual(store.latestRun(), {
      collectedAt: "2026-07-12T00:00:00.000Z",
      authenticated: true,
      queryCount: 1,
      repositoryCount: 1,
    });
    const candidates = store.exportCandidates();
    assert.equal(candidates.length, 1);
    assert.match(candidates[0].artifactKey, /#artifact=skills\/pdf$/);
    assert.equal(candidates[0].metrics.starsGrowth30d, 80);
    assert.equal(candidates[0].discoveryLane, "recent_growth");
  } finally {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("caps exported artifacts per repository", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "personal-radar-discovery-cap-"));
  const store = new DiscoveryStore(path.join(directory, "discovery.sqlite"));
  try {
    const collection = collectionFixture("2026-07-12T00:00:00.000Z", 180);
    collection.repositories[0].artifacts = Array.from({ length: 8 }, (_, index) => ({
      path: `skills/skill-${index}/SKILL.md`, directory: `skills/skill-${index}`, kind: "skill",
      sourceUrl: `https://github.com/example/skills/blob/main/skills/skill-${index}/SKILL.md`, sha: String(index),
    }));
    store.saveCollection(collection);
    assert.equal(store.exportCandidates({ limit: 20, maxArtifactsPerRepository: 3 }).length, 3);
  } finally {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function responseFor(url) {
  if (url.includes("/search/repositories")) return jsonResponse({ total_count: 2, items: [repoFixture("example/skills", 500), repoFixture("example/empty", 10)] });
  if (url.includes("example/skills/git/trees")) return jsonResponse({ tree: [{ type: "blob", path: "skills/pdf/SKILL.md", sha: "abc" }] });
  if (url.includes("example/empty/git/trees")) return jsonResponse({ tree: [{ type: "blob", path: "README.md", sha: "def" }] });
  if (url.includes("/commits?")) return jsonResponse([{ sha: "1" }, { sha: "2" }]);
  if (url.includes("/releases?")) return jsonResponse([{ published_at: "2026-06-01T00:00:00Z" }]);
  if (url.includes("/contributors?")) return jsonResponse([{ login: "a" }, { login: "b" }]);
  throw new Error(`Unexpected URL: ${url}`);
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body };
}

function repoFixture(fullName, stars) {
  return {
    full_name: fullName,
    name: fullName.split("/")[1],
    html_url: `https://github.com/${fullName}`,
    description: "Agent skills",
    default_branch: "main",
    stargazers_count: stars,
    forks_count: 20,
    open_issues_count: 2,
    watchers_count: 5,
    archived: false,
    license: { spdx_id: "MIT" },
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    pushed_at: "2026-07-10T00:00:00Z",
    topics: ["agent-skills"],
  };
}

function collectionFixture(collectedAt, stars) {
  return {
    collectedAt,
    authenticated: true,
    queries: [{ query: "skills", totalCount: 1, returnedCount: 1 }],
    repositories: [{
      ...repoFixture("example/skills", stars),
      url: "https://github.com/example/skills",
      fullName: "example/skills",
      defaultBranch: "main",
      stars,
      forks: 20,
      openIssues: 2,
      watchers: 5,
      archived: false,
      license: "MIT",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2026-07-10T00:00:00Z",
      pushedAt: "2026-07-10T00:00:00Z",
      topics: ["agent-skills"],
      contributors: 2,
      commitCount90d: 5,
      releaseCount12m: 1,
      artifacts: [{ path: "skills/pdf/SKILL.md", directory: "skills/pdf", kind: "skill", sourceUrl: "https://github.com/example/skills/blob/main/skills/pdf/SKILL.md", sha: "abc" }],
    }],
  };
}
