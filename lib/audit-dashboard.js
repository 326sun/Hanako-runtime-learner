import fs from "fs";
import path from "path";
import { summarizeAuditTrace } from "./audit-trace.js";
import { listAgentTaskStates } from "./agent-task-store.js";
import { listTransferCandidateRecords, summarizeTransferCandidate } from "./transfer-registry.js";
import { loadActiveSkills, loadSkillCandidates } from "./skill-promotion-loop.js";
import { countValues, nowIso, readJson, safeFileSlug, writeJson } from "./common.js";
import { renderAuditDashboardMarkdown } from "./audit-dashboard-render.js";
// renderAuditDashboardMarkdown lives in audit-dashboard-render.js (S10.P2);
// re-exported here so existing import sites (incl. tests) keep working.
export { renderAuditDashboardMarkdown } from "./audit-dashboard-render.js";

function walkFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, predicate));
    else if (entry.isFile() && predicate(full, entry)) out.push(full);
  }
  return out;
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function latestFile(files = []) {
  return files.sort((a, b) => mtimeMs(b) - mtimeMs(a))[0] || null;
}

function findLatestBenchmarkReport(learnerDir, options = {}) {
  if (options.benchmarkReportPath && fs.existsSync(options.benchmarkReportPath)) return path.resolve(options.benchmarkReportPath);
  const root = options.benchmarkRunsDir || path.join(learnerDir, "benchmark-runs");
  return latestFile(walkFiles(root, (file) => path.basename(file) === "benchmark-report.json"));
}

function loadBenchmarkSection(learnerDir, options = {}) {
  const reportPath = findLatestBenchmarkReport(learnerDir, options);
  const report = reportPath ? readJson(reportPath, null) : null;
  const metrics = report?.metrics || {};
  const runs = Array.isArray(report?.runs) ? report.runs : [];
  return {
    available: !!report,
    reportPath,
    generatedAt: report?.generatedAt || null,
    ok: report?.ok ?? null,
    scenarioCount: runs.length,
    selectedScenarioCount: report?.corpus?.selectedScenarioCount ?? runs.length,
    metrics,
    regressions: Array.isArray(report?.regressions) ? report.regressions : [],
    categories: countValues(runs.map((run) => run.category)),
    failedScenarios: runs.filter((run) => !run.ok).map((run) => ({ id: run.scenarioId, category: run.category, status: run.status })),
  };
}

function loadAuditTraceSummaries(learnerDir, { limit = 50 } = {}) {
  const auditDir = path.join(learnerDir, "audit");
  const files = walkFiles(auditDir, (file) => file.endsWith(".json"));
  const traces = [];
  for (const file of files) {
    const raw = readJson(file, null);
    if (!raw || !Array.isArray(raw.events) || !raw.traceId) continue;
    traces.push({ ...summarizeAuditTrace(raw), path: file });
  }
  return traces
    .sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || "")))
    .slice(0, Math.max(0, Number(limit || 50)));
}

function loadSkillSection(learnerDir) {
  const candidateStore = loadSkillCandidates(learnerDir);
  const activeRegistry = loadActiveSkills(learnerDir);
  const candidates = candidateStore.candidates || [];
  const active = activeRegistry.skills || [];
  return {
    candidates: candidates.length,
    active: active.length,
    byStatus: countValues(candidates.map((candidate) => candidate.status || "candidate")),
    staged: candidates.filter((candidate) => candidate.status === "staged").map((candidate) => ({ id: candidate.id, rule: candidate.rule, evidence: candidate.evidence })),
    activeSkills: active.map((skill) => ({ id: skill.id, rule: skill.rule, evidence: skill.evidence, scope: skill.scope, activatedAt: skill.activatedAt || null })),
    autoSkillFileWriteBlocked: true,
  };
}

function loadTransferSection(learnerDir, { limit = 50 } = {}) {
  const records = listTransferCandidateRecords(learnerDir, { limit });
  const summaries = records.map(summarizeTransferCandidate);
  return {
    count: summaries.length,
    byStatus: countValues(summaries.map((record) => record.status)),
    validationFailures: summaries.filter((record) => record.validationStatus === "failed" || record.status === "validation_failed").length,
    manualPromotionEligible: summaries.filter((record) => record.manualPromotionEligible).length,
    autoPromotionBlocked: summaries.filter((record) => record.autoPromotionBlocked).length,
    records: summaries,
  };
}

function loadAgentTaskSection(learnerDir, { limit = 50 } = {}) {
  const tasks = listAgentTaskStates(learnerDir, { limit });
  return {
    count: tasks.length,
    byState: countValues(tasks.map((task) => task.state)),
    pendingApprovals: tasks.reduce((sum, task) => sum + Number(task.pendingApprovals || 0), 0),
    tasks,
  };
}

function postureFromMetrics(metrics = {}) {
  const falseAutoApply = Number(metrics.false_auto_apply_rate ?? 0);
  const rollback = metrics.rollback_success_rate == null ? 1 : Number(metrics.rollback_success_rate);
  const task = metrics.task_success_rate == null ? 1 : Number(metrics.task_success_rate);
  if (falseAutoApply > 0 || rollback < 1) return "needs_attention";
  if (task < 0.9) return "watch";
  return "healthy";
}

function buildRecommendations(dashboard = {}) {
  const items = [];
  const benchmark = dashboard.benchmark || {};
  const agent = dashboard.agentTasks || {};
  const transfer = dashboard.transfer || {};
  const skill = dashboard.skillPromotion || {};

  if (!benchmark.available) items.push({ priority: "P0", area: "benchmark", action: "Run benchmark corpus and attach benchmark-report.json to the dashboard." });
  if (benchmark.available && benchmark.ok === false) items.push({ priority: "P0", area: "benchmark", action: "Fix failed benchmark scenarios before increasing automation scope." });
  if ((benchmark.regressions || []).length > 0) items.push({ priority: "P0", area: "benchmark", action: "Investigate metric regressions and block LTS release until resolved." });
  if (Number(benchmark.metrics?.false_auto_apply_rate || 0) > 0) items.push({ priority: "P0", area: "safety", action: "Suspend auto-apply path that produced false_auto_apply evidence." });
  if (agent.pendingApprovals > 0) items.push({ priority: "P1", area: "agent_controller", action: `Review ${agent.pendingApprovals} pending human approval request(s).` });
  if (transfer.validationFailures > 0) items.push({ priority: "P1", area: "transfer", action: "Expire or repair failed cross-project transfer candidates." });
  if (transfer.manualPromotionEligible > 0) items.push({ priority: "P2", area: "transfer", action: "Manually review transfer candidates that passed target validation; auto-promotion remains blocked." });
  if ((skill.byStatus?.staged || 0) > 0) items.push({ priority: "P2", area: "skill", action: "Review staged skill candidates and keep measuring effectiveness before SKILL.md injection." });
  if (items.length === 0) items.push({ priority: "P3", area: "maintenance", action: "No blocking audit item detected; proceed to LTS docs/API freeze." });
  return items;
}

export function buildAuditDashboard(learnerDir, options = {}) {
  if (!learnerDir) return { ok: false, status: "failed", error: "learnerDir missing" };
  const benchmark = loadBenchmarkSection(learnerDir, options);
  const agentTasks = loadAgentTaskSection(learnerDir, { limit: options.limit || 50 });
  const traces = loadAuditTraceSummaries(learnerDir, { limit: options.limit || 50 });
  const transfer = loadTransferSection(learnerDir, { limit: options.limit || 50 });
  const skillPromotion = loadSkillSection(learnerDir);
  const dashboard = {
    ok: true,
    status: "generated",
    schemaVersion: 1,
    generatedAt: nowIso(),
    version: options.version || "unknown",
    safetyPosture: postureFromMetrics(benchmark.metrics),
    summary: {
      benchmarkAvailable: benchmark.available,
      benchmarkOk: benchmark.ok,
      scenarios: benchmark.scenarioCount,
      failedScenarios: benchmark.failedScenarios.length,
      metricRegressions: benchmark.regressions.length,
      falseAutoApplyRate: benchmark.metrics?.false_auto_apply_rate ?? null,
      agentTasks: agentTasks.count,
      pendingApprovals: agentTasks.pendingApprovals,
      auditTraces: traces.length,
      transferCandidates: transfer.count,
      transferManualPromotionEligible: transfer.manualPromotionEligible,
      skillCandidates: skillPromotion.candidates,
      activeSkills: skillPromotion.active,
    },
    benchmark,
    agentTasks,
    auditTraces: traces,
    transfer,
    skillPromotion,
    governanceBoundaries: {
      r4AutoExecution: "blocked",
      externalSideEffects: "blocked_by_policy",
      pluginCodeExecution: "explicit_opt_in_process_isolated",
      transferredMemoryAutoPromotion: "blocked",
      skillFileWrite: "manual_or_explicit_only",
    },
  };
  dashboard.recommendations = buildRecommendations(dashboard);
  return dashboard;
}

export function exportAuditDashboard(learnerDir, dashboard = null, options = {}) {
  const payload = dashboard || buildAuditDashboard(learnerDir, options);
  const dir = path.join(learnerDir, "audit-dashboard", safeFileSlug(options.name || new Date().toISOString().replace(/[:.]/g, "-"), "latest"));
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "dashboard.json");
  writeJson(jsonPath, payload);
  const mdPath = path.join(dir, "dashboard.md");
  fs.writeFileSync(mdPath, renderAuditDashboardMarkdown(payload), "utf-8");
  return { ok: true, status: "generated", dir, jsonPath, mdPath, summary: payload.summary, safetyPosture: payload.safetyPosture, recommendations: payload.recommendations };
}
