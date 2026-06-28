const DEFAULT_CATEGORY = "skill-radar";
const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_LANGUAGE = "zh";
const REPORT_INDEX_LIMIT = 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "personal-radar", channels: [DEFAULT_CATEGORY] });
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

    if (url.pathname === "/ingest-report") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const key = request.headers.get("x-radar-ingest-key") || "";
      const auth = getIngestAuth(env, key);
      if (!auth.ok) {
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

      await pushReport(env, getPushContent(report));
      return Response.json({ ok: true, stored: true, pushed: true, report: stored.report });
    }

    if (url.pathname === "/admin/prune-reports") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const key = request.headers.get("x-radar-ingest-key") || "";
      const auth = getIngestAuth(env, key);
      if (!auth.ok) {
        return new Response("Unauthorized", { status: 401 });
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
      }

      try {
        const result = await pruneReports(env, payload);
        return Response.json({ ok: true, ...result });
      } catch (error) {
        return Response.json({ ok: false, error: error.message }, { status: 400 });
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.resolve().then(() => {
        console.log(`Cron trigger ignored at ${new Date(event.scheduledTime || Date.now()).toISOString()}; publishing uses /ingest-report.`);
      }),
    );
  },
};

function getIngestAuth(env, key) {
  if (env.DEEP_REPORT_INGEST_KEY && key === env.DEEP_REPORT_INGEST_KEY) {
    return { ok: true };
  }
  return { ok: false };
}

async function readIngestedReport(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = await request.json();
    const title = payload.title || "Skill Radar Deep Dive";
    const contentEn = payload.contentEn || payload.content_en || payload.englishContent || payload.content || payload.report || "";
    const contentZh = payload.contentZh || payload.content_zh || payload.chineseContent || "";
    if (!contentEn.trim() && !contentZh.trim()) {
      throw new Error("Empty report content");
    }
    const generatedAt = payload.generatedAt || payload.generated_at || new Date().toISOString();
    return {
      title,
      content: normalizeReportContent(title, contentZh || contentEn),
      contentEn: contentEn.trim() ? normalizeReportContent(title, contentEn) : null,
      contentZh: contentZh.trim() ? normalizeReportContent(title, contentZh) : null,
      pushLanguage: normalizeLanguage(payload.pushLanguage || payload.push_language || DEFAULT_LANGUAGE),
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
    contentEn: text,
    contentZh: null,
    pushLanguage: DEFAULT_LANGUAGE,
    category: DEFAULT_CATEGORY,
    visibility: "private",
    generatedAt: new Date().toISOString(),
    sourceRunId: null,
  };
}

async function pushReport(env, report) {
  if (env.PUSHPLUS_TOKEN) {
    await sendPushPlus(env, report);
    return;
  }

  // No push adapter configured. The report remains available in KV and on the public site.
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

async function storeReport(env, report) {
  if (!env.RADAR_STATE) {
    return { duplicate: false, report: reportMeta(report, env) };
  }

  const meta = reportMeta(report, env);
  const reportKey = reportStorageKey(meta.category, meta.date);

  if (meta.sourceRunId) {
    const runKey = sourceRunStorageKey(meta.sourceRunId);
    const previousRun = await getJsonFromKV(env.RADAR_STATE, runKey);
    if (previousRun) {
      return { duplicate: true, reason: "sourceRunId", report: previousRun };
    }
  }

  const existing = await getJsonFromKV(env.RADAR_STATE, reportKey);
  if (existing) {
    return { duplicate: true, reason: "category-date", report: existing.meta || meta };
  }

  const stored = {
    version: 1,
    meta,
    content: normalizeStoredContent(report),
  };
  await env.RADAR_STATE.put(reportKey, JSON.stringify(stored));
  await updateReportIndex(env, meta);
  await env.RADAR_STATE.put(latestStorageKey(meta.category, meta.visibility), JSON.stringify(meta));

  if (meta.sourceRunId) {
    await env.RADAR_STATE.put(sourceRunStorageKey(meta.sourceRunId), JSON.stringify(meta));
  }

  return { duplicate: false, report: meta };
}

function reportMeta(report, env = {}) {
  const generatedAt = normalizeIsoDate(report.generatedAt);
  const timeZone = report.timeZone || env.RADAR_TIME_ZONE || DEFAULT_TIME_ZONE;
  return {
    title: report.title,
    category: normalizeSegment(report.category || DEFAULT_CATEGORY),
    visibility: report.visibility === "public" ? "public" : "private",
    generatedAt,
    date: formatDateInTimeZone(generatedAt, timeZone),
    timeZone,
    sourceRunId: report.sourceRunId || null,
    languages: availableLanguages(report),
  };
}

async function updateReportIndex(env, meta) {
  const key = reportIndexStorageKey(meta.category);
  const existing = (await getJsonFromKV(env.RADAR_STATE, key)) || [];
  const next = [meta, ...existing.filter((item) => item.date !== meta.date || item.category !== meta.category)].slice(0, REPORT_INDEX_LIMIT);
  await env.RADAR_STATE.put(key, JSON.stringify(next));
}

async function pruneReports(env, payload) {
  if (!env.RADAR_STATE) {
    return { deleted: [], remaining: [] };
  }

  const category = normalizeSegment(payload.category || DEFAULT_CATEGORY);
  const dates = Array.isArray(payload.dates) ? payload.dates.map(normalizeDateSegment).filter(Boolean) : [];
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length === 0) {
    throw new Error("No dates provided");
  }

  const indexKey = reportIndexStorageKey(category);
  const existing = (await getJsonFromKV(env.RADAR_STATE, indexKey)) || [];
  const deleted = [];

  for (const date of uniqueDates) {
    await env.RADAR_STATE.delete(reportStorageKey(category, date));
    deleted.push({ category, date });
  }

  const remaining = existing.filter((item) => item.category !== category || !uniqueDates.includes(item.date));
  await env.RADAR_STATE.put(indexKey, JSON.stringify(remaining));

  const publicLatest = remaining.find((item) => item.visibility === "public");
  if (publicLatest) {
    await env.RADAR_STATE.put(latestStorageKey(category, "public"), JSON.stringify(publicLatest));
  }

  const privateLatest = remaining.find((item) => item.visibility !== "public");
  if (privateLatest) {
    await env.RADAR_STATE.put(latestStorageKey(category, "private"), JSON.stringify(privateLatest));
  }

  return { deleted, remaining: remaining.map((item) => ({ category: item.category, date: item.date, visibility: item.visibility })) };
}

async function renderHome(env, request) {
  const url = new URL(request.url);
  const category = normalizeSegment(url.searchParams.get("category") || DEFAULT_CATEGORY);
  const language = normalizeLanguage(url.searchParams.get("lang") || DEFAULT_LANGUAGE);
  const meta = env.RADAR_STATE ? await getJsonFromKV(env.RADAR_STATE, latestStorageKey(category, "public")) : null;
  if (!meta) {
    return htmlResponse(renderPage("Personal Radar", emptyStateHtml("No public reports yet.", "Run the Codex automation and forward a public report to publish the first page.")));
  }
  return renderStoredReport(env, meta.category, meta.date, new Request(`${url.origin}/reports/${meta.category}/${meta.date}?lang=${language}`));
}

async function renderReportsIndex(env, request) {
  const url = new URL(request.url);
  const category = normalizeSegment(url.searchParams.get("category") || DEFAULT_CATEGORY);
  const language = normalizeLanguage(url.searchParams.get("lang") || DEFAULT_LANGUAGE);
  const reports = env.RADAR_STATE ? ((await getJsonFromKV(env.RADAR_STATE, reportIndexStorageKey(category))) || []) : [];
  const publicReports = reports.filter((report) => report.visibility === "public");
  const items = publicReports.map((report) => {
    const href = `/reports/${encodeURIComponent(report.category)}/${encodeURIComponent(report.date)}?lang=${language}`;
    return `<li><a href="${href}">${escapeHtml(report.title)}</a><span>${escapeHtml(formatMetaDate(report))}</span></li>`;
  }).join("");
  const body = [
    `<section class="page-head"><p>Archive</p><h1>Personal Radar Reports</h1><div class="nav-row"><a href="/?lang=${language}">Latest</a>${renderLanguageSwitch(language, "/reports")}</div></section>`,
    items ? `<ol class="report-list">${items}</ol>` : emptyStateHtml("No public reports yet.", "Only reports ingested with visibility=public are listed here."),
  ].join("\n");
  return htmlResponse(renderPage("Personal Radar Reports", body));
}

async function renderStoredReport(env, category, date, request) {
  const url = new URL(request.url);
  const language = normalizeLanguage(url.searchParams.get("lang") || DEFAULT_LANGUAGE);
  const normalizedCategory = normalizeSegment(category);
  const normalizedDate = normalizeDateSegment(date);
  const stored = env.RADAR_STATE ? await getJsonFromKV(env.RADAR_STATE, reportStorageKey(normalizedCategory, normalizedDate)) : null;
  if (!stored || stored.meta?.visibility !== "public") {
    return htmlResponse(renderPage("Report not found", emptyStateHtml("Report not found.", "The report may be private or unavailable.")), 404);
  }

  const content = selectStoredContent(stored, language);
  const switchPath = `/reports/${encodeURIComponent(stored.meta.category)}/${encodeURIComponent(stored.meta.date)}`;
  const body = [
    `<section class="page-head"><p>${escapeHtml(stored.meta.category)} · ${escapeHtml(formatMetaDate(stored.meta))}</p><h1>${escapeHtml(stored.meta.title)}</h1><div class="nav-row"><a href="/reports?lang=${language}">Archive</a>${renderLanguageSwitch(language, switchPath)}</div></section>`,
    `<article class="markdown">${renderMarkdown(content)}</article>`,
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
    .page-head p { color: var(--accent-2); font-size: 13px; font-weight: 700; margin: 0; }
    .page-head h1 { font-size: clamp(30px, 4vw, 48px); line-height: 1.08; margin: 0; letter-spacing: 0; }
    .page-head a { justify-self: start; font-weight: 650; }
    .nav-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
    .language-switch { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); }
    .language-switch a { padding: 5px 10px; text-decoration: none; color: var(--muted); font-size: 13px; font-weight: 700; }
    .language-switch a.active { background: #edf1eb; color: var(--ink); }
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

async function getJsonFromKV(namespace, key) {
  const raw = await namespace.get(key, "text");
  if (!raw) return null;
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
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

function normalizeStoredContent(report) {
  return {
    en: report.contentEn || report.content || null,
    zh: report.contentZh || null,
  };
}

function selectStoredContent(stored, language) {
  if (typeof stored.content === "string") return stripReportBodyMetadata(stored.content);
  const content = stored.content || {};
  const selected = language === "en" ? content.en || content.zh || "" : content.zh || content.en || "";
  return stripReportBodyMetadata(selected);
}

function getPushContent(report) {
  const language = normalizeLanguage(report.pushLanguage || DEFAULT_LANGUAGE);
  const selected = language === "en" ? report.contentEn || report.content || report.contentZh || "" : report.contentZh || report.content || report.contentEn || "";
  return stripReportBodyMetadata(selected);
}

function availableLanguages(report) {
  const languages = [];
  if (report.contentZh) languages.push("zh");
  if (report.contentEn || report.content) languages.push("en");
  return languages.length ? languages : ["en"];
}

function normalizeLanguage(value) {
  return value === "en" ? "en" : "zh";
}

function renderLanguageSwitch(language, path) {
  const zhClass = language === "zh" ? "active" : "";
  const enClass = language === "en" ? "active" : "";
  return `<span class="language-switch"><a class="${zhClass}" href="${path}?lang=zh">中文</a><a class="${enClass}" href="${path}?lang=en">English</a></span>`;
}

function normalizeReportContent(title, content) {
  const trimmed = content.trim();
  if (trimmed.startsWith("# ")) return trimmed;
  return `# ${title}\n\n${trimmed}`;
}

function stripReportBodyMetadata(content) {
  return String(content || "")
    .replace(/^\s*(生成时间：|生成时间:)\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*北京时间\s*$/gim, "")
    .replace(/^\s*Generated:\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*Beijing Time\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function formatDateInTimeZone(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return formatDateInTimeZone(new Date().toISOString(), timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatMetaDate(meta) {
  const timeZone = meta.timeZone || DEFAULT_TIME_ZONE;
  const value = meta.generatedAt || meta.date;
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return meta.date || "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} ${formatTimeZoneLabel(timeZone)}`;
  } catch {
    return meta.date || date.toISOString().slice(0, 10);
  }
}

function formatTimeZoneLabel(timeZone) {
  if (timeZone === "Asia/Shanghai") return "Beijing Time";
  return timeZone;
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

