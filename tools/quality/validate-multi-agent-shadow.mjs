import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_PATH = path.join(ROOT, "test-support", "multi-agent-verifier-cases.json");
const SCHEMA_PATH = path.join(ROOT, "schemas", "multi-agent-verifier-test-v1.schema.json");
const ELIGIBLE_VERDICTS = new Set(["verified_current", "recovered_current", "migrated"]);

const resultPath = parseResultPath(process.argv.slice(2));
const [fixture, schema, result] = await Promise.all([
  readJson(FIXTURE_PATH),
  readJson(SCHEMA_PATH),
  readJson(resultPath),
]);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(result)) {
  fail(validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n"));
}

validateRunContract(fixture, result);
console.log(`Valid multi-agent adversarial shadow result: ${resultPath}`);

function validateRunContract(expected, actual) {
  const expectedById = new Map(expected.cases.map((item) => [item.id, item]));
  const actualById = new Map();
  for (const item of actual.cases) {
    if (actualById.has(item.id)) fail(`Duplicate case id: ${item.id}`);
    actualById.set(item.id, item);
  }
  if (actualById.size !== expectedById.size) {
    fail(`Expected ${expectedById.size} cases, received ${actualById.size}`);
  }

  if (!actual.primaryVerifier.attempted
    || !actual.primaryVerifier.available
    || !actual.primaryVerifier.completed
    || !actual.primaryVerifier.freshContextRequested) {
    fail("Primary verifier must be an available, completed fresh-context subagent");
  }
  if (!actual.specialistVerifier.attempted
    || !actual.specialistVerifier.available
    || !actual.specialistVerifier.completed
    || !actual.specialistVerifier.freshContextRequested) {
    fail("Specialist verifier must be an available, completed fresh-context subagent");
  }

  for (const [id, expectedCase] of expectedById) {
    const actualCase = actualById.get(id);
    if (!actualCase) fail(`Missing case: ${id}`);
    if (actualCase.title !== expectedCase.title) fail(`${id}: title changed`);

    if (expectedCase.requiresSpecialist && !actualCase.specialist) {
      fail(`${id}: specialist evidence is required`);
    }
    if (!expectedCase.requiresSpecialist && actualCase.specialist !== null) {
      fail(`${id}: unexpected specialist evidence`);
    }

    const finalEvidence = actualCase.reconciled;
    if (finalEvidence.verdict !== expectedCase.expectedVerdict) {
      fail(`${id}: expected ${expectedCase.expectedVerdict}, received ${finalEvidence.verdict}`);
    }
    if (finalEvidence.repositoryStatus !== expectedCase.expectedRepositoryStatus) {
      fail(`${id}: expected repository status ${expectedCase.expectedRepositoryStatus}, received ${finalEvidence.repositoryStatus}`);
    }
    if (expectedCase.expectedCurrentUrlPrefix) {
      if (!finalEvidence.currentUrl?.startsWith(expectedCase.expectedCurrentUrlPrefix)) {
        fail(`${id}: current URL does not match the expected maintained source`);
      }
      if (!finalEvidence.skillMdVerified) {
        fail(`${id}: current SKILL.md was not verified`);
      }
    } else if (finalEvidence.currentUrl !== null) {
      fail(`${id}: ambiguous or invalid evidence must not select a current URL`);
    }

    if (finalEvidence.verdict === "migrated" && !finalEvidence.identityChanged) {
      fail(`${id}: migration must record an identity or scope change`);
    }

    const expectedDisposition = ELIGIBLE_VERDICTS.has(finalEvidence.verdict)
      ? "evaluate_current"
      : finalEvidence.verdict === "ambiguous"
        ? "defer_ambiguous"
        : "reject_invalid";
    if (actualCase.parent.disposition !== expectedDisposition) {
      fail(`${id}: parent disposition does not follow reconciled evidence`);
    }
    const expectedDecisionUrl = expectedDisposition === "evaluate_current"
      ? finalEvidence.currentUrl
      : null;
    if (actualCase.parent.decisionSourceUrl !== expectedDecisionUrl) {
      fail(`${id}: parent did not use the reconciled current URL`);
    }

    if (actualCase.specialist) {
      const disagreement = evidenceIdentity(actualCase.primary)
        !== evidenceIdentity(actualCase.specialist);
      if (actualCase.reconciled.disagreement !== disagreement) {
        fail(`${id}: disagreement flag does not match verifier outputs`);
      }
      if (disagreement && actualCase.reconciled.verdict !== "ambiguous") {
        fail(`${id}: unresolved verifier disagreement must remain ambiguous`);
      }
    } else if (actualCase.reconciled.disagreement) {
      fail(`${id}: disagreement cannot be true without specialist evidence`);
    }
  }
}

function evidenceIdentity(value) {
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
  return value == null
    ? null
    : String(value).replace(/^\/+|\/+$/g, "").replace(/\/SKILL\.md$/i, "");
}

function parseResultPath(args) {
  const index = args.indexOf("--result");
  if (index < 0 || !args[index + 1]) {
    fail("Usage: node tools/quality/validate-multi-agent-shadow.mjs --result PATH");
  }
  return path.resolve(ROOT, args[index + 1]);
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
