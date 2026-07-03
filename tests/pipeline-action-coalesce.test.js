/**
 * P6.D — runPostFlushPipeline fires runAutoActionPipeline as a fire-and-forget
 * call on every turn/usage flush. Without coordination, back-to-back flushes
 * (e.g. several turns completing before the previous run resolves) stack up
 * concurrent runs and reset the per-session action budget every time. These
 * tests verify the opt-in actionPipelineState/budgetState coalescing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs";
import { runPostFlushPipeline } from "../lib/pipeline.js";
import { readEvents } from "../lib/event-log.js";
import { DEFAULT_CONFIG } from "../lib/common.js";
import { createBudgetState } from "../lib/action-runtime.js";

function stubDetector(allPatterns = []) {
  return { all: () => allPatterns, pruneMemory() {}, invalidate() {} };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tmpDir(name) {
  const dir = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("pipeline · auto-action coalescing (P6.D)", () => {
  it("skips a second overlapping auto-action run while one is already in flight", async () => {
    const learnerDir = tmpDir("p6d-coalesce");
    const actionPipelineState = { inFlight: false };
    const base = {
      detector: stubDetector([]),
      autoApprovePatterns: () => ({ count: 0, allPatterns: [] }),
      persistPatterns: () => {},
      refreshSkill: () => {},
      maybeRunModelAdvisor: () => Promise.resolve(),
      reason: "turn",
      learnerDir,
      workspaceRoot: learnerDir,
      config: DEFAULT_CONFIG,
      actionPipelineState,
    };

    // Two large-context-risk triggers with different token counts, so if both
    // ran they would each produce a distinct action.auto_executed event.
    runPostFlushPipeline({ ...base, usage: { totalTokens: 140000 } });
    assert.equal(actionPipelineState.inFlight, true, "first flush should mark the pipeline in-flight synchronously");

    runPostFlushPipeline({ ...base, usage: { totalTokens: 300000 } });
    assert.equal(actionPipelineState.inFlight, true, "still in-flight — second flush must not relaunch the pipeline");

    await wait(300);
    assert.equal(actionPipelineState.inFlight, false, "flag resets once the single in-flight run settles");

    const events = readEvents(learnerDir).filter((e) => e.type === "action.auto_executed");
    assert.equal(events.length, 1, "only the first flush's trigger should have been processed");
  });

  it("runs a fresh auto-action pass for each flush when no actionPipelineState is shared (back-compat)", async () => {
    const learnerDir = tmpDir("p6d-no-coalesce");
    const base = {
      detector: stubDetector([]),
      autoApprovePatterns: () => ({ count: 0, allPatterns: [] }),
      persistPatterns: () => {},
      refreshSkill: () => {},
      maybeRunModelAdvisor: () => Promise.resolve(),
      reason: "turn",
      learnerDir,
      workspaceRoot: learnerDir,
      config: DEFAULT_CONFIG,
    };

    runPostFlushPipeline({ ...base, usage: { totalTokens: 140000 } });
    runPostFlushPipeline({ ...base, usage: { totalTokens: 300000 } });

    await wait(300);
    const events = readEvents(learnerDir).filter((e) => e.type === "action.auto_executed");
    assert.equal(events.length, 2, "without a shared actionPipelineState, both flushes run independently");
  });

  it("accumulates the per-session action budget across flushes when budgetState is shared", async () => {
    const learnerDir = tmpDir("p6d-budget");
    const actionPipelineState = { inFlight: false };
    const budgetState = createBudgetState();
    const base = {
      detector: stubDetector([]),
      autoApprovePatterns: () => ({ count: 0, allPatterns: [] }),
      persistPatterns: () => {},
      refreshSkill: () => {},
      maybeRunModelAdvisor: () => Promise.resolve(),
      reason: "turn",
      learnerDir,
      workspaceRoot: learnerDir,
      config: DEFAULT_CONFIG,
      actionPipelineState,
      budgetState,
    };

    runPostFlushPipeline({ ...base, usage: { totalTokens: 140000 } });
    await wait(200);
    assert.equal(budgetState.autoActionsThisSession, 1, "first executed action should be recorded on the shared budget state");

    runPostFlushPipeline({ ...base, usage: { totalTokens: 300000 } });
    await wait(200);
    assert.equal(budgetState.autoActionsThisSession, 2, "budget should accumulate across flushes instead of resetting");
  });
});
