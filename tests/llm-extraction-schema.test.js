import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_KINDS,
  DEFAULT_RISK_FLOOR,
  evidenceHashOf,
  makeExtractionJob,
  clampRiskTier,
  parseExtraction,
  validateExtraction,
} from "../lib/llm-extraction-schema.js";

describe("llm-extraction-schema", () => {
  describe("evidenceHashOf", () => {
    it("is deterministic and independent of evidence id order/duplicates", () => {
      const a = evidenceHashOf("workflow", ["e1", "e2", "e3"]);
      const b = evidenceHashOf("workflow", ["e3", "e2", "e1", "e2"]);
      assert.equal(a, b);
    });
    it("differs by kind and by evidence set", () => {
      assert.notEqual(evidenceHashOf("workflow", ["e1"]), evidenceHashOf("error", ["e1"]));
      assert.notEqual(evidenceHashOf("workflow", ["e1"]), evidenceHashOf("workflow", ["e2"]));
    });
  });

  describe("makeExtractionJob", () => {
    it("builds a pending job with the full data contract", () => {
      const job = makeExtractionJob({
        kind: "workflow",
        evidenceIds: ["e2", "e1", "e1"],
        summary: "tool seq repeats",
        scope: { project: "proj", taskType: "code", sessionId: "s1" },
        now: "2026-06-25T00:00:00.000Z",
      });
      assert.equal(job.kind, "workflow");
      assert.deepEqual(job.evidenceIds, ["e1", "e2"]); // sorted + deduped
      assert.equal(job.evidenceHash, evidenceHashOf("workflow", ["e1", "e2"]));
      assert.equal(job.summary, "tool seq repeats");
      assert.equal(job.scope.project, "proj");
      assert.equal(job.createdAt, "2026-06-25T00:00:00.000Z");
      assert.equal(job.updatedAt, "2026-06-25T00:00:00.000Z");
      assert.equal(job.attempts, 0);
      assert.equal(job.status, "pending");
      assert.equal(job.nextRunAt, null);
      assert.equal(job.lastError, null);
      assert.equal(job.source, "detector");
      assert.ok(job.id.includes(job.evidenceHash));
    });

    it("rejects an unknown kind", () => {
      assert.throws(() => makeExtractionJob({ kind: "nonsense", evidenceIds: ["e1"], summary: "x" }), /kind/);
    });

    it("rejects empty evidence", () => {
      assert.throws(() => makeExtractionJob({ kind: "workflow", evidenceIds: [], summary: "x" }), /evidence/i);
    });

    it("exposes the allowed kinds and risk floor", () => {
      assert.deepEqual([...ALLOWED_KINDS].sort(), ["error", "preference", "usage", "workflow"]);
      assert.equal(DEFAULT_RISK_FLOOR, "R2");
    });
  });

  describe("clampRiskTier (suggested risk may only raise, never lower)", () => {
    it("raises a too-low suggestion up to the floor", () => {
      assert.equal(clampRiskTier("R0"), "R2");
      assert.equal(clampRiskTier("R1"), "R2");
    });
    it("keeps a higher suggestion", () => {
      assert.equal(clampRiskTier("R3"), "R3");
      assert.equal(clampRiskTier("R4"), "R4");
    });
    it("defaults invalid/missing to the floor", () => {
      assert.equal(clampRiskTier(undefined), "R2");
      assert.equal(clampRiskTier("nope"), "R2");
    });
  });

  describe("parseExtraction", () => {
    it("parses plain, prose-embedded, and fenced JSON", () => {
      assert.deepEqual(parseExtraction('{"type":"none"}'), { type: "none" });
      assert.deepEqual(parseExtraction('sure: {"type":"usage"} ok'), { type: "usage" });
      assert.deepEqual(parseExtraction('```json\n{"type":"error"}\n```'), { type: "error" });
    });
    it("returns null for garbage", () => {
      assert.equal(parseExtraction("not json"), null);
      assert.equal(parseExtraction(""), null);
    });
  });

  describe("validateExtraction", () => {
    const job = makeExtractionJob({ kind: "workflow", evidenceIds: ["e1", "e2"], summary: "s" });

    it("accepts a well-formed extraction and tags source:llm", () => {
      const r = validateExtraction(
        { type: "workflow", desc: "d", generalization: "when X", evidenceIds: ["e1"], confidence: 0.9, suggestedRiskTier: "R3" },
        { job, minConfidence: 0.72 },
      );
      assert.equal(r.ok, true);
      assert.equal(r.extraction.source, "llm");
      assert.equal(r.extraction.type, "workflow");
      assert.equal(r.extraction.suggestedRiskTier, "R3");
      assert.deepEqual(r.extraction.evidenceIds, ["e1"]);
    });

    it("discards type:none without a proposal", () => {
      const r = validateExtraction({ type: "none" }, { job, minConfidence: 0.72 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "none");
    });

    it("discards low or missing confidence", () => {
      assert.equal(validateExtraction({ type: "usage", confidence: 0.5 }, { job, minConfidence: 0.72 }).reason, "low_confidence");
      assert.equal(validateExtraction({ type: "usage" }, { job, minConfidence: 0.72 }).reason, "low_confidence");
    });

    it("rejects an unsupported type", () => {
      assert.equal(validateExtraction({ type: "lol", confidence: 0.9 }, { job, minConfidence: 0.72 }).reason, "bad_type");
    });

    it("rejects unparseable input", () => {
      assert.equal(validateExtraction(null, { job, minConfidence: 0.72 }).reason, "unparseable");
    });

    it("filters forged evidence ids to the job's input set", () => {
      const r = validateExtraction(
        { type: "usage", confidence: 0.9, evidenceIds: ["e1", "forged", "e2"] },
        { job, minConfidence: 0.72 },
      );
      assert.deepEqual(r.extraction.evidenceIds, ["e1", "e2"]);
    });

    it("falls back to the job evidence when the model supplies only forged ids", () => {
      const r = validateExtraction(
        { type: "usage", confidence: 0.9, evidenceIds: ["forged-only"] },
        { job, minConfidence: 0.72 },
      );
      assert.deepEqual(r.extraction.evidenceIds, ["e1", "e2"]);
    });

    it("defaults a missing risk tier to the floor and clamps a too-low one up", () => {
      assert.equal(validateExtraction({ type: "usage", confidence: 0.9 }, { job, minConfidence: 0.72 }).extraction.suggestedRiskTier, "R2");
      assert.equal(validateExtraction({ type: "usage", confidence: 0.9, suggestedRiskTier: "R0" }, { job, minConfidence: 0.72 }).extraction.suggestedRiskTier, "R2");
    });
  });
});
