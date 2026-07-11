import fs from "fs";
import path from "path";
import { writeJson } from "./common.js";
import { cleanupMatchingLegacyEntityFile, entityFilePath, resolveEntityFilePath } from "./entity-file.js";

function now() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function createAuditTrace(input = {}) {
  const createdAt = input.createdAt || now();
  return {
    schemaVersion: 1,
    traceId: input.traceId || `audit:${input.taskId || "task"}:${Date.now()}`,
    taskId: input.taskId || null,
    runId: input.runId || null,
    events: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function appendAuditEvent(trace = {}, event = {}) {
  const at = event.at || now();
  // Shallow-copy: prior events are append-only and never mutated, so re-deep-cloning
  // the whole history on every append made a long run O(events²).
  return {
    ...trace,
    events: [...(trace.events || []), { at, type: event.type || "event", node: event.node || null, state: event.state || null, summary: event.summary || "", data: event.data ? clone(event.data) : {} }],
    updatedAt: at,
  };
}

function auditTracePath(baseDir, taskId) {
  return entityFilePath(path.join(baseDir, "audit"), taskId, { fallback: "task" });
}

export function saveAuditTrace(baseDir, trace = {}) {
  if (!trace.taskId) throw new Error("trace taskId missing");
  const file = auditTracePath(baseDir, trace.taskId);
  writeJson(file, trace);
  cleanupMatchingLegacyEntityFile(path.join(baseDir, "audit"), trace.taskId, { fallback: "task", idField: "taskId" });
  return { ok: true, path: file };
}

export function loadAuditTrace(baseDir, taskId) {
  try {
    const file = resolveEntityFilePath(path.join(baseDir, "audit"), taskId, { fallback: "task", idField: "taskId" });
    const trace = JSON.parse(fs.readFileSync(file, "utf-8"));
    return trace?.taskId === taskId ? trace : null;
  } catch { return null; }
}

export function summarizeAuditTrace(trace = {}) {
  const events = trace.events || [];
  const byType = {};
  for (const event of events) byType[event.type] = (byType[event.type] || 0) + 1;
  return {
    traceId: trace.traceId || null,
    taskId: trace.taskId || null,
    runId: trace.runId || null,
    eventCount: events.length,
    byType,
    firstAt: events[0]?.at || null,
    lastAt: events.at(-1)?.at || null,
  };
}
