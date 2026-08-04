import { assertRunTransition } from "./run-state.js";

export class ShadowRunConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ShadowRunConflictError";
  }
}

export class ShadowRunRepository {
  constructor(database) {
    if (!database?.prepare) throw new TypeError("A D1-compatible database binding is required");
    this.database = database;
  }

  async createOrGetRun({ runId, params, now }) {
    const insert = await this.database.prepare(`
      INSERT INTO engine_runs (
        id, channel, report_date, mode, contract_version, config_hash,
        model_policy_hash, source_policy_hash, status, publication_state,
        budget_soft_usd_micros, budget_hard_usd_micros, created_at, updated_at
      ) VALUES (?, ?, ?, 'shadow', ?, ?, ?, ?, 'scheduled',
        'blocked_shadow', ?, ?, ?, ?)
      ON CONFLICT(channel, report_date, mode, contract_version) DO NOTHING
    `).bind(
      runId,
      params.channel,
      params.reportDate,
      params.contractVersion,
      params.configHash,
      params.modelPolicyHash,
      params.sourcePolicyHash,
      params.budgetSoftUsdMicros,
      params.budgetHardUsdMicros,
      now,
      now,
    ).run();
    const row = await this.getRunByIdentity(params);
    if (!row) throw new Error("logical run was not persisted");
    assertFrozenRunConfiguration(row, params);
    return { run: normalizeRun(row), created: Number(insert.meta?.changes || 0) === 1 };
  }

  async attachWorkflowAttempt({ runId, workflowInstanceId, attemptNo, now, leaseExpiresAt }) {
    try {
      await this.database.prepare(`
        INSERT INTO workflow_attempts (
          workflow_instance_id, run_id, attempt_no, status, lease_owner,
          lease_expires_at, heartbeat_at, created_at
        )
        SELECT ?, ?, ?, 'claimed', ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM workflow_attempts
          WHERE run_id = ? AND status IN ('claimed', 'running')
            AND lease_expires_at > ?
        )
        ON CONFLICT(workflow_instance_id) DO NOTHING
      `).bind(
        workflowInstanceId,
        runId,
        attemptNo,
        workflowInstanceId,
        leaseExpiresAt,
        now,
        now,
        runId,
        now,
      ).run();
    } catch (error) {
      if (/UNIQUE constraint/i.test(String(error?.message || error))) {
        throw new ShadowRunConflictError("logical workflow attempt number is already claimed");
      }
      throw error;
    }
    const row = await this.database.prepare(`
      SELECT workflow_instance_id, run_id, attempt_no, status
      FROM workflow_attempts WHERE workflow_instance_id = ?
    `).bind(workflowInstanceId).first();
    if (!row) {
      throw new ShadowRunConflictError("logical run has an active workflow lease");
    }
    if (row.run_id !== runId || Number(row.attempt_no) !== attemptNo) {
      throw new ShadowRunConflictError("workflow instance is attached to a different logical attempt");
    }
    return {
      workflowInstanceId: row.workflow_instance_id,
      runId: row.run_id,
      attemptNo: Number(row.attempt_no),
      status: row.status,
    };
  }

  async markClaimed({ runId, now }) {
    return this.transitionStatus({ runId, from: "scheduled", to: "claimed", now });
  }

  async transitionStatus({ runId, from, to, now }) {
    assertRunTransition(from, to);
    await this.database.prepare(`
      UPDATE engine_runs SET status = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `).bind(to, now, runId, from).run();
    const row = await this.database.prepare(`
      SELECT id, status, publication_state FROM engine_runs WHERE id = ?
    `).bind(runId).first();
    if (!row) throw new Error("logical run no longer exists");
    if (row.status !== to) {
      throw new ShadowRunConflictError(
        `logical run cannot transition ${from} -> ${to} from status ${row.status}`,
      );
    }
    if (row.publication_state !== "blocked_shadow") {
      throw new ShadowRunConflictError("shadow publication state is not blocked");
    }
    return { runId: row.id, status: row.status, publicationState: row.publication_state };
  }

  async getRunByIdentity(params) {
    return this.database.prepare(`
      SELECT id, channel, report_date, mode, contract_version, config_hash,
        model_policy_hash, source_policy_hash, status, publication_state,
        budget_soft_usd_micros, budget_hard_usd_micros
      FROM engine_runs
      WHERE channel = ? AND report_date = ? AND mode = 'shadow' AND contract_version = ?
    `).bind(params.channel, params.reportDate, params.contractVersion).first();
  }
}

function assertFrozenRunConfiguration(row, params) {
  const expected = {
    config_hash: params.configHash,
    model_policy_hash: params.modelPolicyHash,
    source_policy_hash: params.sourcePolicyHash,
    budget_soft_usd_micros: params.budgetSoftUsdMicros,
    budget_hard_usd_micros: params.budgetHardUsdMicros,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (row[field] !== value) {
      throw new ShadowRunConflictError(`existing logical run has a different frozen ${field}`);
    }
  }
}

function normalizeRun(row) {
  return {
    id: row.id,
    channel: row.channel,
    reportDate: row.report_date,
    mode: row.mode,
    contractVersion: row.contract_version,
    status: row.status,
    publicationState: row.publication_state,
  };
}
