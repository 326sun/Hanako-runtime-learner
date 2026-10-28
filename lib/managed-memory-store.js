import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { writeJson } from "./json-io.js";
import { withDataLock } from "./state-lock.js";
import { factToMemoryItem } from "./facts.js";
import { isActiveFact } from "./temporal.js";
import { normalizeMemory } from "./managed-memory-schema.js";
import { episodeIdForTask } from "./episode-ledger.js";
import { canManageMemoryScope } from "./scope.js";

export { normalizeMemory } from "./managed-memory-schema.js";
export const memoryStatePath = (dir) => path.join(dir, "memory-state.json");
const tombstoneKey = (id) => `sha256:${createHash("sha256").update(String(id)).digest("hex")}`;
export function readMemoryState(dir) {
  const file = memoryStatePath(dir);
  if (!fs.existsSync(file)) return { schemaVersion: 1, revision: 0, records: [], deleted: [], audit: [] };
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state?.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.records) || !Array.isArray(state.deleted)) throw new Error("Invalid memory-state.json; restore a verified backup before writing");
  if (state.records.some((row) => !row || typeof row.id !== "string") || state.deleted.some((id) => typeof id !== "string")) throw new Error("Invalid memory records or tombstones");
  return state;
}
function readRows(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return [];
  const value = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!Array.isArray(value)) throw new Error(`${file} must be an array`);
  return value;
}
export function effectiveMemories(dir, state) {
  const byId = new Map(readRows(dir, "patterns.json").filter((row) => row?.id).map((row) => [row.id, row]));
  for (const fact of readRows(dir, "facts.json")) if (fact?.id) {
    byId.set(fact.id, { ...fact, ...factToMemoryItem(fact), subject: fact.subject, predicate: fact.predicate, object: fact.object,
      validFrom: fact.validFrom, validTo: fact.validTo, firstSeen: fact.validFrom, lastSeen: fact.validFrom });
  }
  for (const row of state.records) byId.set(row.id, row);
  for (const [id, original] of byId) {
    const row = { ...original };
    if (Array.isArray(row.evidence)) row.evidence = row.evidence.map((evidence) => ["experience_log.jsonl", "error_log.jsonl"].includes(evidence?.file) && typeof evidence.id === "string"
      ? { ...evidence, id: episodeIdForTask(evidence.id), sourceRef: episodeIdForTask(evidence.id) }
      : evidence);
    const inferredRefs = Array.isArray(original.evidence) ? original.evidence.filter((evidence) => ["experience_log.jsonl", "error_log.jsonl"].includes(evidence?.file) && typeof evidence.id === "string").map((evidence) => episodeIdForTask(evidence.id)) : [];
    row.sourceRefs = [...new Set([...(Array.isArray(row.sourceRefs) ? row.sourceRefs : []), ...inferredRefs])].slice(0, 20);
    byId.set(id, row);
  }
  const deleted = new Set(state.deleted);
  for (const id of byId.keys()) if (deleted.has(id) || deleted.has(tombstoneKey(id))) byId.delete(id);
  return [...byId.values()];
}
export function readEffectiveMemories(dir) { return effectiveMemories(dir, readMemoryState(dir)); }
export function mutateMemoryState(dir, callback) {
  return withDataLock(dir, "managed-memory", () => {
    const state = readMemoryState(dir);
    const result = callback({ state, items: effectiveMemories(dir, state) });
    if (result && typeof result.then === "function") throw new Error("Memory transaction callback must be synchronous");
    state.revision += 1;
    writeJson(memoryStatePath(dir), state);
    return { ...result, revision: state.revision };
  });
}
export function setManagedRecord(state, row) {
  const index = state.records.findIndex((item) => item.id === row.id);
  if (index < 0) state.records.push(row); else state.records[index] = row;
}
export function addMemoryAudit(state, action, ids) {
  const safeIds = (ids || []).map((id) => `sha256:${createHash("sha256").update(String(id)).digest("hex").slice(0, 24)}`);
  state.audit = [...(state.audit || []), { at: new Date().toISOString(), action, ids: safeIds }].slice(-1000);
}
function factKey(item) { return JSON.stringify([item.scope?.project || "general", item.subject, item.predicate]); }
export function upsertMemory(dir, input, { project = null } = {}) {
  if (input && Object.hasOwn(input, "sourceRefs")) throw new Error("sourceRefs are generated from local episode evidence and cannot be edited directly");
  return mutateMemoryState(dir, ({ state, items }) => {
    const existing = input?.id ? items.find((row) => row.id === input.id) : null;
    let record = normalizeMemory(input, existing);
    if (existing) assertMemoryProject(existing, project);
    if (existing && (existing.type === "fact") !== (record.type === "fact")) throw new Error("Changing between facts and patterns is not supported; create a separate memory");
    if (existing && (existing.scope?.project || existing.context?.project || "general") !== (record.scope?.project || "general")) throw new Error("memory project scope is immutable; create a separate memory in the intended scope");
    if (project && !canManageMemoryScope(record.scope?.project || "general", project)) throw new Error("new memory must match the active project scope");
    if (existing?.type === "fact" && factKey(existing) !== factKey(record)) throw new Error("A fact subject, predicate and project are immutable; create a new fact instead");
    const now = new Date().toISOString();
    const superseded = [];
    if (existing?.requiresReview && existing.status !== "approved") {
      const pending = { ...record, id: existing.id, status: "pending", requiresReview: true, updatedAt: now };
      setManagedRecord(state, pending);
      addMemoryAudit(state, "edit_candidate", [pending.id]);
      return { ok: true, id: pending.id, memory: pending, superseded: [], action: "updated" };
    }
    if (record.type === "fact") {
      if (!isActiveFact(record)) throw new Error("An expired or future fact cannot replace the active fact");
      const active = items.filter((row) => row.type === "fact" && factKey(row) === factKey(record) && isActiveFact(row) && !["rejected", "pending"].includes(row.status));
      const same = active.find((row) => row.object === record.object);
      if (existing?.requiresReview && same && same.id !== existing.id) throw new Error(`An active fact with this value already exists: ${same.id}`);
      if (same) record = { ...record, id: same.id, status: same.status, requiresReview: same.requiresReview || false,
        validFrom: same.validFrom, validTo: same.validTo, scope: { ...record.scope, validFrom: same.scope?.validFrom || same.validFrom, validTo: same.scope?.validTo || same.validTo },
        firstSeen: same.firstSeen || record.firstSeen };
      else if (existing) record = { ...record, id: `manual:${randomUUID()}`, status: "approved", validFrom: now,
        scope: { ...record.scope, validFrom: now, validTo: undefined }, validTo: null };
      for (const old of active) {
        if (old.id === record.id) continue;
        setManagedRecord(state, { ...old, status: "superseded", supersededBy: record.id, validTo: record.validFrom || now,
          learnedValidTo: now, scope: { ...old.scope, validTo: record.validFrom || now } });
        superseded.push(old.id);
      }
      record.supersedes = superseded;
    }
    if (existing && existing.id === record.id) {
      const { history, ...previous } = existing;
      record.history = [...(history || []), { changedAt: now, memory: previous }].slice(-10);
    }
    record.updatedAt = now;
    if (record.type === "fact" && !record.learnedAt) record.learnedAt = now;
    if (Array.isArray(record.relations)) {
      for (const edge of record.relations) {
        if (edge.targetId === record.id) throw new Error("A memory cannot link to itself");
        const target = items.find((item) => item.id === edge.targetId);
        if (!target) throw new Error(`relation target not found: ${edge.targetId}`);
        const sourceProject = record.scope?.project || "general", targetProject = target.scope?.project || "general";
        if (sourceProject !== targetProject && ![sourceProject, targetProject].some((scope) => ["general", "global"].includes(scope))) throw new Error("Cross-project memory links are blocked");
      }
    }
    setManagedRecord(state, record);
    state.deleted = state.deleted.filter((id) => id !== record.id && id !== tombstoneKey(record.id));
    addMemoryAudit(state, "upsert", [record.id, ...superseded]);
    return { ok: true, id: record.id, memory: record, superseded, action: existing ? "updated" : "added" };
  });
}
function assertMemoryProject(row, project) {
  if (!project) return;
  const target = row.scope?.project || row.context?.project || "general";
  if (!canManageMemoryScope(target, project)) throw new Error("memory belongs to another project scope");
}
export function deleteMemory(dir, id, { project = null } = {}) {
  if (typeof id !== "string" || !id) throw new Error("id is required");
  const auditId = `id:${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
  return mutateMemoryState(dir, ({ state, items }) => {
    const target = items.find((row) => row.id === id);
    if (!target) throw new Error("memory not found");
    assertMemoryProject(target, project);
    state.records = state.records.filter((row) => row.id !== id);
    state.deleted = [...new Set([...state.deleted, tombstoneKey(id)])];
    addMemoryAudit(state, "delete", [auditId]);
    return { ok: true, id: auditId, deleted: true, deletionMode: "logical", note: "Hidden from retrieval, hints and exports. Legacy learning files and previous external backups are retained; this is not a secure erase." };
  });
}
