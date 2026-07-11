import fs from "fs";
import path from "path";
import crypto from "crypto";
import { learnerDir } from "./common.js";
import { readJsonlTailLines } from "./jsonl-utils.js";
import { atomicWriteFileSync } from "./atomic-file.js";

const DEFAULT_MAX_EVENTS = 5000;
const DEFAULT_ARCHIVE_SEGMENT_EVENTS = 5000;
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

export function eventArchiveDir(baseDir = learnerDir()) {
  return path.join(baseDir, "event_archive");
}

function eventArchiveManifestPath(baseDir) {
  return path.join(eventArchiveDir(baseDir), "manifest.json");
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

function allEventLogLines(baseDir) {
  const lines = [];
  for (const name of archivedEventFiles(baseDir)) {
    try { lines.push(...fs.readFileSync(path.join(eventArchiveDir(baseDir), name), "utf-8").split("\n").filter(Boolean)); } catch {}
  }
  const file = eventLogPath(baseDir);
  try { lines.push(...fs.readFileSync(file, "utf-8").split("\n").filter(Boolean)); } catch {}
  return lines;
}

export function verifyEventLog(baseDir = learnerDir()) {
  const lines = allEventLogLines(baseDir);
  if (lines.length === 0) {
    return { ok: true, events: 0, rootHash: null, headHash: null, brokenAt: null };
  }
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

function parseEventLines(lines, { type = null, entityId = null, startSeq = 0 } = {}) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const row = JSON.parse(lines[i]);
      if (type && row.type !== type) continue;
      if (entityId && row.entityId !== entityId) continue;
      rows.push({ ...row, seq: startSeq + i });
    } catch {}
  }
  return rows;
}

function archivedEventFiles(baseDir) {
  const dir = eventArchiveDir(baseDir);
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
}

/**
 * Read the active tail cheaply for ordinary recent views. Filtered lookups are
 * complete by default: an old matching event may be outside the active tail,
 * so search archived segments (and, before the first archive, the full log).
 */
export function readEvents(baseDir = learnerDir(), { limit = 200, type = null, entityId = null, complete = null } = {}) {
  const file = eventLogPath(baseDir);
  const mustBeComplete = complete === true || type != null || entityId != null;
  if (!fs.existsSync(file) && !mustBeComplete) return [];
  if (!mustBeComplete) {
    const maxLines = Math.max(limit * 4, limit);
    return parseEventLines(readJsonlTailLines(file, { maxLines }), { type, entityId }).slice(-limit).reverse();
  }
  const rows = [];
  let seq = 0;
  for (const name of archivedEventFiles(baseDir)) {
    try {
      const lines = fs.readFileSync(path.join(eventArchiveDir(baseDir), name), "utf-8").split("\n").filter(Boolean);
      rows.push(...parseEventLines(lines, { type, entityId, startSeq: seq }));
      seq += lines.length;
    } catch {}
  }
  try {
    const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
    rows.push(...parseEventLines(lines, { type, entityId, startSeq: seq }));
  } catch {}
  return rows.slice(-limit).reverse();
}

/**
 * Move immutable event prefixes into numbered segments while preserving their
 * original bytes and hash chain. The active log starts at a non-empty prevHash;
 * verifyEventLog treats that as a valid segment root. Archive manifests make
 * retention observable without mutating historical event payloads.
 */
export function archiveEventLog(baseDir = learnerDir(), { segmentEvents = DEFAULT_ARCHIVE_SEGMENT_EVENTS, keepActiveEvents = DEFAULT_ARCHIVE_SEGMENT_EVENTS } = {}) {
  fs.mkdirSync(baseDir, { recursive: true });
  const lock = acquireLock(baseDir);
  try {
    const file = eventLogPath(baseDir);
    if (!fs.existsSync(file)) return { archived: 0, active: 0, segment: null };
    const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
    const keep = Math.max(1, Number(keepActiveEvents) || DEFAULT_ARCHIVE_SEGMENT_EVENTS);
    const size = Math.max(1, Number(segmentEvents) || DEFAULT_ARCHIVE_SEGMENT_EVENTS);
    if (lines.length <= keep + size) return { archived: 0, active: lines.length, segment: null };
    const count = Math.min(size, lines.length - keep);
    const archived = lines.slice(0, count);
    const active = lines.slice(count);
    const dir = eventArchiveDir(baseDir);
    fs.mkdirSync(dir, { recursive: true });
    const manifestPath = eventArchiveManifestPath(baseDir);
    let manifest = { schemaVersion: 1, segments: [] };
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch {}
    const index = Array.isArray(manifest.segments) ? manifest.segments.length + 1 : 1;
    const name = `${String(index).padStart(8, "0")}-${archived[0] ? JSON.parse(archived[0]).hash.slice(0, 12) : "empty"}.jsonl`;
    atomicWriteFileSync(path.join(dir, name), `${archived.join("\n")}\n`, "utf-8");
    const first = JSON.parse(archived[0]);
    const last = JSON.parse(archived.at(-1));
    manifest = {
      schemaVersion: 1,
      segments: [...(Array.isArray(manifest.segments) ? manifest.segments : []), {
        file: name, events: archived.length, firstHash: first.hash, lastHash: last.hash,
        firstDate: first.date || null, lastDate: last.date || null, archivedAt: new Date().toISOString(),
      }],
    };
    atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    atomicWriteFileSync(file, `${active.join("\n")}\n`, "utf-8");
    _eventSummaryCache.delete(file);
    return { archived: archived.length, active: active.length, segment: name };
  } finally {
    releaseLock(lock);
  }
}

// P8.A: replaying the event log to compute byType/entities summaries is O(n)
// over up to `limit` events, and is called on every audit-dashboard/bundle
// generation — an explicit, heavy governance tool that callers may invoke
// repeatedly without new events having been appended in between. Cache the
// replay result keyed on the event log's mtime+size+limit so repeated calls
// with an unchanged log skip the recompute; any new appendEvent() changes the
// file size (and mtime), which invalidates the cache automatically.
const _eventSummaryCache = new Map();

export function cachedEventSummary(baseDir = learnerDir(), { limit = DEFAULT_MAX_EVENTS, events = null } = {}) {
  const file = eventLogPath(baseDir);
  let stat = null;
  try { stat = fs.statSync(file); } catch {}
  if (stat) {
    const cached = _eventSummaryCache.get(file);
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size && cached.limit === limit) {
      return cached.result;
    }
  }
  const rows = events || readEvents(baseDir, { limit });
  const result = replayEventState(rows);
  if (stat) _eventSummaryCache.set(file, { mtime: stat.mtimeMs, size: stat.size, limit, result });
  return result;
}

export function eventSummary(baseDir = learnerDir()) {
  return cachedEventSummary(baseDir, { limit: DEFAULT_MAX_EVENTS });
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
