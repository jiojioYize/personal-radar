import { sourcePlanHash, validateSourcePortfolioPlan } from "./source-portfolio.js";
import { ShadowRunConflictError } from "./run-repository.js";

export class SourcePlanRepository {
  constructor(database) {
    if (!database?.prepare) throw new TypeError("A D1-compatible database binding is required");
    this.database = database;
  }

  async completedRunCount({ beforeReportDate }) {
    const row = await this.database.prepare(`
      SELECT COUNT(DISTINCT run_id) AS completed_count
      FROM source_rotation_entries
      WHERE completed_report_date < ?
    `).bind(beforeReportDate).first();
    return Number(row?.completed_count || 0);
  }

  async createOrGetPlan({ runId, plan, now }) {
    const errors = validateSourcePortfolioPlan(plan);
    if (errors.length) throw new TypeError(errors.join("\n"));
    const planHash = await sourcePlanHash(plan);
    const planJson = JSON.stringify(plan);
    const assignedSourcesJson = JSON.stringify({
      registry: [{ id: "skillsSh", url: plan.registryUrl }],
      official: plan.officialSources,
      community: plan.communitySources,
    });
    const id = `plan_${planHash.slice(0, 32)}`;
    const inserted = await this.database.prepare(`
      INSERT INTO source_plans (
        id, run_id, plan_version, registry_focus, assigned_sources_json,
        plan_json, plan_hash, created_at
      ) VALUES (?, ?, 'portfolio-v1@1', ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO NOTHING
    `).bind(
      id,
      runId,
      plan.registryFocus,
      assignedSourcesJson,
      planJson,
      planHash,
      now,
    ).run();
    const row = await this.database.prepare(`
      SELECT id, run_id, plan_json, plan_hash FROM source_plans WHERE run_id = ?
    `).bind(runId).first();
    if (!row) throw new Error("source plan was not persisted");
    if (row.plan_hash !== planHash) {
      throw new ShadowRunConflictError("logical run already has a different authoritative source plan");
    }
    return {
      id: row.id,
      runId: row.run_id,
      plan: JSON.parse(row.plan_json),
      planHash: row.plan_hash,
      created: Number(inserted.meta?.changes || 0) === 1,
    };
  }
}
