import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { runOnloadBench } from "../scripts/perf-onload.js";

describe("perf-onload", () => {
  it("runs empty/small/large onload profiles with finite timings", async () => {
    const report = await runOnloadBench({
      quick: true,
      smallPatterns: 5,
      smallLogRows: 10,
      largePatterns: 10,
      largeLogRows: 20,
    });
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.quick, true);
    for (const name of ["empty", "small", "large"]) {
      assert.ok(report.profiles[name], `missing profile ${name}`);
      assert.ok(Number.isFinite(report.profiles[name].onload_ms), `${name} onload should be finite`);
      assert.ok(Number.isFinite(report.profiles[name].unload_ms), `${name} unload should be finite`);
      assert.ok(report.profiles[name].onload_ms >= 0);
      assert.ok(report.profiles[name].unload_ms >= 0);
    }
  });

  it("CLI --quick --json prints a parseable report", () => {
    const result = spawnSync(process.execPath, [
      "scripts/perf-onload.js",
      "--quick",
      "--small-patterns",
      "5",
      "--small-log-rows",
      "10",
      "--large-patterns",
      "10",
      "--large-log-rows",
      "20",
      "--json",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.quick, true);
    assert.equal(report.profiles.empty.patternCount, 0);
    assert.equal(report.profiles.small.patternCount, 5);
    assert.equal(report.profiles.large.patternCount, 10);
    assert.ok(Number.isFinite(report.profiles.empty.onload_ms));
    assert.ok(Number.isFinite(report.profiles.small.onload_ms));
    assert.ok(Number.isFinite(report.profiles.large.onload_ms));
  });
});
