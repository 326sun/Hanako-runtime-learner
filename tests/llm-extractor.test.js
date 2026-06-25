import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExtractionPrompt, extractFromJob } from "../lib/llm-extractor.js";
import { makeExtractionJob } from "../lib/llm-extraction-schema.js";

const job = makeExtractionJob({ kind: "workflow", evidenceIds: ["e1", "e2"], summary: "edit→test→commit repeats" });

function busReturning(textOrFn, sink = []) {
  return {
    bus: {
      request(type, payload, opts) {
        sink.push({ type, payload, opts });
        const text = typeof textOrFn === "function" ? textOrFn() : textOrFn;
        return { text, model: "util" };
      },
    },
  };
}

describe("llm-extractor", () => {
  describe("buildExtractionPrompt", () => {
    it("includes the kind, the summary, and the evidence ids", () => {
      const { system, user } = buildExtractionPrompt(job);
      assert.match(system, /JSON/);
      assert.match(user, /workflow/);
      assert.match(user, /edit→test→commit repeats/);
      assert.match(user, /e1/);
      assert.match(user, /e2/);
    });
  });

  describe("extractFromJob", () => {
    it("returns a validated extraction on a clean JSON response", async () => {
      const sink = [];
      const ctx = busReturning('{"type":"workflow","desc":"d","confidence":0.9,"suggestedRiskTier":"R2","evidenceIds":["e1"]}', sink);
      const r = await extractFromJob(ctx, job, { timeoutMs: 15000, minConfidence: 0.72 });
      assert.equal(r.ok, true);
      assert.equal(r.extraction.source, "llm");
      assert.equal(r.extraction.type, "workflow");
      // passes through the configured timeout
      assert.equal(sink[0].opts.timeout, 15000);
    });

    it("tolerates a markdown-fenced JSON response", async () => {
      const ctx = busReturning('```json\n{"type":"usage","confidence":0.8}\n```');
      const r = await extractFromJob(ctx, job, { timeoutMs: 15000, minConfidence: 0.72 });
      assert.equal(r.ok, true);
      assert.equal(r.extraction.type, "usage");
    });

    it("fails soft and retriable when the host sampling throws", async () => {
      const ctx = { bus: { request() { throw new Error("bus timeout"); } } };
      const r = await extractFromJob(ctx, job, { timeoutMs: 15000, minConfidence: 0.72 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "sample_failed");
      assert.equal(r.retriable, true);
    });

    it("fails soft and retriable on an empty response", async () => {
      const ctx = busReturning("   ");
      const r = await extractFromJob(ctx, job, { timeoutMs: 15000, minConfidence: 0.72 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "sample_failed");
      assert.equal(r.retriable, true);
    });

    it("discards (non-retriable) on unparseable JSON", async () => {
      const ctx = busReturning("the model rambled with no json");
      const r = await extractFromJob(ctx, job, { timeoutMs: 15000, minConfidence: 0.72 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "unparseable");
      assert.equal(r.retriable, false);
    });

    it("reports type:none as a non-retriable, non-proposal outcome", async () => {
      const ctx = busReturning('{"type":"none"}');
      const r = await extractFromJob(ctx, job, { timeoutMs: 15000, minConfidence: 0.72 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "none");
      assert.equal(r.retriable, false);
    });

    it("discards a low-confidence extraction", async () => {
      const ctx = busReturning('{"type":"usage","confidence":0.1}');
      const r = await extractFromJob(ctx, job, { timeoutMs: 15000, minConfidence: 0.72 });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "low_confidence");
      assert.equal(r.retriable, false);
    });
  });
});
