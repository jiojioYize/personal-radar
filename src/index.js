import {
  enrichStructuredReport,
  validateStructuredSemantics,
} from "./report-structure.js";
import { validateCuratedReport } from "./curated-report.js";
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  Bot,
  Box,
  Braces,
  ChartNoAxesCombined,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  CloudUpload,
  ClipboardCheck,
  ClipboardCopy,
  Database,
  ExternalLink,
  FileText,
  Globe2,
  History,
  Presentation,
  Radar,
  Search,
  ShieldCheck,
  Smartphone,
  Star,
  TestTube,
  TriangleAlert,
} from "lucide";

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
        const sameSourceRun = Boolean(
          report.sourceRunId
          && stored.report?.sourceRunId
          && report.sourceRunId === stored.report.sourceRunId
        );
        if (sameSourceRun) {
          try {
            const delivery = await deliverReport(env, report, url.origin, { retry: true });
            return Response.json({
              ok: true,
              stored: false,
              pushed: delivery.pushed,
              duplicate: true,
              reason: stored.reason,
              deliveryStatus: delivery.status,
              deliveryRetried: delivery.retried,
              alreadyDelivered: delivery.alreadyDelivered,
              report: stored.report,
            });
          } catch (error) {
            return Response.json({
              ok: false,
              stored: false,
              pushed: false,
              duplicate: true,
              reason: stored.reason,
              deliveryStatus: "failed",
              error: safeDeliveryError(error),
              report: stored.report,
            }, { status: 502 });
          }
        }
        return Response.json({
          ok: true,
          stored: false,
          pushed: false,
          duplicate: true,
          reason: stored.reason,
          deliveryStatus: "not_retried",
          report: stored.report,
        });
      }

      try {
        const delivery = await deliverReport(env, report, url.origin, { initial: true });
        return Response.json({
          ok: true,
          stored: true,
          pushed: delivery.pushed,
          deliveryStatus: delivery.status,
          report: stored.report,
        });
      } catch (error) {
        return Response.json({
          ok: false,
          stored: true,
          pushed: false,
          deliveryStatus: "failed",
          error: safeDeliveryError(error),
          report: stored.report,
        }, { status: 502 });
      }
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
    const structured = payload.structuredReport
      ? normalizeIngestedStructuredReport(payload.structuredReport)
      : null;
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
      structured,
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

function normalizeIngestedStructuredReport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("structuredReport must be an object");
  }
  const schemaVersion = Number(input.schemaVersion);
  if (![2, 3].includes(schemaVersion)) {
    throw new Error("Unsupported structuredReport schemaVersion");
  }
  if (input.channel !== DEFAULT_CATEGORY) {
    throw new Error("structuredReport channel must be skill-radar");
  }

  const report = schemaVersion === 2
    ? enrichStructuredReport(input, { preservePreference: true })
    : structuredClone(input);
  const errors = schemaVersion === 2
    ? validateStructuredSemantics(report)
    : validateCuratedReport(report, { allowLegacyReaderContract: true });
  const requiredLocalized = [report.summary, report.conclusion];
  if (requiredLocalized.some((value) => !value?.zh?.trim() || !value?.en?.trim())) {
    errors.push("structuredReport requires bilingual summary and conclusion");
  }

  for (const [index, item] of report.items.entries()) {
    for (const language of ["zh", "en"]) {
      const display = item.display?.[language];
      for (const field of ["oneLiner", "whyNow", "bestFor", "action", "primaryCaution", "problem", "usability", "adaptation", "trust"]) {
        if (!String(display?.[field] || "").trim()) {
          errors.push(`items[${index}].display.${language}.${field} is required`);
        }
      }
    }
    if (!isHttpsUrl(item.discovery?.url)) {
      errors.push(`items[${index}].discovery.url must use HTTPS`);
    }
    if (containsRawHtml(item)) {
      errors.push(`items[${index}] contains raw HTML`);
    }
  }

  if (containsRawHtml(report.summary) || containsRawHtml(report.conclusion)) {
    errors.push("structuredReport summary and conclusion must not contain raw HTML");
  }
  if (schemaVersion === 3 && containsRawHtml(report.decisions)) {
    errors.push("structuredReport decisions must not contain raw HTML");
  }
  if (errors.length) {
    throw new Error(`Invalid structuredReport: ${errors.join("; ")}`);
  }
  return report;
}

async function pushReport(env, report, origin) {
  if (env.PUSHPLUS_TOKEN) {
    await sendPushPlus(env, report, origin);
    return true;
  }

  // No push adapter configured. The report remains available in KV and on the public site.
  return false;
}

async function deliverReport(env, report, origin, { initial = false, retry = false } = {}) {
  if (!env.RADAR_STATE) {
    const pushed = await pushReport(env, report, origin);
    return {
      pushed,
      status: pushed ? "succeeded" : "not_configured",
      retried: retry && pushed,
      alreadyDelivered: false,
    };
  }

  const key = deliveryStorageKey(report);
  const previous = await getJsonFromKV(env.RADAR_STATE, key);
  if (["accepted", "succeeded"].includes(previous?.status)) {
    return { pushed: false, status: "accepted", retried: false, alreadyDelivered: true };
  }
  if (previous?.status === "not_configured") {
    return { pushed: false, status: "not_configured", retried: false, alreadyDelivered: false };
  }
  if (!initial && !previous) {
    // Reports delivered before the ledger existed have unknown push state. Re-pushing
    // them would create a notification duplicate, so only explicit failed attempts retry.
    return { pushed: false, status: "legacy_unknown", retried: false, alreadyDelivered: false };
  }
  if (retry && previous?.status === "attempting") {
    throw new Error("PushPlus delivery is already in progress");
  }
  if (retry && previous?.status !== "failed") {
    return { pushed: false, status: previous?.status || "not_retried", retried: false, alreadyDelivered: false };
  }

  const attempt = Number(previous?.attempts || 0) + 1;
  const attemptedAt = new Date().toISOString();
  await env.RADAR_STATE.put(key, JSON.stringify({
    version: 1,
    status: "attempting",
    attempts: attempt,
    attemptedAt,
    sourceRunId: report.sourceRunId || null,
    category: report.category,
    reportDate: report.structured?.reportDate || null,
  }));

  try {
    const pushed = await pushReport(env, report, origin);
    const status = pushed ? "accepted" : "not_configured";
    await env.RADAR_STATE.put(key, JSON.stringify({
      version: 1,
      status,
      attempts: attempt,
      attemptedAt,
      completedAt: new Date().toISOString(),
      sourceRunId: report.sourceRunId || null,
      category: report.category,
      reportDate: report.structured?.reportDate || null,
    }));
    return { pushed, status, retried: retry && pushed, alreadyDelivered: false };
  } catch (error) {
    await env.RADAR_STATE.put(key, JSON.stringify({
      version: 1,
      status: "failed",
      attempts: attempt,
      attemptedAt,
      failedAt: new Date().toISOString(),
      lastError: safeDeliveryError(error),
      sourceRunId: report.sourceRunId || null,
      category: report.category,
      reportDate: report.structured?.reportDate || null,
    }));
    throw error;
  }
}

function safeDeliveryError(error) {
  return String(error?.message || "Push delivery failed").slice(0, 500);
}

export function buildPushMessage(report, origin, template) {
  const structured = report.structured;
  if (!structured) {
    const markdown = getPushContent(report);
    return {
      title: "Personal Radar",
      content: markdown.length > 18000 ? `${markdown.slice(0, 17600)}\n\n...truncated` : markdown,
    };
  }

  const reportUrl = `${origin}/reports/${encodeURIComponent(report.category)}/${encodeURIComponent(structured.reportDate)}?lang=zh`;
  const count = structured.items.length;
  const baseTitle = structured.status === "no_update"
    ? "Skill Radar 今日无重要更新"
    : `Skill Radar 今日精选（${count}项）`;
  const title = report.category.endsWith("-preview") ? `[测试] ${baseTitle}` : baseTitle;

  return {
    title,
    content: template === "html"
      ? renderPushHtml(structured, reportUrl)
      : renderPushMarkdown(structured, reportUrl),
  };
}

function renderPushHtml(report, reportUrl) {
  const summary = escapeHtml(report.summary.zh);
  if (report.status === "no_update") {
    return [
      '<div style="font-family:Arial,Microsoft YaHei,sans-serif;background:#0f1316;color:#f4f6f5;line-height:1.58;padding:16px 12px">',
      '<section style="padding:4px 2px 18px;border-bottom:1px solid #2a3135">',
      '<div style="font-size:12px;font-weight:700;color:#66d9e8;letter-spacing:2px">PERSONAL RADAR</div>',
      '<h2 style="margin:8px 0 5px;font-size:26px;color:#f4f6f5">今日信号</h2>',
      '<p style="margin:0;color:#aeb7b3">今天没有需要你立刻关注的重要更新。</p>',
      "</section>",
      `<section style="background:#171d21;border-left:3px solid #a8e653;padding:11px 12px;margin:12px 0"><p style="margin:0;color:#c9d0cd;font-size:14px">${summary}</p><p style="margin:6px 0 0;color:#89948f;font-size:12px">${escapeHtml(report.conclusion.zh)}</p></section>`,
      `<p style="margin:14px 0 0"><a href="${escapeHtml(reportUrl)}" style="display:block;border:1px solid #66d9e8;color:#66d9e8;text-align:center;text-decoration:none;font-weight:700;padding:11px 14px">查看网站归档</a></p>`,
      "</div>",
    ].join("");
  }

  const cards = report.items.map((item) => {
    const display = item.display.zh;
    return [
      '<section style="background:#171d21;border-top:1px solid #2a3135;border-left:3px solid #a8e653;padding:13px 12px;margin:0">',
      `<h3 style="margin:0 0 6px;font-size:17px;line-height:1.3;color:#f4f6f5;overflow-wrap:anywhere">${escapeHtml(item.title)}</h3>`,
      `<p style="margin:0;color:#c9d0cd;font-size:14px">${escapeHtml(display.oneLiner)}</p>`,
      `<p style="margin:8px 0 0;color:#aeb7b3;font-size:13px"><strong style="color:#66d9e8">值得点开，如果：</strong>${escapeHtml(display.bestFor)}</p>`,
      "</section>",
    ].join("");
  }).join("");

  return [
    '<div style="font-family:Arial,Microsoft YaHei,sans-serif;background:#0f1316;color:#f4f6f5;line-height:1.58;padding:16px 12px">',
    '<section style="padding:3px 2px 14px">',
    '<div style="font-size:12px;font-weight:700;color:#66d9e8;letter-spacing:2px">PERSONAL RADAR</div>',
    '<h2 style="margin:8px 0 5px;font-size:26px;color:#f4f6f5">今日信号</h2>',
    `<p style="margin:0;color:#aeb7b3;font-size:14px">已为你整理 <strong style="color:#a8e653;font-size:17px">${report.items.length}</strong> 个值得继续探索的技能</p>`,
    "</section>",
    `<section style="background:#11171a;border-top:1px solid #2a3135;border-bottom:1px solid #2a3135;padding:10px 12px;margin:0"><p style="margin:0;color:#aeb7b3;font-size:13px"><strong style="color:#66d9e8">今日摘要：</strong>${summary}</p></section>`,
    cards,
    `<p style="margin:13px 0 0"><a href="${escapeHtml(reportUrl)}" style="display:block;border:1px solid #66d9e8;color:#66d9e8;text-align:center;text-decoration:none;font-weight:700;padding:10px 12px">查看完整分析</a></p>`,
    "</div>",
  ].join("");
}

function renderPushMarkdown(report, reportUrl) {
  const lines = [
    report.status === "no_update" ? "## 今日无重要更新" : `## 今日精选 ${report.items.length} 项`,
    "",
    truncateText(report.summary.zh, 160),
  ];

  for (const item of report.items) {
    const display = item.display.zh;
    const heading = report.schemaVersion >= 3 || !item.recommendation
      ? `### ${item.title}`
      : `### ${item.title} · ${item.recommendation}`;
    lines.push("", heading, display.oneLiner, `- 值得关注：${display.bestFor}`);
  }
  lines.push("", `[查看完整报告](${reportUrl})`);
  return lines.join("\n");
}

async function sendPushPlus(env, report, origin) {
  const template = env.PUSHPLUS_TEMPLATE === "html" ? "html" : "markdown";
  const push = buildPushMessage(report, origin, template);
  const response = await fetch("https://www.pushplus.plus/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: env.PUSHPLUS_TOKEN,
      title: push.title,
      content: push.content,
      template,
      channel: env.PUSHPLUS_CHANNEL || "wechat",
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`PushPlus failed with HTTP ${response.status}`);
  }
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error("PushPlus returned an invalid JSON response");
  }
  if (Number(result.code) !== 200) {
    throw new Error(`PushPlus rejected the request with code ${String(result.code ?? "unknown")}`);
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
    version: report.structured ? 2 : 1,
    meta,
    content: normalizeStoredContent(report),
    ...(report.structured ? { structured: report.structured } : {}),
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
    status: report.structured?.status || "published",
    selectedCount: report.structured?.items?.length ?? null,
    schemaVersion: report.structured?.schemaVersion || null,
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
    const empty = language === "en"
      ? ["No public reports yet.", "The latest public report will appear here after it is published."]
      : ["暂时没有公开报告", "下一份公开报告发布后会显示在这里。"];
    return htmlResponse(renderPage("Personal Radar", emptyStateHtml(...empty), language));
  }
  return renderStoredReport(env, meta.category, meta.date, new Request(`${url.origin}/reports/${meta.category}/${meta.date}?lang=${language}`));
}

async function renderReportsIndex(env, request) {
  const url = new URL(request.url);
  const category = normalizeSegment(url.searchParams.get("category") || DEFAULT_CATEGORY);
  const language = normalizeLanguage(url.searchParams.get("lang") || DEFAULT_LANGUAGE);
  const reports = env.RADAR_STATE ? ((await getJsonFromKV(env.RADAR_STATE, reportIndexStorageKey(category))) || []) : [];
  const publicReports = reports.filter((report) => report.visibility === "public");
  const labels = language === "en"
    ? { eyebrow: "Archive", title: "Skill Radar Archive", latest: "Latest report", noUpdate: "No update", emptyTitle: "No public reports yet.", emptyBody: "Published reports will appear here in date order." }
    : { eyebrow: "历史归档", title: "Skill Radar 历史报告", latest: "最新报告", noUpdate: "无重要更新", emptyTitle: "暂时没有公开报告", emptyBody: "已发布报告会按日期显示在这里。" };
  const items = publicReports.map((report) => {
    const href = `/reports/${encodeURIComponent(report.category)}/${encodeURIComponent(report.date)}?lang=${language}`;
    const status = report.status === "no_update" ? `<small class="status-label">${escapeHtml(labels.noUpdate)}</small>` : "";
    const reportTitle = Number(report.schemaVersion) >= 2
      ? (language === "en" ? "Skill Radar Daily Picks" : "Skill Radar 今日精选")
      : report.title;
    return `<li><div><a href="${href}">${escapeHtml(reportTitle)}</a>${status}</div><span>${escapeHtml(formatMetaDate(report, language))}</span></li>`;
  }).join("");
  const body = [
    renderSiteHeader({
      language,
      switchPath: "/reports",
      actionHref: `/?lang=${language}`,
      actionLabel: labels.latest,
      actionShortLabel: language === "en" ? "Latest" : "最新",
      actionIcon: FileText,
    }),
    `<section class="page-head archive-head"><p>${escapeHtml(labels.eyebrow)}</p><h1>${escapeHtml(labels.title)}</h1></section>`,
    items ? `<ol class="report-list">${items}</ol>` : emptyStateHtml(labels.emptyTitle, labels.emptyBody),
  ].join("\n");
  return htmlResponse(renderPage(labels.title, body, language));
}

async function renderStoredReport(env, category, date, request) {
  const url = new URL(request.url);
  const language = normalizeLanguage(url.searchParams.get("lang") || DEFAULT_LANGUAGE);
  const normalizedCategory = normalizeSegment(category);
  const normalizedDate = normalizeDateSegment(date);
  const stored = env.RADAR_STATE ? await getJsonFromKV(env.RADAR_STATE, reportStorageKey(normalizedCategory, normalizedDate)) : null;
  if (!stored || stored.meta?.visibility !== "public") {
    const missing = language === "en"
      ? ["Report not found", "This report is unavailable."]
      : ["未找到报告", "这份报告当前不可用。"];
    return htmlResponse(renderPage(missing[0], emptyStateHtml(...missing), language), 404);
  }

  const content = selectStoredContent(stored, language);
  const switchPath = `/reports/${encodeURIComponent(stored.meta.category)}/${encodeURIComponent(stored.meta.date)}`;
  const isStructured = stored.version >= 2 && stored.structured;
  const pageLabels = language === "en"
    ? { title: "Skill Radar Daily Picks", archive: "Archive" }
    : { title: "Skill Radar 今日精选", archive: "历史归档" };
  const pageTitle = isStructured ? pageLabels.title : stored.meta.title;
  const indexedReports = env.RADAR_STATE
    ? ((await getJsonFromKV(env.RADAR_STATE, reportIndexStorageKey(normalizedCategory))) || [])
    : [];
  const publicReports = [stored.meta, ...indexedReports]
    .filter((report, index, reports) => report.visibility === "public"
      && reports.findIndex((candidate) => candidate.date === report.date) === index)
    .sort((left, right) => right.date.localeCompare(left.date));
  const body = [
    renderSiteHeader({
      language,
      switchPath,
      actionHref: `/reports?lang=${language}`,
      actionLabel: pageLabels.archive,
      actionShortLabel: language === "en" ? "Archive" : "归档",
      actionIcon: History,
      dateNavigation: renderDateNavigation(publicReports, normalizedDate, language),
      pageTitle,
    }),
    isStructured
      ? renderStructuredReport(stored.structured, language)
      : `<article class="markdown">${renderMarkdown(content)}</article>`,
  ].join("\n");
  return htmlResponse(renderPage(pageTitle, body, language));
}

function renderStructuredReport(report, language) {
  const usesReaderContract = Number(report.readerContractVersion || 0) >= 2;
  const labels = language === "en"
    ? {
        whenUseful: "When it helps",
        beforeStart: "Before you start",
        details: "Setup, limits, and deeper analysis",
        whyNow: "Why it matters now",
        problem: "Problem solved",
        usability: "Install and get started",
        adaptation: "Platform adaptation",
        limitations: "Limits and risks",
        trust: "Trust and security",
        source: "Primary source",
        aiHandoff: "Hand off to AI",
        aiIntro: "Copy a bounded task for your AI to evaluate compatibility, propose a plan, and help with installation after you approve it.",
        copyTask: "Copy task",
        copied: "Copied",
        noUpdate: "No important update today",
        overview: "Today's brief",
        what: "What it helps you do",
      }
    : {
        whenUseful: "什么时候值得用",
        beforeStart: "开始前需要",
        details: "安装、限制与深入分析",
        whyNow: "为什么现在值得看",
        problem: "解决什么问题",
        usability: "安装与开始",
        adaptation: "平台适配",
        limitations: "限制与风险",
        trust: "信任与安全",
        source: "官方来源",
        aiHandoff: "交给 AI 处理",
        aiIntro: "复制一份边界清晰的任务，让你的 AI 先评估兼容性并给出计划，得到确认后再协助安装。",
        copyTask: "复制任务",
        copied: "已复制",
        noUpdate: "今日无重要更新",
        overview: "今日导读",
        what: "它能帮你做什么",
      };
  if (!usesReaderContract) {
    Object.assign(labels, language === "en"
      ? {
          whenUseful: "Best for",
          beforeStart: "Start here",
          caution: "Watch for",
          details: "Evidence and adaptation",
          usability: "Usability",
          what: "What it does",
        }
      : {
          whenUseful: "适合你吗",
          beforeStart: "先这样用",
          caution: "需要注意",
          details: "展开证据与适配分析",
          usability: "可用性",
          what: "它能做什么",
        });
  }

  const overview = [
    '<section class="report-overview">',
    '<div class="overview-copy">',
    `<p class="eyebrow overview-label">${renderIcon(Star)}<span>${escapeHtml(report.status === "no_update" ? labels.noUpdate : labels.overview)}</span></p>`,
    `<p class="report-summary">${escapeHtml(report.summary[language])}</p>`,
    "</div>",
    "</section>",
  ].join("");

  if (report.status === "no_update") {
    return [
      '<article class="structured-report">',
      overview,
      "</article>",
    ].join("\n");
  }

  const recommendations = report.items.map((item) => {
    const display = item.display[language];
    const itemId = `recommendation-${item.id || item.rank}`;
    const aiTaskId = `ai-task-${item.id || item.rank}-${language}`;
    const quickFacts = usesReaderContract
      ? [
          `<div><dt>${renderIcon(Box)}<span>${labels.what}</span></dt><dd>${escapeHtml(display.oneLiner)}</dd></div>`,
          `<div><dt>${renderIcon(CircleHelp)}<span>${labels.whenUseful}</span></dt><dd>${escapeHtml(display.bestFor)}</dd></div>`,
          `<div><dt>${renderIcon(ClipboardCheck)}<span>${labels.beforeStart}</span></dt><dd>${escapeHtml(display.action)}</dd></div>`,
        ]
      : [
          `<div><dt>${renderIcon(Box)}<span>${labels.what}</span></dt><dd>${escapeHtml(display.oneLiner)}</dd></div>`,
          `<div><dt>${renderIcon(CircleHelp)}<span>${labels.whenUseful}</span></dt><dd>${escapeHtml(display.bestFor)}</dd></div>`,
          `<div><dt>${renderIcon(ClipboardCheck)}<span>${labels.beforeStart}</span></dt><dd>${escapeHtml(display.action)}</dd></div>`,
          `<div class="caution"><dt>${renderIcon(TriangleAlert)}<span>${labels.caution}</span></dt><dd>${escapeHtml(display.primaryCaution)}</dd></div>`,
        ];
    const detailBlocks = [
      detailBlock(labels.whyNow, display.whyNow),
      detailBlock(labels.problem, display.problem),
      detailBlock(labels.usability, display.usability),
      detailBlock(labels.adaptation, display.adaptation),
      ...(usesReaderContract ? [detailBlock(labels.limitations, display.primaryCaution)] : []),
      detailBlock(labels.trust, display.trust),
      ...(usesReaderContract ? [renderAiHandoff(item, display, language, labels, aiTaskId)] : []),
    ];
    return [
      `<details class="recommendation" id="${escapeHtml(itemId)}">`,
      '<summary class="recommendation-summary">',
      `<span class="recommendation-icon" aria-hidden="true">${renderCategoryIcon(item.category)}</span>`,
      '<span class="recommendation-copy">',
      `<span class="recommendation-title">${escapeHtml(item.title)}</span>`,
      `<span class="one-liner">${escapeHtml(display.oneLiner)}</span>`,
      "</span>",
      `<span class="topic-label"><span class="topic-dot" aria-hidden="true"></span><span>${escapeHtml(formatCategoryLabel(item.category, language))}</span></span>`,
      `<span class="disclosure-icon" aria-hidden="true">${renderIcon(ChevronDown)}</span>`,
      "</summary>",
      '<div class="recommendation-body">',
      `<dl class="quick-facts${usesReaderContract ? "" : " legacy"}">`,
      ...quickFacts,
      "</dl>",
      '<div class="recommendation-actions">',
      `<p class="source-link">${renderIcon(Globe2)}<span>${escapeHtml(labels.source)}</span><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)} ${renderIcon(ExternalLink)}</a></p>`,
      '<details class="evidence-details">',
      `<summary>${renderIcon(ChartNoAxesCombined)}<span>${escapeHtml(labels.details)}</span>${renderIcon(ChevronDown)}</summary>`,
      '<div class="detail-grid">',
      ...detailBlocks,
      "</div>",
      "</details>",
      "</div>",
      "</div>",
      "</details>",
    ].join("");
  }).join("");

  return [
    '<article class="structured-report">',
    overview,
    `<div class="recommendations">${recommendations}</div>`,
    "</article>",
  ].join("\n");
}

function detailBlock(title, value) {
  return `<section><h3>${escapeHtml(title)}</h3><p>${escapeHtml(value)}</p></section>`;
}

function renderAiHandoff(item, display, language, labels, taskId) {
  const prompt = buildAiHandoffPrompt(item, display, language);
  return [
    '<section class="ai-handoff">',
    '<div class="ai-handoff-head">',
    `<div><h3>${renderIcon(Bot)}<span>${escapeHtml(labels.aiHandoff)}</span></h3><p>${escapeHtml(labels.aiIntro)}</p></div>`,
    `<button class="copy-ai-task" type="button" data-copy-target="${escapeHtml(taskId)}" data-copy-label="${escapeHtml(labels.copyTask)}" data-copied-label="${escapeHtml(labels.copied)}">${renderIcon(ClipboardCopy)}<span>${escapeHtml(labels.copyTask)}</span></button>`,
    "</div>",
    `<pre id="${escapeHtml(taskId)}">${escapeHtml(prompt)}</pre>`,
    "</section>",
  ].join("");
}

function buildAiHandoffPrompt(item, display, language) {
  if (language === "en") {
    return [
      `Evaluate and help me adopt the skill "${item.title}".`,
      `Primary source: ${item.sourceUrl}`,
      "",
      `What it helps with: ${display.oneLiner}`,
      `When it helps: ${display.bestFor}`,
      `Before starting: ${display.action}`,
      `Documented setup: ${display.usability}`,
      `Platform adaptation: ${display.adaptation}`,
      `Known limitation: ${display.primaryCaution}`,
      `Trust boundary: ${display.trust}`,
      "",
      "1. Read the primary source and distinguish documented facts from missing information.",
      "2. Inspect my current agent and environment for compatibility, dependencies, credentials, permissions, and file changes.",
      "3. Explain whether this skill is worthwhile for my stated task and list any safer alternatives.",
      "4. Propose an installation and configuration plan first. Do not modify files or install anything until I approve the plan.",
      "5. After approval, use the primary-source method, make the smallest necessary changes, and never print or commit secrets.",
      "6. Run a minimal functional check, report what changed, and provide removal or rollback steps.",
    ].join("\n");
  }
  return [
    `请评估并协助我采用 skill「${item.title}」。`,
    `官方来源：${item.sourceUrl}`,
    "",
    `它能提供的帮助：${display.oneLiner}`,
    `适用场景：${display.bestFor}`,
    `开始前需要：${display.action}`,
    `已有安装说明：${display.usability}`,
    `平台适配：${display.adaptation}`,
    `已知限制：${display.primaryCaution}`,
    `信任边界：${display.trust}`,
    "",
    "1. 阅读官方来源，区分已经有文档支持的事实和缺失信息。",
    "2. 检查我当前使用的 Agent 和环境是否兼容，包括依赖、账号、凭据、权限及将修改的文件。",
    "3. 结合我的实际任务说明是否值得采用，并列出更简单或更安全的替代方案。",
    "4. 先给出安装和配置计划；在我确认前，不要修改文件或执行安装。",
    "5. 得到确认后，只采用官方来源说明的方法并保持最小改动，不要打印或提交任何密钥。",
    "6. 完成后运行最小功能验证，说明具体改动，并提供移除或回滚方法。",
  ].join("\n");
}

function renderIcon(iconNode, className = "icon") {
  const children = iconNode.map(([tag, attributes]) => {
    const serialized = Object.entries(attributes)
      .map(([name, value]) => `${name}="${escapeHtml(String(value))}"`)
      .join(" ");
    return `<${tag} ${serialized}></${tag}>`;
  }).join("");
  return `<svg class="${escapeHtml(className)}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

function renderCategoryIcon(category) {
  const icons = {
    "coding workflow": Braces,
    "coding-workflow": Braces,
    "frontend-design": Smartphone,
    "web-performance": Braces,
    "wordpress-performance": Braces,
    "local-ai": Bot,
    "local-model-inference": Bot,
    "requirements-clarification": ClipboardCheck,
    "cloud-platform": CloudUpload,
    "azure-container-platform": CloudUpload,
    "mobile-app-design": Smartphone,
    "software-testing": TestTube,
    "smart-contract-security": ShieldCheck,
    "accessible-data-visualization": Accessibility,
    "scientific-data-retrieval": Search,
    "database-development": Database,
    "cloud-deployment": CloudUpload,
    "presentation-generation": Presentation,
    "video-production": Clapperboard,
  };
  return renderIcon(icons[String(category || "").trim().toLowerCase()] || Box);
}

function formatCategoryLabel(category, language) {
  const value = String(category || "").trim().toLowerCase();
  const labels = {
    "coding workflow": ["编码工作流", "Coding workflow"],
    "coding-workflow": ["编码工作流", "Coding workflow"],
    "frontend-design": ["界面与体验", "Interface and experience"],
    "web-performance": ["网站性能", "Web performance"],
    "wordpress-performance": ["网站性能", "Website performance"],
    "local-ai": ["本地 AI", "Local AI"],
    "local-model-inference": ["本地 AI", "Local AI"],
    "requirements-clarification": ["需求梳理", "Requirements clarification"],
    "cloud-platform": ["云端与容器", "Cloud and containers"],
    "azure-container-platform": ["云端与容器", "Cloud and containers"],
    "content-collaboration": ["内容与协作", "Content and collaboration"],
    "browser-automation": ["浏览器自动化", "Browser automation"],
    "data-analysis": ["数据分析", "Data analysis"],
    "research-knowledge": ["研究与知识", "Research and knowledge"],
    "documentation": ["文档工作流", "Documentation"],
    "skill-authoring": ["Skill 构建", "Skill authoring"],
    "security": ["安全与治理", "Security and governance"],
    "developer-tools": ["开发工具", "Developer tools"],
    "productivity-automation": ["效率与自动化", "Productivity and automation"],
    "mobile-app-design": ["移动产品设计", "Mobile product design"],
    "software-testing": ["测试工程", "Software testing"],
    "smart-contract-security": ["智能合约安全", "Smart contract security"],
    "accessible-data-visualization": ["无障碍可视化", "Accessible visualization"],
    "scientific-data-retrieval": ["科研数据", "Scientific data"],
    "database-development": ["数据与集成", "Data and integration"],
    "cloud-deployment": ["云端部署", "Cloud deployment"],
    "presentation-generation": ["内容与协作", "Content and collaboration"],
    "video-production": ["视频与动效", "Video and motion"],
  };
  const localized = labels[value];
  if (localized) return language === "en" ? localized[1] : localized[0];
  // Categories are machine-readable slugs. Never leak a new raw English slug
  // into the Chinese reader surface before its presentation label is defined.
  if (language === "zh") return "Agent 工作流";
  return value.split(/[-_]+/).filter(Boolean).map((part) =>
    `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
  ).join(" ") || "Agent workflow";
}

function renderPage(title, body, language = "en") {
  return `<!doctype html>
<html lang="${language === "zh" ? "zh-CN" : "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #111713; --muted: #68716c; --line: #dce3df; --paper: #fbfcfb; --surface: #ffffff; --accent: #087b5f; --accent-soft: #f1f8f5; --accent-2: #f05a24; --warm-soft: #fff7f1; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, "SF Pro Display", "Segoe UI", "Microsoft YaHei", sans-serif; background: var(--paper); color: var(--ink); line-height: 1.62; }
    a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    main { width: min(1370px, calc(100% - 56px)); margin: 0 auto; padding: 0 0 64px; }
    .icon { display: block; flex: 0 0 auto; height: 1em; width: 1em; }
    .visually-hidden { clip: rect(0 0 0 0); clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px; }
    .report-page-head { align-items: center; border-bottom: 1px solid var(--line); display: grid; gap: 30px; grid-template-columns: auto minmax(0, 1fr) auto; min-height: 66px; }
    .brand { align-items: center; color: var(--ink); display: inline-flex; font-size: 21px; font-weight: 800; gap: 11px; text-decoration: none; }
    .brand-mark { align-items: center; border: 2px solid #1c9877; border-radius: 50%; color: var(--accent); display: inline-flex; height: 31px; justify-content: center; width: 31px; }
    .brand-mark .icon { height: 20px; width: 20px; }
    .report-page-head .nav-row { justify-content: flex-end; }
    .header-spacer { min-width: 0; }
    .date-navigation { align-items: center; display: flex; gap: 6px; justify-self: start; }
    .date-step { align-items: center; border-radius: 5px; color: var(--muted); display: inline-flex; height: 30px; justify-content: center; text-decoration: none; width: 30px; }
    .date-step:hover { background: #eef3f0; color: var(--accent); }
    .date-step.disabled { color: #b8c0bb; cursor: not-allowed; }
    .date-step .icon { height: 18px; width: 18px; }
    .date-switcher { position: relative; }
    .date-switcher > summary { align-items: center; border: 1px solid transparent; border-radius: 6px; color: #49534d; cursor: pointer; display: flex; font-size: 13px; gap: 8px; list-style: none; padding: 5px 8px; }
    .date-switcher > summary:hover, .date-switcher[open] > summary { background: #f0f4f2; border-color: var(--line); }
    .date-switcher > summary:focus-visible { box-shadow: 0 0 0 3px rgba(8, 123, 95, 0.18); }
    .date-switcher > summary::-webkit-details-marker { display: none; }
    .date-switcher > summary::marker { content: ""; }
    .date-switcher > summary .icon { height: 16px; width: 16px; }
    .date-switcher[open] > summary .icon:last-child { transform: rotate(180deg); }
    .date-menu { background: var(--surface); border: 1px solid var(--line); border-radius: 7px; box-shadow: 0 14px 34px rgba(22, 42, 34, 0.13); display: grid; left: 50%; max-height: 320px; min-width: 210px; overflow-y: auto; padding: 6px; position: absolute; top: calc(100% + 8px); transform: translateX(-50%); z-index: 20; }
    .date-menu a { align-items: center; border-radius: 5px; color: var(--ink); display: flex; font-size: 13px; justify-content: space-between; padding: 7px 9px; text-decoration: none; }
    .date-menu a:hover { background: #f2f6f4; }
    .date-menu a.active { background: var(--accent-soft); color: var(--accent); font-weight: 750; }
    .date-menu .icon { height: 15px; width: 15px; }
    .page-head { border-bottom: 1px solid var(--line); margin-bottom: 28px; padding-bottom: 20px; display: grid; gap: 8px; }
    .archive-head { padding-top: 34px; }
    .page-head p { color: var(--accent-2); font-size: 13px; font-weight: 700; margin: 0; }
    .page-head h1 { font-size: clamp(32px, 4vw, 44px); line-height: 1.08; margin: 0; letter-spacing: 0; }
    .page-head a { justify-self: start; font-weight: 650; }
    .nav-row { align-items: center; display: flex; flex-wrap: wrap; gap: 14px; }
    .site-action { align-items: center; color: #4f5953; display: inline-flex; font-size: 13px; font-weight: 650; gap: 7px; text-decoration: none; }
    .site-action:hover { color: var(--accent); }
    .site-action .icon { height: 17px; width: 17px; }
    .action-label-short { display: none; }
    .language-switch { background: #eef2ef; border: 1px solid #e1e7e3; border-radius: 6px; display: inline-flex; padding: 3px; position: relative; }
    .language-switch::before { background: var(--line); content: ""; height: 22px; left: -8px; position: absolute; top: 50%; transform: translateY(-50%); width: 1px; }
    .language-switch a { border-radius: 4px; color: var(--muted); font-size: 13px; font-weight: 650; padding: 4px 9px; text-decoration: none; }
    .language-switch a.active { background: var(--surface); box-shadow: 0 1px 3px rgba(28, 48, 39, 0.12); color: var(--ink); }
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
    .report-list li > div { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
    .status-label { border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 11px; font-weight: 750; padding: 2px 7px; text-transform: uppercase; }
    .report-list span, .empty p { color: var(--muted); }
    .empty { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 24px; }
    .empty h2 { margin: 0 0 8px; }
    .empty p { margin: 0; }
    .structured-report { display: grid; gap: 28px; padding-top: 38px; }
    .report-overview { border-bottom: 1px solid var(--line); padding: 0 26px 32px; }
    .overview-copy { max-width: 86ch; }
    .report-summary { font-size: 16px; margin: 0; }
    .recommendations { display: grid; gap: 8px; }
    .recommendation { background: var(--surface); border: 1px solid var(--line); border-radius: 7px; overflow: hidden; transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease; }
    .recommendation[open] { background: var(--accent-soft); border-color: #a9c9bc; box-shadow: inset 5px 0 0 var(--accent), 0 8px 28px rgba(23, 59, 48, 0.05); }
    .recommendation-summary { align-items: center; cursor: pointer; display: grid; gap: 22px; grid-template-columns: 50px minmax(0, 1fr) minmax(190px, 240px) 22px; list-style: none; min-height: 82px; padding: 12px 24px 12px 16px; }
    .recommendation-summary::-webkit-details-marker, .evidence-details > summary::-webkit-details-marker { display: none; }
    .recommendation-summary::marker, .evidence-details > summary::marker { content: ""; }
    .recommendation-summary:hover { background: #f5f8f6; }
    .recommendation[open] > .recommendation-summary:hover { background: transparent; }
    .recommendation-icon { align-items: center; background: #f4f7f5; border: 1px solid #e4ebe7; border-radius: 7px; color: var(--ink); display: inline-flex; height: 48px; justify-content: center; width: 48px; }
    .recommendation-icon .icon { height: 27px; width: 27px; }
    .recommendation-copy { display: grid; gap: 3px; min-width: 0; }
    .recommendation-title { color: var(--ink); font-size: 17px; font-weight: 750; line-height: 1.3; overflow-wrap: anywhere; }
    .one-liner { color: var(--muted); font-size: 14px; line-height: 1.48; }
    .topic-label { align-items: center; border-left: 1px solid var(--line); color: #4f5953; display: flex; font-size: 13px; font-weight: 650; gap: 14px; min-height: 28px; padding-left: 24px; }
    .topic-dot { background: var(--accent); border-radius: 50%; flex: 0 0 auto; height: 10px; width: 10px; }
    .disclosure-icon { color: var(--ink); transition: transform 160ms ease; }
    .disclosure-icon .icon { height: 20px; width: 20px; }
    .recommendation[open] > .recommendation-summary .disclosure-icon { transform: rotate(180deg); }
    .recommendation[open] .recommendation-summary { min-height: 106px; padding: 20px 24px 12px 26px; }
    .recommendation[open] .recommendation-icon { background: var(--accent); border-color: var(--accent); color: white; height: 56px; width: 56px; }
    .recommendation[open] .recommendation-icon .icon { height: 31px; width: 31px; }
    .recommendation[open] .recommendation-title { font-size: 26px; }
    .recommendation[open] .one-liner { color: var(--ink); font-size: 15px; }
    .recommendation-body { border-top: 0; padding: 18px 36px 0; }
    .quick-facts { display: grid; gap: 0; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; }
    .quick-facts.legacy { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .quick-facts div { border-left: 1px solid #cbd8d2; display: grid; gap: 10px; padding: 0 28px; }
    .quick-facts div:first-child { border-left: 0; padding-left: 0; }
    .quick-facts div:last-child { padding-right: 0; }
    .quick-facts dt { align-items: center; color: var(--ink); display: flex; font-size: 14px; font-weight: 800; gap: 12px; }
    .quick-facts dt .icon { color: var(--accent); font-size: 24px; }
    .quick-facts .caution dt .icon { color: var(--accent-2); }
    .quick-facts dd { margin: 0; }
    .recommendation-actions { border-top: 1px solid #cfe0d8; margin-top: 26px; padding: 17px 0 20px; position: relative; }
    .source-link { align-items: center; display: flex; flex-wrap: wrap; gap: 10px 18px; margin: 0; min-height: 26px; overflow-wrap: anywhere; padding-right: 348px; }
    .source-link > .icon { font-size: 22px; }
    .source-link span { color: var(--ink); font-weight: 750; }
    .source-link a { align-items: center; display: inline-flex; font-weight: 700; gap: 6px; }
    .source-link a .icon { font-size: 15px; }
    .evidence-details { margin: 0; }
    .evidence-details > summary { align-items: center; color: var(--ink); cursor: pointer; display: grid; font-weight: 750; gap: 10px; grid-template-columns: auto 1fr auto; list-style: none; position: absolute; right: 0; top: 17px; width: 320px; }
    .evidence-details > summary .icon { font-size: 20px; }
    .evidence-details[open] > summary .icon:last-child { transform: rotate(180deg); }
    summary:focus-visible { outline: none; }
    .recommendation-summary:focus-visible .recommendation-icon { box-shadow: 0 0 0 3px rgba(8, 123, 95, 0.18); }
    .evidence-details > summary:focus-visible span { text-decoration: underline; text-decoration-color: #4aa88b; text-decoration-thickness: 2px; text-underline-offset: 4px; }
    a:focus-visible { outline: 3px solid #f0b36b; outline-offset: 3px; }
    .detail-grid { display: grid; gap: 16px 22px; grid-template-columns: repeat(2, minmax(0, 1fr)); padding-top: 24px; width: 100%; }
    .detail-grid h3 { font-size: 13px; margin: 0 0 4px; }
    .detail-grid p { margin: 0; }
    .ai-handoff { background: #f7faf8; border: 1px solid #cbdad3; border-radius: 7px; grid-column: 1 / -1; margin-top: 8px; padding: 18px; }
    .ai-handoff-head { align-items: flex-start; display: flex; gap: 18px; justify-content: space-between; }
    .ai-handoff-head h3 { align-items: center; display: flex; font-size: 15px; gap: 9px; margin: 0 0 5px; }
    .ai-handoff-head h3 .icon { color: var(--accent); height: 20px; width: 20px; }
    .ai-handoff-head p { color: var(--muted); font-size: 13px; max-width: 76ch; }
    .copy-ai-task { align-items: center; background: var(--surface); border: 1px solid #b9c9c1; border-radius: 5px; color: var(--ink); cursor: pointer; display: inline-flex; flex: 0 0 auto; font: inherit; font-size: 13px; font-weight: 700; gap: 7px; padding: 7px 10px; }
    .copy-ai-task:hover { border-color: var(--accent); color: var(--accent); }
    .copy-ai-task:focus-visible { outline: 3px solid #f0b36b; outline-offset: 3px; }
    .copy-ai-task .icon { height: 16px; width: 16px; }
    .ai-handoff pre { background: #172019; border-radius: 6px; color: #eaf4ee; font: 12px/1.65 "Cascadia Code", Consolas, monospace; margin: 14px 0 0; max-height: 260px; overflow: auto; padding: 14px; white-space: pre-wrap; word-break: break-word; }
    .eyebrow { align-items: center; color: var(--accent); display: flex; font-size: 14px; font-weight: 800; gap: 12px; margin: 0 0 14px; }
    .eyebrow .icon { font-size: 25px; }
    @media (max-width: 640px) {
      main { width: min(100% - 24px, 1370px); padding-bottom: 44px; }
      .report-page-head { gap: 10px 12px; grid-template-columns: 1fr auto; padding: 12px 0; }
      .brand { font-size: 18px; gap: 8px; }
      .brand-mark { height: 28px; width: 28px; }
      .report-page-head .nav-row { grid-column: 2; grid-row: 1; gap: 6px; }
      .site-action { gap: 4px; }
      .action-label-full { display: none; }
      .action-label-short { display: inline; }
      .site-action .icon { height: 19px; width: 19px; }
      .language-switch::before { left: -5px; }
      .language-switch a { padding: 4px 7px; }
      .header-spacer { display: none; }
      .date-navigation { grid-column: 1 / -1; grid-row: 2; justify-self: stretch; justify-content: space-between; }
      .date-switcher { flex: 1; }
      .date-switcher > summary { justify-content: center; }
      .date-menu { width: min(280px, calc(100vw - 32px)); }
      .page-head h1 { font-size: 30px; }
      .report-list li { display: grid; }
      .report-overview { padding: 0 4px 24px; }
      .report-summary { font-size: 16px; }
      .recommendation-summary { gap: 6px 14px; grid-template-columns: 42px minmax(0, 1fr) 18px; min-height: 90px; padding: 14px; }
      .recommendation-icon { grid-row: 1 / span 2; height: 42px; width: 42px; }
      .recommendation-icon .icon { height: 24px; width: 24px; }
      .topic-label { border-left: 0; grid-column: 2 / 3; min-height: auto; padding-left: 0; }
      .topic-dot { display: none; }
      .disclosure-icon { grid-column: 3; grid-row: 1 / span 2; }
      .recommendation[open] .recommendation-summary { min-height: 104px; padding: 18px 16px 12px; }
      .recommendation[open] .recommendation-icon { height: 46px; width: 46px; }
      .recommendation[open] .recommendation-title { font-size: 22px; }
      .recommendation-body { padding: 16px 18px 0; }
      .quick-facts { grid-template-columns: 1fr; }
      .quick-facts div, .quick-facts div:first-child { border-left: 0; border-top: 1px solid #cbd8d2; padding: 14px 0; }
      .quick-facts div:first-child { border-top: 0; padding-top: 0; }
      .source-link { padding-right: 0; }
      .evidence-details { margin-top: 18px; }
      .evidence-details > summary { position: static; width: 100%; }
      .detail-grid { grid-template-columns: 1fr; }
      .ai-handoff-head { display: grid; }
      .copy-ai-task { justify-self: start; }
    }
  </style>
</head>
<body>
  <main>${body}</main>
  <script>
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-copy-target]");
      if (!button) return;
      const target = document.getElementById(button.dataset.copyTarget);
      if (!target) return;
      const label = button.querySelector("span");
      try {
        await navigator.clipboard.writeText(target.textContent);
        if (label) label.textContent = button.dataset.copiedLabel;
        window.setTimeout(() => {
          if (label) label.textContent = button.dataset.copyLabel;
        }, 1600);
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  </script>
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

function deliveryStorageKey(report) {
  if (report.sourceRunId) return `delivery:pushplus:source-run:${report.sourceRunId}`;
  const meta = reportMeta(report);
  return `delivery:pushplus:report:${meta.category}:${meta.date}`;
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
  const zhCurrent = language === "zh" ? ' aria-current="page"' : "";
  const enCurrent = language === "en" ? ' aria-current="page"' : "";
  return `<span class="language-switch"><a class="${zhClass}"${zhCurrent} href="${path}?lang=zh">中文</a><a class="${enClass}"${enCurrent} href="${path}?lang=en">English</a></span>`;
}

function renderSiteHeader({ language, switchPath, actionHref, actionLabel, actionShortLabel, actionIcon, dateNavigation = "", pageTitle = "" }) {
  const navigationLabel = language === "en" ? "Site navigation" : "站点导航";
  return [
    '<header class="report-page-head">',
    `<a class="brand" href="/?lang=${language}"><span class="brand-mark">${renderIcon(Radar)}</span><span>Personal Radar</span></a>`,
    dateNavigation || '<span class="header-spacer"></span>',
    `<nav class="nav-row" aria-label="${navigationLabel}"><a class="site-action" href="${escapeHtml(actionHref)}" title="${escapeHtml(actionLabel)}">${renderIcon(actionIcon)}<span class="action-label-full">${escapeHtml(actionLabel)}</span><span class="action-label-short">${escapeHtml(actionShortLabel || actionLabel)}</span></a>${renderLanguageSwitch(language, switchPath)}</nav>`,
    pageTitle ? `<h1 class="visually-hidden">${escapeHtml(pageTitle)}</h1>` : "",
    "</header>",
  ].join("");
}

function renderDateNavigation(reports, currentDate, language) {
  const currentIndex = reports.findIndex((report) => report.date === currentDate);
  const current = reports[currentIndex] || { date: currentDate, generatedAt: currentDate, timeZone: DEFAULT_TIME_ZONE };
  const older = currentIndex >= 0 ? reports[currentIndex + 1] : null;
  const newer = currentIndex > 0 ? reports[currentIndex - 1] : null;
  const olderLabel = language === "en" ? "Previous report" : "上一份报告";
  const newerLabel = language === "en" ? "Next report" : "下一份报告";
  const chooseLabel = language === "en" ? "Choose report date" : "选择报告日期";
  const pathFor = (report) => `/reports/${encodeURIComponent(report.category || DEFAULT_CATEGORY)}/${encodeURIComponent(report.date)}?lang=${language}`;
  const step = (report, label, icon) => report
    ? `<a class="date-step" href="${pathFor(report)}" aria-label="${label}" title="${label}">${renderIcon(icon)}</a>`
    : `<span class="date-step disabled" aria-disabled="true" title="${label}">${renderIcon(icon)}</span>`;
  const options = reports.map((report) => {
    const active = report.date === currentDate ? ' class="active" aria-current="page"' : "";
    return `<a${active} href="${pathFor(report)}"><span>${escapeHtml(report.date)}</span>${report.date === currentDate ? renderIcon(CalendarDays) : ""}</a>`;
  }).join("");
  return [
    '<div class="date-navigation">',
    step(older, olderLabel, ArrowLeft),
    '<details class="date-switcher">',
    `<summary aria-label="${chooseLabel}">${renderIcon(CalendarDays)}<span>${escapeHtml(formatMetaDate(current, language))}</span>${renderIcon(ChevronDown)}</summary>`,
    `<div class="date-menu">${options}</div>`,
    "</details>",
    step(newer, newerLabel, ArrowRight),
    "</div>",
  ].join("");
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

function formatMetaDate(meta, language = "en") {
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
    return `${values.year}-${values.month}-${values.day} · ${values.hour}:${values.minute} ${formatTimeZoneLabel(timeZone, language)}`;
  } catch {
    return meta.date || date.toISOString().slice(0, 10);
  }
}

function formatTimeZoneLabel(timeZone, language = "en") {
  if (timeZone === "Asia/Shanghai") return language === "zh" ? "北京时间" : "Beijing Time";
  return timeZone;
}

function extractMarkdownTitle(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

function containsRawHtml(value) {
  if (typeof value === "string") return HTML_TAG_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsRawHtml);
  if (value && typeof value === "object") return Object.values(value).some(containsRawHtml);
  return false;
}

const HTML_TAG_PATTERN = /<\/?(?:a|abbr|address|article|aside|audio|b|blockquote|body|br|button|canvas|caption|code|col|colgroup|dd|details|dialog|div|dl|dt|em|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|i|iframe|img|input|label|legend|li|link|main|meta|nav|ol|option|p|pre|script|section|select|small|source|span|strong|style|summary|svg|table|tbody|td|textarea|tfoot|th|thead|title|tr|u|ul|video)(?:\s|>|\/)/i;

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

