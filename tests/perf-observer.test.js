import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { runObserverBench } from "../scripts/perf-observer.js";

describe("perf-observer", () => {
  it("measures 1000-event tool and no-op bursts with finite timings", () => {
    const report = runObserverBench({ quick: true, eventCount: 1000 });
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.eventCount, 1000);
    for (const key of ["toolBurst_total_ms", "toolBurst_perEvent_ms", "noopBurst_total_ms", "noopBurst_perEvent_ms"]) {
      assert.ok(Number.isFinite(report.metrics[key]), `${key} should be finite`);
      assert.ok(report.metrics[key] >= 0, `${key} should be non-negative`);
    }
    // No-op (unhandled event type) dispatch must not create sessions or targets.
    assert.equal(report.metrics.noopBurst_sessionsCreated, 0);
    assert.equal(report.metrics.noopBurst_targetsRegistered, 0);
  });

  it("CLI --quick --json prints a parseable report", () => {
    const result = spawnSync(process.execPath, [
      "scripts/perf-observer.js",
      "--quick",
      "--json",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.eventCount, 1000);
    assert.ok(Number.isFinite(report.metrics.toolBurst_perEvent_ms));
    assert.ok(Number.isFinite(report.metrics.noopBurst_perEvent_ms));
  });
});
