import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  canonicalizeUrl,
  enrichStructuredReport,
  stableSourceId,
  validateStructuredSemantics,
} from "../../src/report-structure.js";

const ROOT = process.env.PERSONAL_RADAR_ROOT
  ? path.resolve(process.env.PERSONAL_RADAR_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTBOX_DIR = path.join(ROOT, "reports", "outbox");
const STATE_DIR = path.join(ROOT, "reports", "state");
const FEEDBACK_DIR = path.join(ROOT, "reports", "feedback");
const INBOX_DIR = path.join(ROOT, "reports", "inbox");
const QUALITY_DIR = path.join(ROOT, "reports", "quality");
const SHADOW_DIR = path.join(ROOT, "reports", "shadow");
const SHADOW_OUTBOX_DIR = path.join(SHADOW_DIR, "outbox");
const SHADOW_STATE_DIR = path.join(SHADOW_DIR, "state");
const HISTORY_PATH = path.join(STATE_DIR, "skill-radar-history.json");
const CONTEXT_PATH = path.join(STATE_DIR, "skill-radar-context.json");
const FEEDBACK_PATH = path.join(FEEDBACK_DIR, "skill-radar.json");
const SOCIAL_PATH = path.join(INBOX_DIR, "social-candidates.json");
const SUMMARY_PATH = path.join(QUALITY_DIR, "skill-radar-summary.md");
const SCHEMA_PATH = path.join(ROOT, "schemas", "skill-radar-report.schema.json");

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";

try {
  if (command === "prepare") await prepareContext(args);
  else if (command === "finalize") await finalizeReport(args);
  else if (command === "feedback") await recordFeedback(args);
  else if (command === "social-add") await addSocialCandidate(args);
  else if (command === "summary") await writeQualitySummary(args);
  else printHelp();
} catch (error) {
  console.error(`quality tool failed: ${error.message}`);
  process.exitCode = 1;
}

async function prepareContext(options) {
  const paths = runtimePaths(options);
  await ensureLocalFiles(paths);
  const asOf = normalizeDate(options.date || beijingDate());
  const history = await buildHistory(asOf, null, { includeShadow: paths.shadow });
  const feedback = await readJson(FEEDBACK_PATH, { version: 1, entries: [] });
  const inbox = await expireDeferredCandidates(await readJson(SOCIAL_PATH, emptyInbox()), asOf);
  if (!paths.shadow) await writeJson(SOCIAL_PATH, inbox);

  const context = {
    version: 1,
    channel: "skill-radar",
    asOf,
    historyWindowDays: 30,
    recentSources: history.sources,
    preferenceSummary: summarizePreferences(feedback.entries),
    pendingSocialCandidates: inbox.candidates.filter((candidate) =>
      ["pending", "verified", "deferred"].includes(candidate.status),
    ),
  };

  await writeJson(paths.historyPath, history);
  await writeJson(paths.contextPath, context);
  console.log(`Prepared${paths.shadow ? " shadow" : ""} quality context: ${relative(paths.contextPath)}`);
  console.log(`Recent sources: ${history.sources.length}; pending social candidates: ${context.pendingSocialCandidates.length}`);
}

async function finalizeReport(options) {
  const paths = runtimePaths(options);
  const inputPath = resolveInput(options.input);

  await ensureLocalFiles(paths);
  const raw = await readJsonRequired(inputPath);
  const feedback = await readJson(FEEDBACK_PATH, { version: 1, entries: [] });
  const reportDate = normalizeDate(raw.reportDate || beijingDate());
  const sidecarPath = path.join(paths.outboxDir, `skill-radar-${reportDate}.quality.json`);
  const history = await buildHistory(reportDate, sidecarPath, { includeShadow: paths.shadow });
  const enriched = enrichStructuredReport(raw, { feedbackEntries: feedback.entries });

  applyHistory(enriched, history.sources);
  const schema = await readJsonRequired(SCHEMA_PATH);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(enriched)) {
    const details = validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`schema validation failed: ${details}`);
  }

  const semanticErrors = validateStructuredSemantics(enriched, { recentSources: history.sources });
  if (semanticErrors.length) {
    throw new Error(`semantic validation failed: ${semanticErrors.join("; ")}`);
  }

  const markdownPath = path.join(paths.outboxDir, `skill-radar-${enriched.reportDate}.md`);
  await writeJson(sidecarPath, enriched);
  await fs.writeFile(markdownPath, renderMarkdown(enriched), "utf8");
  if (!paths.shadow) await applySocialDecisions(enriched);
  await writeJson(
    paths.historyPath,
    await buildHistory(enriched.reportDate, null, { includeShadow: paths.shadow }),
  );
  console.log(`Finalized${paths.shadow ? " shadow" : ""} structured report: ${relative(sidecarPath)}`);
  console.log(`Rendered bilingual Markdown: ${relative(markdownPath)}`);
}

async function recordFeedback(options) {
  if (!options.url || !options.rating) {
    throw new Error("feedback requires --url and --rating");
  }
  if (!["interested", "not_interested"].includes(options.rating)) {
    throw new Error("rating must be interested or not_interested");
  }

  await ensureLocalFiles();
  const feedback = await readJson(FEEDBACK_PATH, { version: 1, entries: [] });
  const canonicalUrl = canonicalizeUrl(options.url);
  const entry = {
    id: `${normalizeDate(options.date || beijingDate())}:${stableSourceId(canonicalUrl)}`,
    reportDate: normalizeDate(options.date || beijingDate()),
    canonicalUrl,
    category: String(options.category || "uncategorized"),
    rating: options.rating,
    note: options.note || null,
    recordedAt: new Date().toISOString(),
  };

  feedback.entries = [
    entry,
    ...feedback.entries.filter((existing) => existing.id !== entry.id),
  ];
  await writeJson(FEEDBACK_PATH, feedback);
  console.log(`Recorded feedback for ${canonicalUrl}`);
}

async function addSocialCandidate(options) {
  if (!options.url) throw new Error("social-add requires --url");
  const postUrl = canonicalizeUrl(options.url);
  const host = new URL(postUrl).hostname;
  if (host !== "x.com" && host !== "www.x.com") {
    throw new Error("Stage 2 social candidates must use an x.com URL");
  }

  await ensureLocalFiles();
  const inbox = await readJson(SOCIAL_PATH, emptyInbox());
  const id = stableSourceId(postUrl);
  if (inbox.candidates.some((candidate) => candidate.id === id)) {
    console.log(`Social candidate already exists: ${postUrl}`);
    return;
  }

  inbox.candidates.push({
    id,
    platform: "x",
    postUrl,
    note: options.note || null,
    addedAt: new Date().toISOString(),
    status: "pending",
    officialUrl: null,
    reason: null,
    lastReviewedAt: null,
    expiresAt: null,
  });
  await writeJson(SOCIAL_PATH, inbox);
  console.log(`Added social candidate: ${postUrl}`);
}

async function writeQualitySummary(options) {
  await ensureLocalFiles();
  const days = Math.max(1, Number(options.days || 30));
  const asOf = normalizeDate(options.date || beijingDate());
  const reports = await loadSidecars();
  const cutoff = addDays(asOf, -(days - 1));
  const selected = reports.filter((report) => report.reportDate >= cutoff && report.reportDate <= asOf);
  const feedback = await readJson(FEEDBACK_PATH, { version: 1, entries: [] });
  const windowFeedback = feedback.entries.filter((entry) =>
    entry.reportDate >= cutoff && entry.reportDate <= asOf,
  );
  const items = selected.flatMap((report) => report.items || []);
  const interested = windowFeedback.filter((entry) => entry.rating === "interested").length;
  const notInterested = windowFeedback.filter((entry) => entry.rating === "not_interested").length;
  const selectedSourceCounts = countBy(items, (item) => item.discovery?.type || "unknown");
  const candidateSourceCounts = {};
  const xDiscoveryTotals = {
    searchedDays: 0,
    candidateCount: 0,
    verifiedCount: 0,
    selectedCount: 0,
    rejectedCount: 0,
    deferredCount: 0,
  };
  for (const report of selected) {
    for (const [source, count] of Object.entries(report.stats?.sourceCounts || {})) {
      candidateSourceCounts[source] = (candidateSourceCounts[source] || 0) + Number(count || 0);
    }
    const xDiscovery = report.stats?.xDiscovery;
    if (xDiscovery?.searched === true) xDiscoveryTotals.searchedDays += 1;
    xDiscoveryTotals.candidateCount += Number(xDiscovery?.candidateCount || 0);
    xDiscoveryTotals.verifiedCount += Number(xDiscovery?.verifiedCount || 0);
    xDiscoveryTotals.selectedCount += Number(xDiscovery?.selectedCount || 0);
    xDiscoveryTotals.rejectedCount += Number(xDiscovery?.rejectedCount || 0);
    xDiscoveryTotals.deferredCount += Number(xDiscovery?.deferredCount || 0);
  }
  const fallbackXCandidates = Number(candidateSourceCounts.x || 0) + Number(candidateSourceCounts.inbox || 0);
  const xCandidates = xDiscoveryTotals.candidateCount || fallbackXCandidates;
  const xItems = items.filter((item) => ["x", "inbox"].includes(item.discovery?.type));
  const xFeedbackUrls = new Set(xItems.map((item) => item.canonicalUrl));
  const xFeedback = windowFeedback.filter((entry) => xFeedbackUrls.has(entry.canonicalUrl));
  const xInterested = xFeedback.filter((entry) => entry.rating === "interested").length;
  const xSelectionRate = xCandidates ? `${Math.round((xItems.length / xCandidates) * 100)}%` : "n/a";
  const xInterestRate = xFeedback.length ? `${Math.round((xInterested / xFeedback.length) * 100)}%` : "n/a";
  const averageScore = items.length
    ? Math.round(items.reduce((sum, item) => sum + Number(item.quality?.baseScore || 0), 0) / items.length)
    : 0;

  const lines = [
    "# Skill Radar Quality Summary",
    "",
    `- Window: ${cutoff} to ${asOf}`,
    `- Valid outcomes: ${selected.length}`,
    `- Published reports: ${selected.filter((report) => report.status === "published").length}`,
    `- No-update outcomes: ${selected.filter((report) => report.status === "no_update").length}`,
    `- Selected items: ${items.length}`,
    `- Average base score: ${averageScore}`,
    `- Interest feedback: ${interested} interested, ${notInterested} not interested`,
    `- Candidate source mix: ${formatCounts(candidateSourceCounts)}`,
    `- Selected source mix: ${formatCounts(selectedSourceCounts)}`,
    `- X discovery: ${xDiscoveryTotals.searchedDays}/${selected.length} days searched, ${xCandidates} candidates, ${xItems.length} selected, ${xSelectionRate} selection rate`,
    `- X decisions: ${xDiscoveryTotals.verifiedCount} verified, ${xDiscoveryTotals.rejectedCount} rejected, ${xDiscoveryTotals.deferredCount} deferred`,
    `- X interest: ${xInterested}/${xFeedback.length} rated items interested (${xInterestRate})`,
    "",
  ];

  await fs.mkdir(QUALITY_DIR, { recursive: true });
  await fs.writeFile(SUMMARY_PATH, lines.join("\n"), "utf8");
  console.log(`Wrote quality summary: ${relative(SUMMARY_PATH)}`);
}

async function buildHistory(asOf, excludedPath = null, { includeShadow = false } = {}) {
  const cutoff = addDays(asOf, -29);
  const sourceMap = new Map();
  const reports = await loadSidecars(excludedPath, { includeShadow });

  for (const report of reports) {
    if (report.reportDate < cutoff || report.reportDate > asOf) continue;
    for (const item of report.items || []) {
      addHistorySource(sourceMap, {
        canonicalUrl: item.canonicalUrl || item.sourceUrl,
        title: item.title,
        category: item.category,
        reportDate: report.reportDate,
      });
    }
  }

  const markdownFiles = await listFiles(OUTBOX_DIR, /^skill-radar-(\d{4}-\d{2}-\d{2})\.md$/);
  for (const file of markdownFiles) {
    const match = path.basename(file).match(/^skill-radar-(\d{4}-\d{2}-\d{2})\.md$/);
    const reportDate = match?.[1];
    if (!reportDate || reportDate < cutoff || reportDate > asOf) continue;
    const sidecarPath = file.replace(/\.md$/, ".quality.json");
    if (await exists(sidecarPath)) continue;
    const markdown = await fs.readFile(file, "utf8");
    const urls = markdown.match(/https:\/\/github\.com\/[^\s)>]+/g) || [];
    for (const url of urls) {
      try {
        addHistorySource(sourceMap, {
          canonicalUrl: canonicalizeUrl(url.replace(/[.,;]+$/, "")),
          title: null,
          category: null,
          reportDate,
        });
      } catch {
        // Legacy reports may contain malformed prose-adjacent URLs.
      }
    }
  }

  return {
    version: 1,
    channel: "skill-radar",
    asOf,
    windowDays: 30,
    sources: [...sourceMap.values()]
      .map((entry) => ({
        ...entry,
        dates: [...new Set(entry.dates)].sort(),
        lastSeenAt: [...new Set(entry.dates)].sort().at(-1),
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
  };
}

function applyHistory(report, recentSources) {
  const recent = new Map(recentSources.map((entry) => [entry.canonicalUrl, entry]));
  for (const item of report.items) {
    const prior = recent.get(item.canonicalUrl);
    item.quality.history = {
      seenWithin30Days: Boolean(prior),
      previousDates: prior?.dates || [],
      materialChange: item.quality?.history?.materialChange === true,
      changeEvidence: item.quality?.history?.changeEvidence || null,
    };
  }
}

async function applySocialDecisions(report) {
  const inbox = await readJson(SOCIAL_PATH, emptyInbox());
  const decisions = new Map(report.socialDecisions.map((decision) => [canonicalizeUrl(decision.postUrl), decision]));
  const selectedPosts = new Map(
    report.items
      .filter((item) => item.discovery?.type === "inbox" || item.discovery?.type === "x")
      .map((item) => [canonicalizeUrl(item.discovery.url), item]),
  );

  inbox.candidates = inbox.candidates.map((candidate) => {
    const postUrl = canonicalizeUrl(candidate.postUrl);
    const selected = selectedPosts.get(postUrl);
    const decision = decisions.get(postUrl);
    if (selected) {
      return {
        ...candidate,
        status: "selected",
        officialUrl: selected.canonicalUrl,
        reason: "Selected for the daily report",
        lastReviewedAt: new Date().toISOString(),
        expiresAt: null,
      };
    }
    if (!decision) return candidate;
    return {
      ...candidate,
      status: decision.status,
      officialUrl: decision.officialUrl ? canonicalizeUrl(decision.officialUrl) : null,
      reason: decision.reason,
      lastReviewedAt: new Date().toISOString(),
      expiresAt: decision.status === "deferred" ? `${addDays(report.reportDate, 14)}T00:00:00.000Z` : null,
    };
  });

  await writeJson(SOCIAL_PATH, inbox);
}

async function expireDeferredCandidates(inbox, asOf) {
  return {
    ...inbox,
    candidates: inbox.candidates.map((candidate) => {
      if (candidate.status !== "deferred" || !candidate.expiresAt) return candidate;
      if (candidate.expiresAt.slice(0, 10) > asOf) return candidate;
      return {
        ...candidate,
        status: "rejected",
        reason: candidate.reason || "Deferred candidate expired after 14 days",
        lastReviewedAt: new Date().toISOString(),
      };
    }),
  };
}

function renderMarkdown(report) {
  return [
    renderLanguage(report, "zh"),
    "",
    renderLanguage(report, "en"),
    "",
  ].join("\n");
}

function renderLanguage(report, language) {
  const marker = language === "zh" ? "zh" : "en";
  const heading = `# Skill Radar Deep Dive - ${report.reportDate}`;
  const labels = language === "zh"
    ? {
        category: "类别",
        source: "来源",
        why: "为什么现在值得看",
        problem: "解决问题",
        bestFor: "适合",
        usability: "可用性",
        adaptation: "Codex 适配",
        trust: "信任/安全",
        recommendation: "建议",
        conclusion: "今日结论",
      }
    : {
        category: "Category",
        source: "Source",
        why: "Why now",
        problem: "Problem solved",
        bestFor: "Best for",
        usability: "Usability",
        adaptation: "Codex adaptation",
        trust: "Trust/security",
        recommendation: "Recommendation",
        conclusion: "Bottom line",
      };
  const lines = [`<!-- ${marker} -->`, heading, "", report.summary[language]];

  if (report.status === "no_update") {
    lines.push("", `## ${labels.conclusion}`, "", report.conclusion[language], `<!-- /${marker} -->`);
    return lines.join("\n");
  }

  for (const item of report.items) {
    const display = item.display[language];
    lines.push(
      "",
      `## ${item.rank}. ${item.title}`,
      "",
      `- **${labels.category}:** ${item.category}`,
      `- **${labels.source}:** [${item.title}](${item.sourceUrl})`,
      `- **${labels.why}:** ${display.whyNow}`,
      `- **${labels.problem}:** ${display.problem}`,
      `- **${labels.bestFor}:** ${display.bestFor}`,
      `- **${labels.usability}:** ${display.usability}`,
      `- **${labels.adaptation}:** ${display.adaptation}`,
      `- **${labels.trust}:** ${display.trust}`,
      `- **${labels.recommendation}:** **${item.recommendation}** - ${display.action}`,
    );
  }

  lines.push("", `## ${labels.conclusion}`, "", report.conclusion[language], `<!-- /${marker} -->`);
  return lines.join("\n");
}

function summarizePreferences(entries) {
  const categories = {};
  for (const entry of entries) {
    const category = entry.category || "uncategorized";
    categories[category] ||= { interested: 0, notInterested: 0 };
    if (entry.rating === "interested") categories[category].interested += 1;
    if (entry.rating === "not_interested") categories[category].notInterested += 1;
  }
  return { totalFeedback: entries.length, categories };
}

function addHistorySource(sourceMap, entry) {
  let canonicalUrl;
  try {
    canonicalUrl = canonicalizeUrl(entry.canonicalUrl);
  } catch {
    return;
  }
  const existing = sourceMap.get(canonicalUrl) || {
    id: stableSourceId(canonicalUrl),
    canonicalUrl,
    title: entry.title || null,
    category: entry.category || null,
    dates: [],
  };
  existing.title ||= entry.title || null;
  existing.category ||= entry.category || null;
  existing.dates.push(entry.reportDate);
  sourceMap.set(canonicalUrl, existing);
}

async function loadSidecars(excludedPath = null, { includeShadow = false } = {}) {
  const files = [
    ...await listFiles(OUTBOX_DIR, /\.quality\.json$/),
    ...(includeShadow ? await listFiles(SHADOW_OUTBOX_DIR, /\.quality\.json$/) : []),
  ];
  const excluded = excludedPath ? path.resolve(excludedPath) : null;
  const reports = [];
  for (const file of files) {
    if (excluded && path.resolve(file) === excluded) continue;
    try {
      reports.push(await readJsonRequired(file));
    } catch {
      // Incomplete drafts are ignored until finalize succeeds.
    }
  }
  return reports;
}

async function ensureLocalFiles(paths = runtimePaths({})) {
  await Promise.all([
    fs.mkdir(OUTBOX_DIR, { recursive: true }),
    fs.mkdir(STATE_DIR, { recursive: true }),
    fs.mkdir(FEEDBACK_DIR, { recursive: true }),
    fs.mkdir(INBOX_DIR, { recursive: true }),
    fs.mkdir(paths.outboxDir, { recursive: true }),
    fs.mkdir(paths.stateDir, { recursive: true }),
  ]);
  if (!(await exists(FEEDBACK_PATH))) await writeJson(FEEDBACK_PATH, { version: 1, entries: [] });
  if (!(await exists(SOCIAL_PATH))) await writeJson(SOCIAL_PATH, emptyInbox());
}

function emptyInbox() {
  return { version: 1, candidates: [] };
}

function runtimePaths(options) {
  const shadow = options.shadow === true || options.shadow === "true";
  const stateDir = shadow ? SHADOW_STATE_DIR : STATE_DIR;
  return {
    shadow,
    outboxDir: shadow ? SHADOW_OUTBOX_DIR : OUTBOX_DIR,
    stateDir,
    historyPath: path.join(stateDir, "skill-radar-history.json"),
    contextPath: path.join(stateDir, "skill-radar-context.json"),
  };
}

async function listFiles(directory, pattern) {
  if (!(await exists(directory))) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function readJsonRequired(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`invalid JSON in ${relative(filePath)}: ${error.message}`);
  }
}

async function readJson(filePath, fallback) {
  if (!(await exists(filePath))) return structuredClone(fallback);
  return readJsonRequired(filePath);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveInput(value) {
  if (!value) throw new Error("finalize requires --input");
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function normalizeDate(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Invalid date: ${value}`);
  return text;
}

function addDays(dateText, amount) {
  const date = new Date(`${normalizeDate(dateText)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function beijingDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function countBy(values, selector) {
  return values.reduce((counts, value) => {
    const key = selector(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function formatCounts(counts) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ") || "none";
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll("\\", "/");
}

function parseArgs(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function printHelp() {
  console.log(`Personal Radar quality tool

Commands:
  prepare [--date YYYY-MM-DD] [--shadow]
  finalize --input reports/state/skill-radar-draft.json [--shadow]
  feedback --url URL --rating interested|not_interested [--date YYYY-MM-DD] [--category NAME] [--note TEXT]
  social-add --url https://x.com/... [--note TEXT]
  summary [--days 30] [--date YYYY-MM-DD]`);
}
