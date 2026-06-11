import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import { createActionTransaction, writeTransactionFile, changedTransactionFiles, rollbackActionTransaction } from "../lib/action-transaction.js";
import { runAutoActionPipeline } from "../lib/pipeline.js";
import { readActionFeedback } from "../lib/action-runtime.js";
import { DEFAULT_CONFIG } from "../lib/common.js";

const tmpDir = path.join(os.tmpdir(), "learner-action-pipeline-test-" + Date.now());
const workspace = path.join(tmpDir, "workspace");

describe("transactions and auto-action pipeline", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(workspace, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("rolls back transaction file writes", () => {
    const file = path.join(workspace, "a.txt");
    fs.writeFileSync(file, "before", "utf-8");
    const txn = createActionTransaction({ workspaceRoot: workspace, actionId: "a", filePaths: ["a.txt"] });
    writeTransactionFile(txn, "a.txt", "after");
    assert.deepEqual(changedTransactionFiles(txn), ["a.txt"]);
    const rolled = rollbackActionTransaction(txn);
    assert.equal(rolled.ok, true);
    assert.equal(fs.readFileSync(file, "utf-8"), "before");
  });

  it("auto-executes low-risk diagnosis and records feedback", async () => {
    const result = await runAutoActionPipeline({
      learnerDir: tmpDir,
      workspaceRoot: workspace,
      config: DEFAULT_CONFIG,
      errors: [{ errorType: "syntax_error" }],
    });
    assert.ok(result.triggers.some((t) => t.type === "non_retryable_tool_error"));
    assert.ok(result.results.some((r) => r.policy.decision === "auto_execute"));
    const feedback = readActionFeedback(tmpDir);
    assert.equal(feedback.length, 1);
    assert.equal(feedback[0].effective, true);
  });

  it("queues high-risk auth confirmation instead of auto-executing", async () => {
    const result = await runAutoActionPipeline({
      learnerDir: tmpDir,
      workspaceRoot: workspace,
      config: DEFAULT_CONFIG,
      errors: [{ errorType: "auth_error" }],
    });
    assert.equal(result.results[0].policy.decision, "manual_confirm");
    assert.equal(readActionFeedback(tmpDir).length, 0);
    const proposalFiles = fs.readdirSync(path.join(tmpDir, "proposals"));
    assert.equal(proposalFiles.length, 1);
  });
});
