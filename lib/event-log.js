import fs from "fs";
import path from "path";
import crypto from "crypto";
import { learnerDir } from "./common.js";
import { readJsonlTailLines } from "./jsonl-utils.js";

const DEFAULT_MAX_EVENTS = 5000;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 10;
// A single append holds the lock only for a few synchronous milliseconds, so a
// lock file older than this cannot belong to a live writer — it was orphaned by
// a crashed/killed process. Reclaim it rather than blocking the event loop for
// the full acquisition timeout on every subsequent append.
const STALE_LOCK_MS = 30_000;

export function eventLogPath(baseDir = learnerDir()) {
  return path.join(baseDir, "event_log.jsonl");
}

function lockFilePath(baseDir = learnerDir()) {
  return path.join(baseDir, ".event-log.lock");
}

/**
 * Acquire an advisory cross-process lock using an atomic create-if-missing
 * file operation. `fs.openSync(path, "wx")` succeeds only when the lock file
 * does not exist, so competing processes (or interleaved async callers in the
 * same event loop) serialize on the lock. The lock is released by closing and
 * deleting the file.
 */
function acquireLock(baseDir) {
  const lockFile = lockFilePath(baseDir);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      return { fd, lockFile };
    } catch (err) {
      lastError = err;
      // Reclaim a stale lock orphaned by a crashed writer. The atomic "wx"
      // create below still guarantees a single holder if two processes race to
      // reclaim; the loser simply retries. The age guard means we never steal a
      // lock a live append is currently holding (its mtime is ~now).
      if (err.code === "EEXIST") {
        try {
          if (Date.now() - fs.statSync(lockFile).mtimeMs > STALE_LOCK_MS) {
            fs.unlinkSync(lockFile);
            continue;
          }
        } catch { /* lock vanished or unreadable — fall through and retry */ }
      }
      // Brief, synchronous back-off. This blocks the event loop, but event-log
      // writes are infrequent and the lock is held only for a single append.
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS);
      } catch {
        // Fallback for environments without Atomics support.
        const until = Date.now() + LOCK_POLL_MS;
        while (Date.now() < until) { /* busy wait */ }
      }
    }
  }
  throw new Error(`event-log lock acquisition timed out after ${LOCK_TIMEOUT_MS}ms: ${lastError?.message || "unknown"}`);
}

function releaseLock({ fd, lockFile }) {
  try { fs.closeSync(fd); } catch {}
  try { fs.unlinkSync(lockFile); } catch {}
}

function eventId(event) {
  const seed = JSON.stringify({
    date: event.date,
    type: event.type,
    entityType: event.entityType,
    entityId: event.entityId,
    summary: event.summary,
  });
  return `evt_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function eventWithoutHashes(event = {}) {
  const { hash, prevHash, ...rest } = event;
  return rest;
}

function hashEvent(event = {}, prevHash = "") {
  return crypto
    .createHash("sha256")
    .update(`${prevHash || ""}${canonicalJson(eventWithoutHashes(event))}`)
    .digest("hex");
}

// Hash of the most recent event. appendEvent calls this on every write, so
// reading the whole file each time was O(n) per append. The chain only needs
// the last line, so read a bounded tail (events are well under 8 KiB); fall back
// to a full read only if the tail somehow contains no complete line. Reading the
// tail fresh each time (rather than caching) keeps the prevHash correct even when
// another writer — e.g. control.js — appended since our last call.
const HEAD_HASH_TAIL_BYTES = 8192;

function lastHashFromText(text) {
  const lines = text.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (typeof row.hash === "string" && row.hash) return row.hash;
      return "";
    } catch {}
  }
  return null; // no complete/parseable line found
}

function lastEventHash(baseDir) {
  const file = eventLogPath(baseDir);
  if (!fs.existsSync(file)) return "";
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return "";
    const start = Math.max(0, size - HEAD_HASH_TAIL_BYTES);
    const len = size - start;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
    const fromTail = lastHashFromText(buf.toString("utf-8"));
    if (fromTail !== null) return fromTail;
    // Tail held no complete line (a single event larger than the window) —
    // fall back to a full read to stay correct.
    return lastHashFromText(fs.readFileSync(file, "utf-8")) || "";
  } catch {
    return "";
  }
}

export function appendEvent(baseDir, event = {}) {
  fs.mkdirSync(baseDir, { recursive: true });
  const lock = acquireLock(baseDir);
  try {
    const base = {
      id: event.id || eventId({ ...event, date: event.date || new Date().toISOString() }),
      date: event.date || new Date().toISOString(),
      actor: event.actor || "runtime",
      type: event.type || "unknown",
      entityType: event.entityType || "unknown",
      entityId: event.entityId || null,
      summary: event.summary || "",
      data: event.data || {},
    };
    const prevHash = lastEventHash(baseDir);
    const next = {
      ...base,
      prevHash,
      hash: hashEvent(base, prevHash),
    };
    fs.appendFileSync(eventLogPath(baseDir), `${JSON.stringify(next)}\n`, "utf-8");
    return next;
  } finally {
    releaseLock(lock);
  }
}

export function verifyEventLog(baseDir = learnerDir()) {
  const file = eventLogPath(baseDir);
  if (!fs.existsSync(file)) {
    return { ok: true, events: 0, rootHash: null, headHash: null, brokenAt: null };
  }
  const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  let expectedPrev = null;
  let rootHash = null;
  let headHash = null;

  for (let i = 0; i < lines.length; i++) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch (err) {
      return { ok: false, events: lines.length, rootHash, headHash, brokenAt: i, reason: `invalid json: ${err.message}` };
    }

    if (!row.hash) {
      return { ok: false, events: lines.length, rootHash, headHash, brokenAt: i, reason: "missing hash" };
    }

    const actualPrev = row.prevHash || "";
    if (i === 0) {
      expectedPrev = actualPrev;
      rootHash = actualPrev || "";
    } else if (actualPrev !== expectedPrev) {
      return { ok: false, events: lines.length, rootHash, headHash, brokenAt: i, reason: "prevHash mismatch" };
    }

    const expectedHash = hashEvent(row, actualPrev);
    if (row.hash !== expectedHash) {
      return { ok: false, events: lines.length, rootHash, headHash, brokenAt: i, reason: "hash mismatch" };
    }

    headHash = row.hash;
    expectedPrev = row.hash;
  }

  return { ok: true, events: lines.length, rootHash, headHash, brokenAt: null };
}

export function readEvents(baseDir = learnerDir(), { limit = 200, type = null, entityId = null } = {}) {
  const file = eventLogPath(baseDir);
  if (!fs.existsSync(file)) return [];
  const rows = [];
  const maxLines = Math.max(limit * 4, limit);
  const lines = readJsonlTailLines(file, { maxLines });
  for (let i = 0; i < lines.length; i++) {
    try {
      const row = JSON.parse(lines[i]);
      if (type && row.type !== type) continue;
      if (entityId && row.entityId !== entityId) continue;
      // seq preserves append order within the sampled tail. Dates only have
      // millisecond precision, so same-ms events need this tie breaker.
      rows.push({ ...row, seq: i });
    } catch {}
  }
  return rows.slice(-limit).reverse();
}

export function eventSummary(baseDir = learnerDir()) {
  const events = readEvents(baseDir, { limit: DEFAULT_MAX_EVENTS });
  return replayEventState(events);
}

export function replayEventState(events = []) {
  const ordered = [...(events || [])].sort((a, b) => {
    const byDate = String(a.date || "").localeCompare(String(b.date || ""));
    if (byDate !== 0) return byDate;
    // Same-millisecond events have identical date strings; fall back to the
    // log append order (seq from readEvents) so replay matches write order.
    return (Number.isFinite(a.seq) ? a.seq : 0) - (Number.isFinite(b.seq) ? b.seq : 0);
  });
  const entities = {};
  const byType = {};
  for (const evt of ordered) {
    if (!evt?.type) continue;
    byType[evt.type] = (byType[evt.type] || 0) + 1;
    const entityType = evt.entityType || "unknown";
    const entityId = evt.entityId || "unknown";
    const key = `${entityType}:${entityId}`;
    const current = entities[key] || { entityType, entityId, status: "unknown", events: 0 };
    const suffix = String(evt.type).split(".").pop();
    const nextStatus = evt.data?.status || ({
      created: "pending",
      updated: current.status || "updated",
      queued: "queued",
      blocked: "blocked",
      validated: current.status || "validated",
      previewed: current.status || "previewed",
      approved: "approved",
      rejected: "rejected",
      applied: "applied",
      rolled_back: "rolled_back",
    }[suffix] || current.status || suffix);
    entities[key] = {
      ...current,
      status: nextStatus,
      events: current.events + 1,
      lastEventType: evt.type,
      lastEventAt: evt.date || null,
      lastSummary: evt.summary || current.lastSummary || "",
    };
  }
  return { count: ordered.length, byType, entities };
}
