import { NonRetryableError, WorkflowEntrypoint } from "cloudflare:workers";
import { ShadowRunRepository } from "./run-repository.js";
import { SourcePlanRepository } from "./source-plan-repository.js";
import {
  assertStage3AShadowGuard,
  bootstrapShadowWorkflow,
  prepareShadowSourcePlan,
} from "./workflow-core.js";

export class SkillRadarShadowWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    try {
      assertStage3AShadowGuard(this.env);
    } catch (error) {
      throw new NonRetryableError(error.message, "STAGE3A_SHADOW_GUARD");
    }
    const runRepository = new ShadowRunRepository(this.env.ENGINE_DB);
    const run = await bootstrapShadowWorkflow({
      event,
      step,
      repository: runRepository,
    });
    return prepareShadowSourcePlan({
      run,
      reportDate: event.payload.reportDate,
      step,
      runRepository,
      sourcePlanRepository: new SourcePlanRepository(this.env.ENGINE_DB),
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "personal-radar-stage3a-shadow",
        executionEnabled: env.STAGE3A_EXECUTION_ENABLED === "true",
        publicationEnabled: env.PUBLICATION_ENABLED === "true",
      });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
};
