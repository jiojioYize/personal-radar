import { DatabaseSync } from "node:sqlite";

export class DiscoveryStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS discovery_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collected_at TEXT NOT NULL,
        source TEXT NOT NULL,
        authenticated INTEGER NOT NULL,
        query_count INTEGER NOT NULL,
        repository_count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repositories (
        full_name TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        description TEXT,
        default_branch TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        pushed_at TEXT,
        archived INTEGER NOT NULL,
        license TEXT,
        topics_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repository_snapshots (
        full_name TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        stars INTEGER NOT NULL,
        forks INTEGER NOT NULL,
        watchers INTEGER NOT NULL,
        open_issues INTEGER NOT NULL,
        contributors INTEGER,
        commits_90d INTEGER,
        releases_12m INTEGER,
        PRIMARY KEY (full_name, collected_at),
        FOREIGN KEY (full_name) REFERENCES repositories(full_name)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_key TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        path TEXT NOT NULL,
        directory TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_url TEXT NOT NULL,
        content_sha TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (full_name) REFERENCES repositories(full_name)
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_repo_time ON repository_snapshots(full_name, collected_at);
      CREATE INDEX IF NOT EXISTS idx_artifacts_repo ON artifacts(full_name);
    `);
  }

  saveCollection(collection) {
    const insertRun = this.db.prepare(`INSERT INTO discovery_runs
      (collected_at, source, authenticated, query_count, repository_count) VALUES (?, 'github', ?, ?, ?)`);
    const upsertRepository = this.db.prepare(`INSERT INTO repositories
      (full_name,url,description,default_branch,created_at,updated_at,pushed_at,archived,license,topics_json,first_seen_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(full_name) DO UPDATE SET
      url=excluded.url,description=excluded.description,default_branch=excluded.default_branch,
      updated_at=excluded.updated_at,pushed_at=excluded.pushed_at,archived=excluded.archived,
      license=excluded.license,topics_json=excluded.topics_json,last_seen_at=excluded.last_seen_at`);
    const insertSnapshot = this.db.prepare(`INSERT OR REPLACE INTO repository_snapshots
      (full_name,collected_at,stars,forks,watchers,open_issues,contributors,commits_90d,releases_12m)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const upsertArtifact = this.db.prepare(`INSERT INTO artifacts
      (artifact_key,full_name,path,directory,kind,source_url,content_sha,first_seen_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(artifact_key) DO UPDATE SET
      source_url=excluded.source_url,content_sha=excluded.content_sha,last_seen_at=excluded.last_seen_at`);

    this.db.exec("BEGIN");
    try {
      insertRun.run(collection.collectedAt, collection.authenticated ? 1 : 0, collection.queries.length, collection.repositories.length);
      for (const repo of collection.repositories) {
        upsertRepository.run(repo.fullName, repo.url, repo.description, repo.defaultBranch, repo.createdAt, repo.updatedAt,
          repo.pushedAt, repo.archived ? 1 : 0, repo.license, JSON.stringify(repo.topics), collection.collectedAt, collection.collectedAt);
        insertSnapshot.run(repo.fullName, collection.collectedAt, repo.stars, repo.forks, repo.watchers, repo.openIssues,
          repo.contributors, repo.commitCount90d, repo.releaseCount12m);
        for (const artifact of repo.artifacts) {
          const key = `${repo.url.toLowerCase()}#artifact=${artifact.directory.toLowerCase()}`;
          upsertArtifact.run(key, repo.fullName, artifact.path, artifact.directory, artifact.kind, artifact.sourceUrl,
            artifact.sha, collection.collectedAt, collection.collectedAt);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  latestRun() {
    const row = this.db.prepare(`SELECT collected_at, authenticated, query_count, repository_count
      FROM discovery_runs ORDER BY collected_at DESC, id DESC LIMIT 1`).get();
    return row ? {
      collectedAt: row.collected_at,
      authenticated: Boolean(row.authenticated),
      queryCount: row.query_count,
      repositoryCount: row.repository_count,
    } : null;
  }

  exportCandidates({ limit = 50, maxArtifactsPerRepository = 5 } = {}) {
    const rows = this.db.prepare(`
      SELECT r.*, a.artifact_key, a.path AS artifact_path, a.directory AS artifact_directory,
        a.kind, a.source_url, a.content_sha,
        s.collected_at, s.stars, s.forks, s.watchers, s.open_issues,
        s.contributors, s.commits_90d, s.releases_12m,
        (SELECT old.stars FROM repository_snapshots old WHERE old.full_name=r.full_name
          AND old.collected_at <= datetime(s.collected_at, '-30 days') ORDER BY old.collected_at DESC LIMIT 1) AS stars_30d_ago
      FROM artifacts a
      JOIN repositories r ON r.full_name=a.full_name
      JOIN repository_snapshots s ON s.full_name=r.full_name
      WHERE s.collected_at=(SELECT MAX(latest.collected_at) FROM repository_snapshots latest WHERE latest.full_name=r.full_name)
      ORDER BY s.stars DESC, r.pushed_at DESC
    `).all();
    const repositoryCounts = new Map();
    const diverseRows = rows.filter((row) => {
      const count = repositoryCounts.get(row.full_name) || 0;
      if (count >= maxArtifactsPerRepository) return false;
      repositoryCounts.set(row.full_name, count + 1);
      return true;
    }).slice(0, limit);
    return diverseRows.map((row) => ({
      artifactKey: row.artifact_key,
      repository: row.full_name,
      repositoryUrl: row.url,
      sourceUrl: row.source_url,
      artifactPath: row.artifact_directory === "." ? null : row.artifact_directory,
      artifactFile: row.artifact_path,
      kind: row.kind,
      description: row.description,
      license: row.license,
      archived: Boolean(row.archived),
      createdAt: row.created_at,
      pushedAt: row.pushed_at,
      collectedAt: row.collected_at,
      metrics: {
        stars: row.stars,
        forks: row.forks,
        watchers: row.watchers,
        openIssues: row.open_issues,
        contributors: row.contributors,
        commitCount90d: row.commits_90d,
        releaseCount12m: row.releases_12m,
        starsGrowth30d: row.stars_30d_ago === null ? null : row.stars - row.stars_30d_ago,
      },
      discoveryLane: classifyLane(row),
      evidence: [{ source: "github-api", observedAt: row.collected_at, fields: ["stars", "forks", "openIssues", "contributors", "commitCount90d", "releaseCount12m"] }],
    }));
  }

  close() {
    this.db.close();
  }
}

function classifyLane(row) {
  if (row.stars >= 1000) return "high_validation";
  if (row.stars_30d_ago !== null && row.stars - row.stars_30d_ago >= 50) return "recent_growth";
  return "emerging";
}
