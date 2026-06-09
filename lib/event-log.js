import fs from "fs";
import path from "path";
import crypto from "crypto";
import { learnerDir, readJson } from "./common.js";

const DEFAULT_MAX_EVENTS = 5000;

export function eventLogPath(baseDir = learnerDir()) {
  return path.join(baseDir, "event_log.jsonl");
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

export function appendEvent(baseDir, event = {}) {
  fs.mkdirSync(baseDir, { recursive: true });
  const next = {
    id: event.id || eventId({ ...event, date: event.date || new Date().toISOString() }),
    date: event.date || new Date().toISOString(),
    actor: event.actor || "runtime",
    type: event.type || "unknown",
    entityType: event.entityType || "unknown",
    entityId: event.entityId || null,
    summary: event.summary || "",
    data: event.data || {},
  };
  fs.appendFileSync(eventLogPath(baseDir), `${JSON.stringify(next)}\n`, "utf-8");
  return next;
}

export function readEvents(baseDir = learnerDir(), { limit = 200, type = null, entityId = null } = {}) {
  const file = eventLogPath(baseDir);
  if (!fs.existsSync(file)) return [];
  const rows = [];
  const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  for (const line of lines.slice(-Math.max(limit * 4, limit))) {
    try {
      const row = JSON.parse(line);
      if (type && row.type !== type) continue;
      if (entityId && row.entityId !== entityId) continue;
      rows.push(row);
    } catch {}
  }
  return rows.slice(-limit).reverse();
}

export function pruneEventLog(baseDir = learnerDir(), { keep = DEFAULT_MAX_EVENTS } = {}) {
  const file = eventLogPath(baseDir);
  if (!fs.existsSync(file)) return 0;
  const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  if (lines.length <= keep) return 0;
  const kept = lines.slice(-keep);
  fs.writeFileSync(file, `${kept.join("\n")}\n`, "utf-8");
  return lines.length - kept.length;
}

export function eventSummary(baseDir = learnerDir()) {
  const events = readEvents(baseDir, { limit: DEFAULT_MAX_EVENTS });
  return replayEventState(events);
}

export function replayEventState(events = []) {
  const ordered = [...(events || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
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
