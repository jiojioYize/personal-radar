import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_PATH = path.join(ROOT, "schemas", "skill-radar-verification-v2.schema.json");
const MATERIAL_FIELDS = [
  "verdict",
  "currentUrl",
  "artifactPath",
  "repositoryStatus",
  "sourceRepositoryChanged",
  "identityChanged",
];
const ELIGIBLE_VERDICTS = new Set(["verified_current", "recovered_current", "migrated"]);
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

validateHarness(evidenceFile, candidateFile, draftFile);
console.log(`Valid adjudicated verification harness evidence: ${args.evidence}`);

function validateHarness(evidence, candidates, draft) {
  if (evidence.reportDate !== candidates.asOf) {
    fail("evidence reportDate must match candidates.asOf");
  }
  const eligible = Array.isArray(candidates.eligibleCandidates) ? candidates.eligibleCandidates : [];
  if (eligible.length < 5 || eligible.length > 20) {
    fail("candidates must contain five to twenty eligible candidates");
  }
  requireCompletedRun(evidence.runs.primary, "runs.primary");

  const expected = new Map(eligible.map((candidate) => [candidate.id, candidate]));
  const retained = new Map();
  const seen = new Set();
  let specialistUsed = false;
  let adjudicatorUsed = false;

  for (const result of evidence.results) {
    if (seen.has(result.candidateId)) {
      fail(`duplicate evidence candidateId: ${result.candidateId}`);
    }
    seen.add(result.candidateId);

    const riskRequiresSpecialist = result.primary.verdict === "migrated"
      || result.primary.identityChanged
      || result.primary.repositoryStatus !== "current";
    if (result.specialistRequired !== riskRequiresSpecialist) {
      fail(`${result.candidateId}: specialistRequired does not match the risk trigger`);
    }

    if (riskRequiresSpecialist) {
      specialistUsed = true;
      if (!result.specialist) {
        fail(`${result.candidateId}: specialist evidence is required`);
      }
    } else if (result.specialist !== null) {
      fail(`${result.candidateId}: specialist evidence is not expected`);
    }

    validateEvidenceSemantics(result.primary, `${result.candidateId}: primary`);
    if (result.specialist) {
      validateEvidenceSemantics(result.specialist, `${result.candidateId}: specialist`);
    }

    const disagreements = result.specialist
      ? materialDisagreementFields(result.primary, result.specialist)
      : [];
    if (!sameStringArray(result.disagreementFields, disagreements)) {
      fail(`${result.candidateId}: disagreementFields do not match verifier outputs`);
    }

    const adjudicationRequired = disagreements.length > 0;
    if (result.adjudicationRequired !== adjudicationRequired) {
      fail(`${result.candidateId}: adjudicationRequired does not match material disagreement`);
    }

    let expectedReconciled;
    if (adjudicationRequired) {
      adjudicatorUsed = true;
      validateDispute(result.candidateId, result.dispute, disagreements);
      if (!result.adjudication) {
        fail(`${result.candidateId}: adjudication evidence is required`);
      }
      validateEvidenceSemantics(result.adjudication, `${result.candidateId}: adjudication`);
      expectedReconciled = result.adjudication;
    } else {
      if (result.dispute !== null || result.adjudication !== null) {
        fail(`${result.candidateId}: dispute and adjudication are not expected`);
      }
      expectedReconciled = result.specialist ?? result.primary;
    }

    if (materialIdentity(result.reconciled) !== materialIdentity(expectedReconciled)) {
      fail(`${result.candidateId}: reconciled identity must follow the adjudication protocol`);
    }
    validateEvidenceSemantics(result.reconciled, `${result.candidateId}: reconciled`);

    if (result.disposition === "retained") {
      validateRetained(result, expected);
      retained.set(result.candidateId, result);
    } else {
      validateRemoved(result, expected, adjudicationRequired);
    }
  }

  if (retained.size !== expected.size) {
    fail("retained evidence must cover every final eligible candidate exactly once");
  }
  for (const id of expected.keys()) {
    if (!retained.has(id)) fail(`missing retained verification evidence for ${id}`);
  }

  if (specialistUsed) {
    requireCompletedRun(evidence.runs.specialist, "runs.specialist");
  } else {
    requireUnusedRun(evidence.runs.specialist, "runs.specialist");
  }
  if (adjudicatorUsed) {
    requireCompletedRun(evidence.runs.adjudicator, "runs.adjudicator");
  } else {
    requireUnusedRun(evidence.runs.adjudicator, "runs.adjudicator");
  }

  if (draft) validateDraft(draft, eligible, retained);
}

function validateEvidenceSemantics(value, label) {
  if (value.verdict === "migrated" && !value.sourceRepositoryChanged) {
    fail(`${label} migrated verdict requires sourceRepositoryChanged true`);
  }
  if (["verified_current", "recovered_current"].includes(value.verdict)
    && value.sourceRepositoryChanged) {
    fail(`${label} sourceRepositoryChanged true requires migrated or unresolved verdict`);
  }
}

function validateDispute(candidateId, dispute, disagreements) {
  if (!dispute) fail(`${candidateId}: structured dispute packet is required`);
  if (!sameStringArray(dispute.fields, disagreements)) {
    fail(`${candidateId}: dispute fields do not match material disagreement`);
  }
  const questionFields = dispute.questions.map((item) => item.field);
  if (!sameStringArray(questionFields, disagreements)) {
    fail(`${candidateId}: dispute must contain one question for every disagreement field`);
  }
}

function validateRetained(result, expected) {
  const candidate = expected.get(result.candidateId);
  if (!candidate) {
    fail(`${result.candidateId}: retained result is not in the final candidate set`);
  }
  if (result.artifactKey !== candidate.artifactKey) {
    fail(`${result.candidateId}: artifactKey does not match filtered candidate`);
  }
  if (result.removalReason !== null || result.requiresFollowup) {
    fail(`${result.candidateId}: retained result cannot carry removal state`);
  }
  const final = result.reconciled;
  if (!ELIGIBLE_VERDICTS.has(final.verdict)) {
    fail(`${result.candidateId}: unresolved source verdict cannot be retained`);
  }
  if (!sameSourceArtifact(final.currentUrl, candidate.sourceUrl, candidate.artifactPath)) {
    fail(`${result.candidateId}: verified current URL does not match filtered candidate`);
  }
  if (normalizeArtifactPath(final.artifactPath) !== normalizeArtifactPath(candidate.artifactPath)) {
    fail(`${result.candidateId}: verified artifact path does not match filtered candidate`);
  }
  if (!final.skillMdVerified || final.repositoryStatus !== "current") {
    fail(`${result.candidateId}: retained evidence must verify a current exact artifact`);
  }
}

function validateRemoved(result, expected, adjudicationRequired) {
  if (expected.has(result.candidateId)) {
    fail(`${result.candidateId}: final eligible candidate cannot be marked removed`);
  }
  if (result.removalReason === null) {
    fail(`${result.candidateId}: removed result requires a removalReason`);
  }
  const unresolved = !ELIGIBLE_VERDICTS.has(result.reconciled.verdict);
  if (!unresolved && result.removalReason !== "verification_contract_failure") {
    fail(`${result.candidateId}: verified current evidence cannot be removed without a contract failure`);
  }
  if (adjudicationRequired && unresolved) {
    if (result.removalReason !== "adjudication_unresolved" || !result.requiresFollowup) {
      fail(`${result.candidateId}: unresolved adjudication must require follow-up`);
    }
  }
  if (!adjudicationRequired && result.removalReason === "adjudication_unresolved") {
    fail(`${result.candidateId}: adjudication removal requires a material disagreement`);
  }
}

function validateDraft(draft, eligible, retained) {
  const decisions = Array.isArray(draft.decisions) ? draft.decisions : [];
  if (decisions.length !== eligible.length) {
    fail("draft decisions must match eligible candidate count");
  }
  const seen = new Set();
  for (const decision of decisions) {
    const candidate = eligible.find((entry) =>
      sameSourceArtifact(entry.sourceUrl, decision.sourceUrl, entry.artifactPath)
      && normalizeArtifactPath(entry.artifactPath) === normalizeArtifactPath(decision.artifactPath));
    if (!candidate) {
      fail(`draft decision has no matching retained candidate: ${decision.title || "unknown"}`);
    }
    if (seen.has(candidate.id)) fail(`draft repeats retained candidate: ${candidate.id}`);
    seen.add(candidate.id);
    const result = retained.get(candidate.id);
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

function requireUnusedRun(run, label) {
  if (run.attempted || run.available || run.completed || run.freshContextRequested || run.retryCount !== 0) {
    fail(`${label} must remain unused when no candidate requires it`);
  }
}

function materialDisagreementFields(left, right) {
  return MATERIAL_FIELDS.filter((field) => materialFieldValue(left, field) !== materialFieldValue(right, field));
}

function materialFieldValue(value, field) {
  if (field === "currentUrl") {
    return sourceArtifactIdentity(value.currentUrl, value.artifactPath);
  }
  if (field === "artifactPath") return normalizeArtifactPath(value.artifactPath);
  return JSON.stringify(value[field]);
}

function materialIdentity(value) {
  return JSON.stringify(MATERIAL_FIELDS.map((field) => materialFieldValue(value, field)));
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
    if (!key || !value) {
      fail("Usage: --evidence PATH --candidates PATH [--draft PATH]");
    }
    parsed[key] = path.resolve(ROOT, value);
  }
  if (!parsed.evidence || !parsed.candidates) {
    fail("--evidence and --candidates are required");
  }
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
