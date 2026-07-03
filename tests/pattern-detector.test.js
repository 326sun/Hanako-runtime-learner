/**
 * Unit tests for lib/pattern-detector.js — core pattern store: constructor,
 * restore, category index, and the decorated all() view. Split by behavior
 * (simplify-S5): ingest tests live in pattern-detector-ingest.test.js, prune
 * and eviction tests in pattern-detector-prune.test.js.
 * Run: node --test tests/pattern-detector.test.js
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

describe("PatternDetector", () => {
  describe("constructor and configuration", () => {
    it("initializes with empty state", () => {
      const detector = new PatternDetector({ minInjectScore: 8 });
      assert.equal(detector.turnCount, 0);
      assert.equal(detector.patterns.size, 0);
      assert.equal(detector.seqCache.size, 0);
    });

    it("setConfig updates config reference", () => {
      const detector = new PatternDetector({ minInjectScore: 5 });
      detector.setConfig({ minInjectScore: 10 });
      assert.equal(detector.config.minInjectScore, 10);
    });
  });

  describe("restore", () => {
    it("loads saved patterns into memory", () => {
      const detector = new PatternDetector({});
      const saved = [
        {
          id: "error:file_not_found",
          type: "error",
          status: "approved",
          desc: "Repeated error",
          count: 5,
          firstSeen: "2025-01-01",
          lastSeen: "2025-01-05",
          score: 15,
        },
      ];
      detector.restore(saved);
      assert.equal(detector.patterns.size, 1);
      assert.equal(detector.patterns.get("error:file_not_found").count, 5);
    });

    it("restores workflow patterns into seqCache", () => {
      const detector = new PatternDetector({});
      const saved = [
        {
          id: "workflow:代码编写→文件探索",
          type: "workflow",
          status: "approved",
          desc: "跨类别工作流",
          count: 4,
          tools: ["grep", "edit", "bash"],
          firstSeen: "2025-01-01",
        },
      ];
      detector.restore(saved);
      assert.equal(detector.seqCache.get("代码编写→文件探索"), 4);
    });

    it("skips patterns without id", () => {
      const detector = new PatternDetector({});
      detector.restore([{ type: "error", desc: "no id" }]);
      assert.equal(detector.patterns.size, 0);
    });

    it("replaces old restored state instead of merging stale indexes", () => {
      const detector = new PatternDetector({});
      detector.restore([{ id: "workflow:代码编写→文件探索", type: "workflow", count: 4, tools: ["grep", "edit", "bash"], context: { categories: ["文件探索", "代码编写"] } }]);
      assert.equal(detector.seqCache.has("代码编写→文件探索"), true);
      assert.equal(detector.catIndex.has("文件探索"), true);

      detector.restore([{ id: "error:file_not_found", type: "error", count: 1 }]);
      assert.equal(detector.patterns.has("workflow:代码编写→文件探索"), false);
      assert.equal(detector.seqCache.has("代码编写→文件探索"), false);
      assert.equal(detector.catIndex.has("文件探索"), false);
      assert.equal(detector.patterns.has("error:file_not_found"), true);
    });
  });

  describe("category index", () => {
    it("removes empty category buckets when a pattern is forgotten", () => {
      const detector = new PatternDetector({});
      detector.restore([{ id: "error:index", type: "error", count: 1, context: { categories: ["debug"] } }]);
      assert.equal(detector.catIndex.has("debug"), true);
      detector._forgetPattern("error:index");
      assert.equal(detector.catIndex.has("debug"), false);
    });
  });

  describe("all()", () => {
    it("returns patterns decorated with knowledgeTier, status, decayedScore, injectable", () => {
      const detector = new PatternDetector({});
      const exp = makeExp({
        toolsUsed: ["grep", "edit", "bash"],
        correction: "以后默认用这个路径",
      });
      detector.ingest(exp);
      detector.ingest(exp);
      detector.ingest(exp);

      const all = detector.all();
      assert.ok(all.length >= 1);
      for (const p of all) {
        assert.ok("knowledgeTier" in p);
        assert.ok("status" in p);
        assert.ok("decayedScore" in p);
        assert.ok("injectable" in p);
      }
    });

    it("sorts by decayedScore descending", () => {
      const detector = new PatternDetector({});
      detector.ingestError(makeError({ errorType: "high", severity: 10 }));
      detector.ingestError(makeError({ errorType: "low", severity: 1 }));

      const all = detector.all();
      assert.ok(all[0].decayedScore >= all[1].decayedScore);
    });

    it("filters out ephemeral tier patterns", () => {
      const detector = new PatternDetector({});
      // capability type patterns are ephemeral by default via knowledgeTier()
      detector.patterns.set("test:cap", {
        id: "test:cap",
        type: "capability",
        status: "pending",
        count: 1,
        score: 1,
      });
      const all = detector.all();
      assert.ok(!all.some((p) => p.id === "test:cap"));
    });

    it("serves a cached snapshot until invalidate() after a side-channel mutation", () => {
      const detector = new PatternDetector({});
      detector.ingestError(makeError({ errorType: "boom", severity: 4 }));
      const before = detector.all().find((p) => p.id === "error:boom");
      assert.equal(before.status, "pending");

      // Direct field mutation (as auto-approve / score boosts do) does NOT touch
      // the dirty bit, so the cache still reflects the old status.
      detector.patterns.get("error:boom").status = "approved";
      assert.equal(detector.all().find((p) => p.id === "error:boom").status, "pending");

      // invalidate() forces a recompute on the next all() call.
      detector.invalidate();
      assert.equal(detector.all().find((p) => p.id === "error:boom").status, "approved");
    });

    it("tracks store dirty state separately from decorated cache reads", () => {
      const detector = new PatternDetector({});
      assert.equal(detector.isDirty(), false);

      detector.ingestError(makeError({ errorType: "dirty", severity: 4 }));
      assert.equal(detector.isDirty(), true);
      detector.all();
      assert.equal(detector.isDirty(), true);

      detector.markClean();
      assert.equal(detector.isDirty(), false);
      detector.invalidate();
      assert.equal(detector.isDirty(), true);

      detector.restore([{ id: "error:restored", type: "error", count: 1 }]);
      assert.equal(detector.isDirty(), false);
    });

    it("highConfidence and prefs return only the first eight matching decorated patterns", () => {
      const detector = new PatternDetector({
        autoInjectHighConfidence: true,
        includePendingPreferences: true,
        minInjectCount: 1,
        minInjectScore: 1,
      });
      const now = new Date().toISOString();
      for (let i = 0; i < 12; i++) {
        detector.patterns.set(`error:${i}`, {
          id: `error:${i}`,
          type: "error",
          status: "pending",
          count: 2,
          score: 30 - i,
          lastSeen: now,
        });
        detector.patterns.set(`pref:${i}`, {
          id: `pref:${i}`,
          type: "preference",
          knowledgeTier: "core",
          status: "pending",
          count: 2,
          score: 30 - i,
          fix: `preference ${i}`,
          lastSeen: now,
        });
      }

      assert.equal(detector.highConfidence().length, 8);
      assert.equal(detector.prefs().length, 8);
      assert.ok(detector.prefs().every((p) => p.type === "preference" && p.fix));
    });
  });
});
