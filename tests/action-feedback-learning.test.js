import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import { recordActionFeedback, readActionFeedback, summarizeActionEffectiveness, updateActionPolicyWeights, actionPolicyWeightsPath } from "../lib/action-runtime.js";

const tmpDir = path.join(os.tmpdir(), "learner-action-feedback-test-" + Date.now());

describe("action feedback and learning weights", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("records append-only feedback and summarizes effectiveness", () => {
    assert.equal(recordActionFeedback(tmpDir, { actionId: "a1", actionType: "no_retry_diagnose", effective: true, confidence: 0.8 }).ok, true);
    assert.equal(recordActionFeedback(tmpDir, { actionId: "a2", actionType: "no_retry_diagnose", effective: false, confidence: 0.6 }).ok, true);
    const rows = readActionFeedback(tmpDir, { actionType: "no_retry_diagnose" });
    assert.equal(rows.length, 2);
    const summary = summarizeActionEffectiveness(tmpDir, "no_retry_diagnose");
    assert.equal(summary.success, 1);
    assert.equal(summary.failure, 1);
  });

  it("updates policy weights from feedback without bypassing gates", () => {
    for (let i = 0; i < 5; i++) recordActionFeedback(tmpDir, { actionId: `a${i}`, actionType: "retry_with_backoff", effective: true, confidence: 0.8 });
    const weights = updateActionPolicyWeights(tmpDir, { actionType: "retry_with_backoff" });
    assert.equal(weights.retry_with_backoff.successRate, 1);
    assert.equal(weights.retry_with_backoff.autoConfidenceBoost, 0.05);
    assert.ok(fs.existsSync(actionPolicyWeightsPath(tmpDir)));
  });

  it("ignores unjudged recent feedback when checking suspension streaks", () => {
    const rows = [
      { actionId: "pending", effective: null, createdAt: "2026-01-06T00:00:00.000Z" },
      { actionId: "f1", effective: false, createdAt: "2026-01-05T00:00:00.000Z" },
      { actionId: "f2", effective: false, createdAt: "2026-01-04T00:00:00.000Z" },
      { actionId: "f3", effective: false, createdAt: "2026-01-03T00:00:00.000Z" },
    ];
    for (const row of rows) {
      recordActionFeedback(tmpDir, { ...row, actionType: "no_retry_diagnose", confidence: 0.8 });
    }
    const weights = updateActionPolicyWeights(tmpDir, { actionType: "no_retry_diagnose", limit: 4 });
    assert.equal(weights.no_retry_diagnose.total, 3);
    assert.equal(weights.no_retry_diagnose.autoSuspended, true);
  });
});
