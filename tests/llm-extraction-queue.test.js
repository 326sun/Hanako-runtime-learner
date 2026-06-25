import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  BACKOFF_MS,
  extractionQueuePath,
  readQueue,
  enqueueJob,
  claimNextJob,
  completeJob,
  failJob,
  pruneTerminal,
} from "../lib/llm-extraction-queue.js";

const tmpDir = path.join(os.tmpdir(), "learner-llmq-test-" + Date.now());
const cand = (over = {}) => ({ kind: "workflow", evidenceIds: ["e1", "e2"], summary: "seq", scope: { project: "p" }, ...over });

describe("llm-extraction-queue", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("enqueues a candidate and persists it", () => {
    const { job, enqueued } = enqueueJob(tmpDir, cand(), { now: "2026-06-25T00:00:00.000Z" });
    assert.equal(enqueued, true);
    assert.equal(job.status, "pending");
    assert.ok(fs.existsSync(extractionQueuePath(tmpDir)));
    assert.equal(readQueue(tmpDir).length, 1);
  });

  it("deduplicates by evidence hash (same evidence ids + kind)", () => {
    enqueueJob(tmpDir, cand(), { now: "2026-06-25T00:00:00.000Z" });
    const second = enqueueJob(tmpDir, cand({ evidenceIds: ["e2", "e1"] }), { now: "2026-06-25T00:01:00.000Z" });
    assert.equal(second.enqueued, false);
    assert.equal(readQueue(tmpDir).length, 1);
  });

  it("enqueues distinct evidence sets separately", () => {
    enqueueJob(tmpDir, cand({ evidenceIds: ["e1"] }), { now: "2026-06-25T00:00:00.000Z" });
    enqueueJob(tmpDir, cand({ evidenceIds: ["e2"] }), { now: "2026-06-25T00:00:00.000Z" });
    assert.equal(readQueue(tmpDir).length, 2);
  });

  it("claims a pending job and marks it running (single-flight)", () => {
    enqueueJob(tmpDir, cand(), { now: "2026-06-25T00:00:00.000Z" });
    const claimed = claimNextJob(tmpDir, { now: "2026-06-25T00:05:00.000Z" });
    assert.equal(claimed.status, "running");
    // persisted as running so a second worker sees nothing to claim
    assert.equal(claimNextJob(tmpDir, { now: "2026-06-25T00:05:00.000Z" }), null);
    assert.equal(readQueue(tmpDir)[0].status, "running");
  });

  it("does not claim a job whose backoff nextRunAt is still in the future", () => {
    enqueueJob(tmpDir, cand(), { now: "2026-06-25T00:00:00.000Z" });
    const job = claimNextJob(tmpDir, { now: "2026-06-25T00:00:00.000Z" });
    failJob(tmpDir, job.id, { error: "timeout", maxAttempts: 3, now: "2026-06-25T00:00:00.000Z" });
    // 1 second later the 5-minute backoff has not elapsed
    assert.equal(claimNextJob(tmpDir, { now: "2026-06-25T00:00:01.000Z" }), null);
    // after the backoff it is claimable again
    const later = new Date(Date.parse("2026-06-25T00:00:00.000Z") + BACKOFF_MS[0] + 1000).toISOString();
    assert.ok(claimNextJob(tmpDir, { now: later }));
  });

  it("fails with exponential backoff then discards after max attempts", () => {
    enqueueJob(tmpDir, cand(), { now: "2026-06-25T00:00:00.000Z" });
    const job = claimNextJob(tmpDir, { now: "2026-06-25T00:00:00.000Z" });

    const f1 = failJob(tmpDir, job.id, { error: "timeout", maxAttempts: 3, now: "2026-06-25T00:00:00.000Z" });
    assert.equal(f1.attempts, 1);
    assert.equal(f1.status, "pending");
    assert.equal(f1.lastError, "timeout");
    assert.equal(Date.parse(f1.nextRunAt) - Date.parse("2026-06-25T00:00:00.000Z"), BACKOFF_MS[0]);

    const f2 = failJob(tmpDir, job.id, { error: "timeout", maxAttempts: 3, now: "2026-06-25T01:00:00.000Z" });
    assert.equal(f2.attempts, 2);
    assert.equal(f2.status, "pending");

    const f3 = failJob(tmpDir, job.id, { error: "timeout", maxAttempts: 3, now: "2026-06-25T02:00:00.000Z" });
    assert.equal(f3.attempts, 3);
    assert.equal(f3.status, "discarded");
  });

  it("completes a job as done", () => {
    enqueueJob(tmpDir, cand(), { now: "2026-06-25T00:00:00.000Z" });
    const job = claimNextJob(tmpDir, { now: "2026-06-25T00:00:00.000Z" });
    const done = completeJob(tmpDir, job.id, { status: "done", now: "2026-06-25T00:10:00.000Z" });
    assert.equal(done.status, "done");
    assert.equal(readQueue(tmpDir)[0].status, "done");
  });

  it("returns null when there is nothing to claim", () => {
    assert.equal(claimNextJob(tmpDir, { now: "2026-06-25T00:00:00.000Z" }), null);
  });

  it("prunes terminal jobs beyond the keep cap", () => {
    for (let i = 0; i < 50; i++) {
      enqueueJob(tmpDir, cand({ evidenceIds: [`x${i}`] }), { now: "2026-06-25T00:00:00.000Z" });
    }
    for (const j of readQueue(tmpDir)) completeJob(tmpDir, j.id, { status: "done", now: "2026-06-25T00:10:00.000Z" });
    pruneTerminal(tmpDir, { keep: 10 });
    assert.equal(readQueue(tmpDir).length, 10);
  });
});
