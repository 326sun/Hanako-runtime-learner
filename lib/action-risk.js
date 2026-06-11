import {
  ACTION_TYPES,
  RISK_TIERS,
  containsDestructiveIntent,
  isAllowedActionType,
} from "./action-types.js";

const ACTION_RISK = Object.freeze({
  [ACTION_TYPES.NO_RETRY_DIAGNOSE]: RISK_TIERS.R0,
  [ACTION_TYPES.UPDATE_FEEDBACK_WEIGHT]: RISK_TIERS.R0,
  [ACTION_TYPES.GENERATE_REPAIR_PLAN]: RISK_TIERS.R1,
  [ACTION_TYPES.RETRY_WITH_BACKOFF]: RISK_TIERS.R1,
  [ACTION_TYPES.LOCATE_MISSING_FILE]: RISK_TIERS.R1,
  [ACTION_TYPES.RUN_TESTS]: RISK_TIERS.R1,
  [ACTION_TYPES.RUN_LINT]: RISK_TIERS.R1,
  [ACTION_TYPES.REDUCE_PROMPT]: RISK_TIERS.R2,
  [ACTION_TYPES.SPLIT_CONTEXT]: RISK_TIERS.R2,
  [ACTION_TYPES.APPLY_PATCH_SANDBOXED]: RISK_TIERS.R2,
  [ACTION_TYPES.REVERT_TRANSACTION]: RISK_TIERS.R2,
  [ACTION_TYPES.EXECUTE_REPAIR_ONCE]: RISK_TIERS.R2,
  [ACTION_TYPES.CREATE_SKILL_CANDIDATE]: RISK_TIERS.R1,
  [ACTION_TYPES.PROMOTE_SKILL_AFTER_SUCCESS]: RISK_TIERS.R3,
  [ACTION_TYPES.ASK_USER_CONFIRMATION]: RISK_TIERS.R4,
});

export function actionTypeOf(actionPlan = {}) {
  return actionPlan.plan?.actionType || actionPlan.actionType || "";
}

export function classifyActionRisk(actionPlan = {}) {
  const actionType = actionTypeOf(actionPlan);
  const checks = [];
  if (!isAllowedActionType(actionType)) {
    return { riskTier: RISK_TIERS.R4, actionType, autoEligible: false, destructive: false, checks: [{ name: "known_action_type", status: "fail", message: `unsupported action type: ${actionType}` }] };
  }
  checks.push({ name: "known_action_type", status: "pass" });
  const destructive = containsDestructiveIntent(actionPlan);
  if (destructive) {
    checks.push({ name: "destructive_intent", status: "fail", message: "destructive or external side-effect intent detected" });
    return { riskTier: RISK_TIERS.R4, actionType, autoEligible: false, destructive, checks };
  }
  const declared = actionPlan.riskTier;
  const base = ACTION_RISK[actionType] || RISK_TIERS.R4;
  const riskTier = declared && /^R[0-4]$/.test(declared) ? declared : base;
  checks.push({ name: "risk_tier", status: "pass", message: riskTier });
  return { riskTier, actionType, autoEligible: riskTier !== RISK_TIERS.R4, destructive, checks };
}

export function requiresTransaction(riskTier, actionPlan = {}) {
  const actionType = actionTypeOf(actionPlan);
  if (riskTier === RISK_TIERS.R2 || riskTier === RISK_TIERS.R3) return true;
  return actionType === ACTION_TYPES.APPLY_PATCH_SANDBOXED || actionType === ACTION_TYPES.EXECUTE_REPAIR_ONCE;
}
