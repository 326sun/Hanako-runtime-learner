import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs";
import { runPostFlushPipeline } from "../lib/pipeline.js";
import { DEFAULT_CONFIG } from "../lib/common.js";

const tmpDir = path.join(os.tmpdir(), "learner-llmwire-test-" + Date.now());

function stubDetector(allPatterns = []) {
  return { all: () => allPatterns, pruneMemory() {}, invalidate() {} };
}

describe("pipeline wiring · llm extraction runner", () => {
  it("invokes maybeRunExtraction with (reason, sessionHandle, allPatterns)", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const allPatterns = [{ id: "workflow:A→B", type: "workflow" }];
    const calls = [];
    runPostFlushPipeline({
      detector: stubDetector(allPatterns),
      autoApprovePatterns: () => ({ count: 0, allPatterns }),
      persistPatterns: () => {},
      refreshSkill: () => {},
      maybeRunModelAdvisor: () => Promise.resolve(),
      maybeRunExtraction: (reason, sessionHandle, patterns) => {
        calls.push({ reason, sessionHandle, patterns });
        return Promise.resolve();
      },
      reason: "turn",
      sessionHandle: "sess-1",
      learnerDir: tmpDir,
      config: DEFAULT_CONFIG,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].reason, "turn");
    assert.equal(calls[0].sessionHandle, "sess-1");
    assert.deepEqual(calls[0].patterns, allPatterns);
  });

  it("does not require maybeRunExtraction (back-compatible default)", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    assert.doesNotThrow(() => runPostFlushPipeline({
      detector: stubDetector(),
      autoApprovePatterns: () => ({ count: 0, allPatterns: [] }),
      persistPatterns: () => {},
      refreshSkill: () => {},
      maybeRunModelAdvisor: () => Promise.resolve(),
      reason: "turn",
      learnerDir: tmpDir,
      config: DEFAULT_CONFIG,
    }));
  });
});
