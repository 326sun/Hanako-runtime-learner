import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { runLargeToolBench } from "../scripts/perf-tools-large.js";

describe("perf-tools-large", () => {
  it("runs the quick large-tool bench and returns finite metrics", async () => {
    const report = await runLargeToolBench({ quick: true, patternCount: 50, logRows: 100 });
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.quick, true);
    assert.deepEqual(report.corpus, { patternCount: 50, logRows: 100 });
    for (const key of ["search_json_ms", "stats_json_ms", "report_text_ms", "doctor_json_ms", "doctor_fast_json_ms", "control_status_json_ms"]) {
      assert.ok(Number.isFinite(report.metrics[key]), `${key} should be finite`);
      assert.ok(report.metrics[key] >= 0, `${key} should be non-negative`);
    }
    assert.equal(report.resultCounts.statsPatterns, 50);
  });

  it("CLI --quick --json prints a parseable report", () => {
    const result = spawnSync(process.execPath, [
      "scripts/perf-tools-large.js",
      "--quick",
      "--patterns",
      "50",
      "--log-rows",
      "100",
      "--json",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.quick, true);
    assert.equal(report.corpus.patternCount, 50);
    assert.equal(report.corpus.logRows, 100);
    assert.ok(Number.isFinite(report.metrics.search_json_ms));
    assert.ok(Number.isFinite(report.metrics.stats_json_ms));
    assert.ok(Number.isFinite(report.metrics.report_text_ms));
    assert.ok(Number.isFinite(report.metrics.doctor_json_ms));
    assert.ok(Number.isFinite(report.metrics.doctor_fast_json_ms));
    assert.ok(Number.isFinite(report.metrics.control_status_json_ms));
  });
});
