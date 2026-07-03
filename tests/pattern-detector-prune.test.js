/**
 * Unit tests for lib/pattern-detector.js — memory pruning, batched eviction,
 * and orphan-relation cleanup. Split from pattern-detector.test.js
 * (simplify-S5); core store tests live there, ingest tests in
 * pattern-detector-ingest.test.js.
 * Run: node --test tests/pattern-detector-prune.test.js
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

describe("PatternDetector — prune/forget", () => {
  describe("pruneMemory", () => {
    it("does not prune when under threshold", () => {
      const detector = new PatternDetector({});
      for (let i = 0; i < 10; i++) {
        detector.ingestError(makeError({ errorType: `error_type_${i}` }));
      }
      const pruned = detector.pruneMemory();
      assert.equal(pruned, 0);
    });

    it("prunes weakest non-approved, non-durable patterns", () => {
      const detector = new PatternDetector({});
      // Fill past the threshold (MAX_PATTERN_COUNT * 2 = 100)
      for (let i = 0; i < 110; i++) {
        detector.ingestError(makeError({ errorType: `error_type_${i}`, severity: 1 }));
      }
      const pruned = detector.pruneMemory();
      assert.ok(pruned >= 10);
    });

    it("score-floor prunes a decayed auto-approved pattern but keeps manually approved", () => {
      const detector = new PatternDetector({});
      const old = new Date(Date.now() - 365 * 86_400_000).toISOString();
      detector.patterns.set("error:auto", {
        id: "error:auto", type: "error", status: "approved", autoApproved: true,
        count: 1, score: 4, firstSeen: old, lastSeen: old,
      });
      detector.patterns.set("error:manual", {
        id: "error:manual", type: "error", status: "approved",
        count: 1, score: 4, firstSeen: old, lastSeen: old,
      });
      detector.pruneMemory();
      assert.equal(detector.patterns.has("error:auto"), false, "auto-approved decays away");
      assert.equal(detector.patterns.has("error:manual"), true, "manual approval is immortal");
    });

    it("clears seqCache when a workflow is pruned so it does not resurrect at full strength", () => {
      const detector = new PatternDetector({ decayHalfLifeDays: 1 });
      const exp = makeExp({ toolsUsed: ["grep", "edit", "bash"] });
      detector.ingest(exp);
      detector.ingest(exp);
      detector.ingest(exp); // workflow created at count 3
      const wfId = "workflow:代码编写→文件探索";
      assert.ok(detector.patterns.has(wfId));
      assert.equal(detector.seqCache.get("代码编写→文件探索"), 3);

      // Age it past the decay floor and prune.
      detector.patterns.get(wfId).lastSeen = new Date(Date.now() - 10 * 86_400_000).toISOString();
      detector.pruneMemory();
      assert.equal(detector.patterns.has(wfId), false, "stale workflow is pruned");
      assert.equal(detector.seqCache.has("代码编写→文件探索"), false, "its counter is cleared too");
      assert.equal(detector.seqInsertOrder.includes("代码编写→文件探索"), false);

      // A single recurrence must NOT instantly recreate it (count restarts at 1).
      detector.ingest(makeExp({ toolsUsed: ["grep", "edit", "bash"] }));
      assert.equal(detector.patterns.has(wfId), false, "does not resurrect from one recurrence");
    });

    it("dedupes workflow taskType accumulation instead of compounding duplicates", () => {
      const detector = new PatternDetector({});
      const t = (taskType) => makeExp({ toolsUsed: ["grep", "edit", "bash"], taskType });
      detector.ingest(t("coding"));
      detector.ingest(t("coding"));
      detector.ingest(t("coding")); // created, taskType "coding"
      detector.ingest(t("research")); // -> "coding,research"
      detector.ingest(t("coding")); // must stay "coding,research", not add a dup

      const wf = detector.patterns.get("workflow:代码编写→文件探索");
      const parts = wf.context.taskType.split(",");
      assert.deepEqual(parts, [...new Set(parts)], "no duplicate task types");
      assert.ok(parts.includes("coding") && parts.includes("research"));
    });

    it("strength cap can evict auto-approved patterns but never manual/durable", () => {
      const detector = new PatternDetector({});
      const old = new Date(Date.now() - 365 * 86_400_000).toISOString();
      // One protected manual + one auto-approved, then flood weak pending ones.
      detector.patterns.set("error:manual", {
        id: "error:manual", type: "error", status: "approved",
        count: 1, score: 5, firstSeen: old, lastSeen: old,
      });
      detector.patterns.set("error:auto", {
        id: "error:auto", type: "error", status: "approved", autoApproved: true,
        count: 1, score: 5, firstSeen: old, lastSeen: old,
      });
      for (let i = 0; i < 130; i++) {
        detector.patterns.set(`error:p${i}`, {
          id: `error:p${i}`, type: "error", status: "pending",
          count: 5, score: 50, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(),
        });
      }
      detector.pruneMemory();
      assert.equal(detector.patterns.has("error:manual"), true, "manual approval survives the cap");
    });
  });

  describe("_forgetPatterns (batched eviction)", () => {
    it("removes all given patterns and cleans their category buckets", () => {
      const detector = new PatternDetector({});
      detector.restore([
        { id: "a", type: "error", count: 1, context: { categories: ["x"] } },
        { id: "b", type: "error", count: 1, context: { categories: ["y"] } },
        { id: "c", type: "error", count: 1, context: { categories: ["z"] } },
      ]);
      detector._forgetPatterns(["a", "c"]);
      assert.equal(detector.patterns.has("a"), false);
      assert.equal(detector.patterns.has("c"), false);
      assert.equal(detector.patterns.has("b"), true);
      assert.equal(detector.catIndex.has("x"), false);
      assert.equal(detector.catIndex.has("z"), false);
      assert.equal(detector.catIndex.has("y"), true);
    });

    it("removes inbound relation edges pointing to any forgotten pattern in one pass", () => {
      const detector = new PatternDetector({});
      detector.restore([
        { id: "a", type: "error", count: 1, context: { categories: ["x"], relations: [
          { targetId: "b", type: "shared-tools", weight: 1 },
          { targetId: "c", type: "same-task", weight: 0.3 },
        ] } },
        { id: "b", type: "error", count: 1, context: { categories: ["y"] } },
        { id: "c", type: "error", count: 1, context: { categories: ["z"], relations: [
          { targetId: "b", type: "shared-tools", weight: 1 },
        ] } },
      ]);
      detector._forgetPatterns(["b"]);
      assert.deepEqual(detector.patterns.get("a").context.relations.map((r) => r.targetId), ["c"]);
      assert.deepEqual(detector.patterns.get("c").context.relations, []);
    });

    it("clears workflow seqCache and seqInsertOrder for forgotten workflow ids", () => {
      const detector = new PatternDetector({});
      detector.restore([
        { id: "workflow:代码编写→文件探索", type: "workflow", count: 4, tools: ["grep", "edit", "bash"], context: { categories: ["文件探索", "代码编写"] } },
      ]);
      assert.equal(detector.seqCache.get("代码编写→文件探索"), 4);
      detector._forgetPatterns(["workflow:代码编写→文件探索"]);
      assert.equal(detector.patterns.has("workflow:代码编写→文件探索"), false);
      assert.equal(detector.seqCache.has("代码编写→文件探索"), false);
      assert.equal(detector.seqInsertOrder.includes("代码编写→文件探索"), false);
    });

    it("produces identical store/index/relation state as N single _forgetPattern calls", () => {
      const build = () => [
        { id: "p1", type: "error", count: 1, context: { categories: ["a"], relations: [{ targetId: "p2", type: "shared-tools", weight: 1 }, { targetId: "p3", type: "same-task", weight: 0.3 }] } },
        { id: "p2", type: "error", count: 1, context: { categories: ["b"], relations: [{ targetId: "p1", type: "shared-tools", weight: 1 }, { targetId: "p4", type: "same-task", weight: 0.3 }] } },
        { id: "p3", type: "error", count: 1, context: { categories: ["c"], relations: [{ targetId: "p4", type: "shared-tools", weight: 1 }] } },
        { id: "p4", type: "error", count: 1, context: { categories: ["a", "c"] } },
      ];
      const ref = new PatternDetector({}); ref.restore(build());
      const batched = new PatternDetector({}); batched.restore(build());

      for (const id of ["p2", "p3"]) ref._forgetPattern(id);
      batched._forgetPatterns(["p2", "p3"]);

      assert.deepEqual([...batched.patterns.keys()].sort(), [...ref.patterns.keys()].sort());
      assert.deepEqual([...batched.catIndex.keys()].sort(), [...ref.catIndex.keys()].sort());
      assert.deepEqual(
        batched.patterns.get("p1").context.relations,
        ref.patterns.get("p1").context.relations,
      );
    });

    it("is a no-op for empty or missing input", () => {
      const detector = new PatternDetector({});
      detector.restore([{ id: "a", type: "error", count: 1, context: { categories: ["x"] } }]);
      detector._forgetPatterns([]);
      detector._forgetPatterns();
      assert.equal(detector.patterns.size, 1);
    });
  });

  describe("pruneMemory — orphan relation cleanup", () => {
    it("strips relation edges that point to a pruned low-score pattern", () => {
      const detector = new PatternDetector({});
      const old = new Date(Date.now() - 365 * 86_400_000).toISOString();
      const fresh = new Date().toISOString();
      // Strong survivor that links to a weak pattern which will be score-floor pruned.
      detector.patterns.set("error:survivor", {
        id: "error:survivor", type: "error", status: "approved",
        count: 5, score: 50, firstSeen: fresh, lastSeen: fresh,
        context: { categories: ["debug"], relations: [{ targetId: "error:weak", type: "shared-tools", weight: 1 }] },
      });
      detector.patterns.set("error:weak", {
        id: "error:weak", type: "error", status: "approved", autoApproved: true,
        count: 1, score: 1, firstSeen: old, lastSeen: old,
        context: { categories: ["debug"] },
      });
      const pruned = detector.pruneMemory();
      assert.ok(pruned >= 1, "weak decayed pattern is pruned");
      assert.equal(detector.patterns.has("error:weak"), false);
      assert.deepEqual(detector.patterns.get("error:survivor").context.relations, [],
        "edge to the pruned pattern is removed");
    });
  });
});
