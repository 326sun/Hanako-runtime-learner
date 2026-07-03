#!/usr/bin/env node
/**
 * Large-data tool response benchmark.
 *
 * Advisory harness for self_learning_search/stats/report/doctor on a synthetic
 * runtime store. It never touches the user's real data directory.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

import { DEFAULT_CONFIG } from "../lib/config-defaults.js";
import { buildSyntheticPatterns } from "./perf-bench.js";
import { execute as searchTool } from "../tools/search.js";
import { execute as statsTool } from "../tools/stats.js";
import { execute as reportTool } from "../tools/report.js";
import { execute as doctorTool } from "../tools/doctor.js";
import { execute as controlTool } from "../tools/control.js";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf-8");
}

function makeLogRows(count, { type = "experience" } = {}) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const sessionId = `session-${i % 40}`;
    rows.push({
      date: new Date(now - i * 60_000).toISOString(),
      taskType: i % 3 === 0 ? "coding" : i % 3 === 1 ? "research" : "general",
      type,
      tool: i % 2 === 0 ? "bash" : "edit",
      errorType: type === "error" ? (i % 2 === 0 ? "timeout" : "syntax") : undefined,
      sessionId,
      sessionRef: { sessionId },
      sessionPath: path.join("sessions", `${sessionId}.jsonl`),
      summary: `${type} row ${i}`,
    });
  }
  return rows;
}

export function createLargeToolCorpus({
  patternCount = 1000,
  logRows = 5000,
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-perf-tools-")),
} = {}) {
  const dataDir = path.join(root, "data");
  const pluginDir = path.join(root, "plugin");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir, "skills", "self-learning"), { recursive: true });
  writeJson(path.join(pluginDir, "manifest.json"), { id: "hanako-runtime-learner", version: "perf" });
  fs.writeFileSync(path.join(pluginDir, "skills", "self-learning", "SKILL.md"), "# Runtime Self-Learning\n", "utf-8");

  const patterns = buildSyntheticPatterns(patternCount).map((pattern, i) => ({
    ...pattern,
    scope: { project: i % 2 === 0 ? "hanako" : "general", taskType: i % 3 === 0 ? "coding" : "general" },
  }));
  writeJson(path.join(dataDir, "patterns.json"), patterns);
  writeJson(path.join(dataDir, "runtime-config.json"), {
    ...DEFAULT_CONFIG,
    officialMemoryBridgeEnabled: false,
    semanticSearchEnabled: false,
    modelAdvisorEnabled: false,
  });
  writeJson(path.join(dataDir, "usage_summary.json"), {
    totalRequests: logRows,
    totalTokens: logRows * 2000,
    costTotal: 0,
    byModel: { "perf-model": { requests: logRows, totalTokens: logRows * 2000 } },
  });
  writeJson(path.join(dataDir, "host_capabilities.json"), { count: 3, availableCount: 3 });
  writeJson(path.join(dataDir, "model_advisor_status.json"), { status: "skipped", reason: "no candidate", lastRunAt: new Date().toISOString() });
  writeJson(path.join(dataDir, "facts.json"), []);
  writeJsonl(path.join(dataDir, "experience_log.jsonl"), makeLogRows(logRows, { type: "experience" }));
  writeJsonl(path.join(dataDir, "error_log.jsonl"), makeLogRows(Math.max(1, Math.floor(logRows / 5)), { type: "error" }));
  writeJsonl(path.join(dataDir, "turns.jsonl"), makeLogRows(logRows, { type: "turn" }));
  writeJsonl(path.join(dataDir, "activity_log.jsonl"), makeLogRows(Math.max(1, Math.floor(logRows / 2)), { type: "activity" }));

  return { root, dataDir, pluginDir, patternCount, logRows };
}

async function measureTool(fn) {
  const started = performance.now();
  const result = await fn();
  const ms = performance.now() - started;
  const text = result?.content?.[0]?.text || "";
  let details = result?.details || null;
  if (!details && text.trim().startsWith("{")) {
    try { details = JSON.parse(text); } catch {}
  }
  return { ms, bytes: Buffer.byteLength(text, "utf-8"), details };
}

export async function runLargeToolBench({ quick = false, patternCount = quick ? 200 : 1000, logRows = quick ? 1000 : 5000 } = {}) {
  const corpus = createLargeToolCorpus({ patternCount, logRows });
  const ctx = { dataDir: corpus.dataDir, pluginDir: corpus.pluginDir, log: { info() {}, warn() {}, error() {} } };
  try {
    const search = await measureTool(() => searchTool({ query: "lint test workflow", project: "hanako", limit: 8 }, ctx));
    const stats = await measureTool(() => statsTool({}, ctx));
    const report = await measureTool(() => reportTool({ days: 7 }, ctx));
    const doctor = await measureTool(() => doctorTool({ format: "json" }, ctx));
    const doctorFast = await measureTool(() => doctorTool({ format: "json", fast: true }, ctx));
    const controlStatus = await measureTool(() => controlTool({ action: "status" }, ctx));
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      quick,
      corpus: { patternCount, logRows },
      metrics: {
        search_json_ms: search.ms,
        stats_json_ms: stats.ms,
        report_text_ms: report.ms,
        doctor_json_ms: doctor.ms,
        doctor_fast_json_ms: doctorFast.ms,
        control_status_json_ms: controlStatus.ms,
      },
      responseBytes: {
        search: search.bytes,
        stats: stats.bytes,
        report: report.bytes,
        doctor: doctor.bytes,
        doctorFast: doctorFast.bytes,
        controlStatus: controlStatus.bytes,
      },
      resultCounts: {
        search: search.details?.count ?? null,
        statsPatterns: stats.details?.patternCount ?? null,
        doctorIssues: doctor.details?.issues?.length ?? null,
        doctorFastIssues: doctorFast.details?.issues?.length ?? null,
        controlPatterns: controlStatus.details?.patterns ?? null,
      },
    };
  } finally {
    fs.rmSync(corpus.root, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const opts = { json: false, quick: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--quick") opts.quick = true;
    else if (arg === "--patterns") opts.patternCount = Number(argv[++i]);
    else if (arg === "--log-rows") opts.logRows = Number(argv[++i]);
  }
  return opts;
}

function fmt(ms) {
  return ms < 0.01 ? ms.toExponential(2) : ms.toFixed(3);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const report = await runLargeToolBench(opts);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("# Large-data tool response performance\n");
    console.log(`patterns=${report.corpus.patternCount}, logRows=${report.corpus.logRows}, quick=${report.quick}`);
    console.log("");
    for (const [name, value] of Object.entries(report.metrics)) {
      console.log(`- ${name}: ${fmt(value)} ms`);
    }
  }
}
