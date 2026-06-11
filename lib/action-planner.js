import crypto from "crypto";
import { ACTION_TYPES, isAllowedActionType, legacyRiskForTier } from "./action-types.js";

function hashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex").slice(0, 16);
}

function proposalId(trigger, plan) {
  return `action_plan:${hashPayload({ triggerType: trigger.type, evidence: trigger.evidence, actionType: plan.actionType })}`;
}

function planForTrigger(trigger) {
  if (!trigger?.type) return null;
  if (trigger.type === "large_context_risk") {
    return {
      actionType: ACTION_TYPES.SPLIT_CONTEXT,
      riskTier: "R2",
      steps: [
        "Identify independent task modules before continuing.",
        "Split work into 2-4 sub-tasks while preserving the original objective.",
        "Keep each sub-task below the configured large-context threshold.",
        "Merge partial results and verify no requirement was dropped.",
      ],
      expectedGain: { timeoutRiskReduction: "medium", extraCalls: "1-3" },
      verification: { metrics: ["success", "errorCount", "userAccepted", "droppedRequirements"] },
      rollbackPlan: ["Keep the original task text unchanged and fall back to manual confirmation if splitting is ambiguous."],
    };
  }
  if (trigger.type === "retryable_tool_error") {
    const isModel = trigger.evidence?.errorType === "model_error";
    return {
      actionType: isModel ? ACTION_TYPES.REDUCE_PROMPT : ACTION_TYPES.RETRY_WITH_BACKOFF,
      riskTier: isModel ? "R2" : "R1",
      steps: isModel
        ? ["Compact non-essential context into a bounded summary.", "Retry only after reducing prompt size or narrowing retrieval.", "Stop after one retry if the model error persists."]
        : ["Wait briefly using backoff.", "Retry the same operation at most once.", "Record whether the retry succeeds."],
      expectedGain: { transientFailureRecovery: "medium", maxRetries: 1 },
      verification: { metrics: ["success", "errorType", "retryCount"] },
      rollbackPlan: isModel ? ["Retain the original prompt/context and expose the compacted version as a derivative artifact only."] : [],
    };
  }
  if (trigger.type === "non_retryable_tool_error") {
    const err = trigger.evidence?.errorType;
    if (err === "file_not_found" || err === "path_error") {
      return {
        actionType: ACTION_TYPES.LOCATE_MISSING_FILE,
        riskTier: "R1",
        steps: ["Search the workspace or parent directory for similar filenames.", "If exactly one high-confidence candidate exists, return it as the suggested path.", "If multiple candidates exist, require user confirmation."],
        expectedGain: { avoidsBlindRetry: true },
        verification: { metrics: ["candidateCount", "uniqueCandidate"] },
      };
    }
    if (err === "permission_denied" || err === "auth_error") {
      return {
        actionType: ACTION_TYPES.ASK_USER_CONFIRMATION,
        riskTier: "R4",
        steps: ["Do not retry the same operation.", "Explain the missing permission or authentication requirement.", "Ask the user to grant access or choose another target."],
        expectedGain: { preventsUnsafeRetry: true },
        verification: { metrics: ["userConfirmed"] },
      };
    }
    return {
      actionType: ACTION_TYPES.NO_RETRY_DIAGNOSE,
      riskTier: "R1",
      steps: trigger.repairPlan?.length ? trigger.repairPlan : ["Inspect the exact error message.", "Change one variable before retrying.", "Do not loop the identical call."],
      expectedGain: { avoidsBlindRetry: true },
      verification: { metrics: ["diagnosisGenerated"] },
    };
  }
  return null;
}

export function buildActionPlanProposal(trigger, context = {}) {
  const plan = planForTrigger(trigger);
  if (!plan || !isAllowedActionType(plan.actionType)) return null;
  const risk = legacyRiskForTier(plan.riskTier);
  return {
    id: proposalId(trigger, plan),
    type: "action_plan",
    title: `Runtime action: ${plan.actionType}`,
    risk,
    riskTier: plan.riskTier,
    autoApply: false,
    reason: trigger.reason || `Triggered ${trigger.type}`,
    trigger,
    triggerPatternIds: trigger.evidence?.patternId ? [trigger.evidence.patternId] : [],
    plan: {
      actionType: plan.actionType,
      steps: plan.steps,
      command: context.command || null,
      input: context.input || null,
    },
    expectedGain: plan.expectedGain || {},
    verification: plan.verification || { metrics: ["success"] },
    rollbackPlan: plan.rollbackPlan || [],
  };
}

export function buildActionPlans(triggers = [], context = {}) {
  const plans = [];
  const seen = new Set();
  for (const trigger of triggers || []) {
    const proposal = buildActionPlanProposal(trigger, context);
    if (!proposal || seen.has(proposal.id)) continue;
    seen.add(proposal.id);
    plans.push(proposal);
  }
  const max = Number(context.config?.runtimeActions?.maxActionPlansPerTurn || context.config?.autoActions?.maxAutoActionsPerTurn || 3);
  return max > 0 ? plans.slice(0, max) : plans;
}
