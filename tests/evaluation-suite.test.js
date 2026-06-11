import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { calculateEvaluationMetrics, compareMetrics, detectMetricRegressions } from "../lib/evaluation-metrics.js";
import { runEvaluationScenario, runEvaluationSuite } from "../lib/evaluation-runner.js";
import { ACTION_TYPES } from "../lib/action-types.js";

const tmpDir = path.join(os.tmpdir(), `learner-eval-${Date.now()}`);

describe("evaluation metrics", () => {
  it("calculates core autonomous runtime metrics", () => {
    const metrics = calculateEvaluationMetrics([
      { status: "succeeded", autoApplied: true, rollbackAttempted: true, rollbackOk: true, repairAttempted: true, repairOk: false, durationMs: 10 },
      { status: "manual_confirm", manualEscalated: true, durationMs: 20 },
      { status: "unsafe_auto_apply", autoApplied: true, falseAutoApply: true, durationMs: 30 },
    ]);
    assert.equal(metrics.task_success_rate, 1 / 3);
    assert.equal(metrics.auto_execution_success_rate, 1 / 2);
    assert.equal(metrics.false_auto_apply_rate, 1 / 2);
    assert.equal(metrics.manual_escalation_rate, 1 / 3);
    assert.equal(metrics.rollback_success_rate, 1);
    assert.equal(metrics.repair_success_rate, 0);
  });

  it("detects regressions using metric direction", () => {
    const current = { task_success_rate: 0.7, false_auto_apply_rate: 0.2 };
    const baseline = { task_success_rate: 0.8, false_auto_apply_rate: 0.1 };
    const regressions = detectMetricRegressions(current, baseline, { task_success_rate: 0.01, false_auto_apply_rate: 0.01 });
    assert.deepEqual(regressions.map((r) => r.metric).sort(), ["false_auto_apply_rate", "task_success_rate"]);
    assert.equal(compareMetrics(current, baseline).task_success_rate.delta, -0.10000000000000009);
  });
});

describe("evaluation runner", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "a.js"), "const a = 1;\n", "utf-8");
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("runs action and file assertion scenarios", async () => {
    const actionPlan = {
      id: "eval:diagnose",
      type: "action_plan",
      riskTier: "R1",
      reason: "diagnose",
      plan: { actionType: ACTION_TYPES.NO_RETRY_DIAGNOSE, steps: ["diagnose"] },
      verification: { metrics: ["diagnosisGenerated"] },
    };
    const result = await runEvaluationScenario({ id: "s1", steps: [{ type: "execute_action", actionPlan }, { type: "assert_file", path: "a.js", exists: true, contains: "const a" }] }, { workspaceRoot: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(result.stepResults.length, 2);
  });

  it("runs a suite and emits aggregate metrics", async () => {
    const suite = await runEvaluationSuite([{ id: "s1", steps: [{ type: "assert_file", path: "a.js", exists: true }] }], { workspaceRoot: tmpDir });
    assert.equal(suite.runs.length, 1);
    assert.equal(suite.metrics.task_success_rate, 1);
  });
});
