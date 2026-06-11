import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildHighRiskAdvisorCodePatchProposals,
  buildRepeatedCodePatchProposals,
  mergeAdvisorSuggestions,
} from "../lib/advisor-insights.js";

function tempLearnerDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "advisor-insights-"));
}

describe("advisor insights shared helpers", () => {
  it("merges advisor suggestions into arrays with one lookup pass", () => {
    const patterns = [
      { id: "error:import_missing", type: "error", status: "pending", fix: "old" },
      { id: "error:approved", type: "error", status: "approved", fix: "keep" },
    ];
    const result = mergeAdvisorSuggestions(patterns, {
      suggestions: [
        { patternId: "error:import_missing", advice: "new safe advice" },
        { patternId: "error:approved", advice: "should not replace" },
        { patternId: "missing", advice: "ignored" },
      ],
    });

    assert.equal(result.merged, 1);
    assert.deepEqual(result.mergedPatternIds, ["error:import_missing"]);
    assert.equal(patterns[0].fix, "new safe advice");
    assert.equal(patterns[1].fix, "keep");
    assert.ok(patterns[0].advisorUpdatedAt);
  });

  it("merges advisor suggestions into pattern maps", () => {
    const patterns = new Map([
      ["error:syntax_error", { id: "error:syntax_error", type: "error", status: "pending" }],
    ]);

    const result = mergeAdvisorSuggestions(patterns, [
      { patternId: "error:syntax_error", advice: "quote the path before retrying" },
    ]);

    assert.equal(result.merged, 1);
    assert.equal(patterns.get("error:syntax_error").fix, "quote the path before retrying");
  });

  it("builds repeated code patch proposals only for eligible unresolved error patterns", () => {
    const learnerDir = tempLearnerDir();
    try {
      const result = buildRepeatedCodePatchProposals({
        learnerDir,
        minCount: 3,
        patterns: [
          { id: "error:path_error", type: "error", count: 3, status: "pending", fix: "check path" },
          { id: "error:unknown", type: "error", count: 10, status: "pending", fix: "too vague" },
          { id: "error:approved", type: "error", count: 4, status: "approved", fix: "already handled" },
          { id: "usage:large_context:x", type: "usage", count: 5, status: "pending", fix: "split" },
        ],
      });

      assert.equal(result.created, 1);
      assert.equal(result.proposals.length, 1);
      assert.equal(result.proposals[0].triggerPatternIds[0], "error:path_error");
    } finally {
      fs.rmSync(learnerDir, { recursive: true, force: true });
    }
  });

  it("builds high-risk advisor proposals from a pre-indexed pattern source", () => {
    const learnerDir = tempLearnerDir();
    try {
      const patterns = new Map([
        ["error:import_missing", { id: "error:import_missing", type: "error", count: 1, status: "pending", fix: "old" }],
        ["workflow:a", { id: "workflow:a", type: "workflow", count: 9, status: "pending", fix: "not code" }],
      ]);

      const result = buildHighRiskAdvisorCodePatchProposals({
        learnerDir,
        patterns,
        adviceOrSuggestions: {
          suggestions: [
            { patternId: "error:import_missing", risk: "high", advice: "add the missing export" },
            { patternId: "workflow:a", risk: "high", advice: "ignored" },
            { patternId: "error:import_missing", risk: "low", advice: "ignored" },
          ],
        },
      });

      assert.equal(result.created, 1);
      assert.equal(result.proposals.length, 1);
      assert.equal(result.proposals[0].patch.summary, "add the missing export");
    } finally {
      fs.rmSync(learnerDir, { recursive: true, force: true });
    }
  });
});
