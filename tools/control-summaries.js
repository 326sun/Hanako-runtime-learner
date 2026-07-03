// Pure summary / formatting helpers extracted from tools/control.js (C-001 phase 3a).
//
// These functions are side-effect free: they only aggregate or map plain data
// for the control tool's JSON responses. They were module-private in control.js
// and had no external consumers; moving them here shrinks the control dispatcher
// and makes them directly unit-testable. Bodies are unchanged from control.js.

export function countByStatus(rows = [], field = "status") {
  const counts = {};
  for (const row of rows) {
    const key = row?.[field] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function summarizePatternStatus(patterns = []) {
  const summary = { total: 0, pending: 0, approved: 0, rejected: 0 };
  for (const pattern of patterns) {
    summary.total += 1;
    if (pattern?.status === "pending") summary.pending += 1;
    else if (pattern?.status === "approved") summary.approved += 1;
    else if (pattern?.status === "rejected") summary.rejected += 1;
  }
  return summary;
}

export function summarizeDecoratedPatterns(patterns = []) {
  const summary = { total: 0, injectable: 0, pending: 0, approved: 0, rejected: 0 };
  for (const pattern of patterns) {
    summary.total += 1;
    if (pattern.injectable) summary.injectable += 1;
    if (pattern.status === "pending") summary.pending += 1;
    else if (pattern.status === "approved") summary.approved += 1;
    else if (pattern.status === "rejected") summary.rejected += 1;
  }
  return summary;
}

export function countWaitingAgentTasks(tasks = []) {
  let waiting = 0;
  for (const task of tasks) {
    if (task.state === "waiting_for_human") waiting += 1;
  }
  return waiting;
}

export function validationNextAction(validation) {
  return validation?.ok
    ? "approve_review then apply_review"
    : "fix proposal or reject_proposal";
}

export function reviewPanelNextActions(panel = {}) {
  const actions = [];
  const blocked = panel.counts?.blockedReviews || 0;
  const pending = panel.counts?.pendingReviews || 0;
  if (blocked > 0) actions.push("validate blocked reviews, then fix or reject them");
  if (pending > 0) actions.push("preview queued reviews, then approve_review or reject_review");
  if (panel.counts?.pendingProposals > 0) actions.push("validate_proposal for pending proposals not yet reviewed");
  if (!actions.length) actions.push("no review action needed");
  return actions;
}
