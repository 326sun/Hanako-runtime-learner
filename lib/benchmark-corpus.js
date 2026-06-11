import fs from "fs";
import path from "path";
import { runEvaluationSuite } from "./evaluation-runner.js";
import { compareMetrics, detectMetricRegressions } from "./evaluation-metrics.js";

const SCENARIO_STEP_TYPES = new Set(["execute_action", "run_command", "run_agent_controller", "transfer_validate", "run_skill_promotion_loop", "generate_audit_dashboard", "render_skill", "release_readiness", "assert_file", "assert_last_result", "note"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function walkJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
  }
  return out.sort();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultBenchmarkRoot(root = process.cwd()) {
  return path.join(root, "benchmarks");
}

export function validateBenchmarkScenario(scenario = {}) {
  const errors = [];
  const warnings = [];
  if (!scenario.id || typeof scenario.id !== "string") errors.push("scenario.id is required");
  if (!scenario.title || typeof scenario.title !== "string") warnings.push("scenario.title is recommended");
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) errors.push("scenario.steps must be a non-empty array");
  for (const [index, step] of asArray(scenario.steps).entries()) {
    if (!SCENARIO_STEP_TYPES.has(step.type)) errors.push(`step ${index} has unsupported type: ${step.type}`);
    if (step.type === "execute_action" && !step.actionPlan) errors.push(`step ${index} execute_action requires actionPlan`);
    if (step.type === "run_command" && !step.command) errors.push(`step ${index} run_command requires command`);
    if (step.type === "assert_file" && !step.path) errors.push(`step ${index} assert_file requires path`);
    if (step.type === "assert_last_result" && !step.path) errors.push(`step ${index} assert_last_result requires path`);
    if (step.type === "run_agent_controller" && !step.input) errors.push(`step ${index} run_agent_controller requires input`);
    if (step.type === "generate_audit_dashboard" && step.learnerDir === "") errors.push(`step ${index} generate_audit_dashboard learnerDir cannot be empty`);
    if (step.type === "render_skill" && step.learnerDir === "") errors.push(`step ${index} render_skill learnerDir cannot be empty`);
    if (step.type === "transfer_validate" && !step.candidate) errors.push(`step ${index} transfer_validate requires candidate`);
    if (step.type === "release_readiness" && step.projectRoot === "") errors.push(`step ${index} release_readiness projectRoot cannot be empty`);
  }
  for (const fixture of asArray(scenario.workspace?.files)) {
    if (!fixture.path || path.isAbsolute(String(fixture.path))) errors.push(`fixture path must be relative: ${fixture.path}`);
    if (String(fixture.path).split(/[\\/]/).includes("..")) errors.push(`fixture path cannot contain ..: ${fixture.path}`);
  }
  return { ok: errors.length === 0, errors, warnings, scenarioId: scenario.id || null };
}

export function loadBenchmarkScenario(filePath) {
  let scenario;
  try {
    scenario = readJson(filePath);
  } catch (err) {
    // A malformed scenario file should land in `rejected`, not crash the corpus load.
    return { scenario: null, validation: { ok: false, errors: [`invalid scenario JSON: ${err.message}`], warnings: [], scenarioId: null }, filePath };
  }
  const validation = validateBenchmarkScenario(scenario);
  return { scenario, validation, filePath };
}

export function loadBenchmarkCorpus(options = {}) {
  const root = path.resolve(options.benchmarkRoot || defaultBenchmarkRoot(options.projectRoot));
  const scenariosDir = path.resolve(options.scenariosDir || path.join(root, "scenarios"));
  const files = walkJsonFiles(scenariosDir);
  const loaded = files.map(loadBenchmarkScenario);
  const scenarios = loaded.filter((item) => item.validation.ok).map((item) => ({ ...item.scenario, sourceFile: item.filePath }));
  const rejected = loaded.filter((item) => !item.validation.ok).map((item) => ({ filePath: item.filePath, validation: item.validation }));
  const ids = new Set();
  const duplicateIds = [];
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) duplicateIds.push(scenario.id);
    ids.add(scenario.id);
  }
  return {
    ok: rejected.length === 0 && duplicateIds.length === 0,
    root,
    scenariosDir,
    scenarioCount: scenarios.length,
    scenarios,
    rejected,
    duplicateIds,
  };
}

export function loadBenchmarkBaseline(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const data = readJson(filePath);
  return data.metrics ? data : { metrics: data };
}

export function loadBenchmarkThresholds(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const data = readJson(filePath);
  return data.thresholds || data;
}

function filterScenarios(scenarios, ids = []) {
  const wanted = new Set(asArray(ids).map(String).filter(Boolean));
  if (wanted.size === 0) return scenarios;
  return scenarios.filter((scenario) => wanted.has(scenario.id));
}

export function formatBenchmarkReport(result = {}) {
  const metrics = result.metrics || {};
  const lines = [];
  lines.push(`# Benchmark Report`);
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt || new Date().toISOString()}`);
  lines.push(`Scenarios: ${result.runs?.length || 0}`);
  lines.push(`Status: ${result.ok ? "passed" : "failed"}`);
  lines.push("");
  lines.push(`## Metrics`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  for (const [key, value] of Object.entries(metrics)) {
    lines.push(`| ${key} | ${typeof value === "number" ? value.toFixed(4) : String(value)} |`);
  }
  lines.push("");
  lines.push(`## Scenario Results`);
  lines.push("");
  lines.push(`| Scenario | Category | Status | Steps |`);
  lines.push(`|---|---|---|---:|`);
  for (const run of result.runs || []) {
    lines.push(`| ${run.scenarioId} | ${run.category || "uncategorized"} | ${run.status} | ${run.stepResults?.length || 0} |`);
  }
  if (result.regressions?.length) {
    lines.push("");
    lines.push(`## Regressions`);
    lines.push("");
    lines.push(`| Metric | Direction | Delta | Current | Baseline |`);
    lines.push(`|---|---|---:|---:|---:|`);
    for (const regression of result.regressions) {
      lines.push(`| ${regression.metric} | ${regression.direction} | ${regression.delta.toFixed(4)} | ${regression.current.toFixed(4)} | ${regression.baseline.toFixed(4)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function runBenchmarkCorpus(options = {}, context = {}) {
  const corpus = loadBenchmarkCorpus(options);
  if (!corpus.ok) {
    return { ok: false, status: "invalid_corpus", corpus, errors: ["benchmark corpus validation failed"] };
  }
  const scenarios = filterScenarios(corpus.scenarios, options.ids);
  const suite = await runEvaluationSuite(scenarios, {
    ...context,
    config: { ...(context.config || {}), ...(options.config || {}) },
    keepBenchmarkWorkspaces: options.keepBenchmarkWorkspaces === true,
  });
  const benchmarkRoot = corpus.root;
  const baselinePath = options.baselinePath || path.join(benchmarkRoot, "baseline-v4.0.9.json");
  const thresholdsPath = options.thresholdsPath || path.join(benchmarkRoot, "thresholds.json");
  const baseline = loadBenchmarkBaseline(baselinePath);
  const thresholds = loadBenchmarkThresholds(thresholdsPath);
  const comparison = baseline ? compareMetrics(suite.metrics, baseline.metrics) : {};
  const regressions = baseline ? detectMetricRegressions(suite.metrics, baseline.metrics, thresholds) : [];
  const result = {
    ...suite,
    corpus: { root: corpus.root, scenarioCount: corpus.scenarioCount, selectedScenarioCount: scenarios.length },
    baseline: baseline ? { path: baselinePath, metrics: baseline.metrics } : null,
    thresholds,
    comparison,
    regressions,
    ok: suite.runs.every((run) => run.ok) && regressions.length === 0,
  };
  if (options.outputDir) {
    const outputDir = path.resolve(options.outputDir);
    writeJson(path.join(outputDir, "benchmark-report.json"), result);
    fs.writeFileSync(path.join(outputDir, "benchmark-report.md"), formatBenchmarkReport(result), "utf-8");
    result.outputDir = outputDir;
  }
  return result;
}
