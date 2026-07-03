import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  selectExtractionCandidates,
  enqueueCandidates,
  extractionToProposal,
  runExtractionTick,
} from "../lib/llm-extraction-worker.js";
import { readQueue } from "../lib/llm-extraction-queue.js";
import { listProposals, readProposal } from "../lib/proposals.js";
import { listReviews } from "../lib/review-queue.js";
import { DEFAULT_CONFIG } from "../lib/common.js";

const tmpDir = path.join(os.tmpdir(), "learner-llmworker-test-" + Date.now());
const enabled = { ...DEFAULT_CONFIG, llmExtractionEnabled: true, llmExtractionMinIntervalMinutes: 30, llmExtractionMaxJobsPerRun: 5, llmExtractionMinConfidence: 0.72, llmExtractionTimeoutMs: 15000, llmExtractionMaxAttempts: 3 };

const wfPattern = { id: "workflow:A→B", type: "workflow", status: "approved", desc: "A→B repeats", fix: "automate", scope: { project: "p", taskType: "code" }, evidence: [{ hash: "h1" }, { hash: "h2" }] };
const prefPattern = { id: "pref:x", type: "preference", status: "approved", desc: "user pref", evidence: [{ hash: "hp" }] };
const durableWf = { id: "workflow:C→D", type: "workflow", knowledgeTier: "durable", desc: "C→D", evidence: [{ hash: "hd" }] };
const errPattern = { id: "error:timeout", type: "error", status: "pending", desc: "timeout error", evidence: [{ hash: "he" }] };

function busReturning(textOrFn, sink = []) {
  return {
    bus: {
      request(type, payload, opts) {
        sink.push({ type, payload, opts });
        const text = typeof textOrFn === "function" ? textOrFn() : textOrFn;
        return { text, model: "util" };
      },
      getCapability: () => ({ available: true }),
    },
  };
}

const validJson = '{"type":"workflow","desc":"d","generalization":"when X","confidence":0.9,"suggestedRiskTier":"R2","evidenceIds":["h1"]}';

describe("llm-extraction-worker", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  describe("selectExtractionCandidates", () => {
    it("excludes preference and durable patterns (privacy), keeps workflow/error/usage", () => {
      const cands = selectExtractionCandidates([wfPattern, prefPattern, durableWf, errPattern], { limit: 12 });
      const kinds = cands.map((c) => c.kind).sort();
      assert.deepEqual(kinds, ["error", "workflow"]);
      const wf = cands.find((c) => c.kind === "workflow");
      assert.deepEqual(wf.evidenceIds, ["h1", "h2"]);
      assert.match(wf.summary, /A→B repeats/);
    });
  });

  describe("enqueueCandidates", () => {
    it("is a no-op when llmExtractionEnabled is false (v4 behavior: no queue file)", () => {
      const r = enqueueCandidates(tmpDir, DEFAULT_CONFIG, [wfPattern, errPattern], { now: "2026-06-25T00:00:00.000Z" });
      assert.equal(r.enqueued, 0);
      assert.equal(fs.existsSync(path.join(tmpDir, "llm-extraction-queue.json")), false);
    });

    it("enqueues eligible candidates when enabled and dedupes on repeat", () => {
      const r1 = enqueueCandidates(tmpDir, enabled, [wfPattern, errPattern], { now: "2026-06-25T00:00:00.000Z" });
      assert.equal(r1.enqueued, 2);
      const r2 = enqueueCandidates(tmpDir, enabled, [wfPattern, errPattern], { now: "2026-06-25T00:01:00.000Z" });
      assert.equal(r2.enqueued, 0);
      assert.equal(readQueue(tmpDir).length, 2);
    });
  });

  describe("extractionToProposal", () => {
    it("builds a review-only pattern_candidate tagged source:llm", () => {
      const job = { id: "extract:hash1", evidenceHash: "hash1", kind: "workflow", scope: {} };
      const extraction = { type: "workflow", desc: "d", generalization: "g", evidenceIds: ["h1"], confidence: 0.9, suggestedRiskTier: "R2", source: "llm" };
      const p = extractionToProposal(extraction, job);
      assert.equal(p.type, "pattern_candidate");
      assert.equal(p.source, "llm");
      assert.equal(p.autoApply, false);
      assert.equal(p.kind, "workflow");
      assert.deepEqual(p.evidenceIds, ["h1"]);
      assert.equal(p.suggestedRiskTier, "R2");
      assert.ok(p.id.includes("hash1"));
    });
  });

  describe("runExtractionTick", () => {
    it("is a no-op and never samples when disabled (v4 characterization)", async () => {
      const sink = [];
      const ctx = busReturning(validJson, sink);
      const r = await runExtractionTick(ctx, { config: DEFAULT_CONFIG, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      assert.equal(r.skipped, "disabled");
      assert.equal(sink.length, 0);
    });

    it("degrades safely when the host has no sampling capability", async () => {
      const ctx = { bus: { request() { throw new Error("should not be called"); }, getCapability: () => ({ available: false }) } };
      enqueueCandidates(tmpDir, enabled, [wfPattern], { now: "2026-06-25T00:00:00.000Z" });
      const r = await runExtractionTick(ctx, { config: enabled, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      assert.equal(r.skipped, "unavailable");
    });

    it("turns a valid sample into a pattern_candidate routed through the review queue", async () => {
      const ctx = busReturning(validJson);
      enqueueCandidates(tmpDir, enabled, [wfPattern], { now: "2026-06-25T00:00:00.000Z" });
      const r = await runExtractionTick(ctx, { config: enabled, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      assert.equal(r.proposalsCreated, 1);

      const proposals = listProposals(tmpDir);
      assert.equal(proposals.length, 1);
      assert.equal(proposals[0].type, "pattern_candidate");
      assert.equal(proposals[0].source, "llm");
      assert.ok(proposals[0].evidenceIds.length > 0);

      const reviews = listReviews(tmpDir);
      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].status, "queued");
      assert.ok(reviews[0].validation.ok);

      assert.equal(readQueue(tmpDir)[0].status, "done");
    });

    it("never lowers the action risk below the floor even if the model suggests R0", async () => {
      const ctx = busReturning('{"type":"workflow","desc":"d","confidence":0.9,"suggestedRiskTier":"R0"}');
      enqueueCandidates(tmpDir, enabled, [wfPattern], { now: "2026-06-25T00:00:00.000Z" });
      await runExtractionTick(ctx, { config: enabled, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      assert.equal(listProposals(tmpDir)[0].suggestedRiskTier, "R2");
    });

    it("marks type:none jobs done without creating a proposal", async () => {
      const ctx = busReturning('{"type":"none"}');
      enqueueCandidates(tmpDir, enabled, [wfPattern], { now: "2026-06-25T00:00:00.000Z" });
      const r = await runExtractionTick(ctx, { config: enabled, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      assert.equal(r.proposalsCreated, 0);
      assert.equal(listProposals(tmpDir).length, 0);
      assert.equal(readQueue(tmpDir)[0].status, "done");
    });

    it("fails soft when the host sampling throws, leaving the job retriable", async () => {
      const ctx = { bus: { request() { throw new Error("bus down"); }, getCapability: () => ({ available: true }) } };
      enqueueCandidates(tmpDir, enabled, [wfPattern], { now: "2026-06-25T00:00:00.000Z" });
      const r = await runExtractionTick(ctx, { config: enabled, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      assert.equal(r.proposalsCreated, 0);
      const job = readQueue(tmpDir)[0];
      assert.equal(job.attempts, 1);
      assert.equal(job.status, "pending");
    });

    it("processes at most llmExtractionMaxJobsPerRun jobs per tick", async () => {
      const ctx = busReturning(validJson);
      const pats = Array.from({ length: 8 }, (_, i) => ({ id: `error:e${i}`, type: "error", status: "pending", desc: `err ${i}`, evidence: [{ hash: `h${i}` }] }));
      enqueueCandidates(tmpDir, { ...enabled, llmExtractionMaxJobsPerRun: 3 }, pats, { now: "2026-06-25T00:00:00.000Z" });
      const r = await runExtractionTick(ctx, { config: { ...enabled, llmExtractionMaxJobsPerRun: 3 }, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      assert.equal(r.processed, 3);
    });

    it("P9.C: records batch size and duration on the returned result and persisted state", async () => {
      const ctx = busReturning(validJson);
      const pats = [wfPattern, errPattern];
      enqueueCandidates(tmpDir, enabled, pats, { now: "2026-06-25T00:00:00.000Z" });
      const r = await runExtractionTick(ctx, { config: enabled, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      assert.ok(Number.isFinite(r.durationMs) && r.durationMs >= 0, "tick result should report a finite duration");

      const state = JSON.parse(fs.readFileSync(path.join(tmpDir, "llm_extraction_state.json"), "utf-8"));
      assert.equal(state.lastRunAt, "2026-06-25T00:00:00.000Z");
      assert.ok(Number.isFinite(state.durationMs) && state.durationMs >= 0, "persisted state should record duration");
      assert.equal(state.processed, r.processed);
      assert.equal(state.proposalsCreated, r.proposalsCreated);
      assert.equal(state.maxJobs, 5);
    });

    it("rate-limits a second tick within the min interval", async () => {
      const ctx = busReturning(validJson);
      enqueueCandidates(tmpDir, enabled, [wfPattern, errPattern], { now: "2026-06-25T00:00:00.000Z" });
      await runExtractionTick(ctx, { config: enabled, dataDir: tmpDir, now: "2026-06-25T00:00:00.000Z" });
      const r2 = await runExtractionTick(ctx, { config: enabled, dataDir: tmpDir, now: "2026-06-25T00:05:00.000Z" });
      assert.equal(r2.skipped, "rate_limited");
    });
  });
});
