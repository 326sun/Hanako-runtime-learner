/**
 * action-runtime — merged support for the auto-action pipeline.
 * (was: action-budget.js + action-feedback.js + action-learning.js)
 */
import fs from "fs";
import path from "path";
import { DEFAULT_CONFIG, readJson, writeJson } from "./common.js";

// ── Budget ──────────────────────────────────────────────────────────────────

export function autoActionBudget(config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const auto = merged.autoActions || {};
  return {
    maxAutoActionsPerTurn: Number(auto.maxAutoActionsPerTurn ?? 5),
    maxAutoActionsPerSession: Number(auto.maxAutoActionsPerSession ?? 20),
    maxRepairAttempts: Number(auto.maxRepairAttempts ?? 1),
    maxRetryPerToolCall: Number(auto.maxRetryPerToolCall ?? 1),
    maxExecutionMsPerAction: Number(auto.maxExecutionMsPerAction ?? 30000),
    maxExecutionMsPerTurn: Number(auto.maxExecutionMsPerTurn ?? 120000),
    maxChangedFilesPerAction: Number(auto.maxChangedFilesPerAction ?? 8),
  };
}

export function createBudgetState(initial = {}) {
  return { autoActionsThisTurn: 0, autoActionsThisSession: 0, executionMsThisTurn: 0, retryCounts: {}, repairCounts: {}, ...initial };
}

export function checkBudget(actionPlan = {}, { config = {}, state = createBudgetState(), estimatedMs = 0 } = {}) {
  const b = autoActionBudget(config);
  const checks = [
    { name: "budget_auto_actions_turn", status: state.autoActionsThisTurn < b.maxAutoActionsPerTurn ? "pass" : "fail", message: `${state.autoActionsThisTurn}/${b.maxAutoActionsPerTurn}` },
    { name: "budget_auto_actions_session", status: state.autoActionsThisSession < b.maxAutoActionsPerSession ? "pass" : "fail", message: `${state.autoActionsThisSession}/${b.maxAutoActionsPerSession}` },
    { name: "budget_execution_turn", status: state.executionMsThisTurn + estimatedMs <= b.maxExecutionMsPerTurn ? "pass" : "fail", message: `${state.executionMsThisTurn + estimatedMs}/${b.maxExecutionMsPerTurn}` },
  ];
  const actionType = actionPlan.plan?.actionType || actionPlan.actionType || "unknown";
  const retryKey = actionPlan.trigger?.id || actionPlan.id || actionType;
  const retryCount = state.retryCounts?.[retryKey] || 0;
  if (actionType === "retry_with_backoff") {
    checks.push({ name: "budget_retry_count", status: retryCount < b.maxRetryPerToolCall ? "pass" : "fail", message: `${retryCount}/${b.maxRetryPerToolCall}` });
  }
  const failed = checks.filter((c) => c.status === "fail");
  return { ok: failed.length === 0, checks, budget: b };
}

export function noteBudgetExecution(state = createBudgetState(), actionPlan = {}, result = {}) {
  const actionType = actionPlan.plan?.actionType || actionPlan.actionType || "unknown";
  state.autoActionsThisTurn += 1;
  state.autoActionsThisSession += 1;
  state.executionMsThisTurn += Number(result.durationMs || 0);
  if (actionType === "retry_with_backoff") {
    const key = actionPlan.trigger?.id || actionPlan.id || actionType;
    state.retryCounts[key] = (state.retryCounts[key] || 0) + 1;
  }
  return state;
}

// ── Feedback ────────────────────────────────────────────────────────────────

const FEEDBACK_FILE = "action_feedback.jsonl";

function validateFeedback(feedback) {
  if (!feedback || typeof feedback !== "object") return "feedback must be an object";
  if (!feedback.actionId) return "actionId missing";
  if (!feedback.actionType) return "actionType missing";
  return "";
}

export function recordActionFeedback(learnerDir, feedback) {
  const error = validateFeedback(feedback);
  if (error) return { ok: false, error };
  const file = path.join(learnerDir, FEEDBACK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), effective: null, confidence: 0, ...feedback }) + "\n", "utf-8");
  return { ok: true, row: feedback };
}

export function readActionFeedback(learnerDir, { limit = 0, actionType = null } = {}) {
  const file = path.join(learnerDir, FEEDBACK_FILE);
  let text;
  try { text = fs.readFileSync(file, "utf-8"); } catch { return []; }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!actionType || row.actionType === actionType) rows.push(row);
    } catch {}
  }
  rows.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export function summarizeActionEffectiveness(learnerDir, actionType, { limit = 20 } = {}) {
  const rows = readActionFeedback(learnerDir, { actionType, limit });
  const judged = rows.filter((r) => r.effective === true || r.effective === false);
  const success = judged.filter((r) => r.effective === true).length;
  const failure = judged.filter((r) => r.effective === false).length;
  return { actionType, total: rows.length, judged: judged.length, success, failure, successRate: judged.length ? success / judged.length : null };
}

// ── Learning (policy weight updates) ────────────────────────────────────────

export function actionPolicyWeightsPath(learnerDir) {
  return path.join(learnerDir, "action_policy_weights.json");
}

export function updateActionPolicyWeights(learnerDir, { actionType = null, limit = 20 } = {}) {
  const file = actionPolicyWeightsPath(learnerDir);
  const weights = readJson(file, {});
  const actionTypes = actionType ? [actionType] : [...new Set(readActionFeedback(learnerDir).map((r) => r.actionType).filter(Boolean))];
  for (const type of actionTypes) {
    const rows = readActionFeedback(learnerDir, { actionType: type, limit }).filter((r) => r.effective === true || r.effective === false);
    const success = rows.filter((r) => r.effective === true).length;
    const failure = rows.filter((r) => r.effective === false).length;
    const total = success + failure;
    const successRate = total ? success / total : null;
    let autoConfidenceBoost = 0, autoSuspended = false;
    if (total >= 5 && successRate >= 0.8) autoConfidenceBoost = 0.05;
    if (total >= 5 && successRate <= 0.4) autoConfidenceBoost = -0.05;
    if (rows.slice(0, 3).length === 3 && rows.slice(0, 3).every((r) => r.effective === false)) autoSuspended = true;
    weights[type] = { actionType: type, success, failure, total, successRate, autoConfidenceBoost, autoSuspended, lastUpdated: new Date().toISOString() };
  }
  writeJson(file, weights);
  return weights;
}
