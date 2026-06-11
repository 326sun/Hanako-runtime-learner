import crypto from "crypto";

export const HUMAN_INTERRUPT_REASONS = Object.freeze({
  RISK_TOO_HIGH: "risk_too_high",
  SCOPE_UNCLEAR: "scope_unclear",
  BUDGET_EXCEEDED: "budget_exceeded",
  VERIFICATION_FAILED: "verification_failed",
  CONFLICTING_RESULTS: "conflicting_results",
  EXTERNAL_SIDE_EFFECT: "requires_external_side_effect",
  USER_PREFERENCE_REQUIRED: "user_preference_required",
});

function stableId(prefix, payload) {
  return `${prefix}:${crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex").slice(0, 12)}`;
}

function now() { return new Date().toISOString(); }
function asArray(value) { return Array.isArray(value) ? value : []; }

export function detectHumanInterrupt(signal = {}, context = {}) {
  const reasons = [];
  const riskTier = signal.riskTier || signal.risk?.riskTier || context.riskTier || context.risk?.riskTier;
  if (["R3", "R4"].includes(riskTier) || signal.decision === "manual_confirm") reasons.push(HUMAN_INTERRUPT_REASONS.RISK_TOO_HIGH);
  if (signal.scopeGate?.decision === "manual_confirm" || signal.scopeUnclear) reasons.push(HUMAN_INTERRUPT_REASONS.SCOPE_UNCLEAR);
  if (signal.budget?.ok === false || signal.budgetExceeded) reasons.push(HUMAN_INTERRUPT_REASONS.BUDGET_EXCEEDED);
  if (signal.verification?.verified === false || signal.verificationFailed) reasons.push(HUMAN_INTERRUPT_REASONS.VERIFICATION_FAILED);
  if (asArray(signal.conflicts).length > 0 || signal.conflictingResults) reasons.push(HUMAN_INTERRUPT_REASONS.CONFLICTING_RESULTS);
  if (signal.externalSideEffect || signal.requiresExternalSideEffect) reasons.push(HUMAN_INTERRUPT_REASONS.EXTERNAL_SIDE_EFFECT);
  if (signal.userPreferenceRequired || signal.preferenceRequired) reasons.push(HUMAN_INTERRUPT_REASONS.USER_PREFERENCE_REQUIRED);
  return {
    required: reasons.length > 0,
    reasons: [...new Set(reasons)],
  };
}

export function createApprovalRequest({ taskId = null, node = null, reason = null, reasons = [], summary = "Human approval required", options = [] } = {}) {
  const mergedReasons = [...new Set([reason, ...asArray(reasons)].filter(Boolean))];
  const request = {
    id: stableId("approval", { taskId, node, mergedReasons, summary, at: now() }),
    taskId,
    node,
    status: "pending",
    reasons: mergedReasons,
    summary,
    options: options.length ? options : ["approve", "reject", "cancel"],
    createdAt: now(),
    updatedAt: now(),
  };
  return request;
}

export function addApprovalRequest(agentState = {}, request = {}) {
  const next = JSON.parse(JSON.stringify(agentState));
  next.approvalRequests = [...(next.approvalRequests || []), request];
  next.updatedAt = now();
  return next;
}

export function resolveApprovalRequest(agentState = {}, requestId, decision, extra = {}) {
  const allowed = new Set(["approved", "rejected", "cancelled"]);
  if (!allowed.has(decision)) throw new Error(`invalid approval decision: ${decision}`);
  let found = false;
  const at = now();
  const next = JSON.parse(JSON.stringify(agentState));
  next.approvalRequests = (next.approvalRequests || []).map((request) => {
    if (request.id !== requestId) return request;
    found = true;
    return { ...request, ...extra, status: decision, resolvedAt: at, updatedAt: at };
  });
  if (!found) throw new Error(`approval request not found: ${requestId}`);
  next.updatedAt = at;
  return next;
}

export function latestPendingApproval(agentState = {}) {
  return [...(agentState.approvalRequests || [])].reverse().find((request) => request.status === "pending") || null;
}
