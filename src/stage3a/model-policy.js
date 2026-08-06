export const MODEL_POLICY_VERSION = "stage3a-openai-gpt-5.6-v1";
export const PRICE_BOOK_VERSION = "openai-standard-2026-08-06";

const PRICE_BOOK = deepFreeze({
  "gpt-5.6-luna": { input: 1_000_000, cachedInput: 100_000, output: 6_000_000 },
  "gpt-5.6-terra": { input: 2_500_000, cachedInput: 250_000, output: 15_000_000 },
  "gpt-5.6-sol": { input: 5_000_000, cachedInput: 500_000, output: 30_000_000 },
});

export const STAGE3A_MODEL_POLICY = deepFreeze({
  version: MODEL_POLICY_VERSION,
  provider: "openai",
  endpoint: "responses",
  store: false,
  priceBookVersion: PRICE_BOOK_VERSION,
  roles: {
    primary: { model: "gpt-5.6-terra", reasoningEffort: "low", maximumAttempts: 2 },
    specialist: { model: "gpt-5.6-terra", reasoningEffort: "medium", maximumAttempts: 2 },
    adjudicator: { model: "gpt-5.6-sol", reasoningEffort: "medium", maximumAttempts: 2 },
    editor: { model: "gpt-5.6-terra", reasoningEffort: "medium", maximumAttempts: 2 },
  },
});

export function modelRolePolicy(role) {
  const policy = STAGE3A_MODEL_POLICY.roles[role];
  if (!policy) throw new TypeError(`Unknown Stage 3A model role: ${role}`);
  return policy;
}

export function estimateModelCostUsdMicros({
  role,
  inputTokens,
  cachedInputTokens = 0,
  outputTokens,
}) {
  const { model } = modelRolePolicy(role);
  const rates = PRICE_BOOK[model];
  assertTokenCount(inputTokens, "inputTokens");
  assertTokenCount(cachedInputTokens, "cachedInputTokens");
  assertTokenCount(outputTokens, "outputTokens");
  if (cachedInputTokens > inputTokens) {
    throw new TypeError("cachedInputTokens cannot exceed inputTokens");
  }
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  return Math.ceil((
    uncachedInputTokens * rates.input
    + cachedInputTokens * rates.cachedInput
    + outputTokens * rates.output
  ) / 1_000_000);
}

export async function modelPolicyHash() {
  const bytes = new TextEncoder().encode(stableJson(STAGE3A_MODEL_POLICY));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0")).join("");
}

function assertTokenCount(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${label} must be non-negative`);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
