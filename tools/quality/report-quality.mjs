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
import {
  HarnessValidationError,
  validateVerificationHarnessV2,
} from "./validate-verification-harness-v2.mjs";

const ROOT = process.env.PERSONAL_RADAR_ROOT
  ? path.resolve(process.env.PERSONAL_RADAR_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTBOX_DIR = path.join(ROOT, "reports", "outbox");
const STATE_DIR = path.join(ROOT, "reports", "state");
const FEEDBACK_DIR = path.join(ROOT, "reports", "feedback");
const INBOX_DIR = path.join(ROOT, "reports", "inbox");
const QUALITY_DIR = path.join(ROOT, "reports", "quality");
const EXPERIMENTS_DIR = path.join(ROOT, "reports", "experiments");
const SHADOW_DIR = path.join(ROOT, "reports", "shadow");
const SHADOW_OUTBOX_DIR = path.join(SHADOW_DIR, "outbox");
const SHADOW_STATE_DIR = path.join(SHADOW_DIR, "state");
const SHADOW_INBOX_DIR = path.join(SHADOW_DIR, "inbox");
const HISTORY_PATH = path.join(STATE_DIR, "skill-radar-history.json");
const HISTORY_V1_ARCHIVE_PATH = path.join(STATE_DIR, "skill-radar-history-v1-archive.json");
const CONTEXT_PATH = path.join(STATE_DIR, "skill-radar-context.json");
const FEEDBACK_PATH = path.join(FEEDBACK_DIR, "skill-radar.json");
const SOCIAL_PATH = path.join(INBOX_DIR, "social-candidates.json");
const RECHECK_PATH = path.join(INBOX_DIR, "recheck-candidates.json");
const GITHUB_CANDIDATES_PATH = path.join(INBOX_DIR, "github-candidates.json");
const SUMMARY_PATH = path.join(QUALITY_DIR, "skill-radar-summary.md");
const SCHEMA_PATH = path.join(ROOT, "schemas", "skill-radar-report.schema.json");
const CURATED_SCHEMA_PATH = path.join(ROOT, "schemas", "skill-radar-report-v3.schema.json");
const LEGACY_DISCOVERY_TYPES = new Set(["awesomeClaudeSkills", "agentPlugins", "openAgentSkill"]);
const PORTFOLIO_DISCOVERY_TYPES = new Set(["registryPulse", "officialRotation", "communityTrend", "rulesModes", "recheck"]);
const PORTFOLIO_SOURCES = {
  registryPulse: new Set(["skillsSh"]),
  officialRotation: new Set([
    "anthropicSkills", "openAiPlugins", "githubAwesomeCopilot", "cursorMarketplace",
    "geminiExtensions", "nvidiaSkills", "huggingFaceSkills", "microsoftAgentSkills",
  ]),
  communityTrend: new Set(["awesomeClaudeSkills", "openAgentSkill"]),
  rulesModes: new Set(["githubAwesomeCopilot", "rooModes"]),
  recheck: new Set(["confirmedCorrection"]),
};
const CONTAINER_TYPES = new Set(["registry_entry", "repository", "plugin", "extension", "marketplace_entry"]);
const ARTIFACT_TYPES = new Set(["skill", "rule", "mode", "instruction_pack"]);
const PROVENANCE_TYPES = new Set(["first_party", "officially_governed_community", "independent"]);
const DEPENDENCY_TYPES = new Set(["none", "mcp", "cli", "api", "hooks", "authentication", "runtime", "platform"]);
const REGISTRY_VIEWS = ["all_time", "trending", "hot", "official"];
const OFFICIAL_SOURCE_ROTATION = [
  { id: "anthropicSkills", url: "https://github.com/anthropics/skills" },
  { id: "openAiPlugins", url: "https://github.com/openai/plugins" },
  { id: "githubAwesomeCopilot", url: "https://github.com/github/awesome-copilot" },
  { id: "cursorMarketplace", url: "https://cursor.com/marketplace" },
  { id: "geminiExtensions", url: "https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/index.md" },
  { id: "nvidiaSkills", url: "https://github.com/NVIDIA/skills" },
  { id: "huggingFaceSkills", url: "https://github.com/huggingface/skills" },
  { id: "microsoftAgentSkills", url: "https://github.com/MicrosoftDocs/agent-skills" },
];

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";

try {
  if (command === "prepare") await prepareContext(args);
  else if (command === "finalize") await finalizeReport(args);
  else if (command === "finalize-curated") await finalizeCuratedReport(args);
  else if (command === "filter-candidates") await filterCandidates(args);
  else if (command === "feedback") await recordFeedback(args);
  else if (command === "feedback-replay") await replayFeedback(args);
  else if (command === "social-add") await addSocialCandidate(args);
  else if (command === "recheck-add") await addRecheckCandidate(args);
  else if (command === "summary") await writeQualitySummary(args);
  else printHelp();
} catch (error) {
  console.error(`quality tool failed: ${error.message}`);
  if (typeof error.toJSON === "function") {
    console.error(`QUALITY_ERROR_JSON ${JSON.stringify(error.toJSON())}`);
  }
  process.exitCode = 1;
}

async function prepareContext(options) {
  const paths = runtimePaths(options);
  const sourcePortfolio = flag(options["source-portfolio"]);
  await ensureLocalFiles(paths);
  if (!paths.shadow) await archiveLegacyHistory();
  const asOf = normalizeDate(options.date || beijingDate());
  if (sourcePortfolio) await prepareSourcePortfolioPlan(paths, asOf);
  const history = await buildHistory(asOf, null, { includeShadow: paths.shadow });
  const feedback = await readJson(FEEDBACK_PATH, { version: 1, entries: [] });
  const inbox = await expireDeferredCandidates(await readJson(SOCIAL_PATH, emptyInbox()), asOf);
  const githubDiscovery = await readJson(GITHUB_CANDIDATES_PATH, null);
  const recheckQueue = await readJson(paths.recheckPath, emptyRecheckQueue());
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
    pendingRecheckCandidates: recheckQueue.candidates
      .filter((entry) => entry.status === "pending")
      .map((entry) => ({ ...entry.candidate, recheckReason: entry.reason, queuedAt: entry.queuedAt })),
  };

  await writeJson(paths.historyPath, history);
  await writeJson(paths.contextPath, context);
  console.log(`Prepared${paths.shadow ? " shadow" : ""} quality context: ${relative(paths.contextPath)}`);
  console.log(`Recent sources: ${history.sources.length}; pending social candidates: ${context.pendingSocialCandidates.length}`);
  console.log(`GitHub discovery candidates: ${context.githubDiscovery?.candidates?.length || 0}`);
  console.log(`Pending recheck candidates: ${context.pendingRecheckCandidates.length}`);
}

async function filterCandidates(options) {
  const paths = runtimePaths(options);
  const sourcePortfolio = flag(options["source-portfolio"]);
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
  const sourcePlan = sourcePortfolio ? await readSourcePlan(paths, asOf) : null;
  const history = await buildHistory(asOf, null, { includeShadow: paths.shadow });
  const recentByArtifact = new Map(history.sources.map((entry) => [entry.artifactKey, entry]));
  const reviewState = await readJson(paths.reviewStatePath, { version: 1, channel: "skill-radar", entries: [] });
  const reviewByArtifact = new Map((reviewState.entries || []).map((entry) => [entry.artifactKey, entry]));
  const recheckQueue = await readJson(paths.recheckPath, emptyRecheckQueue());
  const pendingRechecks = recheckQueue.candidates.filter((entry) => entry.status === "pending");
  const pendingRechecksByArtifact = new Map(pendingRechecks.map((entry) => [
    artifactKeyForCandidate(entry.candidate),
    entry,
  ]));
  const sevenDayCutoff = addDays(asOf, -7);
  const seenCandidateArtifacts = new Set();

  const candidates = input.candidates.map((candidate, index) => {
    const title = String(candidate.title || "").trim();
    if (!title) throw new Error(`candidates[${index}].title is required`);
    const sourceUrl = String(candidate.sourceUrl || "").trim();
    const discoveryType = String(candidate.discoveryType || "");
    const allowedDiscoveryTypes = sourcePortfolio ? PORTFOLIO_DISCOVERY_TYPES : LEGACY_DISCOVERY_TYPES;
    if (!allowedDiscoveryTypes.has(discoveryType)) {
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
    if (sourcePortfolio) validatePortfolioCandidate(candidate, index, discoveryType, artifactPath, sourcePlan);
    const item = {
      sourceUrl,
      discoveryType,
      discoveryUrl,
      quality: { evidence: { artifactScope, artifactPath } },
    };
    const canonicalUrl = canonicalizeUrl(sourceUrl);
    const artifactKey = artifactKeyFor(item);
    const queuedRecheck = pendingRechecksByArtifact.get(artifactKey);
    if (sourcePortfolio && discoveryType === "recheck") {
      if (!queuedRecheck) {
        throw new Error(`candidates[${index}] is not present in the pending recheck queue`);
      }
      if (JSON.stringify(recheckCandidateShape(candidate))
        !== JSON.stringify(recheckCandidateShape(queuedRecheck.candidate))) {
        throw new Error(`candidates[${index}] must match the prepared recheck candidate exactly`);
      }
    } else if (sourcePortfolio && queuedRecheck) {
      throw new Error(`candidates[${index}] duplicates a pending recheck; use the prepared recheck entry`);
    }
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
      && (discoveryType === "recheck"
        || materialChange
        || (!exactDuplicate && repositoryAppearances7d < 2 && !reviewBlocked));
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

  if (sourcePortfolio) {
    const candidateArtifacts = new Set(candidates.map((candidate) => candidate.artifactKey));
    const missingRecheck = pendingRechecks.find((entry) =>
      !candidateArtifacts.has(artifactKeyForCandidate(entry.candidate)));
    if (missingRecheck) {
      throw new Error(`candidate pool must include pending recheck: ${missingRecheck.candidate.title}`);
    }
  }
  if (sourcePortfolio) validatePortfolioCoverage(candidates, sourcePlan);

  const output = {
    version: 2,
    sourceProfile: sourcePortfolio ? "portfolio-v1" : "legacy-v3",
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

function validatePortfolioCandidate(candidate, index, discoveryType, artifactPath, sourcePlan) {
  const sourceId = String(candidate.sourceId || "");
  if (!PORTFOLIO_SOURCES[discoveryType]?.has(sourceId)) {
    throw new Error(`candidates[${index}].sourceId is invalid for ${discoveryType}`);
  }
  const containerType = String(candidate.containerType || "");
  if (!CONTAINER_TYPES.has(containerType)) {
    throw new Error(`candidates[${index}].containerType is invalid`);
  }
  if (["plugin", "extension", "marketplace_entry"].includes(containerType) && !artifactPath) {
    throw new Error(`candidates[${index}] requires artifactPath for ${containerType} containers`);
  }
  if (!ARTIFACT_TYPES.has(String(candidate.artifactType || ""))) {
    throw new Error(`candidates[${index}].artifactType is invalid`);
  }
  if (!PROVENANCE_TYPES.has(String(candidate.provenance || ""))) {
    throw new Error(`candidates[${index}].provenance is invalid`);
  }
  const containerUrl = String(candidate.containerUrl || "");
  if (!isHttpsUrl(containerUrl)) {
    throw new Error(`candidates[${index}].containerUrl must use HTTPS`);
  }
  if (!Array.isArray(candidate.discoverySignals) || candidate.discoverySignals.length < 1
    || candidate.discoverySignals.some((signal) => !String(signal || "").trim())) {
    throw new Error(`candidates[${index}].discoverySignals requires at least one non-empty signal`);
  }
  if (!Array.isArray(candidate.dependencies) || candidate.dependencies.length < 1
    || candidate.dependencies.some((dependency) => !DEPENDENCY_TYPES.has(dependency))) {
    throw new Error(`candidates[${index}].dependencies is invalid`);
  }
  if (candidate.dependencies.includes("none") && candidate.dependencies.length !== 1) {
    throw new Error(`candidates[${index}].dependencies cannot combine none with another dependency`);
  }
  if (discoveryType === "registryPulse" && candidate.registryView !== sourcePlan.registryFocus) {
    throw new Error(`candidates[${index}].registryView must match today's ${sourcePlan.registryFocus} plan`);
  }
  if (discoveryType === "officialRotation"
    && !sourcePlan.officialSources.some((source) => source.id === sourceId)) {
    throw new Error(`candidates[${index}].sourceId is not assigned in today's official rotation`);
  }
  if (discoveryType === "recheck" && candidate.registryView != null) {
    throw new Error(`candidates[${index}].registryView must be null for recheck`);
  }
}

function validatePortfolioCoverage(candidates, sourcePlan) {
  for (const lane of ["registryPulse", "officialRotation", "communityTrend"]) {
    if (!candidates.some((candidate) => candidate.discoveryType === lane)) {
      throw new Error(`source portfolio requires at least one ${lane} candidate`);
    }
  }
  const officialSources = new Set(
    candidates.filter((candidate) => candidate.discoveryType === "officialRotation").map((candidate) => candidate.sourceId),
  );
  if (officialSources.size < sourcePlan.minimumOfficialSources) {
    throw new Error(`source portfolio requires at least ${sourcePlan.minimumOfficialSources} assigned official sources`);
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function prepareSourcePortfolioPlan(paths, asOf) {
  const rotation = await readJson(paths.sourceRotationPath, { version: 1, channel: "skill-radar", entries: [] });
  const completedRuns = await discoverCompletedPortfolioRuns(paths.outboxDir, asOf);
  const entries = new Map((rotation.entries || []).map((entry) => [entry.reportDate, entry]));
  for (const run of completedRuns) {
    entries.set(run.reportDate, { ...entries.get(run.reportDate), ...run, status: "completed" });
  }

  const existing = entries.get(asOf);
  let plan;
  if (existing?.plan) {
    plan = {
      ...existing.plan,
      registryUrl: registryUrlFor(existing.plan.registryFocus),
    };
    entries.set(asOf, { ...existing, plan });
  } else {
    const completedBeforeToday = [...entries.values()].filter(
      (entry) => entry.status === "completed" && entry.reportDate < asOf,
    );
    const rotationIndex = completedBeforeToday.length;
    const registryFocus = REGISTRY_VIEWS[rotationIndex % REGISTRY_VIEWS.length];
    const officialSources = Array.from({ length: 3 }, (_, offset) =>
      OFFICIAL_SOURCE_ROTATION[(rotationIndex * 3 + offset) % OFFICIAL_SOURCE_ROTATION.length]);
    plan = {
      version: 1,
      sourceProfile: "portfolio-v1",
      reportDate: asOf,
      registryFocus,
      registryUrl: registryUrlFor(registryFocus),
      officialSources,
      minimumOfficialSources: 2,
      communitySources: [
        { id: "awesomeClaudeSkills", url: "https://awesomeclaudeskills.com/" },
        { id: "openAgentSkill", url: "https://www.openagentskill.com/skills" },
      ],
      completedRunCount: completedBeforeToday.length,
    };
    entries.set(asOf, { reportDate: asOf, status: "planned", plan });
  }

  await writeJson(paths.sourcePlanPath, plan);
  await writeJson(paths.sourceRotationPath, {
    version: 1,
    channel: "skill-radar",
    updatedAt: new Date().toISOString(),
    entries: [...entries.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate)),
  });
  console.log(`Prepared source portfolio plan: ${relative(paths.sourcePlanPath)}`);
  console.log(`Registry focus: ${plan.registryFocus}; official rotation: ${plan.officialSources.map((source) => source.id).join(", ")}`);
}

async function readSourcePlan(paths, asOf) {
  const plan = await readJson(paths.sourcePlanPath, null);
  if (!plan || plan.sourceProfile !== "portfolio-v1" || plan.reportDate !== asOf) {
    throw new Error(`run prepare${paths.shadow ? " --shadow" : ""} --source-portfolio for this date before filtering candidates`);
  }
  return plan;
}

async function discoverCompletedPortfolioRuns(outboxDir, beforeOrOn) {
  const files = await listFiles(outboxDir, /^skill-radar-\d{4}-\d{2}-\d{2}\.quality\.json$/);
  const runs = [];
  for (const file of files) {
    const report = await readJson(file, null);
    if (!report || report.reportDate > beforeOrOn
      || !report.decisions?.some((decision) => decision.sourceContext)) continue;
    const officialSourceIds = [...new Set(report.decisions
      .filter((decision) => decision.sourceContext?.lane === "officialRotation")
      .map((decision) => decision.sourceContext.sourceId))];
    const registryDecision = report.decisions.find((decision) => decision.sourceContext?.lane === "registryPulse");
    runs.push({
      reportDate: report.reportDate,
      status: "completed",
      actual: {
        registryFocus: registryDecision?.sourceContext?.registryView
          || inferRegistryView(registryDecision?.sourceContext?.discoverySignals),
        officialSourceIds,
        sourceCounts: report.stats?.sourceCounts || {},
      },
    });
  }
  return runs;
}

async function completeSourcePortfolioPlan(paths, report) {
  const rotation = await readJson(paths.sourceRotationPath, { version: 1, channel: "skill-radar", entries: [] });
  const entries = new Map((rotation.entries || []).map((entry) => [entry.reportDate, entry]));
  const current = entries.get(report.reportDate) || { reportDate: report.reportDate };
  entries.set(report.reportDate, {
    ...current,
    status: "completed",
    completedAt: new Date().toISOString(),
    actual: {
      registryFocus: current.plan?.registryFocus || null,
      officialSourceIds: [...new Set(report.decisions
        .filter((decision) => decision.sourceContext?.lane === "officialRotation")
        .map((decision) => decision.sourceContext.sourceId))],
      sourceCounts: report.stats.sourceCounts,
      decisionCounts: countBy(report.decisions, (decision) => decision.decision),
    },
  });
  await writeJson(paths.sourceRotationPath, {
    version: 1,
    channel: "skill-radar",
    updatedAt: new Date().toISOString(),
    entries: [...entries.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate)),
  });
}

function registryUrlFor(view) {
  return view === "all_time" ? "https://www.skills.sh/" : `https://www.skills.sh/${view}`;
}

function inferRegistryView(signals = []) {
  const normalized = signals.map((signal) => String(signal).toLowerCase());
  return REGISTRY_VIEWS.find((view) =>
    normalized.some((signal) => signal.includes(view.replace("_", "-")))) || null;
}

function flag(value) {
  return value === true || value === "true";
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
  const recovery = parseRecoveryAttempt(options);
  let reportDate = null;
  let recoveryEnabled = false;
  try {
    const inputPath = resolveRequiredInput(options.input, "finalize-curated");
    const candidatesPath = resolveRequiredInput(options.candidates, "finalize-curated --candidates");
    const input = await readJsonRequired(inputPath);
    const filtered = await readJsonRequired(candidatesPath);
    reportDate = normalizeDate(input.reportDate || beijingDate());
    const explicitEvidence = options["verification-evidence"]
      ? path.resolve(ROOT, options["verification-evidence"])
      : null;
    const defaultEvidencePath = path.join(paths.stateDir, "skill-radar-verification-evidence.json");
    recoveryEnabled = filtered.sourceProfile === "portfolio-v1"
      && (!paths.shadow || explicitEvidence || await exists(defaultEvidencePath));
    if (recovery && !recoveryEnabled) {
      throw new Error("finalization recovery is available only for Harness v2 portfolio runs");
    }
    if (recoveryEnabled) {
      if (recovery) await assertRecoveryAttemptAllowed(paths, reportDate, recovery);
      else await assertNoOpenRecovery(paths, reportDate);
    }
    await finalizeCuratedReportImpl(options);
    if (recoveryEnabled && recovery) {
      await recordFinalizationRecovery(paths, reportDate, recovery, null);
    }
  } catch (error) {
    const classified = classifyFinalizationFailure(error);
    if (recoveryEnabled && reportDate && classified) {
      await recordFinalizationRecovery(paths, reportDate, recovery, classified);
    }
    throw classified || error;
  }
}

async function finalizeCuratedReportImpl(options) {
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
  const sourceProfile = filtered.sourceProfile || "legacy-v3";
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
  const preferenceSummary = await readPreparedPreferenceSummary(paths, reportDate);
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
        type: discoveryLabel(candidate.discoveryType, candidate.sourceId),
        url: candidate.discoveryUrl,
      },
      preference: bindDecisionPreference(decision.preference, preferenceSummary, candidate.title),
      ...(sourceProfile === "portfolio-v1" ? {
        sourceContext: {
          lane: candidate.discoveryType,
          sourceId: candidate.sourceId,
          containerType: candidate.containerType,
          containerUrl: candidate.containerUrl,
          artifactType: candidate.artifactType,
          provenance: candidate.provenance,
          discoverySignals: candidate.discoverySignals,
          dependencies: candidate.dependencies,
          registryView: candidate.registryView || null,
        },
      } : {}),
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
  if (sourceProfile === "portfolio-v1") {
    const explicitEvidence = options["verification-evidence"]
      ? path.resolve(ROOT, options["verification-evidence"])
      : null;
    const evidencePath = explicitEvidence
      || path.join(paths.stateDir, "skill-radar-verification-evidence.json");
    const evidenceRequired = !paths.shadow || explicitEvidence || await exists(evidencePath);
    // Historical source-portfolio shadows predate Harness v2. Production and
    // any shadow that supplies evidence remain fail-closed.
    if (evidenceRequired) {
      let evidence;
      try {
        evidence = await readJsonRequired(evidencePath);
      } catch (error) {
        throw new HarnessValidationError(error.message, {
          code: "HARNESS_EVIDENCE_UNAVAILABLE",
          candidateId: null,
          repairable: true,
          retryStage: "deterministic",
          recommendedAction: "regenerate_evidence_artifact_from_retained_verifier_outputs",
        });
      }
      await validateVerificationHarnessV2({
        evidence,
        candidates: filtered,
        draft: deterministicRaw,
      });
    }
  }
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
  const semanticErrors = validateCuratedReport(enriched, { sourceProfile });
  if (semanticErrors.length) {
    throw new Error(`curated semantic validation failed: ${semanticErrors.join("; ")}`);
  }

  const markdownPath = path.join(paths.outboxDir, `skill-radar-${reportDate}.md`);
  await writeJson(sidecarPath, enriched);
  await fs.writeFile(markdownPath, renderMarkdown(enriched), "utf8");
  await updateCuratedReviewState(paths.reviewStatePath, enriched.decisions, reportDate);
  await completeRecheckCandidates(paths.recheckPath, enriched.decisions, reportDate);
  if (sourceProfile === "portfolio-v1") await completeSourcePortfolioPlan(paths, enriched);
  await writeJson(paths.historyPath, await buildHistory(reportDate, null, { includeShadow: paths.shadow }));
  console.log(`Finalized${paths.shadow ? " shadow" : ""} curated report: ${relative(sidecarPath)}`);
  console.log(`Rendered bilingual Markdown: ${relative(markdownPath)}`);
}

function parseRecoveryAttempt(options) {
  const roundValue = options["recovery-round"];
  const stageValue = options["recovery-stage"];
  if (roundValue == null && stageValue == null) return null;
  if (roundValue == null || stageValue == null) {
    throw new Error("--recovery-round and --recovery-stage must be provided together");
  }
  const round = Number(roundValue);
  const stage = String(stageValue);
  if (!Number.isInteger(round) || round < 1 || round > 2) {
    throw new Error("--recovery-round must be 1 or 2");
  }
  if (!new Set(["deterministic", "targeted_verifier"]).has(stage)) {
    throw new Error("--recovery-stage must be deterministic or targeted_verifier");
  }
  return { round, stage };
}

function classifyFinalizationFailure(error) {
  if (error instanceof HarnessValidationError) return error;
  const message = String(error?.message || "");
  const rules = [
    {
      pattern: /curated decisions must cover every eligible candidate|curated decision was not eligible/,
      code: "DRAFT_CANDIDATE_LINK_MISMATCH",
      retryStage: "deterministic",
      action: "rebuild_draft_candidate_links",
    },
    {
      pattern: /curated schema validation failed/,
      code: "CURATED_SCHEMA_INVALID",
      retryStage: "deterministic",
      action: "repair_only_schema_fields_derivable_from_validated_inputs",
    },
    {
      pattern: /curated semantic validation failed/,
      code: "CURATED_SEMANTIC_INVALID",
      retryStage: "deterministic",
      action: "repair_reader_copy_or_rerun_affected_verifier_if_facts_conflict",
    },
    {
      pattern: /preference is required|references unknown feedback|preference/,
      code: "PREFERENCE_BINDING_INVALID",
      retryStage: "deterministic",
      action: "rebind_preference_from_prepared_feedback_summary",
    },
  ];
  const rule = rules.find((entry) => entry.pattern.test(message));
  if (!rule) return null;
  return new HarnessValidationError(message, {
    code: rule.code,
    candidateId: message.match(/\b(src_[a-f0-9]{8})\b/)?.[1] || null,
    repairable: true,
    retryStage: rule.retryStage,
    recommendedAction: rule.action,
  });
}

async function recordFinalizationRecovery(paths, reportDate, recovery, error) {
  const recoveryPath = path.join(paths.stateDir, "skill-radar-finalization-recovery.json");
  const current = await readJson(recoveryPath, null);
  const state = current?.reportDate === reportDate
    ? current
    : { version: 1, reportDate, maxRepairRounds: 2, status: "open", initialFailure: null, attempts: [] };
  if (!recovery) {
    state.status = "open";
    state.initialFailure = error?.toJSON() || state.initialFailure;
  } else {
    const attempt = {
      round: recovery.round,
      stage: recovery.stage,
      outcome: error ? "failed" : "succeeded",
      error: error?.toJSON() || null,
      recordedAt: new Date().toISOString(),
    };
    state.attempts = [
      ...(state.attempts || []).filter((entry) => entry.round !== recovery.round),
      attempt,
    ].sort((left, right) => left.round - right.round);
    state.status = error ? "open" : "resolved";
    if (!error) state.resolvedAt = attempt.recordedAt;
  }
  await writeJson(recoveryPath, state);
}

async function assertRecoveryAttemptAllowed(paths, reportDate, recovery) {
  const recoveryPath = path.join(paths.stateDir, "skill-radar-finalization-recovery.json");
  const state = await readJson(recoveryPath, null);
  if (!state || state.reportDate !== reportDate || !state.initialFailure) {
    throw new Error("recovery attempt requires a recorded initial finalization failure for the same reportDate");
  }
  if (state.status === "resolved") {
    throw new Error("finalization recovery is already resolved");
  }
  if ((state.attempts || []).some((attempt) => attempt.round === recovery.round)) {
    throw new Error(`recovery round ${recovery.round} has already been used`);
  }
  if (recovery.round === 2 && !(state.attempts || []).some((attempt) => attempt.round === 1)) {
    throw new Error("recovery round 2 requires a completed round 1 attempt");
  }
  const latestFailure = [...(state.attempts || [])]
    .filter((attempt) => attempt.outcome === "failed" && attempt.error)
    .sort((left, right) => right.round - left.round)[0]?.error || state.initialFailure;
  if (!latestFailure.repairable || latestFailure.retryStage === "none") {
    throw new Error(`latest finalization failure is not repairable: ${latestFailure.code}`);
  }
  if (latestFailure.retryStage !== recovery.stage) {
    throw new Error(`recovery stage must be ${latestFailure.retryStage} for ${latestFailure.code}`);
  }
}

async function assertNoOpenRecovery(paths, reportDate) {
  const recoveryPath = path.join(paths.stateDir, "skill-radar-finalization-recovery.json");
  const state = await readJson(recoveryPath, null);
  if (state?.reportDate === reportDate && state.status === "open") {
    throw new Error("an open finalization recovery exists; retry with the next --recovery-round and matching --recovery-stage");
  }
}

function discoveryLabel(discoveryType, sourceId) {
  if (sourceId) {
    return {
      skillsSh: "skills-sh",
      anthropicSkills: "anthropic-skills",
      openAiPlugins: "openai-plugins",
      githubAwesomeCopilot: "github-awesome-copilot",
      cursorMarketplace: "cursor-marketplace",
      geminiExtensions: "gemini-extensions",
      nvidiaSkills: "nvidia-skills",
      huggingFaceSkills: "hugging-face-skills",
      microsoftAgentSkills: "microsoft-agent-skills",
      awesomeClaudeSkills: "awesome-claude-skills",
      openAgentSkill: "open-agent-skill",
      rooModes: "roo-modes",
      confirmedCorrection: "confirmed-recheck",
    }[sourceId];
  }
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

async function completeRecheckCandidates(recheckPath, decisions, reportDate) {
  const queue = await readJson(recheckPath, emptyRecheckQueue());
  const decisionsByArtifact = new Map(decisions.map((decision) => [decision.artifactKey, decision]));
  let changed = false;
  const candidates = queue.candidates.map((entry) => {
    if (entry.status !== "pending") return entry;
    const decision = decisionsByArtifact.get(artifactKeyForCandidate(entry.candidate));
    if (!decision) return entry;
    changed = true;
    return {
      ...entry,
      status: "completed",
      completedAt: reportDate,
      outcome: decision.decision,
    };
  });
  if (changed) await writeJson(recheckPath, { version: 1, candidates });
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
  const sourceUrl = String(options.url).trim();
  const canonicalUrl = canonicalizeUrl(options.url);
  const artifactKey = String(options["artifact-key"] || sourceUrl).trim();
  const feedbackDate = normalizeDate(options.date || beijingDate());
  const entry = {
    id: stableSourceId(artifactKey).replace(/^src_/, "fb_"),
    feedbackDate,
    reportDate: feedbackDate,
    artifactKey,
    sourceUrl,
    canonicalUrl,
    title: options.title ? String(options.title).trim() : null,
    category: String(options.category || "uncategorized"),
    rating: options.rating,
    note: options.note || null,
    recordedAt: new Date().toISOString(),
  };

  feedback.version = 2;
  feedback.entries = [
    entry,
    ...feedback.entries.filter((existing) => existing.id !== entry.id),
  ];
  await writeJson(FEEDBACK_PATH, feedback);
  console.log(`Recorded feedback for ${canonicalUrl}`);
}

async function replayFeedback(options) {
  const reportPath = resolveRequiredInput(options.report, "feedback-replay --report");
  const scenarioPath = resolveRequiredInput(options.scenario, "feedback-replay --scenario");
  const report = await readJsonRequired(reportPath);
  const scenario = await readJsonRequired(scenarioPath);

  if (report.schemaVersion !== 3 || report.status !== "published") {
    throw new Error("feedback replay requires a published schema v3 report");
  }
  if (!textValue(scenario.name) || !Array.isArray(scenario.signals) || !Array.isArray(scenario.matches)) {
    throw new Error("feedback replay scenario requires name, signals, and matches");
  }

  const recommended = report.decisions.filter((decision) => decision.decision === "recommend");
  if (!recommended.length) throw new Error("feedback replay report has no recommended items");
  const recommendedByArtifact = new Map(recommended.map((decision) => [decision.artifactKey, decision]));
  const signalIds = new Set();
  for (const signal of scenario.signals) {
    if (!textValue(signal?.id) || !["interested", "not_interested"].includes(signal?.rating)) {
      throw new Error("feedback replay signals require unique ids and valid ratings");
    }
    if (signalIds.has(signal.id)) throw new Error(`feedback replay signal id is duplicated: ${signal.id}`);
    signalIds.add(signal.id);
  }

  const matchesByArtifact = new Map();
  for (const match of scenario.matches) {
    if (!textValue(match?.artifactKey) || !recommendedByArtifact.has(match.artifactKey)) {
      throw new Error(`feedback replay match is not a recommended artifact: ${match?.artifactKey || "missing"}`);
    }
    if (matchesByArtifact.has(match.artifactKey)) {
      throw new Error(`feedback replay artifact is matched more than once: ${match.artifactKey}`);
    }
    const preference = bindDecisionPreference(match, { signals: scenario.signals }, recommendedByArtifact.get(match.artifactKey).title);
    if (preference.effect === "neutral") {
      throw new Error(`feedback replay matches must be non-neutral: ${match.artifactKey}`);
    }
    matchesByArtifact.set(match.artifactKey, preference);
  }

  const baseline = recommended.map((decision, index) => ({
    artifactKey: decision.artifactKey,
    title: decision.title,
    category: decision.category,
    baselineRank: index + 1,
    preference: matchesByArtifact.get(decision.artifactKey)
      || { effect: "neutral", matchedFeedbackIds: [], rationale: null },
  }));
  const preferenceOrder = { boosted: 0, neutral: 1, deprioritized: 2 };
  const personalized = [...baseline]
    .sort((left, right) =>
      preferenceOrder[left.preference.effect] - preferenceOrder[right.preference.effect]
      || left.baselineRank - right.baselineRank)
    .map((item, index) => ({ ...item, personalizedRank: index + 1 }));
  const personalizedByArtifact = new Map(personalized.map((item) => [item.artifactKey, item]));
  const changes = baseline.map((item) => {
    const personalizedItem = personalizedByArtifact.get(item.artifactKey);
    return {
      artifactKey: item.artifactKey,
      title: item.title,
      category: item.category,
      fromRank: item.baselineRank,
      toRank: personalizedItem.personalizedRank,
      effect: item.preference.effect,
      matchedFeedbackIds: item.preference.matchedFeedbackIds,
      rationale: item.preference.rationale,
    };
  });
  const result = {
    version: 1,
    experiment: "feedback-replay",
    scenario: {
      name: scenario.name,
      description: scenario.description || null,
      sourceReportDate: report.reportDate,
      signals: scenario.signals,
    },
    guardrails: {
      selectedSetUnchanged: baseline.length === personalized.length
        && baseline.every((item) => personalizedByArtifact.has(item.artifactKey)),
      unrelatedItemsRemainNeutral: baseline
        .filter((item) => !matchesByArtifact.has(item.artifactKey))
        .every((item) => item.preference.effect === "neutral"),
      allNonNeutralEffectsTraceable: changes
        .filter((item) => item.effect !== "neutral")
        .every((item) => item.matchedFeedbackIds.length > 0),
    },
    baselineOrder: baseline.map((item) => item.title),
    personalizedOrder: personalized.map((item) => item.title),
    changes,
  };

  if (Object.values(result.guardrails).some((passed) => !passed)) {
    throw new Error("feedback replay violated an isolation guardrail");
  }

  const outputDir = options.output
    ? resolveInput(options.output)
    : path.join(EXPERIMENTS_DIR, "feedback-replay", safeFileName(scenario.name));
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "result.json");
  const markdownPath = path.join(outputDir, "result.md");
  await writeJson(jsonPath, result);
  await fs.writeFile(markdownPath, renderFeedbackReplay(result), "utf8");
  console.log(`Completed feedback replay: ${relative(jsonPath)}`);
}

function renderFeedbackReplay(result) {
  const lines = [
    `# Feedback Replay: ${result.scenario.name}`,
    "",
    result.scenario.description || "Offline preference-ordering replay.",
    "",
    `- Source report: ${result.scenario.sourceReportDate}`,
    `- Signals: ${result.scenario.signals.length}`,
    `- Selected set unchanged: ${result.guardrails.selectedSetUnchanged ? "yes" : "no"}`,
    `- Unrelated items remain neutral: ${result.guardrails.unrelatedItemsRemainNeutral ? "yes" : "no"}`,
    "",
    "## Order comparison",
    "",
    "| Before | After | Effect | Evidence |",
    "| ---: | ---: | --- | --- |",
  ];
  for (const change of result.changes) {
    lines.push(`| ${change.fromRank}. ${change.title} | ${change.toRank}. ${change.title} | ${change.effect} | ${change.matchedFeedbackIds.join(", ") || "-"} |`);
  }
  lines.push("", "## Explanations", "");
  for (const change of result.changes.filter((item) => item.effect !== "neutral")) {
    lines.push(`- **${change.title}:** ${change.rationale}`);
  }
  return `${lines.join("\n")}\n`;
}

function safeFileName(value) {
  const normalized = String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("feedback replay scenario name cannot form an output path");
  return normalized;
}

function textValue(value) {
  return typeof value === "string" && value.trim().length > 0;
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

async function addRecheckCandidate(options) {
  const required = ["title", "source-url", "artifact-scope", "reason"];
  const missing = required.find((name) => !String(options[name] || "").trim());
  if (missing) throw new Error(`recheck-add requires --${missing}`);

  const paths = runtimePaths(options);
  await ensureLocalFiles(paths);
  const sourceUrl = String(options["source-url"]).trim();
  if (!isHttpsUrl(sourceUrl)) throw new Error("recheck-add --source-url must use HTTPS");
  const artifactScope = String(options["artifact-scope"]).trim();
  const artifactPath = options["artifact-path"] == null ? null : String(options["artifact-path"]).trim() || null;
  if (["general_skill_collection", "official_catalog", "mixed_toolkit"].includes(artifactScope) && !artifactPath) {
    throw new Error(`recheck-add requires --artifact-path for ${artifactScope}`);
  }
  const containerUrl = String(options["container-url"] || canonicalizeUrl(sourceUrl)).trim();
  const discoveryUrl = String(options["discovery-url"] || sourceUrl).trim();
  if (!isHttpsUrl(containerUrl) || !isHttpsUrl(discoveryUrl)) {
    throw new Error("recheck-add container and discovery URLs must use HTTPS");
  }
  const dependencies = String(options.dependencies || "none").split(",").map((value) => value.trim()).filter(Boolean);
  if (dependencies.some((dependency) => !DEPENDENCY_TYPES.has(dependency))
    || (dependencies.includes("none") && dependencies.length !== 1)) {
    throw new Error("recheck-add --dependencies is invalid");
  }
  const candidate = {
    title: String(options.title).trim(),
    sourceUrl,
    artifactScope,
    artifactPath,
    discoveryType: "recheck",
    sourceId: "confirmedCorrection",
    discoveryUrl,
    containerType: String(options["container-type"] || "repository"),
    containerUrl,
    artifactType: String(options["artifact-type"] || "skill"),
    provenance: String(options.provenance || "first_party"),
    discoverySignals: ["confirmed-correction"],
    dependencies,
    registryView: null,
  };
  validatePortfolioCandidate(candidate, 0, "recheck", artifactPath, {
    registryFocus: null,
    officialSources: [],
  });

  const queue = await readJson(paths.recheckPath, emptyRecheckQueue());
  const artifactKey = artifactKeyForCandidate(candidate);
  const existing = queue.candidates.find((entry) =>
    artifactKeyForCandidate(entry.candidate) === artifactKey && entry.status === "pending");
  if (existing) {
    console.log(`Recheck candidate already pending: ${candidate.title}`);
    return;
  }
  if (queue.candidates.filter((entry) => entry.status === "pending").length >= 4) {
    throw new Error("recheck queue already has four pending candidates");
  }
  queue.candidates.push({
    id: stableSourceId(`recheck:${artifactKey}`),
    status: "pending",
    reason: String(options.reason).trim(),
    queuedAt: new Date().toISOString(),
    completedAt: null,
    outcome: null,
    candidate,
  });
  await writeJson(paths.recheckPath, queue);
  console.log(`Added recheck candidate: ${candidate.title}`);
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
  const preferenceDecisions = selected.flatMap((report) => report.decisions || []);
  const boostedDecisions = preferenceDecisions.filter((decision) => decision.preference?.effect === "boosted");
  const deprioritizedDecisions = preferenceDecisions.filter((decision) => decision.preference?.effect === "deprioritized");
  const referencedFeedbackIds = new Set(preferenceDecisions.flatMap((decision) =>
    decision.preference?.matchedFeedbackIds || []));
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
    `- Preference effects: ${boostedDecisions.length} boosted, ${deprioritizedDecisions.length} deprioritized`,
    `- Feedback signals referenced by later decisions: ${referencedFeedbackIds.size}`,
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
        what: "它能帮你做什么",
        why: "为什么现在值得看",
        problem: "解决问题",
        bestFor: "什么时候值得用",
        prerequisite: "开始前需要",
        usability: "安装与开始",
        adaptation: "平台适配",
        limitations: "限制与风险",
        trust: "信任/安全",
        conclusion: "今日结论",
      }
    : {
        category: "Category",
        source: "Source",
        what: "What it helps you do",
        why: "Why now",
        problem: "Problem solved",
        bestFor: "When it helps",
        prerequisite: "Before you start",
        usability: "Install and get started",
        adaptation: "Platform adaptation",
        limitations: "Limits and risks",
        trust: "Trust/security",
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
      `- **${labels.what}:** ${display.oneLiner}`,
      `- **${labels.why}:** ${display.whyNow}`,
      `- **${labels.problem}:** ${display.problem}`,
      `- **${labels.bestFor}:** ${display.bestFor}`,
      `- **${labels.prerequisite}:** ${display.action}`,
      `- **${labels.usability}:** ${display.usability}`,
      `- **${labels.adaptation}:** ${display.adaptation}`,
      `- **${labels.limitations}:** ${display.primaryCaution}`,
      `- **${labels.trust}:** ${display.trust}`,
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
  const signals = [...entries]
    .sort((left, right) => String(right.recordedAt || "").localeCompare(String(left.recordedAt || "")))
    .slice(0, 50)
    .map((entry) => ({
      id: String(entry.id),
      rating: entry.rating,
      title: entry.title || null,
      category: entry.category || "uncategorized",
      artifactKey: entry.artifactKey || entry.canonicalUrl,
      canonicalUrl: entry.canonicalUrl,
      note: entry.note || null,
      recordedAt: entry.recordedAt || null,
    }));
  return {
    version: 2,
    policy: "positive-interest-primary",
    totalFeedback: entries.length,
    interestedCount: entries.filter((entry) => entry.rating === "interested").length,
    notInterestedCount: entries.filter((entry) => entry.rating === "not_interested").length,
    unratedMeans: "unknown",
    categories,
    signals,
  };
}

async function readPreparedPreferenceSummary(paths, reportDate) {
  const context = await readJson(paths.contextPath, null);
  if (!context || context.asOf !== reportDate) return summarizePreferences([]);
  return context.preferenceSummary || summarizePreferences([]);
}

function bindDecisionPreference(value, summary, title) {
  const signals = Array.isArray(summary?.signals) ? summary.signals : [];
  const knownSignals = new Map(signals.map((signal) => [signal.id, signal]));
  if (!signals.length && value == null) {
    return { effect: "neutral", matchedFeedbackIds: [], rationale: null };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`curated decision preference is required when feedback exists: ${title}`);
  }
  const effect = String(value.effect || "neutral");
  if (!new Set(["boosted", "neutral", "deprioritized"]).has(effect)) {
    throw new Error(`curated decision preference effect is invalid: ${title}`);
  }
  const matchedFeedbackIds = Array.isArray(value.matchedFeedbackIds)
    ? [...new Set(value.matchedFeedbackIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  const rationale = value.rationale == null ? null : String(value.rationale).trim() || null;
  const matchedSignals = matchedFeedbackIds.map((id) => {
    const signal = knownSignals.get(id);
    if (!signal) throw new Error(`curated decision references unknown feedback ${id}: ${title}`);
    return signal;
  });
  if (effect === "neutral") {
    if (matchedFeedbackIds.length || rationale !== null) {
      throw new Error(`neutral preference cannot claim feedback evidence: ${title}`);
    }
  } else {
    if (!matchedFeedbackIds.length || !rationale) {
      throw new Error(`non-neutral preference requires feedback evidence and rationale: ${title}`);
    }
    const expectedRating = effect === "boosted" ? "interested" : "not_interested";
    if (matchedSignals.some((signal) => signal.rating !== expectedRating)) {
      throw new Error(`${effect} preference uses incompatible feedback: ${title}`);
    }
  }
  return { effect, matchedFeedbackIds, rationale };
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
  if (!(await exists(paths.recheckPath))) await writeJson(paths.recheckPath, emptyRecheckQueue());
  if (!(await exists(paths.reviewStatePath))) {
    await writeJson(paths.reviewStatePath, { version: 1, channel: "skill-radar", entries: [] });
  }
}

function emptyInbox() {
  return { version: 1, candidates: [] };
}

function emptyRecheckQueue() {
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
    recheckPath: shadow
      ? path.join(SHADOW_INBOX_DIR, "recheck-candidates.json")
      : RECHECK_PATH,
    sourcePlanPath: path.join(stateDir, "skill-radar-source-plan.json"),
    sourceRotationPath: path.join(stateDir, "skill-radar-source-rotation.json"),
  };
}

function artifactKeyForCandidate(candidate) {
  return artifactKeyFor({
    sourceUrl: String(candidate.sourceUrl || ""),
    quality: {
      evidence: {
        artifactScope: String(candidate.artifactScope || "individual_skill"),
        artifactPath: candidate.artifactPath == null ? null : String(candidate.artifactPath),
      },
    },
  });
}

function recheckCandidateShape(candidate) {
  return {
    title: String(candidate.title || ""),
    sourceUrl: String(candidate.sourceUrl || ""),
    artifactScope: String(candidate.artifactScope || ""),
    artifactPath: candidate.artifactPath == null ? null : String(candidate.artifactPath),
    discoveryType: String(candidate.discoveryType || ""),
    sourceId: String(candidate.sourceId || ""),
    discoveryUrl: String(candidate.discoveryUrl || ""),
    containerType: String(candidate.containerType || ""),
    containerUrl: String(candidate.containerUrl || ""),
    artifactType: String(candidate.artifactType || ""),
    provenance: String(candidate.provenance || ""),
    discoverySignals: Array.isArray(candidate.discoverySignals) ? candidate.discoverySignals.map(String) : [],
    dependencies: Array.isArray(candidate.dependencies) ? candidate.dependencies.map(String) : [],
    registryView: candidate.registryView ?? null,
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
  prepare [--date YYYY-MM-DD] [--shadow] [--source-portfolio]
  finalize --input reports/state/skill-radar-draft.json [--shadow]
  finalize-curated --input FILE --candidates FILTERED_FILE [--verification-evidence FILE] [--recovery-round 1|2 --recovery-stage deterministic|targeted_verifier] [--shadow]
  filter-candidates --input FILE [--output FILE] [--date YYYY-MM-DD] [--shadow] [--source-portfolio]
  feedback --url URL --rating interested|not_interested [--date YYYY-MM-DD] [--title NAME] [--artifact-key KEY] [--category NAME] [--note TEXT]
  feedback-replay --report SIDECAR --scenario FILE [--output DIR]
  social-add --url https://x.com/... [--note TEXT]
  recheck-add --title NAME --source-url URL --artifact-scope SCOPE --reason TEXT [--artifact-path PATH] [--discovery-url URL] [--container-url URL] [--dependencies LIST] [--shadow]
  summary [--days 30] [--date YYYY-MM-DD]`);
}
