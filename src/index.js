import { CHANNELS } from "./channels.js";

const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";
const DEFAULT_USER_AGENT = "personal-radar/0.1";
const DEFAULT_CATEGORY = "skill-radar";
const REPORT_INDEX_LIMIT = 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "personal-radar", channels: activeChannels(env).map((c) => c.id) });
    }

    if (url.pathname === "/") {
      return renderHome(env, request);
    }

    if (url.pathname === "/reports") {
      return renderReportsIndex(env, request);
    }

    const reportMatch = url.pathname.match(/^\/reports\/([^/]+)\/([^/]+)$/);
    if (reportMatch) {
      return renderStoredReport(env, reportMatch[1], reportMatch[2], request);
    }

    if (url.pathname === "/run") {
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

      const stored = await storeReport(env, report);
      if (stored.duplicate) {
        return Response.json({ ok: true, stored: false, pushed: false, duplicate: true, reason: stored.reason, report: stored.report });
      }

      await pushReport(env, report.content);
      return Response.json({ ok: true, stored: true, pushed: true, report: stored.report });
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
  const allowed = new Set((env.RADAR_CHANNELS || DEFAULT_CATEGORY).split(",").map((x) => x.trim()).filter(Boolean));
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
      accept: "application/vnd.github+json",
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
    "# Personal Radar",
    "",
    `Generated: ${date}`,
    `Trigger: ${context.trigger || "unknown"}`,
    "",
    ...sections,
    "",
    "## Notes",
    "",
    "- This MVP uses public GitHub repository search only.",
    "- Skill is interpreted broadly: Codex skills, other agent skills/rules, MCP servers, reusable workflows, and document/browser automation patterns can all qualify.",
    "- Treat code recommendations as untrusted until reviewed.",
    "- Avoid installing tools that request secrets or broad system permissions without inspection.",
  ].join("\n");
}

function renderChannel(channel, items) {
  const lines = [`## ${channel.title}`, ""];

  if (items.length === 0) {
    lines.push("No items found this run.", "");
    return lines.join("\n");
  }

  items.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${item.title}`);
    lines.push("");
    lines.push(`- Source: ${item.source}`);
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Link: ${item.url}`);
    lines.push(`- Stars: ${item.stars}`);
    lines.push(`- Language: ${item.language}`);
    lines.push(`- Updated: ${item.updatedAt}`);
    lines.push(`- Why it may be useful: ${item.description}`);
    lines.push(`- Fit: ${item.fit}`);
    lines.push(`- Adaptation note: ${item.adaptation}`);
    lines.push("- Caveat: Review the repository, permissions, and install steps before use.");
    lines.push("");
  });

  return lines.join("\n");
}

function renderSkippedReport(reason, nextRunAt) {
  return ["# Personal Radar", "", `Skipped: ${reason}`, nextRunAt ? `Next eligible run: ${nextRunAt}` : null].filter(Boolean).join("\n");
}

function renderTestReport() {
  return [
    "# Personal Radar Test",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "PushPlus is connected successfully.",
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
    const generatedAt = payload.generatedAt || payload.generated_at || new Date().toISOString();
    return {
      title,
      content: normalizeReportContent(title, content),
      category: normalizeSegment(payload.category || payload.channel || DEFAULT_CATEGORY),
      visibility: payload.visibility === "public" ? "public" : "private",
      generatedAt: normalizeIsoDate(generatedAt),
      sourceRunId: payload.sourceRunId || payload.source_run_id || null,
    };
  }

  const text = await request.text();
  if (!text.trim()) {
    throw new Error("Empty report content");
  }
  return {
    title: extractMarkdownTitle(text) || "Skill Radar Deep Dive",
    content: text,
    category: DEFAULT_CATEGORY,
    visibility: "private",
    generatedAt: new Date().toISOString(),
    sourceRunId: null,
  };
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

async function storeReport(env, report) {
  if (!env.RADAR_STATE) {
    return { duplicate: false, report: reportMeta(report) };
  }

  const meta = reportMeta(report);
  const reportKey = reportStorageKey(meta.category, meta.date);

  if (meta.sourceRunId) {
    const runKey = sourceRunStorageKey(meta.sourceRunId);
    const previousRun = await env.RADAR_STATE.get(runKey, "json");
    if (previousRun) {
      return { duplicate: true, reason: "sourceRunId", report: previousRun };
    }
  }

  const existing = await env.RADAR_STATE.get(reportKey, "json");
  if (existing) {
    return { duplicate: true, reason: "category-date", report: existing.meta || meta };
  }

  const stored = {
    version: 1,
    meta,
    content: report.content,
  };
  await env.RADAR_STATE.put(reportKey, JSON.stringify(stored));
  await updateReportIndex(env, meta);
  await env.RADAR_STATE.put(latestStorageKey(meta.category, meta.visibility), JSON.stringify(meta));

  if (meta.sourceRunId) {
    await env.RADAR_STATE.put(sourceRunStorageKey(meta.sourceRunId), JSON.stringify(meta));
  }

  return { duplicate: false, report: meta };
}

function reportMeta(report) {
  const generatedAt = normalizeIsoDate(report.generatedAt);
  return {
    title: report.title,
    category: normalizeSegment(report.category || DEFAULT_CATEGORY),
    visibility: report.visibility === "public" ? "public" : "private",
    generatedAt,
    date: generatedAt.slice(0, 10),
    sourceRunId: report.sourceRunId || null,
  };
}

async function updateReportIndex(env, meta) {
  const key = reportIndexStorageKey(meta.category);
  const existing = (await env.RADAR_STATE.get(key, "json")) || [];
  const next = [meta, ...existing.filter((item) => item.date !== meta.date || item.category !== meta.category)].slice(0, REPORT_INDEX_LIMIT);
  await env.RADAR_STATE.put(key, JSON.stringify(next));
}

async function renderHome(env, request) {
  const category = normalizeSegment(new URL(request.url).searchParams.get("category") || DEFAULT_CATEGORY);
  const meta = env.RADAR_STATE ? await env.RADAR_STATE.get(latestStorageKey(category, "public"), "json") : null;
  if (!meta) {
    return htmlResponse(renderPage("Personal Radar", emptyStateHtml("No public reports yet.", "Run the Codex automation and forward a public report to publish the first page.")));
  }
  return renderStoredReport(env, meta.category, meta.date, request);
}

async function renderReportsIndex(env, request) {
  const category = normalizeSegment(new URL(request.url).searchParams.get("category") || DEFAULT_CATEGORY);
  const reports = env.RADAR_STATE ? ((await env.RADAR_STATE.get(reportIndexStorageKey(category), "json")) || []) : [];
  const publicReports = reports.filter((report) => report.visibility === "public");
  const items = publicReports.map((report) => {
    const href = `/reports/${encodeURIComponent(report.category)}/${encodeURIComponent(report.date)}`;
    return `<li><a href="${href}">${escapeHtml(report.title)}</a><span>${escapeHtml(report.date)}</span></li>`;
  }).join("");
  const body = [
    '<section class="page-head"><p>Archive</p><h1>Personal Radar Reports</h1><a href="/">Latest</a></section>',
    items ? `<ol class="report-list">${items}</ol>` : emptyStateHtml("No public reports yet.", "Only reports ingested with visibility=public are listed here."),
  ].join("\n");
  return htmlResponse(renderPage("Personal Radar Reports", body));
}

async function renderStoredReport(env, category, date, request) {
  const normalizedCategory = normalizeSegment(category);
  const normalizedDate = normalizeDateSegment(date);
  const stored = env.RADAR_STATE ? await env.RADAR_STATE.get(reportStorageKey(normalizedCategory, normalizedDate), "json") : null;
  if (!stored || stored.meta?.visibility !== "public") {
    return htmlResponse(renderPage("Report not found", emptyStateHtml("Report not found.", "The report may be private or unavailable.")), 404);
  }

  const body = [
    `<section class="page-head"><p>${escapeHtml(stored.meta.category)} · ${escapeHtml(stored.meta.date)}</p><h1>${escapeHtml(stored.meta.title)}</h1><a href="/reports">Archive</a></section>`,
    `<article class="markdown">${renderMarkdown(stored.content)}</article>`,
  ].join("\n");
  return htmlResponse(renderPage(stored.meta.title, body));
}

function renderPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #172018; --muted: #667064; --line: #d9ded7; --paper: #f7f8f4; --surface: #ffffff; --accent: #0b6b59; --accent-2: #994d1f; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); line-height: 1.6; }
    a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 56px; }
    .page-head { border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 20px; display: grid; gap: 8px; }
    .page-head p { color: var(--accent-2); font-size: 13px; font-weight: 700; margin: 0; text-transform: uppercase; }
    .page-head h1 { font-size: clamp(30px, 4vw, 48px); line-height: 1.08; margin: 0; letter-spacing: 0; }
    .page-head a { justify-self: start; font-weight: 650; }
    .markdown { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: clamp(18px, 3vw, 34px); }
    .markdown h1:first-child { display: none; }
    .markdown h2 { border-top: 1px solid var(--line); padding-top: 22px; margin-top: 28px; }
    .markdown h2:first-child, .markdown h3:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
    .markdown h2, .markdown h3 { line-height: 1.25; letter-spacing: 0; }
    .markdown ul { padding-left: 22px; }
    .markdown li { margin: 5px 0; }
    .markdown code { background: #edf1eb; border-radius: 5px; padding: 1px 5px; }
    .report-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .report-list li { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
    .report-list span, .empty p { color: var(--muted); }
    .empty { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 24px; }
    .empty h2 { margin: 0 0 8px; }
    .empty p { margin: 0; }
    @media (max-width: 640px) { main { width: min(100% - 24px, 920px); padding-top: 24px; } .report-list li { display: grid; } }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inList = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInline(listItem[1])}</li>`);
      continue;
    }
    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  return html.join("\n");
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
}

function emptyStateHtml(title, message) {
  return `<section class="empty"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></section>`;
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function reportStorageKey(category, date) {
  return `report:${normalizeSegment(category)}:${normalizeDateSegment(date)}`;
}

function latestStorageKey(category, visibility) {
  return `latest:${normalizeSegment(category)}:${visibility === "public" ? "public" : "private"}`;
}

function reportIndexStorageKey(category) {
  return `reports:index:${normalizeSegment(category)}`;
}

function sourceRunStorageKey(sourceRunId) {
  return `source-run:${sourceRunId}`;
}

function normalizeReportContent(title, content) {
  const trimmed = content.trim();
  if (trimmed.startsWith("# ")) return trimmed;
  return `# ${title}\n\n${trimmed}`;
}

function normalizeSegment(value) {
  return String(value || DEFAULT_CATEGORY).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || DEFAULT_CATEGORY;
}

function normalizeDateSegment(value) {
  const text = String(value || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return new Date().toISOString().slice(0, 10);
}

function normalizeIsoDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function extractMarkdownTitle(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
