import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_PATH = path.join(ROOT, "schemas", "skill-radar-verification-v1.schema.json");
const args = parseArgs(process.argv.slice(2));
const [schema, evidenceFile, candidateFile, draftFile] = await Promise.all([
  readJson(SCHEMA_PATH),
  readJson(args.evidence),
  readJson(args.candidates),
  args.draft ? readJson(args.draft) : null,
]);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(evidenceFile)) {
  fail(validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n"));
}

validateEvidence(evidenceFile, candidateFile, draftFile);
console.log(`Valid multi-agent verification evidence: ${args.evidence}`);

function validateEvidence(evidence, candidates, draft) {
  if (evidence.reportDate !== candidates.asOf) fail("evidence reportDate must match candidates.asOf");
  const eligible = Array.isArray(candidates.eligibleCandidates) ? candidates.eligibleCandidates : [];
  if (eligible.length < 5 || eligible.length > 20) fail("candidates must contain five to twenty eligible candidates");
  requireCompletedRun(evidence.primaryVerifier, "primaryVerifier");

  const expected = new Map(eligible.map((candidate) => [candidate.id, candidate]));
  const results = new Map();
  for (const result of evidence.results) {
    if (results.has(result.candidateId)) fail(`duplicate evidence candidateId: ${result.candidateId}`);
    results.set(result.candidateId, result);
  }
  if (results.size !== expected.size) fail("evidence must cover every eligible candidate exactly once");

  for (const [id, candidate] of expected) {
    const result = results.get(id);
    if (!result) fail(`missing verification evidence for ${id}`);
    if (result.artifactKey !== candidate.artifactKey) fail(`${id}: artifactKey does not match filtered candidate`);
    const final = result.reconciled;
    if (!["verified_current", "recovered_current", "migrated"].includes(final.verdict)) {
      fail(`${id}: unresolved source verdict cannot enter main-model evaluation`);
    }
    if (normalizeUrl(final.currentUrl) !== normalizeUrl(candidate.sourceUrl)) {
      fail(`${id}: verified current URL does not match filtered candidate`);
    }
    if (normalizeArtifactPath(final.artifactPath) !== normalizeArtifactPath(candidate.artifactPath)) {
      fail(`${id}: verified artifact path does not match filtered candidate`);
    }
    if (!final.skillMdVerified || final.repositoryStatus !== "current") {
      fail(`${id}: final evidence must verify a current exact artifact`);
    }

    const riskRequiresSpecialist = result.primary.verdict === "migrated"
      || result.primary.identityChanged
      || result.primary.repositoryStatus !== "current";
    if (result.specialistRequired !== riskRequiresSpecialist) {
      fail(`${id}: specialistRequired does not match the risk trigger`);
    }
    if (riskRequiresSpecialist) {
      requireCompletedRun(evidence.specialistVerifier, "specialistVerifier");
      if (!result.specialist) fail(`${id}: specialist evidence is required`);
      if (materialIdentity(result.primary) !== materialIdentity(result.specialist)) {
        fail(`${id}: unresolved specialist disagreement cannot enter main-model evaluation`);
      }
    } else if (result.specialist !== null) {
      fail(`${id}: specialist evidence is not expected`);
    }
  }

  if (!draft) return;
  const decisions = Array.isArray(draft.decisions) ? draft.decisions : [];
  if (decisions.length !== expected.size) fail("draft decisions must match eligible candidate count");
  const seen = new Set();
  for (const decision of decisions) {
    const candidate = eligible.find((entry) =>
      normalizeUrl(entry.sourceUrl) === normalizeUrl(decision.sourceUrl)
      && normalizeArtifactPath(entry.artifactPath) === normalizeArtifactPath(decision.artifactPath));
    if (!candidate) fail(`draft decision has no matching verified candidate: ${decision.title || "unknown"}`);
    if (seen.has(candidate.id)) fail(`draft repeats verified candidate: ${candidate.id}`);
    seen.add(candidate.id);
    const result = results.get(candidate.id);
    if (decision.verification?.candidateId !== candidate.id
      || decision.verification?.verdict !== result.reconciled.verdict
      || normalizeUrl(decision.verification?.currentUrl) !== normalizeUrl(candidate.sourceUrl)) {
      fail(`${candidate.id}: draft verification reference is missing or inconsistent`);
    }
  }
}

function requireCompletedRun(run, label) {
  if (!run?.attempted || !run.available || !run.completed || !run.freshContextRequested) {
    fail(`${label} must be an available, completed fresh-context subagent`);
  }
}

function materialIdentity(value) {
  return JSON.stringify([
    value.verdict,
    normalizeUrl(value.currentUrl),
    normalizeArtifactPath(value.artifactPath),
    value.repositoryStatus,
    value.identityChanged,
  ]);
}

function normalizeUrl(value) {
  return value == null ? null : String(value).replace(/\/+$/, "");
}

function normalizeArtifactPath(value) {
  return value == null ? null : String(value).replace(/^\/+|\/+$/g, "").replace(/\/SKILL\.md$/i, "");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (!key || !value) fail("Usage: --evidence PATH --candidates PATH [--draft PATH]");
    parsed[key] = path.resolve(ROOT, value);
  }
  if (!parsed.evidence || !parsed.candidates) fail("--evidence and --candidates are required");
  return parsed;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    fail(`Cannot read JSON ${filePath}: ${error.message}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
