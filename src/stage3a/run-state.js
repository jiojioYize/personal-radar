const TRANSITIONS = new Map([
  ["scheduled", new Set(["claimed", "cancelled_operator"])],
  ["claimed", new Set(["collecting", "cancelled_operator"])],
  ["collecting", new Set(["filtering", "failed_source_system", "failed_retry_exhausted"])],
  ["filtering", new Set(["verifying", "failed_contract", "failed_budget"])],
  ["verifying", new Set(["editing", "failed_contract", "failed_model_provider", "failed_budget"])],
  ["editing", new Set(["validating", "failed_contract", "failed_model_provider", "failed_budget"])],
  ["validating", new Set([
    "shadow_ready", "valid_no_update", "failed_contract", "failed_budget",
  ])],
  ["shadow_ready", new Set(["comparing"])],
  ["comparing", new Set(["compared"])],
]);

export function assertRunTransition(from, to) {
  if (!TRANSITIONS.get(from)?.has(to)) {
    throw new TypeError(`run status transition ${from} -> ${to} is not allowed`);
  }
}
