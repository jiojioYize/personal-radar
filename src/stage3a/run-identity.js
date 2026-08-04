const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateShadowRunParams(input) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const params = {
    channel: value.channel ?? "skill-radar",
    reportDate: String(value.reportDate || ""),
    contractVersion: value.contractVersion ?? "engine-shadow-result-v1",
    configHash: String(value.configHash || ""),
    modelPolicyHash: String(value.modelPolicyHash || ""),
    sourcePolicyHash: String(value.sourcePolicyHash || ""),
    attemptNo: value.attemptNo ?? 1,
    budgetSoftUsdMicros: value.budgetSoftUsdMicros ?? 3_000_000,
    budgetHardUsdMicros: value.budgetHardUsdMicros ?? 5_000_000,
  };
  if (params.channel !== "skill-radar") throw new TypeError("channel must be skill-radar");
  if (!DATE_PATTERN.test(params.reportDate)) throw new TypeError("reportDate must use YYYY-MM-DD");
  if (params.contractVersion !== "engine-shadow-result-v1") {
    throw new TypeError("contractVersion must be engine-shadow-result-v1");
  }
  for (const field of ["configHash", "modelPolicyHash", "sourcePolicyHash"]) {
    if (!HASH_PATTERN.test(params[field])) throw new TypeError(`${field} must be a lowercase SHA-256 hex digest`);
  }
  if (!Number.isInteger(params.attemptNo) || params.attemptNo < 1) {
    throw new TypeError("attemptNo must be a positive integer");
  }
  if (!Number.isInteger(params.budgetSoftUsdMicros) || params.budgetSoftUsdMicros < 0) {
    throw new TypeError("budgetSoftUsdMicros must be a non-negative integer");
  }
  if (!Number.isInteger(params.budgetHardUsdMicros)
    || params.budgetHardUsdMicros < params.budgetSoftUsdMicros) {
    throw new TypeError("budgetHardUsdMicros must be an integer at least as large as the soft budget");
  }
  return params;
}

export async function logicalRunId(params) {
  const identity = [
    params.channel,
    params.reportDate,
    "shadow",
    params.contractVersion,
  ].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `run_${hex.slice(0, 32)}`;
}
