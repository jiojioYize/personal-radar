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
  const removals = new Set();
  for (const removal of evidence.removals) {
    if (removals.has(removal.candidateId)) {
      fail(`duplicate removal candidateId: ${removal.candidateId}`);
    }
    removals.add(removal.candidateId);
    if (results.has(removal.candidateId)) {
      fail(`${removal.candidateId}: candidate cannot be both retained and removed`);
    }
    if (removal.reason === "specialist_disagreement") {
      if (removal.stage !== "specialist_reconciliation"
        || removal.specialistVerdict === null
        || removal.disagreementFields.length === 0
        || !removal.requiresFollowup) {
        fail(`${removal.candidateId}: specialist disagreement must be auditable and require follow-up`);
      }
    } else if (removal.disagreementFields.length > 0) {
      fail(`${removal.candidateId}: disagreementFields require specialist_disagreement`);
    }
  }

  for (const [id, candidate] of expected) {
    const result = results.get(id);
    if (!result) fail(`missing verification evidence for ${id}`);
    if (result.artifactKey !== candidate.artifactKey) fail(`${id}: artifactKey does not match filtered candidate`);
    const final = result.reconciled;
    if (!["verified_current", "recovered_current", "migrated"].includes(final.verdict)) {
      fail(`${id}: unresolved source verdict cannot enter main-model evaluation`);
    }
    if (!sameSourceArtifact(final.currentUrl, candidate.sourceUrl, candidate.artifactPath)) {
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
      sameSourceArtifact(entry.sourceUrl, decision.sourceUrl, entry.artifactPath)
      && normalizeArtifactPath(entry.artifactPath) === normalizeArtifactPath(decision.artifactPath));
    if (!candidate) fail(`draft decision has no matching verified candidate: ${decision.title || "unknown"}`);
    if (seen.has(candidate.id)) fail(`draft repeats verified candidate: ${candidate.id}`);
    seen.add(candidate.id);
    const result = results.get(candidate.id);
    if (decision.verification?.candidateId !== candidate.id
      || decision.verification?.verdict !== result.reconciled.verdict
      || !sameSourceArtifact(
        decision.verification?.currentUrl,
        candidate.sourceUrl,
        candidate.artifactPath
      )) {
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
    sourceArtifactIdentity(value.currentUrl, value.artifactPath),
    normalizeArtifactPath(value.artifactPath),
    value.repositoryStatus,
    value.identityChanged,
  ]);
}

function sameSourceArtifact(left, right, artifactPath) {
  return sourceArtifactIdentity(left, artifactPath) === sourceArtifactIdentity(right, artifactPath);
}

function sourceArtifactIdentity(value, artifactPath) {
  const normalizedUrl = normalizeUrl(value);
  if (normalizedUrl == null) return null;
  return githubFileIdentity(normalizedUrl, artifactPath) ?? normalizedUrl;
}

function githubFileIdentity(value, artifactPath) {
  const normalizedArtifactPath = normalizeArtifactPath(artifactPath);
  if (!normalizedArtifactPath) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodePathSegment);
  const artifactParts = normalizedArtifactPath.split("/").filter(Boolean);
  const artifactFileParts = [...artifactParts, "SKILL.md"];
  let owner;
  let repository;
  let refAndFileParts;

  if (host === "github.com" && parts[2] === "blob") {
    [owner, repository] = parts;
    refAndFileParts = parts.slice(3);
  } else if (host === "raw.githubusercontent.com") {
    [owner, repository] = parts;
    refAndFileParts = parts.slice(2);
  } else {
    return null;
  }

  if (!owner || !repository || !endsWithSegments(refAndFileParts, artifactFileParts)) {
    return null;
  }

  // The artifact key and artifact-path checks separately protect repository
  // and path identity. This canonical form only treats GitHub's human-readable
  // blob page and raw-content endpoint as equivalent views of that same file.
  return `github-file:${owner.toLowerCase()}/${repository.toLowerCase()}#artifact=${normalizedArtifactPath}`;
}

function endsWithSegments(value, suffix) {
  if (value.length <= suffix.length) return false;
  const offset = value.length - suffix.length;
  return suffix.every((segment, index) => value[offset + index] === segment);
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
