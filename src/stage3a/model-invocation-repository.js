import { MODEL_POLICY_VERSION, modelRolePolicy } from "./model-policy.js";
import { PRIMARY_VERIFIER_PROMPT_VERSION } from "./primary-verifier-request.js";
import { ShadowRunConflictError } from "./run-repository.js";

export class ModelInvocationRepository {
  constructor(database) {
    if (!database?.prepare) throw new TypeError("A D1-compatible database binding is required");
    this.database = database;
  }

  async reservePrimary({ runId, envelope, attemptNo = 1, now }) {
    await validatePrimaryReservation({ runId, envelope, attemptNo, now });
    const context = await this.database.prepare(`
      SELECT c.id AS case_id, c.run_id, c.candidate_id, c.disposition,
        c.evidence_bundle_id, r.status AS run_status, r.mode, r.publication_state
      FROM verification_cases c
      JOIN engine_runs r ON r.id = c.run_id
      WHERE c.id = ?
    `).bind(envelope.caseId).first();
    if (!context || context.run_id !== runId || context.candidate_id !== envelope.candidateId
      || context.disposition !== "pending" || !context.evidence_bundle_id
      || context.run_status !== "verifying" || context.mode !== "shadow"
      || context.publication_state !== "blocked_shadow") {
      throw new TypeError("primary invocation requires a pending evidence-backed shadow case");
    }

    const existing = await this.findSlot(envelope.caseId, attemptNo);
    if (existing) return assertMatching(existing, { runId, envelope, attemptNo });
    const id = `invocation_${(await sha256(`${envelope.requestHash}\nprimary\n${attemptNo}`)).slice(0, 32)}`;
    await this.database.prepare(`
      INSERT INTO model_invocations (
        id, run_id, verification_case_id, candidate_id, role, attempt_no,
        request_hash, provider, model, model_policy, prompt_version, status, created_at
      ) VALUES (?, ?, ?, ?, 'primary', ?, ?, 'openai', ?, ?, ?, 'reserved', ?)
      ON CONFLICT DO NOTHING
    `).bind(
      id, runId, envelope.caseId, envelope.candidateId, attemptNo,
      envelope.requestHash, envelope.request.model, envelope.modelPolicyVersion,
      envelope.promptVersion, now,
    ).run();
    const stored = await this.findSlot(envelope.caseId, attemptNo);
    if (!stored) throw new Error("primary model invocation reservation was not persisted");
    return assertMatching(stored, { runId, envelope, attemptNo });
  }

  async findSlot(caseId, attemptNo) {
    return this.database.prepare(`
      SELECT id, run_id, verification_case_id, candidate_id, role, attempt_no,
        request_hash, provider, model, model_policy, prompt_version, status, created_at
      FROM model_invocations
      WHERE verification_case_id = ? AND role = 'primary' AND attempt_no = ?
    `).bind(caseId, attemptNo).first();
  }
}

async function validatePrimaryReservation({ runId, envelope, attemptNo, now }) {
  const policy = modelRolePolicy("primary");
  if (typeof runId !== "string" || !runId || runId.length > 100
    || !envelope || envelope.contractVersion !== "openai-responses-request-v1"
    || envelope.role !== "primary" || envelope.modelPolicyVersion !== MODEL_POLICY_VERSION
    || envelope.promptVersion !== PRIMARY_VERIFIER_PROMPT_VERSION
    || envelope.request?.model !== policy.model || envelope.request?.store !== false
    || envelope.request?.previous_response_id !== undefined
    || !/^[a-f0-9]{64}$/.test(envelope.requestHash || "")
    || !Number.isInteger(attemptNo) || attemptNo < 1 || attemptNo > policy.maximumAttempts
    || !Number.isFinite(Date.parse(now))) {
    throw new TypeError("primary invocation reservation contract is invalid");
  }
  if (await sha256(stableJson(envelope.request)) !== envelope.requestHash) {
    throw new TypeError("primary invocation request hash is invalid");
  }
}

function assertMatching(row, { runId, envelope, attemptNo }) {
  if (row.run_id !== runId || row.verification_case_id !== envelope.caseId
    || row.candidate_id !== envelope.candidateId || row.role !== "primary"
    || Number(row.attempt_no) !== attemptNo || row.request_hash !== envelope.requestHash
    || row.provider !== "openai" || row.model !== envelope.request.model
    || row.model_policy !== envelope.modelPolicyVersion
    || row.prompt_version !== envelope.promptVersion || row.status !== "reserved") {
    throw new ShadowRunConflictError("primary model invocation slot has immutable drift");
  }
  return {
    id: row.id,
    runId: row.run_id,
    caseId: row.verification_case_id,
    candidateId: row.candidate_id,
    role: row.role,
    attemptNo: Number(row.attempt_no),
    requestHash: row.request_hash,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0")).join("");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
