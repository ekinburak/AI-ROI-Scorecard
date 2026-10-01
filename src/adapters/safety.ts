const BLOCKED_ATTRIBUTE_KEYS = new Set([
  "prompt",
  "completion",
  "input",
  "output",
  "email",
  "stack",
  "stacktrace",
  "stack_trace",
  "message",
  "error.message",
  "exception.message",
  "exception.stacktrace",
  "gen_ai.prompt",
  "gen_ai.completion",
  "llm.prompt",
  "llm.completion",
]);

const ROI_ACCOUNT_ID = "roi.account_id";
const ROI_WORKFLOW_KEY = "roi.workflow_key";
const ROI_POLICY_KEY = "roi.policy_key";
const ROI_OUTCOME_ID = "roi.outcome_id";
const ROI_UNITS = "roi.units";

export const ROI_SEMANTIC_ATTRIBUTES = {
  accountId: ROI_ACCOUNT_ID,
  workflowKey: ROI_WORKFLOW_KEY,
  policyKey: ROI_POLICY_KEY,
  outcomeId: ROI_OUTCOME_ID,
  units: ROI_UNITS,
} as const;

export function sanitizeAttributes(
  attributes: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const normalized = key.toLowerCase();
    if (BLOCKED_ATTRIBUTE_KEYS.has(normalized)) continue;
    if (normalized.includes("prompt") || normalized.includes("completion")) continue;
    if (normalized.includes("password") || normalized.includes("token")) continue;
    if (typeof value === "string" && value.includes("@") && value.includes(".")) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export function readSemanticString(
  attributes: Record<string, string | number | boolean>,
  key: string,
): string | undefined {
  const value = attributes[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TypeError(`Attribute ${key} must be a string`);
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

export function readSemanticNumber(
  attributes: Record<string, string | number | boolean>,
  key: string,
): number | undefined {
  const value = attributes[key];
  if (value === undefined) return undefined;
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number <= 0 || number > 1_000_000_000) throw new RangeError("Units must be a positive bounded integer");
  return number;
}
