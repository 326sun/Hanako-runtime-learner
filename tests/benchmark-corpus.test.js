import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { loadBenchmarkCorpus, runBenchmarkCorpus, validateBenchmarkScenario } from "../lib/benchmark-corpus.js";
import { runEvaluationScenario } from "../lib/evaluation-runner.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("benchmark corpus", () => {
  it("loads and validates the built-in scenario corpus", () => {
    const corpus = loadBenchmarkCorpus({ projectRoot });
    assert.equal(corpus.ok, true);
    assert.equal(corpus.rejected.length, 0);
    assert.ok(corpus.scenarioCount >= 5);
    assert.ok(corpus.scenarios.some((scenario) => scenario.id === "safety.rollback_failed_verification"));
  });

  it("rejects malformed scenarios", () => {
    const validation = validateBenchmarkScenario({ id: "bad", steps: [{ type: "unknown" }] });
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /unsupported type/);
  });

  it("runs the built-in corpus with thresholds and no regressions", async () => {
    const outputDir = path.join(os.tmpdir(), `hanako-benchmark-test-${Date.now()}`);
    const result = await runBenchmarkCorpus({ projectRoot, outputDir }, { pluginDir: projectRoot });
    assert.equal(result.ok, true);
    assert.equal(result.runs.length >= 5, true);
    assert.equal(result.metrics.task_success_rate, 1);
    assert.equal(result.metrics.false_auto_apply_rate, 0);
    assert.equal(result.regressions.length, 0);
    assert.equal(fs.existsSync(path.join(outputDir, "benchmark-report.md")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "benchmark-report.json")), true);
    fs.rmSync(outputDir, { recursive: true, force: true });
  });
});

describe("evaluation runner fixtures", () => {
  it("materializes isolated fixture workspaces and removes them by default", async () => {
    const result = await runEvaluationScenario({
      id: "fixture-isolation",
      workspace: { files: [{ path: "src/a.js", content: "export const a = 1;\n" }] },
      context: { config: { autoActionCommands: { allowlist: ["node --check"] } } },
      steps: [
        { type: "run_command", command: "node --check src/a.js", expectExitCode: 0 },
        { type: "assert_file", path: "src/a.js", contains: "a = 1" }
      ]
    });
    assert.equal(result.ok, true);
    assert.equal(result.stepResults.length, 2);
  });
});
