import fs from "fs";
import os from "os";
import path from "path";
import { executeActionPlan, runAllowedCommand } from "./action-executor.js";
import { runAgentController } from "./agent-controller.js";
import { runTransferCandidateValidation } from "./transfer-validation-runner.js";
import { runSkillPromotionLoop } from "./skill-promotion-loop.js";
import { exportAuditDashboard } from "./audit-dashboard.js";
import { buildSkillMdFromPatterns } from "./common.js";
import { buildReleaseReadiness } from "./release-readiness.js";
import { calculateEvaluationMetrics } from "./evaluation-metrics.js";

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function writeFixtureFiles(workspaceRoot, files = []) {
  for (const file of files) {
    const rel = String(file.path || "");
    if (!rel || path.isAbsolute(rel)) throw new Error(`fixture path must be relative: ${rel}`);
    const full = path.resolve(workspaceRoot, rel);
    if (!isInside(full, workspaceRoot)) throw new Error(`fixture path escapes workspace: ${rel}`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, String(file.content ?? ""), "utf-8");
  }
}

function prepareScenarioWorkspace(scenario = {}, context = {}) {
  const workspace = scenario.workspace || {};
  if (!workspace.files && !workspace.copyFrom) {
    return { workspaceRoot: path.resolve(context.workspaceRoot || scenario.workspaceRoot || process.cwd()), cleanup: () => {} };
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hanako-benchmark-${scenario.id || "scenario"}-`));
  if (workspace.copyFrom) {
    const source = path.resolve(workspace.copyFrom);
    fs.cpSync(source, root, { recursive: true, force: true });
  }
  writeFixtureFiles(root, workspace.files || []);
  return {
    workspaceRoot: root,
    cleanup: () => {
      if (context.keepBenchmarkWorkspaces === true || scenario.keepWorkspace === true) return;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function assertFile(workspaceRoot, assertion = {}) {
  const file = path.resolve(workspaceRoot, assertion.path || "");
  if (!isInside(file, workspaceRoot)) return { ok: false, error: `assertion path escapes workspace: ${assertion.path}` };
  const exists = fs.existsSync(file);
  if (assertion.exists === true && !exists) return { ok: false, error: `file does not exist: ${assertion.path}` };
  if (assertion.exists === false && exists) return { ok: false, error: `file exists: ${assertion.path}` };
  if (assertion.contains !== undefined) {
    if (!exists) return { ok: false, error: `file does not exist: ${assertion.path}` };
    const text = fs.readFileSync(file, "utf-8");
    if (!text.includes(String(assertion.contains))) return { ok: false, error: `file does not contain expected text: ${assertion.path}` };
  }
  if (assertion.notContains !== undefined && exists) {
    const text = fs.readFileSync(file, "utf-8");
    if (text.includes(String(assertion.notContains))) return { ok: false, error: `file contains unexpected text: ${assertion.path}` };
  }
  return { ok: true };
}

function valueAtPath(value, dottedPath) {
  return String(dottedPath || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

function assertLastResult(lastResult, assertion = {}) {
  const actual = assertion.path ? valueAtPath(lastResult, assertion.path) : lastResult;
  if (assertion.equals !== undefined && actual !== assertion.equals) return { ok: false, error: `expected ${assertion.path} to equal ${assertion.equals}, got ${actual}` };
  if (assertion.exists === true && actual === undefined) return { ok: false, error: `expected ${assertion.path} to exist` };
  if (assertion.includes !== undefined && !String(actual || "").includes(String(assertion.includes))) return { ok: false, error: `expected ${assertion.path} to include ${assertion.includes}` };
  if (assertion.gte !== undefined && !(Number(actual) >= Number(assertion.gte))) return { ok: false, error: `expected ${assertion.path} >= ${assertion.gte}, got ${actual}` };
  return { ok: true, actual };
}

function acceptableStatuses(step = {}, defaults = []) {
  if (Array.isArray(step.acceptableStatuses)) return step.acceptableStatuses.map(String);
  if (step.expectStatus) return [String(step.expectStatus)];
  return defaults;
}

function containsNested(value, predicate, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (predicate(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsNested(item, predicate, depth + 1));
  if (typeof value === "object") return Object.values(value).some((child) => containsNested(child, predicate, depth + 1));
  return false;
}

function resolveWorkspacePlaceholders(value, workspaceRoot) {
  if (typeof value === "string") return value.replaceAll("$WORKSPACE", workspaceRoot).replaceAll("${WORKSPACE}", workspaceRoot);
  if (Array.isArray(value)) return value.map((item) => resolveWorkspacePlaceholders(item, workspaceRoot));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveWorkspacePlaceholders(child, workspaceRoot)]));
  }
  return value;
}

function mergeScenarioContext(scenario = {}, context = {}) {
  const workspaceRoot = context.workspaceRoot || process.cwd();
  const merged = {
    ...context,
    ...(scenario.context || {}),
    config: { ...(context.config || {}), ...(scenario.context?.config || scenario.config || {}) },
    taskScope: scenario.context?.taskScope || scenario.taskScope || context.taskScope,
  };
  return resolveWorkspacePlaceholders(merged, workspaceRoot);
}

export async function runEvaluationScenario(scenario = {}, context = {}) {
  const started = Date.now();
  const prepared = prepareScenarioWorkspace(scenario, context);
  const workspaceRoot = prepared.workspaceRoot;
  const scenarioContext = mergeScenarioContext(scenario, { ...context, workspaceRoot });
  const config = scenarioContext.config || {};
  const stepResults = [];
  let status = "succeeded";
  let lastResult = null;

  try {
    for (const step of scenario.steps || []) {
      let result;
      if (step.type === "execute_action") {
        result = await executeActionPlan(step.actionPlan, { ...scenarioContext, workspaceRoot, config });
        const okStatuses = acceptableStatuses(step, ["succeeded", "queued"]);
        if (!okStatuses.includes(result.status)) status = "failed";
      } else if (step.type === "run_command") {
        result = await runAllowedCommand(step.command, { cwd: workspaceRoot, timeout: Number(step.timeout || 30000), config });
        const okStatuses = acceptableStatuses(step, ["succeeded"]);
        if (!okStatuses.includes(result.status) || (step.expectExitCode !== undefined && result.exitCode !== step.expectExitCode)) status = "failed";
        if (step.expectExitCode === undefined && result.exitCode !== 0) status = "failed";
      } else if (step.type === "assert_file") {
        result = assertFile(workspaceRoot, step);
        if (!result.ok) status = "failed";
      } else if (step.type === "run_agent_controller") {
        const input = resolveWorkspacePlaceholders(step.input || {}, workspaceRoot);
        result = await runAgentController(input, { ...scenarioContext, workspaceRoot, config });
        result = { ...result, status: result.state?.state || result.status };
        const okStatuses = acceptableStatuses(step, ["completed", "waiting_for_human", "succeeded"]);
        const resultStatus = result.status;
        if (!okStatuses.includes(resultStatus)) status = "failed";
      } else if (step.type === "transfer_validate") {
        const payload = resolveWorkspacePlaceholders(step, workspaceRoot);
        result = await runTransferCandidateValidation(payload.candidate, {
          ...scenarioContext,
          workspaceRoot,
          config,
          registryBaseDir: payload.registryBaseDir || scenarioContext.registryBaseDir || path.join(workspaceRoot, ".hanako"),
          targetProfile: payload.targetProfile || scenarioContext.targetProfile,
          targetPolicy: payload.targetPolicy || scenarioContext.targetPolicy,
        });
        const okStatuses = acceptableStatuses(step, ["validated"]);
        if (!okStatuses.includes(result.status)) status = "failed";
      } else if (step.type === "run_skill_promotion_loop") {
        const payload = resolveWorkspacePlaceholders(step, workspaceRoot);
        const learnerDir = payload.learnerDir || scenarioContext.learnerDir || path.join(workspaceRoot, ".hanako");
        result = runSkillPromotionLoop(learnerDir, payload.options || {});
        const okStatuses = acceptableStatuses(step, ["completed"]);
        if (!okStatuses.includes(result.status)) status = "failed";
      } else if (step.type === "generate_audit_dashboard") {
        const payload = resolveWorkspacePlaceholders(step, workspaceRoot);
        const learnerDir = payload.learnerDir || scenarioContext.learnerDir || path.join(workspaceRoot, ".hanako");
        result = exportAuditDashboard(learnerDir, null, {
          name: payload.name || "benchmark",
          version: payload.version || scenarioContext.version || "benchmark",
          benchmarkReportPath: payload.benchmarkReportPath,
          benchmarkRunsDir: payload.benchmarkRunsDir,
          limit: payload.limit || 50,
        });
        const okStatuses = acceptableStatuses(step, ["generated"]);
        if (!okStatuses.includes(result.status)) status = "failed";
      } else if (step.type === "render_skill") {
        const payload = resolveWorkspacePlaceholders(step, workspaceRoot);
        const learnerDir = payload.learnerDir || scenarioContext.learnerDir || path.join(workspaceRoot, ".hanako");
        const rendered = buildSkillMdFromPatterns(payload.patterns || [], { ...config, ...(payload.config || {}) }, {
          turnCount: Number(payload.turnCount || 0),
          dataDir: learnerDir,
        });
        if (payload.outputPath) {
          const out = path.resolve(workspaceRoot, payload.outputPath);
          if (!isInside(out, workspaceRoot)) throw new Error(`render_skill outputPath escapes workspace: ${payload.outputPath}`);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, rendered, "utf-8");
        }
        result = { ok: true, status: "rendered", content: rendered, outputPath: payload.outputPath || null };
        const okStatuses = acceptableStatuses(step, ["rendered"]);
        if (!okStatuses.includes(result.status)) status = "failed";
      } else if (step.type === "release_readiness") {
        const payload = resolveWorkspacePlaceholders(step, workspaceRoot);
        const projectRoot = payload.projectRoot || scenarioContext.pluginDir || process.cwd();
        result = buildReleaseReadiness(projectRoot, { minBenchmarkScenarios: payload.minBenchmarkScenarios || 16 });
        result = { ...result, status: result.summary?.status || "unknown", ok: result.summary?.ok === true };
        const okStatuses = acceptableStatuses(step, ["ready"]);
        if (!okStatuses.includes(result.status)) status = "failed";
      } else if (step.type === "assert_last_result") {
        result = assertLastResult(lastResult, step);
        if (!result.ok) status = "failed";
      } else if (step.type === "note") {
        result = { ok: true, note: step.note || "" };
      } else {
        result = { ok: false, error: `unknown evaluation step: ${step.type}` };
        status = "failed";
      }
      if (!String(step.type || "").startsWith("assert_")) lastResult = result;
      stepResults.push({ ...result, type: step.type, name: step.name || step.type });
      if (status === "failed" && step.stopOnFailure !== false) break;
    }
  } finally {
    prepared.cleanup();
  }

  const durationMs = Date.now() - started;
  const rollbackAttempted = stepResults.some((r) => r.rollback || r.status === "reverted" || containsNested(r, (value) => value?.rollback?.attempted === true || value?.status === "reverted"));
  const rollbackOk = stepResults.some((r) => r.rollback?.ok || r.status === "reverted" || containsNested(r, (value) => value?.rollback?.ok === true || value?.status === "reverted"));
  const repairAttempted = stepResults.some((r) => r.repair?.attempted || containsNested(r, (value) => value?.repair?.attempted === true));
  const repairOk = stepResults.some((r) => r.repair?.ok || containsNested(r, (value) => value?.repair?.ok === true));
  const manualEscalated = scenario.manualEscalated === true || stepResults.some((r) => r.status === "queued" || r.status === "waiting_for_human" || r.state?.state === "waiting_for_human" || r.registry?.decision === "manual_confirm");

  return {
    scenarioId: scenario.id || scenario.name || "scenario",
    title: scenario.title || scenario.name || scenario.id || "scenario",
    category: scenario.category || "uncategorized",
    status,
    ok: status === "succeeded",
    autoApplied: scenario.autoApplied === true,
    manualEscalated,
    falseAutoApply: scenario.falseAutoApply === true,
    rollbackAttempted,
    rollbackOk,
    repairAttempted,
    repairOk,
    tokenOverhead: scenario.tokenOverhead,
    skillEffectiveness: scenario.skillEffectiveness,
    durationMs,
    stepResults,
  };
}

export async function runEvaluationSuite(scenarios = [], context = {}) {
  const runs = [];
  for (const scenario of scenarios) runs.push(await runEvaluationScenario(scenario, context));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), runs, metrics: calculateEvaluationMetrics(runs) };
}
