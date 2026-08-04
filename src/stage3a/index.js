import { NonRetryableError, WorkflowEntrypoint } from "cloudflare:workers";
import { ShadowRunRepository } from "./run-repository.js";
import { assertStage3AShadowGuard, bootstrapShadowWorkflow } from "./workflow-core.js";

export class SkillRadarShadowWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    try {
      assertStage3AShadowGuard(this.env);
    } catch (error) {
      throw new NonRetryableError(error.message, "STAGE3A_SHADOW_GUARD");
    }
    return bootstrapShadowWorkflow({
      event,
      step,
      repository: new ShadowRunRepository(this.env.ENGINE_DB),
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
