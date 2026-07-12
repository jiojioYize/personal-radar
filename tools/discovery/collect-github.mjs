import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collectGithubCandidates } from "../../src/discovery/github.js";
import { DiscoveryStore } from "../../src/discovery/store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INBOX = path.join(ROOT, "reports", "inbox");
const DATABASE = path.join(INBOX, "discovery.sqlite");
const OUTPUT = path.join(INBOX, "github-candidates.json");

await fs.mkdir(INBOX, { recursive: true });
const credentials = await resolveGithubCredentials();
const token = credentials.token;
const store = new DiscoveryStore(DATABASE);

try {
  const exportOnly = process.argv.includes("--export-only");
  const collection = exportOnly ? null : await collectGithubCandidates({ token });
  if (collection) store.saveCollection(collection);
  const latestRun = store.latestRun();
  const candidates = store.exportCandidates({ limit: 100 });
  const latestSnapshotAt = candidates.reduce((latest, item) => item.collectedAt > latest ? item.collectedAt : latest, "");
  const output = {
    version: 1,
    generatedAt: collection?.collectedAt || latestSnapshotAt || null,
    source: "github-api",
    authenticated: collection?.authenticated ?? latestRun?.authenticated ?? false,
    collection: {
      queryCount: collection?.queries.length ?? latestRun?.queryCount ?? null,
      repositoryCount: collection?.repositories.length ?? latestRun?.repositoryCount ?? new Set(candidates.map((item) => item.repository)).size,
      artifactCount: collection?.repositories.reduce((sum, repo) => sum + repo.artifacts.length, 0) ?? null,
      exportedCandidateCount: candidates.length,
    },
    queries: collection?.queries || [],
    candidates,
  };
  await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  const artifactSummary = output.collection.artifactCount === null
    ? `${output.collection.exportedCandidateCount} exported candidates`
    : `${output.collection.artifactCount} artifacts`;
  console.log(`${exportOnly ? "GitHub discovery export" : "GitHub discovery complete"}: ${output.collection.repositoryCount} repositories, ${artifactSummary}`);
  console.log(`Candidate evidence pack: ${path.relative(ROOT, OUTPUT)}`);
  console.log(`GitHub authentication: ${exportOnly ? (output.authenticated ? "stored authenticated snapshot" : "stored anonymous snapshot") : credentials.source}`);
} finally {
  store.close();
}

async function readLocalSecret(name) {
  try {
    const content = await fs.readFile(path.join(ROOT, ".secrets.local"), "utf8");
    const match = content.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
    return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || null;
  } catch {
    return null;
  }
}

async function resolveGithubCredentials() {
  if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, source: "environment" };
  const local = await readLocalSecret("GITHUB_TOKEN");
  if (local) return { token: local, source: "local secret" };
  try {
    const run = promisify(execFile);
    const { stdout } = await run("gh", ["auth", "token"], { windowsHide: true, encoding: "utf8" });
    const token = stdout.trim();
    if (token) return { token, source: "GitHub CLI keyring" };
  } catch {
    // Anonymous mode remains useful for small daily samples.
  }
  return { token: null, source: "anonymous (reduced scope)" };
}
