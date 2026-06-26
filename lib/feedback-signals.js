/**
 * feedback-signals — v5.1 M5 feedback instrumentation (signals only).
 *
 * Records a small, well-defined set of feedback signals into the existing
 * hash-chained, append-only event-log so a FUTURE adaptive layer (v5.2+) could
 * learn from real outcomes. This module is INSTRUMENTATION ONLY:
 *   - it never mutates thresholds, config, patterns, or memory;
 *   - it never participates in any current decision;
 *   - summarizeFeedback is a pure read that returns counts, never suggestions.
 *
 * Privacy: events carry only ids, counts, and short reason codes — never user
 * verbatim text, memory bodies, source snippets, or absolute paths. skillRef is
 * reduced to a relative path or basename.
 *
 * Three new signals (proposal.applied / proposal.rejected / pattern.approved /
 * pattern.rejected are already emitted elsewhere and are NOT re-instrumented):
 *   feedback.memory_injected   — memory ids injected into SKILL.md (on success)
 *   feedback.injection_revoked — a previously-injected memory's injection pulled
 *   feedback.memory_closed     — a user manually closed/rejected a memory
 */

import path from "path";
import { appendEvent, readEvents } from "./event-log.js";

export const FEEDBACK_TYPES = {
  injected: "feedback.memory_injected",
  revoked: "feedback.injection_revoked",
  closed: "feedback.memory_closed",
};

const MAX_REASON = 64;

// Strip anything that could leak a filesystem location: absolute paths collapse
// to their basename, separators normalize to "/", and the result is length-capped.
function sanitizeRef(ref) {
  const raw = String(ref || "").trim();
  if (!raw) return "";
  const safe = path.isAbsolute(raw) ? path.basename(raw) : raw.replace(/\\/g, "/");
  return safe.slice(0, 128);
}

// reason is a short machine code (e.g. "rejected", "superseded"), never free text.
function sanitizeReason(reason) {
  return String(reason || "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
}

// Append fail-soft: a logging failure must never break the caller's main flow.
function safeAppend(baseDir, event) {
  try {
    appendEvent(baseDir, event);
    return true;
  } catch {
    return false;
  }
}

export function recordMemoryInjected(baseDir, { patternIds = [], skillRef = "" } = {}) {
  const ids = (Array.isArray(patternIds) ? patternIds : []).map((x) => String(x)).filter(Boolean);
  if (!ids.length) return false;
  return safeAppend(baseDir, {
    type: FEEDBACK_TYPES.injected,
    entityType: "memory",
    entityId: null,
    summary: `Injected ${ids.length} memory id(s)`,
    data: { patternIds: ids, count: ids.length, skillRef: sanitizeRef(skillRef) },
  });
}

export function recordInjectionRevoked(baseDir, { patternId = "", reason = "" } = {}) {
  const id = String(patternId || "");
  if (!id) return false;
  return safeAppend(baseDir, {
    type: FEEDBACK_TYPES.revoked,
    entityType: "memory",
    entityId: id,
    summary: `Injection revoked: ${id}`,
    data: { patternId: id, reason: sanitizeReason(reason) },
  });
}

export function recordMemoryClosed(baseDir, { patternId = "", actor = "user", reason = "" } = {}) {
  const id = String(patternId || "");
  if (!id) return false;
  const who = actor === "runtime" ? "runtime" : "user";
  return safeAppend(baseDir, {
    type: FEEDBACK_TYPES.closed,
    entityType: "memory",
    entityId: id,
    actor: who,
    summary: `Memory closed: ${id}`,
    data: { patternId: id, actor: who, reason: sanitizeReason(reason) },
  });
}

// True if `patternId` appears in a recorded feedback.memory_injected event.
// Lets a revoke hook fire injection_revoked only for memories we actually injected.
export function wasRecentlyInjected(baseDir, patternId) {
  const id = String(patternId || "");
  if (!id) return false;
  try {
    const events = readEvents(baseDir, { limit: 500, type: FEEDBACK_TYPES.injected });
    return events.some((e) => Array.isArray(e?.data?.patternIds) && e.data.patternIds.includes(id));
  } catch {
    return false;
  }
}

const COUNTED_TYPES = {
  [FEEDBACK_TYPES.injected]: "memoryInjected",
  [FEEDBACK_TYPES.revoked]: "injectionRevoked",
  [FEEDBACK_TYPES.closed]: "memoryClosed",
  "proposal.applied": "proposalApplied",
  "proposal.rejected": "proposalRejected",
  "pattern.approved": "patternApproved",
  "pattern.rejected": "patternRejected",
};

/**
 * Pure read: tally feedback (and the already-present proposal/pattern) signals
 * over the last `sinceDays`. Returns counts only — no thresholds, no decisions,
 * no file writes. Intended substrate for a future adaptive layer, unused today.
 */
export function summarizeFeedback(baseDir, { sinceDays = 30 } = {}) {
  const counts = {
    memoryInjected: 0,
    injectionRevoked: 0,
    memoryClosed: 0,
    proposalApplied: 0,
    proposalRejected: 0,
    patternApproved: 0,
    patternRejected: 0,
  };
  let injectedIdTotal = 0;
  const cutoff = sinceDays > 0 ? Date.now() - sinceDays * 86_400_000 : 0;
  let events = [];
  try {
    events = readEvents(baseDir, { limit: 5000 });
  } catch {
    events = [];
  }
  for (const e of events) {
    if (cutoff) {
      const t = Date.parse(e?.date || "");
      if (Number.isFinite(t) && t < cutoff) continue;
    }
    const key = COUNTED_TYPES[e?.type];
    if (!key) continue;
    counts[key] += 1;
    if (e.type === FEEDBACK_TYPES.injected) injectedIdTotal += Number(e?.data?.count || 0);
  }
  return { sinceDays, counts, injectedIdTotal };
}
