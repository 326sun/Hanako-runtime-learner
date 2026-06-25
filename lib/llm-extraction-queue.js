/**
 * llm-extraction-queue — persistent work queue for v5 LLM pattern extraction
 * (plan §5.4 / §5.5). The synchronous flush path only ever ENQUEUEs here; a
 * background async worker (lib/llm-extraction-worker.js) claims and consumes.
 *
 * Stored as a single JSON array via the atomic writeJson helper (same store
 * style as patterns.json / model_advice.json), so writes are crash-safe.
 *
 * Rules enforced: dedup by evidenceHash, single-flight claim (pending→running),
 * exponential backoff on failure, discard after maxAttempts. None of these ever
 * block or throw into the caller's hot path.
 */

import path from "path";
import { readJson, writeJson } from "./json-io.js";
import { makeExtractionJob } from "./llm-extraction-schema.js";

// Backoff schedule per failed attempt: 5min → 30min → 2h (plan §5.5).
export const BACKOFF_MS = Object.freeze([5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]);

const TERMINAL_STATUSES = new Set(["done", "discarded", "failed"]);
const MAX_QUEUE = 200;
const KEEP_TERMINAL = 40;

export function extractionQueuePath(dataDir) {
  return path.join(dataDir, "llm-extraction-queue.json");
}

export function readQueue(dataDir) {
  const rows = readJson(extractionQueuePath(dataDir), []);
  return Array.isArray(rows) ? rows : [];
}

export function writeQueue(dataDir, jobs) {
  writeJson(extractionQueuePath(dataDir), jobs);
  return jobs;
}

/**
 * Enqueue a detector candidate. Deduplicates by evidenceHash: an existing job
 * with the same hash (in any state) is never re-queued, so a recurring pattern
 * does not flood the queue or re-burn model budget.
 * @returns {{ job: object, enqueued: boolean }}
 */
export function enqueueJob(dataDir, candidate, { now = new Date().toISOString(), maxQueue = MAX_QUEUE } = {}) {
  const job = makeExtractionJob({ ...candidate, now });
  const jobs = readQueue(dataDir);
  const existing = jobs.find((j) => j.evidenceHash === job.evidenceHash);
  if (existing) return { job: existing, enqueued: false };
  jobs.push(job);
  // Bound growth: drop the oldest terminal jobs first, then oldest overall.
  if (jobs.length > maxQueue) {
    jobs.sort((a, b) => {
      const at = TERMINAL_STATUSES.has(a.status) ? 0 : 1;
      const bt = TERMINAL_STATUSES.has(b.status) ? 0 : 1;
      if (at !== bt) return at - bt;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
    jobs.splice(0, jobs.length - maxQueue);
  }
  writeQueue(dataDir, jobs);
  return { job, enqueued: true };
}

function persistJob(dataDir, id, mutate) {
  const jobs = readQueue(dataDir);
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;
  jobs[idx] = mutate({ ...jobs[idx] });
  writeQueue(dataDir, jobs);
  return jobs[idx];
}

/**
 * Claim the next runnable job and mark it running, persisting immediately so a
 * concurrent worker sees no claimable job (single-flight at the store level).
 * Skips jobs whose backoff nextRunAt is still in the future.
 */
export function claimNextJob(dataDir, { now = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(now);
  const jobs = readQueue(dataDir);
  const runnable = jobs
    .filter((j) => j.status === "pending" && (!j.nextRunAt || Date.parse(j.nextRunAt) <= nowMs))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const next = runnable[0];
  if (!next) return null;
  return persistJob(dataDir, next.id, (j) => ({ ...j, status: "running", updatedAt: now }));
}

export function updateJob(dataDir, id, patch, { now = new Date().toISOString() } = {}) {
  return persistJob(dataDir, id, (j) => ({ ...j, ...patch, updatedAt: now }));
}

export function completeJob(dataDir, id, { status = "done", lastError = null, now = new Date().toISOString() } = {}) {
  return persistJob(dataDir, id, (j) => ({ ...j, status, lastError, updatedAt: now }));
}

/**
 * Record a failed attempt with exponential backoff. Once attempts reach
 * maxAttempts the job is discarded (terminal) so it never blocks the queue.
 */
export function failJob(dataDir, id, { error = "", maxAttempts = 3, now = new Date().toISOString() } = {}) {
  return persistJob(dataDir, id, (j) => {
    const attempts = (j.attempts || 0) + 1;
    if (attempts >= maxAttempts) {
      return { ...j, attempts, status: "discarded", lastError: String(error), nextRunAt: null, updatedAt: now };
    }
    const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    return {
      ...j,
      attempts,
      status: "pending",
      lastError: String(error),
      nextRunAt: new Date(Date.parse(now) + backoff).toISOString(),
      updatedAt: now,
    };
  });
}

/** Cap terminal (done/discarded/failed) jobs, newest-wins; pending/running kept. */
export function pruneTerminal(dataDir, { keep = KEEP_TERMINAL } = {}) {
  const jobs = readQueue(dataDir);
  const terminal = jobs
    .filter((j) => TERMINAL_STATUSES.has(j.status))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  if (terminal.length <= keep) return jobs.length;
  const drop = new Set(terminal.slice(keep).map((j) => j.id));
  const kept = jobs.filter((j) => !drop.has(j.id));
  writeQueue(dataDir, kept);
  return kept.length;
}
