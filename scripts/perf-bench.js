#!/usr/bin/env node
/**
 * perf-bench — per-turn hot-path performance regression harness.
 *
 * The v4.x runtime has no measured CPU bottleneck (the pattern store is bounded
 * at MAX_PATTERN_COUNT*2 = 100 and every hot-path op is sub-millisecond at that
 * size). This harness exists to *keep it that way*: it measures the ops that run
 * on every flushed turn and fails when any exceeds a generous ceiling, so future
 * maintenance edits that quietly regress the hot path are caught.
 *
 * Advisory tool (not wired into the release gate) to avoid CI flakiness on slow
 * runners. Run: npm run perf
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";

import { MemoryIndex } from "../lib/memory-index.js";
import { PatternDetector } from "../lib/pattern-detector.js";
import { decoratePatterns } from "../lib/scoring.js";
import { buildSkillMdFromPatterns } from "../lib/skill-renderer.js";
import { DEFAULT_CONFIG } from "../lib/config-defaults.js";

const CATS = ["read", "edit", "bash", "search", "git", "test", "lint", "web"];

/** Build N synthetic workflow patterns with cross-pattern relations and CJK text. */
export function buildSyntheticPatterns(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c1 = CATS[i % CATS.length];
    const c2 = CATS[(i * 3 + 1) % CATS.length];
    out.push({
      id: `workflow:${c1}→${c2}#${i}`,
      type: "workflow",
      desc: `修复 ${c1} 然后运行 ${c2} 的工作流 fix lint then test step ${i}`,
      tools: [c1, c2],
      count: 1 + (i % 9),
      score: 1 + (i % 20),
      firstSeen: new Date(Date.now() - i * 3600e3).toISOString(),
      lastSeen: new Date(Date.now() - i * 1800e3).toISOString(),
      context: {
        categories: [c1, c2],
        tools: [c1, c2],
        taskType: "coding",
        relations: i > 0 ? [{ targetId: `workflow:${CATS[(i - 1) % CATS.length]}→${c2}#${i - 1}`, type: "shared-tools", weight: 1 }] : [],
      },
      status: i % 5 === 0 ? "approved" : "pending",
    });
  }
  return out;
}

/** Time a function: warm up, then loop for a fixed budget and return ms/op. */
export function measure(fn, { quick = false } = {}) {
  const warm = quick ? 5 : 30;
  for (let i = 0; i < warm; i++) fn();
  const budgetMs = quick ? 15 : 60;
  let iters = 0;
  const t0 = performance.now();
  do { fn(); iters++; } while (performance.now() - t0 < budgetMs);
  return (performance.now() - t0) / iters;
}

/**
 * Measure the per-turn hot path at each size. Returns { metrics, bySize, sizes }
 * where `metrics` is the flat result for the largest size (the realistic worst
 * case used for threshold checks).
 */
export function runPerfBench({ sizes = [50, 100], quick = false } = {}) {
  const cfg = DEFAULT_CONFIG;
  const bySize = {};
  for (const N of sizes) {
    const pats = buildSyntheticPatterns(N);
    const idx = new MemoryIndex().rebuild(pats);
    const det = new PatternDetector(cfg);
    det.restore(pats);
    bySize[N] = {
      search_ms: measure(() => idx.search("修复 lint test 然后", { limit: 8 }), { quick }),
      decorate_ms: measure(() => decoratePatterns(pats, cfg), { quick }),
      skill_render_ms: measure(() => buildSkillMdFromPatterns(pats, cfg, { turnCount: N }), { quick }),
      prune_ms: measure(() => { det.restore(pats); det.pruneMemory(); }, { quick }),
      all_cold_ms: measure(() => { det.invalidate(); det.all(); }, { quick }),
      all_cached_ms: measure(() => det.all(), { quick }),
    };
  }
  const maxSize = Math.max(...sizes);
  return { metrics: bySize[maxSize], bySize, sizes };
}

/** Measure cold module-graph import by spawning fresh node processes (min of runs). */
export function measureColdImport(runs = 3) {
  const entry = path.resolve(import.meta.dirname, "..", "index.js");
  const code = `import { pathToFileURL } from "url"; const t = performance.now(); await import(pathToFileURL(${JSON.stringify(entry)}).href); process.stdout.write(String(performance.now() - t));`;
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf-8" });
    const v = Number(r.stdout);
    if (Number.isFinite(v)) samples.push(v);
  }
  return samples.length ? Math.min(...samples) : NaN;
}

/** Compare metrics against thresholds. Only metrics present in `thresholds` are checked. */
export function evaluate(metrics, thresholds) {
  const breaches = [];
  for (const [metric, limit] of Object.entries(thresholds || {})) {
    const value = metrics[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value > limit) breaches.push({ metric, value, limit });
  }
  return { ok: breaches.length === 0, breaches };
}

export function loadThresholds(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return {}; }
}

export function buildPerfReport({ quick = false, thresholdsPath = path.resolve(import.meta.dirname, "..", "benchmarks", "perf-thresholds.json") } = {}) {
  const { bySize, sizes } = runPerfBench({ quick });
  const coldImport_ms = measureColdImport();
  const maxSize = Math.max(...sizes);
  const metrics = { ...bySize[maxSize], coldImport_ms };
  const thresholds = loadThresholds(thresholdsPath);
  const { ok, breaches } = evaluate(metrics, thresholds);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    quick,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sizes,
    maxSize,
    metrics,
    bySize,
    thresholdsPath,
    thresholds,
    ok,
    breaches,
  };
}

function fmt(ms) { return ms < 0.01 ? ms.toExponential(2) : ms.toFixed(4); }

// ── CLI ──
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const argv = process.argv.slice(2);
  const thresholdsPath = (() => {
    const i = argv.indexOf("--thresholds");
    return i !== -1 ? argv[i + 1] : path.resolve(import.meta.dirname, "..", "benchmarks", "perf-thresholds.json");
  })();
  const asJson = argv.includes("--json");
  const quick = argv.includes("--quick");

  const report = buildPerfReport({ quick, thresholdsPath });
  const { bySize, sizes, coldImport_ms, thresholds, ok, breaches } = {
    ...report,
    coldImport_ms: report.metrics.coldImport_ms,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("# Per-turn hot-path performance\n");
    const cols = ["search_ms", "decorate_ms", "skill_render_ms", "prune_ms", "all_cold_ms", "all_cached_ms"];
    console.log(`| N | ${cols.join(" | ")} |`);
    console.log(`|---:|${cols.map(() => "---:").join("|")}|`);
    for (const N of sizes) {
      console.log(`| ${N} | ${cols.map((c) => fmt(bySize[N][c])).join(" | ")} |`);
    }
    console.log(`\ncold import (fresh process, min of 3): ${coldImport_ms.toFixed(1)} ms`);
    console.log(`\nThresholds: ${thresholdsPath}`);
    if (breaches.length) {
      console.log("\n❌ Threshold breaches:");
      for (const b of breaches) console.log(`  - ${b.metric}: ${fmt(b.value)} ms > ${b.limit} ms`);
    } else {
      console.log("\n✅ All metrics within thresholds.");
    }
  }
  process.exit(ok ? 0 : 1);
}
