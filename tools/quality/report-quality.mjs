import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  canonicalizeUrl,
  artifactKeyFor,
  enrichStructuredReport,
  stableSourceId,
  validateStructuredSemantics,
} from "../../src/report-structure.js";
import { enrichCuratedReport, validateCuratedReport } from "../../src/curated-report.js";

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
const HISTORY_V1_ARCHIVE_PATH = path.join(STATE_DIR, "skill-radar-history-v1-archive.json");
const CONTEXT_PATH = path.join(STATE_DIR, "skill-radar-context.json");
const FEEDBACK_PATH = path.join(FEEDBACK_DIR, "skill-radar.json");
const SOCIAL_PATH = path.join(INBOX_DIR, "social-candidates.json");
const GITHUB_CANDIDATES_PATH = path.join(INBOX_DIR, "github-candidates.json");
const SUMMARY_PATH = path.join(QUALITY_DIR, "skill-radar-summary.md");
const SCHEMA_PATH = path.join(ROOT, "schemas", "skill-radar-report.schema.json");
const CURATED_SCHEMA_PATH = path.join(ROOT, "schemas", "skill-radar-report-v3.schema.json");

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";

try {
  if (command === "prepare") await prepareContext(args);
  else if (command === "finalize") await finalizeReport(args);
  else if (command === "finalize-curated") await finalizeCuratedReport(args);
  else if (command === "filter-candidates") await filterCandidates(args);
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
  if (!paths.shadow) await archiveLegacyHistory();
  const asOf = normalizeDate(options.date || beijingDate());
  const history = await buildHistory(asOf, null, { includeShadow: paths.shadow });
  const feedback = await readJson(FEEDBACK_PATH, { version: 1, entries: [] });
  const inbox = await expireDeferredCandidates(await readJson(SOCIAL_PATH, emptyInbox()), asOf);
  const githubDiscovery = await readJson(GITHUB_CANDIDATES_PATH, null);
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
    githubDiscovery: summarizeGithubDiscovery(githubDiscovery),
  };

  await writeJson(paths.historyPath, history);
  await writeJson(paths.contextPath, context);
  console.log(`Prepared${paths.shadow ? " shadow" : ""} quality context: ${relative(paths.contextPath)}`);
  console.log(`Recent sources: ${history.sources.length}; pending social candidates: ${context.pendingSocialCandidates.length}`);
  console.log(`GitHub discovery candidates: ${context.githubDiscovery?.candidates?.length || 0}`);
}

async function filterCandidates(options) {
  const paths = runtimePaths(options);
  const inputPath = resolveRequiredInput(options.input, "filter-candidates");
  const outputPath = options.output
    ? resolveInput(options.output)
    : path.join(paths.stateDir, "skill-radar-candidates-filtered.json");
  const input = await readJsonRequired(inputPath);
  if (!Array.isArray(input.candidates)) {
    throw new Error("filter-candidates input requires a candidates array");
  }

  await ensureLocalFiles(paths);
  if (!paths.shadow) await archiveLegacyHistory();
  const asOf = normalizeDate(options.date || input.asOf || beijingDate());
  const history = await buildHistory(asOf, null, { includeShadow: paths.shadow });
  const recentByArtifact = new Map(history.sources.map((entry) => [entry.artifactKey, entry]));
  const reviewState = await readJson(paths.reviewStatePath, { version: 1, channel: "skill-radar", entries: [] });
  const reviewByArtifact = new Map((reviewState.entries || []).map((entry) => [entry.artifactKey, entry]));
  const sevenDayCutoff = addDays(asOf, -7);
  const seenCandidateArtifacts = new Set();

  const candidates = input.candidates.map((candidate, index) => {
    const title = String(candidate.title || "").trim();
    if (!title) throw new Error(`candidates[${index}].title is required`);
    const sourceUrl = String(candidate.sourceUrl || "").trim();
    const discoveryType = String(candidate.discoveryType || "");
    if (!["awesomeClaudeSkills", "agentPlugins", "openAgentSkill"].includes(discoveryType)) {
      throw new Error(`candidates[${index}].discoveryType is invalid`);
    }
    const discoveryUrl = String(candidate.discoveryUrl || "").trim();
    let parsedDiscoveryUrl;
    try {
      parsedDiscoveryUrl = new URL(discoveryUrl);
    } catch {
      throw new Error(`candidates[${index}].discoveryUrl is invalid`);
    }
    if (parsedDiscoveryUrl.protocol !== "https:") {
      throw new Error(`candidates[${index}].discoveryUrl must use HTTPS`);
    }
    const artifactScope = String(candidate.artifactScope || "individual_skill");
    const artifactPath = candidate.artifactPath == null ? null : String(candidate.artifactPath).trim();
    if (["general_skill_collection", "official_catalog", "mixed_toolkit"].includes(artifactScope) && !artifactPath) {
      throw new Error(`candidates[${index}] requires artifactPath for ${artifactScope}`);
    }
    const item = {
      sourceUrl,
      discoveryType,
      discoveryUrl,
      quality: { evidence: { artifactScope, artifactPath } },
    };
    const canonicalUrl = canonicalizeUrl(sourceUrl);
    const artifactKey = artifactKeyFor(item);
    const duplicateInCandidatePool = seenCandidateArtifacts.has(artifactKey);
    seenCandidateArtifacts.add(artifactKey);
    const prior = recentByArtifact.get(artifactKey);
    const priorReview = reviewByArtifact.get(artifactKey);
    const repositoryDates = history.sources
      .filter((entry) => entry.canonicalUrl === canonicalUrl)
      .flatMap((entry) => entry.dates)
      .filter((date) => date >= sevenDayCutoff && date < asOf);
    const materialChange = candidate.materialChange === true
      && Boolean(String(candidate.changeEvidence || "").trim());
    const exactDuplicate = Boolean(prior);
    const repositoryAppearances7d = new Set(repositoryDates).size;
    const reviewBlocked = ["defer", "reject"].includes(priorReview?.outcome)
      && String(priorReview.reviewAfter || "") > asOf;
    const eligible = !duplicateInCandidatePool
      && (materialChange || (!exactDuplicate && repositoryAppearances7d < 2 && !reviewBlocked));
    const exclusionReason = eligible
      ? null
      : duplicateInCandidatePool
        ? "duplicate-in-candidate-pool"
        : exactDuplicate
        ? "exact-artifact-within-30-days"
        : repositoryAppearances7d >= 2
          ? "repository-appeared-twice-within-7-days"
          : `${priorReview.outcome}-until-${priorReview.reviewAfter}`;

    return {
      ...candidate,
      title,
      sourceUrl,
      artifactScope,
      artifactPath,
      canonicalUrl,
      artifactKey,
      id: stableSourceId(artifactKey),
      history: {
        exactDuplicate,
        duplicateInCandidatePool,
        previousDates: prior?.dates || [],
        repositoryAppearances7d,
        previousOutcome: priorReview?.outcome || null,
        reviewAfter: priorReview?.reviewAfter || null,
        materialChange,
        eligible,
        exclusionReason,
      },
    };
  });

  const output = {
    version: 2,
    channel: "skill-radar",
    asOf,
    historyVersion: history.version,
    minimumEligibleCandidates: 5,
    needsReplenishment: candidates.filter((candidate) => candidate.history.eligible).length < 5,
    candidates,
    eligibleCandidates: candidates.filter((candidate) => candidate.history.eligible),
    excludedCandidates: candidates.filter((candidate) => !candidate.history.eligible),
  };
  await writeJson(outputPath, output);
  console.log(`Filtered candidates with artifact history v2: ${relative(outputPath)}`);
  console.log(`Candidates: ${candidates.length}; eligible: ${output.eligibleCandidates.length}; excluded: ${output.excludedCandidates.length}`);
  if (output.needsReplenishment) console.log("Replenishment required: fewer than five eligible candidates");
}

function summarizeGithubDiscovery(discovery) {
  if (!discovery || !Array.isArray(discovery.candidates)) return null;
  return {
    generatedAt: discovery.generatedAt,
    source: discovery.source,
    authenticated: discovery.authenticated,
    collection: discovery.collection,
    candidates: discovery.candidates.slice(0, 50),
  };
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

async function finalizeCuratedReport(options) {
  const paths = runtimePaths(options);
  const inputPath = resolveRequiredInput(options.input, "finalize-curated");
  const candidatesPath = resolveRequiredInput(options.candidates, "finalize-curated --candidates");
  await ensureLocalFiles(paths);
  if (!paths.shadow) await archiveLegacyHistory();
  const raw = await readJsonRequired(inputPath);
  const filtered = await readJsonRequired(candidatesPath);
  if (!Array.isArray(filtered.candidates) || !Array.isArray(filtered.excludedCandidates)) {
    throw new Error("finalize-curated candidates file must be filter-candidates output");
  }
  const sourceCounts = countBy(filtered.candidates, (candidate) => candidate.discoveryType);
  const deterministicRaw = {
    ...raw,
    candidateCount: filtered.candidates.length,
    duplicateCount: filtered.excludedCandidates.filter((candidate) =>
      candidate.history?.exactDuplicate || candidate.history?.duplicateInCandidatePool
    ).length,
    sourceCounts,
  };
  const reportDate = normalizeDate(deterministicRaw.reportDate || beijingDate());
  if (filtered.asOf !== reportDate) {
    throw new Error("curated draft reportDate must match filtered candidate date");
  }
  const eligibleCandidatesByArtifact = new Map(
    filtered.eligibleCandidates.map((candidate) => [candidate.artifactKey, candidate]),
  );
  const boundDecisions = (Array.isArray(deterministicRaw.decisions) ? deterministicRaw.decisions : []).map((decision) => {
    const { recommendation: _legacyRecommendation, ...decisionWithoutLegacyAction } = decision;
    const identityInput = {
      sourceUrl: String(decision.sourceUrl || ""),
      quality: {
        evidence: {
          artifactScope: String(decision.artifactScope || "individual_skill"),
          artifactPath: decision.artifactPath == null ? null : String(decision.artifactPath),
        },
      },
    };
    const artifactKey = artifactKeyFor(identityInput);
    const candidate = eligibleCandidatesByArtifact.get(artifactKey);
    if (!candidate) {
      throw new Error(`curated decision was not eligible after code filtering: ${decision.title || artifactKey}`);
    }
    return {
      ...decisionWithoutLegacyAction,
      title: candidate.title,
      sourceUrl: candidate.sourceUrl,
      artifactScope: candidate.artifactScope,
      artifactPath: candidate.artifactPath,
      discovery: {
        type: discoveryLabel(candidate.discoveryType),
        url: candidate.discoveryUrl,
      },
    };
  });
  const decisionArtifactKeys = new Set(boundDecisions.map((decision) => artifactKeyFor({
    sourceUrl: decision.sourceUrl,
    quality: { evidence: { artifactScope: decision.artifactScope, artifactPath: decision.artifactPath } },
  })));
  const missingDecision = filtered.eligibleCandidates.find((candidate) => !decisionArtifactKeys.has(candidate.artifactKey));
  if (boundDecisions.length !== filtered.eligibleCandidates.length || missingDecision) {
    throw new Error(`curated decisions must cover every eligible candidate${missingDecision ? `; missing: ${missingDecision.title}` : ""}`);
  }
  deterministicRaw.decisions = boundDecisions;
  const sidecarPath = path.join(paths.outboxDir, `skill-radar-${reportDate}.quality.json`);
  const history = await buildHistory(reportDate, sidecarPath, { includeShadow: paths.shadow });
  const enriched = enrichCuratedReport(deterministicRaw, { recentSources: history.sources });
  const schema = await readJsonRequired(CURATED_SCHEMA_PATH);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(enriched)) {
    const details = validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`curated schema validation failed: ${details}`);
  }
  const semanticErrors = validateCuratedReport(enriched);
  if (semanticErrors.length) {
    throw new Error(`curated semantic validation failed: ${semanticErrors.join("; ")}`);
  }

  const markdownPath = path.join(paths.outboxDir, `skill-radar-${reportDate}.md`);
  await writeJson(sidecarPath, enriched);
  await fs.writeFile(markdownPath, renderMarkdown(enriched), "utf8");
  await updateCuratedReviewState(paths.reviewStatePath, enriched.decisions, reportDate);
  await writeJson(paths.historyPath, await buildHistory(reportDate, null, { includeShadow: paths.shadow }));
  console.log(`Finalized${paths.shadow ? " shadow" : ""} curated report: ${relative(sidecarPath)}`);
  console.log(`Rendered bilingual Markdown: ${relative(markdownPath)}`);
}

function discoveryLabel(discoveryType) {
  return {
    awesomeClaudeSkills: "awesome-claude-skills",
    agentPlugins: "agent-plugins",
    openAgentSkill: "open-agent-skill",
  }[discoveryType];
}

async function updateCuratedReviewState(reviewStatePath, decisions, reportDate) {
  const state = await readJson(reviewStatePath, { version: 1, channel: "skill-radar", entries: [] });
  const entries = new Map((state.entries || []).map((entry) => [entry.artifactKey, entry]));
  for (const decision of decisions) {
    if (decision.decision === "recommend") {
      entries.delete(decision.artifactKey);
      continue;
    }
    const cooldownDays = decision.decision === "defer" ? 14 : 90;
    entries.set(decision.artifactKey, {
      artifactKey: decision.artifactKey,
      canonicalUrl: decision.canonicalUrl,
      title: decision.title,
      outcome: decision.decision,
      reason: decision.reason,
      reviewedAt: reportDate,
      reviewAfter: addDays(reportDate, cooldownDays),
    });
  }
  await writeJson(reviewStatePath, {
    version: 1,
    channel: "skill-radar",
    updatedAt: reportDate,
    entries: [...entries.values()].sort((a, b) => a.artifactKey.localeCompare(b.artifactKey)),
  });
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
        artifactKey: item.artifactKey || artifactKeyFor(item),
        title: item.title,
        category: item.category,
        reportDate: report.reportDate,
      });
    }
  }

  return {
    version: 2,
    channel: "skill-radar",
    asOf,
    windowDays: 30,
    identity: "exact-artifact",
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
  const recent = new Map(recentSources.map((entry) => [entry.artifactKey || entry.canonicalUrl, entry]));
  for (const item of report.items) {
    const prior = recent.get(item.artifactKey || item.canonicalUrl);
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
        adaptation: "平台适配",
        trust: "信任/安全",
        recommendation: "怎么用",
        conclusion: "今日结论",
      }
    : {
        category: "Category",
        source: "Source",
        why: "Why now",
        problem: "Problem solved",
        bestFor: "Best for",
        usability: "Usability",
        adaptation: "Platform adaptation",
        trust: "Trust/security",
        recommendation: "How to use",
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
      `- **${labels.recommendation}:** ${display.action}`,
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
  const artifactKey = String(entry.artifactKey || canonicalUrl);
  const existing = sourceMap.get(artifactKey) || {
    id: stableSourceId(artifactKey),
    canonicalUrl,
    artifactKey,
    title: entry.title || null,
    category: entry.category || null,
    identityScope: artifactKey.includes("#artifact=") ? "artifact_path" : "repository_artifact",
    exactArtifactKnown: true,
    dates: [],
  };
  existing.title ||= entry.title || null;
  existing.category ||= entry.category || null;
  existing.dates.push(entry.reportDate);
  sourceMap.set(artifactKey, existing);
}

async function archiveLegacyHistory() {
  if (!(await exists(HISTORY_PATH)) || await exists(HISTORY_V1_ARCHIVE_PATH)) return;
  const current = await readJson(HISTORY_PATH, null);
  if (!current || Number(current.version) !== 1) return;
  await fs.copyFile(HISTORY_PATH, HISTORY_V1_ARCHIVE_PATH);
  console.log(`Archived legacy repository history: ${relative(HISTORY_V1_ARCHIVE_PATH)}`);
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
  if (!(await exists(paths.reviewStatePath))) {
    await writeJson(paths.reviewStatePath, { version: 1, channel: "skill-radar", entries: [] });
  }
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
    reviewStatePath: path.join(stateDir, "skill-radar-review-state.json"),
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

function resolveRequiredInput(value, commandName) {
  if (!value) throw new Error(`${commandName} requires --input`);
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
  finalize-curated --input FILE --candidates FILTERED_FILE [--shadow]
  filter-candidates --input FILE [--output FILE] [--date YYYY-MM-DD] [--shadow]
  feedback --url URL --rating interested|not_interested [--date YYYY-MM-DD] [--category NAME] [--note TEXT]
  social-add --url https://x.com/... [--note TEXT]
  summary [--days 30] [--date YYYY-MM-DD]`);
}
