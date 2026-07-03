/**
 * Smoke tests for scripts/perf-bench.js — the per-turn hot-path performance
 * regression harness. Verifies the harness measures real ops and that the
 * threshold evaluation flags regressions. Run: node --test tests/perf-bench.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { runPerfBench, evaluate, buildSyntheticPatterns } from "../scripts/perf-bench.js";

describe("perf-bench", () => {
  it("buildSyntheticPatterns produces N well-formed pattern objects", () => {
    const pats = buildSyntheticPatterns(20);
    assert.equal(pats.length, 20);
    for (const p of pats) {
      assert.ok(p.id, "has id");
      assert.equal(p.type, "workflow");
      assert.ok(Array.isArray(p.tools) && p.tools.length >= 2);
      assert.ok(Array.isArray(p.context.categories));
    }
  });

  it("runPerfBench returns a finite ms value for every hot-path metric", () => {
    const { metrics } = runPerfBench({ sizes: [50], quick: true });
    for (const key of ["search_ms", "decorate_ms", "skill_render_ms", "prune_ms", "all_cold_ms", "all_cached_ms"]) {
      assert.ok(key in metrics, `missing metric ${key}`);
      assert.ok(Number.isFinite(metrics[key]), `${key} should be a finite number`);
      assert.ok(metrics[key] >= 0, `${key} should be non-negative`);
    }
  });

  it("evaluate passes under thresholds and reports breaches when over", () => {
    const thresholds = { search_ms: 5, prune_ms: 5 };
    const good = evaluate({ search_ms: 1, prune_ms: 2 }, thresholds);
    assert.equal(good.ok, true);
    assert.equal(good.breaches.length, 0);

    const bad = evaluate({ search_ms: 9, prune_ms: 2 }, thresholds);
    assert.equal(bad.ok, false);
    assert.ok(bad.breaches.some((b) => b.metric === "search_ms"));
  });

  it("evaluate ignores metrics that have no configured threshold", () => {
    const res = evaluate({ search_ms: 999, coldImport_ms: 5 }, { coldImport_ms: 10 });
    assert.equal(res.ok, true, "unthresholded metric does not fail the run");
  });

  it("CLI --quick --json prints a parseable report with metadata", () => {
    const result = spawnSync(process.execPath, ["scripts/perf-bench.js", "--quick", "--json"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.quick, true);
    assert.deepEqual(report.sizes, [50, 100]);
    assert.equal(report.maxSize, 100);
    assert.ok(report.generatedAt);
    assert.ok(report.thresholdsPath.endsWith("perf-thresholds.json"));
    assert.equal(report.ok, true);
    for (const key of ["search_ms", "decorate_ms", "skill_render_ms", "prune_ms", "all_cold_ms", "all_cached_ms", "coldImport_ms"]) {
      assert.ok(Number.isFinite(report.metrics[key]), `${key} should be finite`);
    }
  });
});
