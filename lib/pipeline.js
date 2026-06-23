/**
 * pipeline — shared post-flush processing used by observer.js and index.js.
 * Also hosts the runtime action loop and policy evaluation.
 */

import { learnerDir as defaultLearnerDir, DEFAULT_CONFIG, mergeConfig } from "./common.js";
import { detectActionTriggers } from "./action-triggers.js";
import { buildActionPlans } from "./action-planner.js";
import { executeActionPlan } from "./action-executor.js";
import {
  recordActionFeedback, updateActionPolicyWeights, createBudgetState,
  noteBudgetExecution, checkBudget,
} from "./action-runtime.js";
import { upsertProposal } from "./proposals.js";
import { appendEvent } from "./event-log.js";
import { compareRiskTier, riskTierLte } from "./action-types.js";
import { classifyActionRisk, requiresTransaction } from "./action-risk.js";

// ── Policy evaluation (was action-policy.js) ──────────────────────────────

function hasVerification(actionPlan = {}) {
  const v = actionPlan.verification || actionPlan.plan?.verification;
  return !!(v && (Array.isArray(v.metrics) ? v.metrics.length > 0 : Object.keys(v).length > 0));
}

function hasRollback(actionPlan = {}) {
  const plan = actionPlan.rollbackPlan || actionPlan.plan?.rollbackPlan || [];
  return Array.isArray(plan) ? plan.length > 0 : !!plan;
}

export function evaluateActionPolicy(actionPlan = {}, { config = {}, budgetState = null } = {}) {
  const merged = mergeConfig(config);
  const auto = merged.autoActions || {};
  if (auto.enabled === false) {
    return { decision: "manual_confirm", riskTier: "R4", reasons: ["auto actions disabled"], checks: [{ name: "auto_enabled", status: "fail" }], confidence: 0 };
  }
  const checks = [{ name: "auto_enabled", status: "pass" }];
  const risk = classifyActionRisk(actionPlan);
  checks.push(...risk.checks);
  const maxTier = auto.maxAutoRiskTier || "R2";
  const confidence = Number(actionPlan.trigger?.confidence ?? actionPlan.confidence ?? 0.75);
  const minConfidence = Number(auto.minConfidence ?? merged.minConfidence ?? 0.72);
  checks.push({ name: "confidence", status: confidence >= minConfidence ? "pass" : "fail", message: `${confidence}/${minConfidence}` });
  checks.push({ name: "risk_ceiling", status: riskTierLte(risk.riskTier, maxTier) ? "pass" : "fail", message: `${risk.riskTier} <= ${maxTier}` });
  if (risk.destructive) checks.push({ name: "destructive_intent", status: "fail" });
  if (auto.requireVerification !== false) checks.push({ name: "verification", status: hasVerification(actionPlan) ? "pass" : "fail" });
  if (requiresTransaction(risk.riskTier, actionPlan) && auto.requireRollbackForWrites !== false) {
    checks.push({ name: "rollback", status: hasRollback(actionPlan) ? "pass" : "fail" });
  }
  if (budgetState) checks.push(...checkBudget(actionPlan, { config: merged, state: budgetState }).checks);

  const failed = checks.filter((c) => c.status === "fail");
  const reasons = failed.map((c) => c.message || c.name);
  if (risk.destructive) return { decision: "reject", riskTier: "R4", actionType: risk.actionType, reasons, checks, requiredGuards: [], confidence };
  if (risk.riskTier === "R4") return { decision: "manual_confirm", riskTier: risk.riskTier, actionType: risk.actionType, reasons: reasons.length ? reasons : ["R4 actions require manual confirmation"], checks, requiredGuards: ["manual_confirmation"], confidence };
  if (risk.riskTier === "R3" && auto.allowR3WithStrictGuards !== true) return { decision: "manual_confirm", riskTier: risk.riskTier, actionType: risk.actionType, reasons: ["R3 actions require manual confirmation by default"], checks, requiredGuards: ["manual_confirmation"], confidence };
  if (compareRiskTier(risk.riskTier, maxTier) > 0) return { decision: "manual_confirm", riskTier: risk.riskTier, actionType: risk.actionType, reasons, checks, requiredGuards: ["manual_confirmation"], confidence };
  if (failed.length > 0) return { decision: "defer", riskTier: risk.riskTier, actionType: risk.actionType, reasons, checks, requiredGuards: failed.map((c) => c.name), confidence };
  return { decision: "auto_execute", riskTier: risk.riskTier, actionType: risk.actionType, reasons: [], checks, requiredGuards: requiresTransaction(risk.riskTier, actionPlan) ? ["transaction", "verification"] : ["verification"], confidence };
}

export async function runAutoActionPipeline({
  learnerDir = defaultLearnerDir(),
  config = DEFAULT_CONFIG,
  patterns = [],
  usage = null,
  errors = [],
  input = "",
  workspaceRoot = process.cwd(),
  retry = null,
  budgetState = createBudgetState(),
  ctx = null,
} = {}) {
  const triggers = detectActionTriggers({ config, patterns, usage, errors, input });
  const plans = buildActionPlans(triggers, { config, input });
  const results = [];
  for (const plan of plans) {
    const policy = evaluateActionPolicy(plan, { config, budgetState });
    if (policy.decision === "auto_execute" && config.autoActions?.dryRun !== true) {
      const result = await executeActionPlan(plan, { learnerDir, config, input, workspaceRoot, retry });
      noteBudgetExecution(budgetState, plan, result);
      const effective = result.status === "succeeded" && result.verification?.verified === true;
      recordActionFeedback(learnerDir, {
        actionId: plan.id,
        triggerType: plan.trigger?.type || null,
        actionType: plan.plan?.actionType,
        before: { trigger: plan.trigger?.evidence || {}, inputChars: String(input || "").length },
        after: { status: result.status, durationMs: result.durationMs, verification: result.verification },
        effective,
        confidence: result.verification?.confidence || 0,
      });
      if (config.autoActions?.updatePolicyWeights !== false) updateActionPolicyWeights(learnerDir, { actionType: plan.plan?.actionType });
      try {
        appendEvent(learnerDir, {
          type: "action.auto_executed",
          entityType: "action_plan",
          entityId: plan.id,
          summary: `Auto-executed ${plan.plan?.actionType}: ${result.status}`,
          data: { decision: policy.decision, riskTier: policy.riskTier, verification: result.verification },
        });
      } catch {}
      results.push({ plan, policy, result });
    } else if (policy.decision === "manual_confirm" || policy.decision === "defer") {
      upsertProposal(learnerDir, { ...plan, autoApply: false, policy });
      results.push({ plan, policy, result: { status: "queued" } });
    } else {
      try {
        appendEvent(learnerDir, {
          type: "action.rejected",
          entityType: "action_plan",
          entityId: plan.id,
          summary: `Rejected runtime action: ${plan.plan?.actionType}`,
          data: { policy },
        });
      } catch {}
      results.push({ plan, policy, result: { status: "rejected" } });
    }
  }
  return { triggers, plans, results, budgetState };
}

/**
 * Run the standard post-flush pipeline: auto-approve → prune → persist →
 * runtime action loop → skill refresh → model advisor. Optional hooks allow the
 * two call sites (observer flushTurn and index.js recordUsage) to insert their
 * own pre/post steps.
 */
export function runPostFlushPipeline({
  detector,
  autoApprovePatterns,
  persistPatterns,
  refreshSkill,
  maybeRunModelAdvisor,
  reason,
  sessionHandle = null,
  before = [],
  after = [],
  ctx = null,
  learnerDir = defaultLearnerDir(),
  config,
  usage = null,
  errors = [],
  input = "",
  workspaceRoot = process.cwd(),
}) {
  const effectiveConfig = mergeConfig(config || DEFAULT_CONFIG);
  for (const hook of before) {
    try { hook(); } catch (err) { ctx?.log?.debug?.(`runtime-learner: before-hook ${err.message}`); }
  }

  // Each pipeline step is independently guarded so one failure does not
  // cascade into skipping downstream steps (e.g. a pruneMemory crash should
  // not prevent pattern persistence or skill refresh).

  try { autoApprovePatterns(sessionHandle); }
  catch (err) { ctx?.log?.warn?.(`runtime-learner: auto-approve failed: ${err.message}`); }

  try { detector.pruneMemory(); }
  catch (err) { ctx?.log?.warn?.(`runtime-learner: prune failed: ${err.message}`); }

  let allPatterns;
  try { allPatterns = detector.all(); }
  catch (err) {
    ctx?.log?.warn?.(`runtime-learner: detector.all() failed: ${err.message}`);
    allPatterns = [];
  }

  try { persistPatterns(); }
  catch (err) { ctx?.log?.warn?.(`runtime-learner: persist failed: ${err.message}`); }

  runAutoActionPipeline({ learnerDir, config: effectiveConfig, patterns: allPatterns, usage, errors, input, workspaceRoot, ctx })
    .catch((err) => ctx?.log?.warn?.(`runtime-learner: auto-action pipeline failed: ${err.message}`));

  try { refreshSkill(false, sessionHandle, allPatterns); }
  catch (err) { ctx?.log?.warn?.(`runtime-learner: skill refresh failed: ${err.message}`); }

  maybeRunModelAdvisor(reason, sessionHandle, allPatterns).catch(
    (err) => ctx?.log?.debug?.(`runtime-learner: model advisor rejected: ${err?.message || err}`));

  for (const hook of after) {
    try { hook(); } catch (err) { ctx?.log?.debug?.(`runtime-learner: after-hook ${err.message}`); }
  }
}
