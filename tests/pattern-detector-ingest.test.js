/**
 * Unit tests for lib/pattern-detector.js — ingest paths (workflow, preference,
 * error, usage) plus the full-pipeline integration case. Split from
 * pattern-detector.test.js (simplify-S5); core store tests live there, prune
 * and eviction tests in pattern-detector-prune.test.js.
 * Run: node --test tests/pattern-detector-ingest.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PatternDetector } from "../lib/pattern-detector.js";

function makeExp(overrides = {}) {
  return {
    date: new Date().toISOString(),
    taskType: "coding",
    toolsUsed: ["grep", "edit", "bash"],
    taskSummary: "tools: grep -> edit -> bash",
    toolCallCount: 3,
    resultStatus: "success",
    stopReason: "stop",
    correction: "",
    errors: [],
    ...overrides,
  };
}

function makeError(overrides = {}) {
  return {
    date: new Date().toISOString(),
    errorType: "file_not_found",
    errorDesc: "ENOENT: no such file",
    severity: 2,
    ...overrides,
  };
}

describe("PatternDetector — ingest", () => {
  describe("ingest — workflow detection", () => {
    it("does not create workflow for single turn", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({ toolsUsed: ["grep", "edit", "bash"] });
      const result = detector.ingest(exp);
      assert.equal(result.length, 0);
    });

    it("creates workflow after 3 occurrences of same category sequence", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({ toolsUsed: ["grep", "edit", "bash"] });

      detector.ingest(exp);
      detector.ingest(exp);
      const result = detector.ingest(exp);

      assert.ok(result.length >= 1);
      const wf = result.find((p) => p.type === "workflow");
      assert.ok(wf);
      assert.ok(wf.id.startsWith("workflow:"));
      assert.equal(wf.count, 3);
    });

    it("tracks sub-signatures for actionable hints", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({ toolsUsed: ["grep", "edit", "bash"] });

      // Workflow created at count=3, sub-signature starts at 1
      detector.ingest(exp);
      detector.ingest(exp);
      detector.ingest(exp);
      // Additional ingests increment the existing sub-signature
      detector.ingest(exp);
      detector.ingest(exp);

      const all = detector.all();
      const wf = all.find((p) => p.type === "workflow");
      assert.ok(wf);
      assert.ok(wf.subSignatures);
      assert.equal(wf.subSignatures["grep->edit->bash"], 3);
    });

    it("upgrades fix hint when sub-signature dominates", () => {
      const detector = new PatternDetector({});
      const exp1 = makeExp({ toolsUsed: ["grep", "edit", "bash"] });

      // Create workflow (count=3), then 3 more to raise sub-signature to >=3
      detector.ingest(exp1);
      detector.ingest(exp1);
      detector.ingest(exp1);
      detector.ingest(exp1);
      detector.ingest(exp1);
      detector.ingest(exp1);

      const all = detector.all();
      const wf = all.find((p) => p.type === "workflow");
      assert.ok(wf.fix.includes("Common sequence"));
    });

    it("skips single-category tool chains", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({ toolsUsed: ["grep", "find", "ls"] });

      detector.ingest(exp);
      detector.ingest(exp);
      const result = detector.ingest(exp);

      assert.equal(result.length, 0);
    });
  });

  describe("ingest — preference detection", () => {
    it("creates preference pattern from user correction", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({
        toolsUsed: ["edit"],
        correction: "不对，应该用绝对路径",
      });

      const result = detector.ingest(exp);
      const pref = result.find((p) => p.type === "preference");
      assert.ok(pref);
      assert.ok(pref.id.startsWith("pref:"));
    });

    it("increments existing preference count and score", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({
        toolsUsed: ["edit"],
        correction: "不对，应该用绝对路径",
      });

      detector.ingest(exp);
      detector.ingest(exp);

      const all = detector.all();
      const pref = all.find((p) => p.type === "preference");
      assert.ok(pref);
      assert.equal(pref.count, 2);
    });

    it("classifies durable preferences from language cues", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({
        toolsUsed: ["edit"],
        correction: "以后默认使用绝对路径，记住",
      });

      detector.ingest(exp);
      const all = detector.all();
      const pref = all.find((p) => p.type === "preference");
      assert.ok(pref);
      assert.equal(pref.knowledgeTier, "durable");
    });

    it("defaults to core tier for ordinary corrections", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({
        toolsUsed: ["edit"],
        correction: "路径不对",
      });

      detector.ingest(exp);
      const all = detector.all();
      const pref = all.find((p) => p.type === "preference");
      assert.equal(pref.knowledgeTier, "core");
    });
  });

  describe("ingestError", () => {
    it("creates error pattern for new error type", () => {
      const detector = new PatternDetector({});
      const result = detector.ingestError(makeError());
      assert.equal(result.isNew, true);
      assert.equal(result.pattern.type, "error");
      assert.equal(result.pattern.count, 1);
      assert.ok(result.pattern.id.startsWith("error:"));
    });

    it("accumulates existing error pattern", () => {
      const detector = new PatternDetector({});
      detector.ingestError(makeError());
      const result = detector.ingestError(makeError());
      assert.equal(result.isNew, false);
      assert.equal(result.pattern.count, 2);
    });

    it("weights by severity", () => {
      const detector = new PatternDetector({});
      detector.ingestError(makeError({ severity: 4 }));
      const all = detector.all();
      assert.equal(all[0].score, 4);
    });
  });

  describe("ingestUsage", () => {
    it("creates large-context usage pattern above threshold", () => {
      const detector = new PatternDetector({ largeUsageTokenThreshold: 100000 });
      const changes = detector.ingestUsage({
        date: new Date().toISOString(),
        requestId: "usage-large-1",
        model: "deepseek-v4-pro",
        totalTokens: 150000,
        inputTokens: 100000,
        outputTokens: 50000,
        status: "success",
        subsystem: "chat",
        operation: "send",
      });
      assert.ok(changes.length >= 1);
      const pattern = changes.find((c) => c.pattern.id.includes("large_context"))?.pattern;
      assert.ok(pattern);
      assert.equal(pattern.evidence?.[0]?.type, "usage");
      assert.equal(pattern.evidence?.[0]?.file, "usage_summary.json");
      assert.equal(pattern.evidence?.[0]?.id, "usage-large-1");
      assert.match(pattern.evidence?.[0]?.quote || "", /model=deepseek-v4-pro/);
      assert.match(pattern.evidence?.[0]?.quote || "", /operation=send/);
      assert.match(pattern.evidence?.[0]?.quote || "", /totalTokens=150000/);
    });

    it("creates failed-request pattern on error", () => {
      const detector = new PatternDetector({});
      const changes = detector.ingestUsage({
        date: new Date().toISOString(),
        id: "usage-fail-1",
        model: "deepseek-v4-pro",
        status: "error",
        error: { message: "timeout" },
        subsystem: "chat",
        operation: "send",
      });
      assert.ok(changes.length >= 1);
      const pattern = changes.find((c) => c.pattern.id.includes("failed_request"))?.pattern;
      assert.ok(pattern);
      assert.equal(pattern.evidence?.[0]?.type, "usage");
      assert.equal(pattern.evidence?.[0]?.id, "usage-fail-1");
      assert.match(pattern.evidence?.[0]?.quote || "", /status=error/);
      assert.match(pattern.evidence?.[0]?.quote || "", /timeout/);
    });

    it("adds distinct evidence when reinforcing an existing usage pattern", () => {
      const detector = new PatternDetector({ largeUsageTokenThreshold: 100000 });
      detector.ingestUsage({
        date: "2026-07-03T00:00:00.000Z",
        requestId: "usage-large-1",
        model: "deepseek-v4-pro",
        totalTokens: 150000,
        status: "success",
        subsystem: "chat",
        operation: "send",
      });
      const changes = detector.ingestUsage({
        date: "2026-07-03T00:01:00.000Z",
        requestId: "usage-large-2",
        model: "deepseek-v4-pro",
        totalTokens: 160000,
        status: "success",
        subsystem: "chat",
        operation: "send",
      });
      const pattern = changes.find((c) => c.pattern.id.includes("large_context"))?.pattern;
      assert.equal(pattern.count, 2);
      assert.equal(pattern.evidence.length, 2);
      assert.deepEqual(pattern.evidence.map((ev) => ev.id), ["usage-large-2", "usage-large-1"]);
    });

    it("does not flag benign non-whitelisted statuses as failed requests", () => {
      const detector = new PatternDetector({});
      for (const status of ["succeeded", "stopped", "finished"]) {
        const changes = detector.ingestUsage({
          date: new Date().toISOString(),
          model: "deepseek-v4-pro",
          status,
          subsystem: "chat",
          operation: "send",
        });
        assert.ok(!changes.some((c) => c.pattern.id.includes("failed_request")),
          `status "${status}" must not create a failed_request pattern`);
      }
    });
  });

  describe("integration: full pipeline", () => {
    it("detects workflow, preference, and error in same session", () => {
      const detector = new PatternDetector({});
      const date = new Date().toISOString();

      // 3 workflow turns
      for (let i = 0; i < 3; i++) {
        detector.ingest(makeExp({
          date,
          toolsUsed: ["grep", "edit", "bash"],
        }));
      }

      // 1 correction turn
      detector.ingest(makeExp({
        date,
        toolsUsed: ["write"],
        correction: "不对，文件名应该用下划线",
      }));

      // 2 errors
      detector.ingestError(makeError({ date, errorType: "permission_denied", severity: 3 }));
      detector.ingestError(makeError({ date, errorType: "permission_denied", severity: 3 }));

      const all = detector.all();
      assert.ok(all.some((p) => p.type === "workflow"));
      assert.ok(all.some((p) => p.type === "preference"));
      assert.ok(all.some((p) => p.type === "error"));
    });

    it("turnCount tracks total ingest cycles", () => {
      const detector = new PatternDetector({});
      for (let i = 0; i < 5; i++) {
        detector.ingest(makeExp({ toolsUsed: ["grep", "edit"] }));
      }
      assert.equal(detector.turnCount, 5);
    });
  });
});
