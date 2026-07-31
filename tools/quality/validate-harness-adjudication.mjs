import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_PATH = path.join(ROOT, "schemas", "harness-adjudication-test-v1.schema.json");
const EXPECTED_URL =
  "https://github.com/remotion-dev/remotion/tree/main/packages/skills/skills/remotion-best-practices";
const EXPECTED_PATH = "packages/skills/skills/remotion-best-practices";
const resultPath = parseResultPath(process.argv.slice(2));
const [schema, result] = await Promise.all([readJson(SCHEMA_PATH), readJson(resultPath)]);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(result)) {
  fail(validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n"));
}

const decision = result.case.adjudication;
if (decision.verdict !== "migrated") fail("expected migrated verdict");
if (normalizeUrl(decision.currentUrl) !== EXPECTED_URL) fail("expected exact current Remotion skill URL");
if (normalizePath(decision.artifactPath) !== EXPECTED_PATH) fail("expected exact current Remotion artifact path");
if (decision.repositoryStatus !== "current" || !decision.skillMdVerified) {
  fail("expected a verified current first-party artifact");
}
if (!decision.sourceRepositoryChanged) fail("repository migration must be recorded");
if (decision.identityChanged) fail("identity-continuous repository migration must not change artifact identity");
if (result.case.parent.disposition !== "evaluate_current"
  || normalizeUrl(result.case.parent.decisionSourceUrl) !== EXPECTED_URL) {
  fail("parent routing must use the adjudicated current artifact");
}

console.log(`Valid targeted harness adjudication result: ${resultPath}`);

function normalizeUrl(value) {
  return value == null ? null : String(value).replace(/\/+$/, "");
}

function normalizePath(value) {
  return value == null ? null : String(value).replace(/^\/+|\/+$/g, "").replace(/\/SKILL\.md$/i, "");
}

function parseResultPath(args) {
  const index = args.indexOf("--result");
  if (index < 0 || !args[index + 1]) {
    fail("Usage: node tools/quality/validate-harness-adjudication-test.mjs --result PATH");
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
