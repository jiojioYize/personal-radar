const DEFAULT_QUERIES = [
  { query: '"SKILL.md" agent skills is:public in:name,description,readme', sort: "stars", lane: "high_validation" },
  { query: '"Claude Code" skills is:public in:name,description,readme', sort: "stars", lane: "high_validation" },
  { query: '"Cursor rules" OR ".cursorrules" is:public in:name,description,readme', sort: "stars", lane: "high_validation" },
  { query: '"SKILL.md" agent skills is:public in:name,description,readme', sort: "updated", lane: "emerging" },
  { query: '"Codex" skills is:public in:name,description,readme', sort: "updated", lane: "emerging" },
  { query: '"Roo Code" OR "Cline rules" is:public in:name,description,readme', sort: "updated", lane: "emerging" },
];

export function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "personal-radar-discovery/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function collectGithubCandidates({
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
  queries = DEFAULT_QUERIES,
  maxRepositories = token ? 25 : 8,
  now = new Date(),
} = {}) {
  const headers = githubHeaders(token);
  const discovered = new Map();
  const queryStats = [];

  for (const queryInput of queries) {
    const search = normalizeSearch(queryInput);
    const result = await githubJson(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(search.query)}&sort=${search.sort}&order=desc&per_page=10`,
      { headers, fetchImpl },
    );
    queryStats.push({ ...search, totalCount: Number(result.total_count || 0), returnedCount: result.items?.length || 0 });
    for (const repository of result.items || []) {
      const existing = discovered.get(repository.full_name);
      if (existing) existing.discoveryLanes.add(search.lane);
      else discovered.set(repository.full_name, { ...repository, discoveryLanes: new Set([search.lane]) });
    }
  }

  const ranked = balancedRepositories([...discovered.values()], maxRepositories, now);
  const repositories = [];

  for (const repository of ranked) {
    const tree = await githubJson(`https://api.github.com/repos/${repository.full_name}/git/trees/${repository.default_branch}?recursive=1`, { headers, fetchImpl });
    const commits = await githubJson(`https://api.github.com/repos/${repository.full_name}/commits?since=${daysAgo(now, 90)}&per_page=100`, { headers, fetchImpl, optional: true });
    const releases = await githubJson(`https://api.github.com/repos/${repository.full_name}/releases?per_page=20`, { headers, fetchImpl, optional: true });
    const contributors = await githubJson(`https://api.github.com/repos/${repository.full_name}/contributors?anon=1&per_page=100`, { headers, fetchImpl, optional: true });
    const artifacts = extractSkillArtifacts(tree.tree || [], repository);
    if (!artifacts.length) continue;
    repositories.push(normalizeRepository(repository, {
      discoveryLanes: [...repository.discoveryLanes],
      artifacts,
      commitCount90d: Array.isArray(commits) ? commits.length : null,
      releaseCount12m: countRecent(releases, "published_at", now, 365),
      contributors: Array.isArray(contributors) ? contributors.length : null,
    }));
  }

  return {
    version: 1,
    collectedAt: now.toISOString(),
    authenticated: Boolean(token),
    queries: queryStats,
    repositories,
  };
}

export function extractSkillArtifacts(tree, repository) {
  return tree
    .filter((entry) => entry.type === "blob" && /(^|\/)(SKILL\.md|CLAUDE\.md|AGENTS\.md|\.cursorrules)$/i.test(entry.path))
    .map((entry) => ({
      path: entry.path,
      directory: entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : ".",
      kind: artifactKind(entry.path),
      sourceUrl: `https://github.com/${repository.full_name}/blob/${repository.default_branch}/${entry.path}`,
      sha: entry.sha || null,
    }));
}

export function repositoryDiscoveryScore(repository, now = new Date()) {
  const stars = Math.log10(Number(repository.stargazers_count || 0) + 1) * 20;
  const recent = Math.max(0, 30 - ageDays(repository.pushed_at, now));
  const skillSignal = /skill|rule|agent/i.test(`${repository.name} ${repository.description || ""}`) ? 20 : 0;
  return stars + recent + skillSignal;
}

function normalizeRepository(repository, extra) {
  return {
    fullName: repository.full_name,
    url: repository.html_url,
    description: repository.description || null,
    defaultBranch: repository.default_branch,
    stars: Number(repository.stargazers_count || 0),
    forks: Number(repository.forks_count || 0),
    openIssues: Number(repository.open_issues_count || 0),
    watchers: Number(repository.subscribers_count || repository.watchers_count || 0),
    archived: Boolean(repository.archived),
    license: repository.license?.spdx_id || null,
    createdAt: repository.created_at,
    updatedAt: repository.updated_at,
    pushedAt: repository.pushed_at,
    topics: repository.topics || [],
    ...extra,
  };
}

function balancedRepositories(repositories, limit, now) {
  const rank = (items) => items.sort((a, b) => repositoryDiscoveryScore(b, now) - repositoryDiscoveryScore(a, now));
  const high = rank(repositories.filter((repo) => repo.discoveryLanes.has("high_validation")));
  const emerging = rank(repositories.filter((repo) => repo.discoveryLanes.has("emerging")));
  const selected = [];
  const seen = new Set();
  const add = (repo) => {
    if (repo && !seen.has(repo.full_name) && selected.length < limit) {
      seen.add(repo.full_name);
      selected.push(repo);
    }
  };
  const perLane = Math.ceil(limit / 2);
  high.slice(0, perLane).forEach(add);
  emerging.slice(0, perLane).forEach(add);
  rank(repositories).forEach(add);
  return selected;
}

function normalizeSearch(value) {
  if (typeof value === "string") return { query: value, sort: "updated", lane: "emerging" };
  return {
    query: String(value.query),
    sort: value.sort === "stars" ? "stars" : "updated",
    lane: value.lane === "high_validation" ? "high_validation" : "emerging",
  };
}

async function githubJson(url, { headers, fetchImpl, optional = false, attempts = 3 }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers });
      if (optional && (response.status === 404 || response.status === 409 || response.status === 422)) return null;
      if (!response.ok) {
        const remaining = response.headers?.get?.("x-ratelimit-remaining");
        throw new Error(`GitHub API ${response.status} for ${new URL(url).pathname}${remaining === "0" ? " (rate limit exhausted)" : ""}`);
      }
      return response.json();
    } catch (error) {
      if (attempt < attempts) {
        await delay(250 * 2 ** (attempt - 1));
        continue;
      }
      if (optional) return null;
      throw error;
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function artifactKind(path) {
  const name = path.split("/").at(-1).toLowerCase();
  if (name === "skill.md") return "skill";
  if (name === "claude.md") return "claude-rule";
  if (name === "agents.md") return "agent-rule";
  return "cursor-rule";
}

function countRecent(items, field, now, days) {
  if (!Array.isArray(items)) return null;
  return items.filter((item) => ageDays(item[field], now) <= days).length;
}

function ageDays(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now.getTime() - timestamp) / 86400000)) : 9999;
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * 86400000).toISOString();
}

export { DEFAULT_QUERIES };
