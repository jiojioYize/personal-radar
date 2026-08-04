import { logicalRunId, validateShadowRunParams } from "./run-identity.js";

const DATABASE_RETRY = {
  retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
};

export function assertStage3AShadowGuard(env) {
  if (env?.PUBLICATION_ENABLED !== "false") {
    throw new Error("Stage 3A shadow requires PUBLICATION_ENABLED=false");
  }
  if (env?.STAGE3A_EXECUTION_ENABLED !== "true") {
    throw new Error("Stage 3A execution is disabled");
  }
}

export async function bootstrapShadowWorkflow({ event, step, repository, now = new Date() }) {
  const params = validateShadowRunParams(event?.payload);
  const workflowInstanceId = String(event?.instanceId || "");
  if (!workflowInstanceId || workflowInstanceId.length > 100) {
    throw new TypeError("workflow instance ID must contain one to one hundred characters");
  }
  const runId = await logicalRunId(params);
  const timestamp = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();

  const logicalRun = await step.do("claim logical shadow run", DATABASE_RETRY, () =>
    repository.createOrGetRun({ runId, params, now: timestamp }));
  const attempt = await step.do("attach workflow attempt", DATABASE_RETRY, () =>
    repository.attachWorkflowAttempt({
      runId: logicalRun.run.id,
      workflowInstanceId,
      attemptNo: params.attemptNo,
      now: timestamp,
      leaseExpiresAt,
    }));
  const claimed = await step.do("persist claimed state", DATABASE_RETRY, () =>
    repository.markClaimed({ runId: logicalRun.run.id, now: timestamp }));

  return {
    runId: logicalRun.run.id,
    workflowInstanceId: attempt.workflowInstanceId,
    attemptNo: attempt.attemptNo,
    status: claimed.status,
    publicationState: claimed.publicationState,
    nextStage: "source_plan",
  };
}
