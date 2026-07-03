#!/usr/bin/env node
/**
 * perf-observer — high-frequency EventBus dispatch cost harness (P6 acceptance).
 *
 * Measures the per-event cost of the observer's hot dispatch path (the
 * subscribe() callback in lib/observer.js) under a burst of tool events and a
 * burst of unhandled ("no-op") event types, so a future change that adds
 * unbounded per-event work is caught. Advisory tool (not wired into the
 * release gate) to avoid CI flakiness on slow runners. Run: npm run perf:observer
 */
import path from "path";
import { pathToFileURL } from "url";

import { createObserver } from "../lib/observer.js";
import { PatternDetector } from "../lib/pattern-detector.js";
import { DEFAULT_CONFIG } from "../lib/config-defaults.js";

function makeObserver({ sessions = new Map(), runtimeState = null } = {}) {
  const detector = new PatternDetector(DEFAULT_CONFIG);
  const rs = runtimeState || { pendingAdoptionChecks: new Map(), sessionActivityCount: 0, sessionTargets: new Map() };
  const paths = {
    TURNS_FILE: path.join(process.cwd(), ".perf-observer-unused-turns.jsonl"),
    EXPERIENCE_LOG: path.join(process.cwd(), ".perf-observer-unused-experience.jsonl"),
    ERROR_LOG: path.join(process.cwd(), ".perf-observer-unused-errors.jsonl"),
    CONFIG_FILE: path.join(process.cwd(), ".perf-observer-unused-config.json"),
    DATA_DIR: process.cwd(),
  };
  const deps = {
    detector,
    sessions,
    runtimeState: rs,
    persistPatterns: () => {},
    refreshSkill: () => {},
    autoApprovePatterns: () => ({ count: 0, allPatterns: [] }),
    syncDiskStatus: () => {},
    pruneDataFiles: async () => {},
    maybeRunModelAdvisor: async () => {},
    maybeRunExtraction: async () => {},
    logActivity: () => {},
    recordUsage: () => {},
    configRef: { current: DEFAULT_CONFIG },
    ctx: { log: { info() {}, warn() {}, error() {}, debug() {} } },
    paths,
    MAX_SESSIONS: 64,
  };
  const observer = createObserver(deps);
  let eventCallback;
  observer.subscribe({
    subscribe(cb) { eventCallback = cb; return () => {}; },
  }, { learnFromUsage: false });
  return { eventCallback, sessions, runtimeState: rs };
}

/** Dispatch `count` tool_execution_start/end pairs across a fixed session (never flushed). */
export function benchToolBurst(count) {
  const { eventCallback } = makeObserver();
  const sessionMeta = { sessionId: "perf-observer-session", sessionPath: "sessions/perf.jsonl" };
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    eventCallback({ type: "tool_execution_start", toolName: i % 2 === 0 ? "read" : "edit" }, sessionMeta);
    eventCallback({ type: "tool_execution_end", toolName: i % 2 === 0 ? "read" : "edit" }, sessionMeta);
  }
  const totalMs = performance.now() - t0;
  return { totalMs, perEventMs: totalMs / (count * 2) };
}

/** Dispatch `count` events of an unhandled type — should short-circuit before any state mutation. */
export function benchNoopBurst(count) {
  const { eventCallback, sessions, runtimeState } = makeObserver();
  const sessionMeta = { sessionId: "perf-observer-noop-session", sessionPath: "sessions/perf-noop.jsonl" };
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    eventCallback({ type: "some_unhandled_event", i }, sessionMeta);
  }
  const totalMs = performance.now() - t0;
  return { totalMs, perEventMs: totalMs / count, sessionsCreated: sessions.size, targetsRegistered: runtimeState.sessionTargets.size };
}

export function runObserverBench({ quick = false, eventCount = 1000 } = {}) {
  // Warm up the JIT once before the measured run, mirroring perf-bench.js's approach.
  benchToolBurst(quick ? 50 : 200);
  benchNoopBurst(quick ? 50 : 200);

  const toolBurst = benchToolBurst(eventCount);
  const noopBurst = benchNoopBurst(eventCount);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    quick,
    eventCount,
    node: process.version,
    metrics: {
      toolBurst_total_ms: toolBurst.totalMs,
      toolBurst_perEvent_ms: toolBurst.perEventMs,
      noopBurst_total_ms: noopBurst.totalMs,
      noopBurst_perEvent_ms: noopBurst.perEventMs,
      noopBurst_sessionsCreated: noopBurst.sessionsCreated,
      noopBurst_targetsRegistered: noopBurst.targetsRegistered,
    },
  };
}

function fmt(ms) { return ms < 0.01 ? ms.toExponential(2) : ms.toFixed(4); }

// ── CLI ──
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const quick = argv.includes("--quick");

  const report = runObserverBench({ quick });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`# Observer high-frequency dispatch (${report.eventCount} events)\n`);
    console.log(`tool_execution_start/end burst: ${fmt(report.metrics.toolBurst_total_ms)} ms total, ${fmt(report.metrics.toolBurst_perEvent_ms)} ms/event`);
    console.log(`unhandled-type (no-op) burst:   ${fmt(report.metrics.noopBurst_total_ms)} ms total, ${fmt(report.metrics.noopBurst_perEvent_ms)} ms/event`);
    console.log(`no-op sessions created: ${report.metrics.noopBurst_sessionsCreated}, targets registered: ${report.metrics.noopBurst_targetsRegistered}`);
  }
}
