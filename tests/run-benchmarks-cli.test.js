/**
 * P10.D — scripts/run-benchmarks.js `--json`: print the full benchmark
 * report as JSON instead of the Markdown summary, so automation/tooling can
 * consume it without scraping stdout.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-benchmarks-cli-test-"));

describe("scripts/run-benchmarks.js --json (P10.D)", () => {
  after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  it("prints a parseable JSON report for a single scenario", () => {
    const result = spawnSync(process.execPath, [
      "scripts/run-benchmarks.js",
      "--id", "audit.dashboard_surface",
      "--output-dir", outputDir,
      "--json",
    ], { cwd: process.cwd(), encoding: "utf-8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.ok(Array.isArray(report.runs) && report.runs.length === 1);
    assert.equal(report.runs[0].scenarioId, "audit.dashboard_surface");
    // --json suppresses the "Reports written to" line the Markdown path prints.
    assert.doesNotMatch(result.stdout, /Reports written to/);
  });

  it("without --json still prints the Markdown summary (unchanged default behavior)", () => {
    const result = spawnSync(process.execPath, [
      "scripts/run-benchmarks.js",
      "--id", "audit.dashboard_surface",
      "--output-dir", outputDir,
    ], { cwd: process.cwd(), encoding: "utf-8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Reports written to/);
    assert.throws(() => JSON.parse(result.stdout), "Markdown output should not itself be valid JSON");
  });
});
