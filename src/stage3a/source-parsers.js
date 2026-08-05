import {
  canonicalRepositoryUrl,
  createCandidateSignal,
  normalizeArtifactPath,
} from "./candidate-signals.js";

export async function parseSkillsShDirectory({ task, content, observedAt }) {
  const links = htmlLinks(content, task.url);
  const matches = [];
  for (const link of links) {
    const url = new URL(link.url);
    if (!/(^|\.)skills\.sh$/i.test(url.hostname)) continue;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 3 || ["trending", "hot", "official"].includes(parts[0])) continue;
    matches.push(await createCandidateSignal({
      task,
      signalKind: "artifact_lead",
      title: link.text || parts[2].replace(/-/g, " "),
      locatorUrl: url.href,
      repositoryUrl: `https://github.com/${parts[0]}/${parts[1]}`,
      artifactType: "skill",
      evidenceText: `skills.sh lists ${parts[2]} under ${parts[0]}/${parts[1]}; exact repository path is unresolved`,
      sourceRank: matches.length + 1,
      observedAt,
    }));
    if (matches.length >= task.maxCandidateSignals) break;
  }
  if (!matches.length) throw new TypeError("skills.sh directory contained no recognizable artifact entries");
  return matches;
}

export async function parseGithubTree({ task, content, observedAt, repositoryUrl = task.url }) {
  const parsed = JSON.parse(content);
  const entries = Array.isArray(parsed) ? parsed : parsed.tree;
  if (!Array.isArray(entries)) throw new TypeError("GitHub tree response must contain a tree array");
  const repository = canonicalRepositoryUrl(repositoryUrl);
  const branch = parsed.branch || parsed.default_branch || "HEAD";
  const signals = [];
  for (const entry of entries) {
    if (entry?.type !== "blob") continue;
    const artifact = classifyArtifactPath(entry.path);
    if (!artifact) continue;
    const path = normalizeArtifactPath(entry.path);
    const title = artifactTitle(path, artifact);
    signals.push(await createCandidateSignal({
      task,
      signalKind: "exact_artifact",
      title,
      locatorUrl: `${repository}/blob/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`,
      repositoryUrl: repository,
      artifactPath: path,
      artifactType: artifact,
      evidenceText: `GitHub repository tree contains the exact artifact path ${path}`,
      sourceRank: signals.length + 1,
      observedAt,
    }));
    if (signals.length >= task.maxCandidateSignals) break;
  }
  return signals;
}

export async function parseCommunityDirectory({ task, content, observedAt }) {
  const signals = [];
  const seen = new Set();
  for (const link of htmlLinks(content, task.url)) {
    let repository;
    try { repository = canonicalRepositoryUrl(link.url); } catch { continue; }
    const url = new URL(link.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const blobIndex = parts.indexOf("blob");
    let artifactPath = null;
    let artifactType = null;
    if (blobIndex === 2 && parts.length > 4) {
      const proposedPath = decodeURIComponent(parts.slice(4).join("/"));
      artifactType = classifyArtifactPath(proposedPath);
      if (artifactType) artifactPath = proposedPath;
    }
    const identity = artifactPath ? `${repository}#${artifactPath}` : repository;
    if (seen.has(identity)) continue;
    seen.add(identity);
    signals.push(await createCandidateSignal({
      task,
      signalKind: artifactPath ? "exact_artifact" : "container_lead",
      title: link.text || parts[1],
      locatorUrl: link.url,
      repositoryUrl: repository,
      artifactPath,
      artifactType: artifactType || "unknown",
      evidenceText: artifactPath
        ? `Community directory links to the exact artifact path ${artifactPath}`
        : "Community directory links to a repository or collection that requires artifact expansion",
      sourceRank: signals.length + 1,
      observedAt,
    }));
    if (signals.length >= task.maxCandidateSignals) break;
  }
  if (!signals.length) throw new TypeError("community directory contained no recognizable GitHub entries");
  return signals;
}

export function classifyArtifactPath(value) {
  const path = String(value || "").replace(/\\/g, "/");
  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1);
  if (name === "skill.md") return "skill";
  if (name === "claude.md") return "claude_instruction";
  if (name === "agents.md") return "codex_instruction";
  if (name === ".cursorrules" || lower.startsWith(".cursor/rules/") || lower.includes("/.cursor/rules/")) return "cursor_rule";
  if (name === ".clinerules" || lower.startsWith(".clinerules/") || lower.includes("/.clinerules/")) return "cline_rule";
  if (lower.startsWith(".roo/rules/") || lower.includes("/.roo/rules/")) return "roo_rule";
  if (lower.includes("/.github/agents/") || lower.startsWith(".github/agents/")) {
    return name.endsWith(".agent.md") ? "agent_definition" : null;
  }
  if (lower.includes("/.github/instructions/") || lower.startsWith(".github/instructions/")) {
    return name.endsWith(".instructions.md") ? "instruction" : null;
  }
  return null;
}

function htmlLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    try {
      links.push({
        url: new URL(decodeEntities(match[1] || match[2] || match[3]), baseUrl).href,
        text: decodeEntities(match[4].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(),
      });
    } catch {
      // A malformed directory link is not a candidate signal.
    }
  }
  return links;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function artifactTitle(path, artifactType) {
  const parts = path.split("/");
  const filename = parts.at(-1);
  if (filename.toLowerCase() === "skill.md" && parts.length > 1) return parts.at(-2).replace(/[-_]/g, " ");
  return filename.replace(/\.(instructions|agent)?\.md$|\.mdc$|^\./gi, "").replace(/[-_]/g, " ");
}
