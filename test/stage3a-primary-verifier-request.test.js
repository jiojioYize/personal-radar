import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import {
  MODEL_POLICY_VERSION,
  STAGE3A_MODEL_POLICY,
  estimateModelCostUsdMicros,
  modelPolicyHash,
} from "../src/stage3a/model-policy.js";
import {
  PRIMARY_VERIFIER_MAXIMUM_SOURCE_BYTES,
  PrimaryVerifierPreparationError,
  buildPrimaryVerifierRequest,
  primaryVerifierOutputSchema,
} from "../src/stage3a/primary-verifier-request.js";

test("freezes a role-specific GPT-5.6 policy and estimates costs from its price book", async () => {
  assert.equal(MODEL_POLICY_VERSION, "stage3a-openai-gpt-5.6-v1");
  assert.deepEqual(STAGE3A_MODEL_POLICY.roles.primary, {
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    maximumAttempts: 2,
  });
  assert.equal(STAGE3A_MODEL_POLICY.roles.adjudicator.model, "gpt-5.6-sol");
  assert.equal(estimateModelCostUsdMicros({
    role: "primary",
    inputTokens: 1_000,
    cachedInputTokens: 100,
    outputTokens: 500,
  }), 9_775);
  assert.match(await modelPolicyHash(), /^[a-f0-9]{64}$/);
  assert.throws(() => estimateModelCostUsdMicros({
    role: "primary", inputTokens: 1, cachedInputTokens: 2, outputTokens: 0,
  }), /cannot exceed/);
});

test("builds a stateless strict primary-verifier Responses request from one evidence case", async () => {
  const input = await verifierInput("# Browser Skill\n\nUse this skill for bounded browser checks.");
  const first = await buildPrimaryVerifierRequest(input, { safetyIdentifier: "single_user_01" });
  const replay = await buildPrimaryVerifierRequest(input, { safetyIdentifier: "single_user_01" });
  assert.equal(first.requestHash, replay.requestHash);
  assert.equal(first.role, "primary");
  assert.equal(first.request.model, "gpt-5.6-terra");
  assert.equal(first.request.store, false);
  assert.equal(first.request.previous_response_id, undefined);
  assert.deepEqual(first.request.reasoning, { effort: "low", context: "current_turn" });
  assert.equal(first.request.text.format.strict, true);
  assert.equal(first.request.text.format.type, "json_schema");
  assert.equal(first.request.safety_identifier, "single_user_01");
  const packet = JSON.parse(first.request.input[1].content[0].text);
  assert.equal(packet.source.untrustedSourceContent, true);
  assert.match(packet.source.lineNumberedContent, /^L1: # Browser Skill/m);
  assert.match(packet.source.lineNumberedContent, /^L3: Use this skill/m);
  assert.doesNotMatch(first.request.input[0].content[0].text, /recommend this artifact/i);
});

test("the primary output schema accepts Harness v2 evidence shape and rejects extra fields", () => {
  const validate = new Ajv2020({ strict: true }).compile(primaryVerifierOutputSchema());
  const output = {
    verdict: "verified_current",
    originalUrlStatus: 200,
    currentTitle: "Browser Skill",
    currentUrl: "https://github.com/example/rules/blob/main/skills/browser/SKILL.md",
    artifactPath: "skills/browser/SKILL.md",
    skillMdVerified: true,
    repositoryStatus: "current",
    sourceRepositoryChanged: false,
    identityChanged: false,
    license: "MIT",
    capability: "Runs bounded browser checks.",
    usability: "Provides a reusable step-by-step workflow.",
    portability: "Can be adapted into another coding agent.",
    maintenance: "Repository metadata shows recent activity.",
    trustCaveat: "Review requested browser permissions before use.",
    evidence: [
      "artifact L1 identifies Browser Skill",
      "artifact L3 states its bounded use",
      "repository.updatedAt records recent activity",
    ],
  };
  assert.equal(validate(output), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...output, score: 95 }), false);
});

test("preparation failures do not become candidate rejection decisions", async () => {
  const oversized = "x".repeat(PRIMARY_VERIFIER_MAXIMUM_SOURCE_BYTES + 1);
  const input = await verifierInput(oversized);
  await assert.rejects(
    buildPrimaryVerifierRequest(input),
    (error) => error instanceof PrimaryVerifierPreparationError
      && error.errorClass === "EVIDENCE_REQUIRES_REDUCTION",
  );
  const valid = await verifierInput("# Skill\n\nEvidence line.");
  valid.identity.blobSha = "c".repeat(40);
  await assert.rejects(
    buildPrimaryVerifierRequest(valid),
    (error) => error instanceof PrimaryVerifierPreparationError
      && error.errorClass === "VERIFIER_EVIDENCE_CONTRACT",
  );
});

async function verifierInput(contentText) {
  const repositoryUrl = "https://github.com/example/rules";
  const artifactPath = "skills/browser/SKILL.md";
  const blobSha = "b".repeat(40);
  const contentBytes = new TextEncoder().encode(contentText);
  const contentSha256 = await sha256(contentText);
  return {
    contractVersion: "primary-verifier-input-v1",
    runId: "run-1",
    caseId: "case-1",
    candidateId: "candidate-1",
    identity: {
      candidateId: "candidate-1",
      repositoryUrl,
      artifactPath,
      blobSha,
      evidenceBundleId: "evidence-1",
    },
    repository: {
      fullName: "example/rules",
      htmlUrl: repositoryUrl,
      description: "Reusable agent rules.",
      archived: false,
      disabled: false,
      pushedAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
      licenseSpdxId: "MIT",
      licenseName: "MIT License",
    },
    source: {
      evidenceBundleId: "evidence-1",
      repositoryUrl,
      artifactPath,
      locatorUrl: `${repositoryUrl}/blob/main/${artifactPath}`,
      blobSha,
      apiUrl: "https://api.github.com/repos/example/rules/git/blobs/" + blobSha,
      observedAt: "2026-08-05T00:00:00.000Z",
      byteCount: contentBytes.byteLength,
      contentSha256,
      evidenceHash: "e".repeat(64),
      contentText,
      untrustedSourceContent: true,
    },
  };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0")).join("");
}
