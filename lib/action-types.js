export const ACTION_TYPES = Object.freeze({
  SPLIT_CONTEXT: "split_context",
  RETRY_WITH_BACKOFF: "retry_with_backoff",
  LOCATE_MISSING_FILE: "locate_missing_file",
  REDUCE_PROMPT: "reduce_prompt",
  ASK_USER_CONFIRMATION: "ask_user_confirmation",
  NO_RETRY_DIAGNOSE: "no_retry_diagnose",
  RUN_TESTS: "run_tests",
  RUN_LINT: "run_lint",
  APPLY_PATCH_SANDBOXED: "apply_patch_sandboxed",
  REVERT_TRANSACTION: "revert_transaction",
  UPDATE_FEEDBACK_WEIGHT: "update_feedback_weight",
  GENERATE_REPAIR_PLAN: "generate_repair_plan",
  EXECUTE_REPAIR_ONCE: "execute_repair_once",
  CREATE_SKILL_CANDIDATE: "create_skill_candidate",
  PROMOTE_SKILL_AFTER_SUCCESS: "promote_skill_after_success",
});

export const ACTION_TYPE_SET = new Set(Object.values(ACTION_TYPES));

export const RISK_TIERS = Object.freeze({
  R0: "R0",
  R1: "R1",
  R2: "R2",
  R3: "R3",
  R4: "R4",
});

export const RISK_TIER_ORDER = Object.freeze({ R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 });

export const DEFAULT_ALLOWED_COMMANDS = Object.freeze([
  "node --check",
]);

const DESTRUCTIVE_PATTERNS = Object.freeze([
  /\brm\s+-rf\b/i,
  /\brmdir\b/i,
  /\bdel\s+\/s\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\boverwrite\b/i,
  /\bforce\s+push\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+tag\b/i,
  /\bnpm\s+publish\b/i,
  /\brelease\b/i,
  /\bsend\s+(email|message)\b/i,
  /\b(upload|modify|change|print|expose)\b.*\bcredentials?\b/i,
  /\b(upload|modify|change|print|expose)\b.*\bsecrets?\b/i,
  /\breset\s+--hard\b/i,
  /\bdrop\s+table\b/i,
  /\bcurl\b.*\b-X\s*(POST|PUT|PATCH|DELETE)\b/i,
]);

export function isAllowedActionType(actionType) {
  return ACTION_TYPE_SET.has(String(actionType || ""));
}

// Flatten a step (string or structured object) to scannable text. Structured
// steps (e.g. { command: "rm -rf …" }) must not collapse to "[object Object]" —
// that would hide a destructive command from containsDestructiveIntent below.
function stepText(step) {
  if (!step) return "";
  if (typeof step === "string") return step;
  try { return JSON.stringify(step); } catch { return ""; }
}

function actionText(actionPlan = {}) {
  const steps = actionPlan.plan?.steps || actionPlan.steps || [];
  const extra = [
    actionPlan.plan?.actionType,
    actionPlan.actionType,
    actionPlan.title,
    actionPlan.reason,
    actionPlan.plan?.command,
    actionPlan.plan?.patchSummary,
    ...(Array.isArray(steps) ? steps.map(stepText) : []),
  ];
  return extra.filter(Boolean).join("\n");
}

export function containsDestructiveIntent(actionPlan = {}) {
  const text = actionText(actionPlan);
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(text));
}

export function compareRiskTier(a, b) {
  return (RISK_TIER_ORDER[a] ?? 99) - (RISK_TIER_ORDER[b] ?? 99);
}

export function riskTierLte(a, b) {
  return compareRiskTier(a, b) <= 0;
}

export function legacyRiskForTier(tier) {
  if (tier === "R0" || tier === "R1") return "low";
  if (tier === "R2" || tier === "R3") return "medium";
  return "high";
}
