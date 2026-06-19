import { CHANNELS } from "./channels.js";

const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";
const DEFAULT_USER_AGENT = "personal-radar/0.1";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "personal-radar", channels: activeChannels(env).map((c) => c.id) });
    }

    if (url.pathname === "/run" || url.pathname === "/") {
      const report = await runRadar(env, { trigger: "http", dryRun: true });
      return new Response(report, {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    if (url.pathname === "/test-push") {
      const key = url.searchParams.get("key") || "";
      if (!env.RADAR_TEST_KEY || key !== env.RADAR_TEST_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }
      const report = renderTestReport();
      await pushReport(env, report);
      return new Response("Push test sent", { status: 200 });
    }

    if (url.pathname === "/ingest-report") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const key = request.headers.get("x-radar-ingest-key") || "";
      if (!env.DEEP_REPORT_INGEST_KEY || key !== env.DEEP_REPORT_INGEST_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }

      let report;
      try {
        report = await readIngestedReport(request);
      } catch (error) {
        return Response.json({ ok: false, error: error.message }, { status: 400 });
      }
      await pushReport(env, report);
      return Response.json({ ok: true, pushed: true });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRadar(env, { trigger: "cron", scheduledTime: event.scheduledTime }));
  },
};

async function runRadar(env, context = {}) {
  const shouldRun = await shouldRunNow(env, context);
  if (!shouldRun.run) {
    const skipped = renderSkippedReport(shouldRun.reason, shouldRun.nextRunAt);
    console.log(skipped);
    return skipped;
  }

  const channels = activeChannels(env);
  const sections = [];

  for (const channel of channels) {
    const items = await collectChannelItems(channel);
    sections.push(renderChannel(channel, items));
  }

  const report = renderReport(sections, context);
  if (!context.dryRun) {
    await markRun(env);
    await pushReport(env, report);
  }
  console.log(report);
  return report;
}

function activeChannels(env) {
  const allowed = new Set((env.RADAR_CHANNELS || "skill-radar").split(",").map((x) => x.trim()).filter(Boolean));
  return CHANNELS.filter((channel) => channel.enabled && allowed.has(channel.id));
}

async function collectChannelItems(channel) {
  const results = [];

  for (const source of channel.sources) {
    if (source.type !== "github-search") continue;
    const repos = await searchGitHub(source.query);
    for (const repo of repos) {
      results.push({
        source: source.label,
        categoryHint: source.categoryHint,
        title: repo.full_name,
        url: repo.html_url,
        description: repo.description || "No description provided.",
        stars: repo.stargazers_count || 0,
        updatedAt: repo.updated_at,
        language: repo.language || "Unknown",
        topics: repo.topics || [],
      });
    }
  }

  return dedupeByUrl(results)
    .map(enrichItem)
    .sort((a, b) => scoreItem(b) - scoreItem(a))
    .slice(0, channel.maxItems || 8);
}

async function searchGitHub(query) {
  const params = new URLSearchParams({
    q: query,
    sort: "updated",
    order: "desc",
    per_page: "10",
  });

  const response = await fetch(`${GITHUB_SEARCH_URL}?${params.toString()}`, {
    headers: {
      "accept": "application/vnd.github+json",
      "user-agent": DEFAULT_USER_AGENT,
    },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

function scoreItem(item) {
  const stars = Math.log10((item.stars || 0) + 1) * 10;
  const ageDays = (Date.now() - Date.parse(item.updatedAt || 0)) / 86400000;
  const freshness = Math.max(0, 20 - Math.min(ageDays, 20));
  const categoryBoost = {
    "Codex Skill": 18,
    "Other Agent Skill": 14,
    "Document Skill": 12,
    "MCP Server": 10,
    "Agent Workflow": 8,
    "General AI Tool": -8,
  }[item.category] || 0;
  return stars + freshness + categoryBoost + item.fitScore;
}

function enrichItem(item) {
  const text = `${item.title} ${item.description} ${(item.topics || []).join(" ")} ${item.source}`.toLowerCase();
  const category = classifyItem(item, text);
  const fitScore = computeFitScore(text, category);
  return {
    ...item,
    category,
    fitScore,
    fit: describeFit(category),
    adaptation: describeAdaptation(category),
  };
}

function classifyItem(item, text) {
  if (text.includes(".codex/skills") || text.includes("codex skill") || text.includes("skill.md")) {
    return "Codex Skill";
  }
  if (text.includes("cursor rules") || text.includes("cline rules") || text.includes("agent skill") || text.includes("ai rules")) {
    return "Other Agent Skill";
  }
  if (text.includes("mcp server") || text.includes("model context protocol")) {
    return "MCP Server";
  }
  if (text.includes("pandoc") || text.includes("docx") || text.includes("pdf automation") || text.includes("markdown")) {
    return "Document Skill";
  }
  if (text.includes("workflow") || text.includes("automation") || text.includes("agent runtime")) {
    return "Agent Workflow";
  }
  return item.categoryHint || "General AI Tool";
}

function computeFitScore(text, category) {
  let score = 0;
  for (const keyword of ["skill", "skills", "workflow", "automation", "mcp", "rules", "template", "prompt", "pdf", "docx", "browser"]) {
    if (text.includes(keyword)) score += 2;
  }
  if (category === "General AI Tool") score -= 8;
  return score;
}

function describeFit(category) {
  switch (category) {
    case "Codex Skill":
      return "Likely directly relevant to Codex skill usage or adaptation.";
    case "Other Agent Skill":
      return "Useful as a portable agent capability, but may need format conversion for Codex.";
    case "MCP Server":
      return "Extends agent tool access; often pairs well with a skill that explains when and how to use it.";
    case "Document Skill":
      return "Relevant to repeatable document, PDF, Markdown, or Word workflows.";
    case "Agent Workflow":
      return "Reusable process pattern that could become a skill after distilling the steps.";
    default:
      return "Potentially useful AI tooling, but not necessarily a skill without further adaptation.";
  }
}

function describeAdaptation(category) {
  switch (category) {
    case "Codex Skill":
      return "Inspect its SKILL.md and install or adapt only after reviewing scripts and permissions.";
    case "Other Agent Skill":
      return "Map the workflow into a Codex SKILL.md with clear trigger rules, safety notes, and validation.";
    case "MCP Server":
      return "Treat it as a tool integration; create a separate skill only if usage needs repeatable guidance.";
    case "Document Skill":
      return "Extract the repeatable commands, templates, and validation checks into a local skill.";
    case "Agent Workflow":
      return "Turn the workflow into a short checklist plus optional scripts if it proves repeatable.";
    default:
      return "Use as inspiration; avoid installing until the repo is reviewed.";
  }
}

function dedupeByUrl(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    output.push(item);
  }
  return output;
}

function renderReport(sections, context) {
  const date = new Date().toISOString();
  return [
    `# Personal Radar`,
    ``,
    `Generated: ${date}`,
    `Trigger: ${context.trigger || "unknown"}`,
    ``,
    ...sections,
    ``,
    `## Notes`,
    ``,
    `- This MVP uses public GitHub repository search only.`,
    `- "Skill" is interpreted broadly: Codex skills, other agent skills/rules, MCP servers, reusable workflows, and document/browser automation patterns can all qualify.`,
    `- Treat code recommendations as untrusted until reviewed.`,
    `- Avoid installing tools that request secrets or broad system permissions without inspection.`,
  ].join("\n");
}

function renderChannel(channel, items) {
  const lines = [`## ${channel.title}`, ``];

  if (items.length === 0) {
    lines.push(`No items found this run.`, ``);
    return lines.join("\n");
  }

  items.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${item.title}`);
    lines.push(``);
    lines.push(`- Source: ${item.source}`);
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Link: ${item.url}`);
    lines.push(`- Stars: ${item.stars}`);
    lines.push(`- Language: ${item.language}`);
    lines.push(`- Updated: ${item.updatedAt}`);
    lines.push(`- Why it may be useful: ${item.description}`);
    lines.push(`- Fit: ${item.fit}`);
    lines.push(`- Adaptation note: ${item.adaptation}`);
    lines.push(`- Caveat: Review the repository, permissions, and install steps before use.`);
    lines.push(``);
  });

  return lines.join("\n");
}

function renderSkippedReport(reason, nextRunAt) {
  return [`# Personal Radar`, ``, `Skipped: ${reason}`, nextRunAt ? `Next eligible run: ${nextRunAt}` : null].filter(Boolean).join("\n");
}

function renderTestReport() {
  return [
    `# Personal Radar Test`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `PushPlus is connected successfully.`,
  ].join("\n");
}

async function readIngestedReport(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = await request.json();
    const title = payload.title || "Skill Radar Deep Dive";
    const content = payload.content || payload.report || "";
    if (!content.trim()) {
      throw new Error("Empty report content");
    }
    return `# ${title}\n\n${content}`;
  }

  const text = await request.text();
  if (!text.trim()) {
    throw new Error("Empty report content");
  }
  return text;
}

async function shouldRunNow(env, context = {}) {
  return { run: true };
}

async function markRun(env) {
  if (!env.RADAR_STATE) return;
  await env.RADAR_STATE.put("lastRunAt", new Date().toISOString());
}

async function pushReport(env, report) {
  if (env.PUSHPLUS_TOKEN) {
    await sendPushPlus(env, report);
    return;
  }

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await sendTelegram(env, report);
    return;
  }

  // No push adapter configured. The report is still available through /run and Worker logs.
}

async function sendPushPlus(env, report) {
  const content = report.length > 18000 ? `${report.slice(0, 17600)}\n\n...truncated` : report;
  const response = await fetch("https://www.pushplus.plus/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: env.PUSHPLUS_TOKEN,
      title: "Personal Radar",
      content,
      template: "markdown",
      channel: env.PUSHPLUS_CHANNEL || "wechat",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PushPlus failed: ${response.status} ${body}`);
  }
}

async function sendTelegram(env, report) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const text = report.length > 3900 ? `${report.slice(0, 3800)}\n\n...truncated` : report;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
}
