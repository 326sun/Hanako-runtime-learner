import { nowIso } from "./common.js";

/**
 * audit-dashboard-render.js
 *
 * Markdown rendering for the audit dashboard. Pure: takes an already-aggregated
 * dashboard object (built by audit-dashboard.js) and returns a Markdown string.
 * Split out of audit-dashboard.js (S10.P2 equivalence refactor), behavior
 * unchanged — separates "what the numbers are" (aggregation) from "how they're
 * presented" (rendering).
 */

function percent(value) {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function renderStatus(value) {
  if (value === true) return "passed";
  if (value === false) return "failed";
  if (value == null) return "n/a";
  return String(value);
}

export function renderAuditDashboardMarkdown(dashboard = {}) {
  const lines = [];
  lines.push("# Runtime Learner Audit Dashboard");
  lines.push("");
  lines.push(`Generated: ${dashboard.generatedAt || nowIso()}`);
  lines.push(`Version: ${dashboard.version || "unknown"}`);
  lines.push(`Safety posture: **${dashboard.safetyPosture || "unknown"}**`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push("| Item | Value |");
  lines.push("|---|---:|");
  lines.push(`| Benchmark available | ${renderStatus(dashboard.summary?.benchmarkAvailable)} |`);
  lines.push(`| Benchmark status | ${renderStatus(dashboard.summary?.benchmarkOk)} |`);
  lines.push(`| Benchmark scenarios | ${dashboard.summary?.scenarios ?? 0} |`);
  lines.push(`| Failed scenarios | ${dashboard.summary?.failedScenarios ?? 0} |`);
  lines.push(`| Metric regressions | ${dashboard.summary?.metricRegressions ?? 0} |`);
  lines.push(`| False auto-apply rate | ${percent(dashboard.summary?.falseAutoApplyRate)} |`);
  lines.push(`| Agent tasks | ${dashboard.summary?.agentTasks ?? 0} |`);
  lines.push(`| Pending approvals | ${dashboard.summary?.pendingApprovals ?? 0} |`);
  lines.push(`| Transfer candidates | ${dashboard.summary?.transferCandidates ?? 0} |`);
  lines.push(`| Transfer candidates eligible for manual promotion | ${dashboard.summary?.transferManualPromotionEligible ?? 0} |`);
  lines.push(`| Skill candidates | ${dashboard.summary?.skillCandidates ?? 0} |`);
  lines.push(`| Active skills | ${dashboard.summary?.activeSkills ?? 0} |`);
  lines.push("");

  lines.push("## Benchmark Evidence");
  lines.push("");
  if (!dashboard.benchmark?.available) {
    lines.push("No benchmark report found.");
  } else {
    lines.push(`Report: ${dashboard.benchmark.reportPath || "n/a"}`);
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|---|---:|");
    for (const [key, value] of Object.entries(dashboard.benchmark.metrics || {})) {
      lines.push(`| ${key} | ${typeof value === "number" ? value.toFixed(4) : String(value)} |`);
    }
    if (dashboard.benchmark.failedScenarios?.length) {
      lines.push("");
      lines.push("### Failed Scenarios");
      for (const item of dashboard.benchmark.failedScenarios) lines.push(`- ${item.id} [${item.category}]: ${item.status}`);
    }
  }
  lines.push("");

  lines.push("## Agent Controller");
  lines.push("");
  lines.push(`Tasks: ${dashboard.agentTasks?.count ?? 0}`);
  lines.push(`Pending approvals: ${dashboard.agentTasks?.pendingApprovals ?? 0}`);
  if (dashboard.agentTasks?.tasks?.length) {
    lines.push("");
    lines.push("| Task | State | Current node | Pending approvals | Updated |");
    lines.push("|---|---|---|---:|---|");
    for (const task of dashboard.agentTasks.tasks.slice(0, 20)) {
      lines.push(`| ${task.taskId || "n/a"} | ${task.state || "n/a"} | ${task.currentNode || "n/a"} | ${task.pendingApprovals || 0} | ${task.updatedAt || "n/a"} |`);
    }
  }
  lines.push("");

  lines.push("## Cross-project Transfer");
  lines.push("");
  lines.push(`Candidates: ${dashboard.transfer?.count ?? 0}`);
  lines.push(`Manual promotion eligible: ${dashboard.transfer?.manualPromotionEligible ?? 0}`);
  lines.push(`Auto-promotion blocked: ${dashboard.transfer?.autoPromotionBlocked ?? 0}`);
  if (dashboard.transfer?.records?.length) {
    lines.push("");
    lines.push("| Candidate | Status | Source → Target | Validation | Manual promotion | Auto-promotion blocked |");
    lines.push("|---|---|---|---|---:|---:|");
    for (const record of dashboard.transfer.records.slice(0, 20)) {
      lines.push(`| ${record.id || "n/a"} | ${record.status || "n/a"} | ${record.sourceProjectId || "?"} → ${record.targetProjectId || "?"} | ${record.validationStatus || "n/a"} | ${record.manualPromotionEligible ? "yes" : "no"} | ${record.autoPromotionBlocked ? "yes" : "no"} |`);
    }
  }
  lines.push("");

  lines.push("## Skill Promotion");
  lines.push("");
  lines.push(`Candidates: ${dashboard.skillPromotion?.candidates ?? 0}`);
  lines.push(`Active skills: ${dashboard.skillPromotion?.active ?? 0}`);
  lines.push(`SKILL.md auto-write: ${dashboard.skillPromotion?.autoSkillFileWriteBlocked ? "blocked by default" : "allowed"}`);
  if (dashboard.skillPromotion?.activeSkills?.length) {
    lines.push("");
    lines.push("| Active skill | Rule | Success | Regression |");
    lines.push("|---|---|---:|---:|");
    for (const skill of dashboard.skillPromotion.activeSkills.slice(0, 20)) {
      lines.push(`| ${skill.id} | ${String(skill.rule || "").replaceAll("|", "\\|")} | ${skill.evidence?.successCount || 0} | ${skill.evidence?.regressionCount || 0} |`);
    }
  }
  lines.push("");

  lines.push("## Governance Boundaries");
  lines.push("");
  lines.push("| Boundary | State |");
  lines.push("|---|---|");
  for (const [key, value] of Object.entries(dashboard.governanceBoundaries || {})) lines.push(`| ${key} | ${value} |`);
  lines.push("");

  lines.push("## Recommended Actions");
  lines.push("");
  for (const item of dashboard.recommendations || []) lines.push(`- **${item.priority}** [${item.area}] ${item.action}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
