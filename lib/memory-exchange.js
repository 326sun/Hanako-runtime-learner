import { createHash, randomUUID } from "node:crypto";
import { mutateMemoryState, setManagedRecord, addMemoryAudit, readEffectiveMemories, normalizeMemory } from "./managed-memory-store.js";
import { exportableMemory, assertPlain } from "./managed-memory-schema.js";
import { isActiveFact } from "./temporal.js";
import { canManageMemoryScope } from "./scope.js";

export const MEMORY_BUNDLE_FORMAT = "hanako-self-learning-memory";
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fingerprint(item) {
  return digest([item.memoryCategory || item.type, item.scope?.project || "general", item.scope?.taskType || "general",
    item.subject || "", item.predicate || "", item.object || "", item.desc || "", item.fix || "", item.summary || item.metadata?.summary || "",
    item.aliases || item.metadata?.aliases || [], item.entities || [], item.relations || [], item.sourceRefs || [], item.memoryTier || null,
    item.tags || [], item.keywords || [], item.validFrom || null, item.validTo || null]);
}
export function parseMemoryBundle(bundle) {
  assertPlain(bundle, "bundle");
  if (bundle.format !== MEMORY_BUNDLE_FORMAT || ![1, 2].includes(bundle.version)) throw new Error("Unsupported memory bundle format/version");
  if (Buffer.byteLength(JSON.stringify(bundle)) > 8 * 1024 * 1024) throw new Error("Memory bundle exceeds 8 MiB");
  let raw;
  if (bundle.version === 2) raw = bundle.memories;
  else {
    if (!Array.isArray(bundle.patterns) || !Array.isArray(bundle.facts)) throw new Error("v1 bundle requires patterns/facts arrays");
    raw = [...bundle.patterns.map(exportableMemory), ...bundle.facts.map((fact) => exportableMemory({ ...fact, type: "fact" }))];
  }
  if (!Array.isArray(raw) || raw.length > 10000) throw new Error("Memory bundle must contain at most 10000 memories");
  const ids = new Set();
  return raw.map((item) => {
    assertPlain(item, "bundle memory");
    if (typeof item.id !== "string" || !item.id) throw new Error("Each imported memory requires an id");
    if (ids.has(item.id)) throw new Error(`Duplicate id in bundle: ${item.id}`);
    ids.add(item.id);
    const normalized = normalizeMemory(item);
    // Portable bundles cannot assert local provenance. Source references are
    // host-owned and must be re-established against this installation's ledger.
    normalized.sourceRefs = [];
    return normalized;
  });
}
function makePlan(items, incoming) {
  const existing = new Map(items.map((row) => [row.id, row]));
  const signatures = new Set(items.map(fingerprint));
  const add = [], conflicts = [], skipped = [];
  const incomingFacts = new Map();
  for (const row of incoming) {
    const old = existing.get(row.id), signature = fingerprint(row);
    if (old) {
      if (fingerprint(old) === signature) skipped.push(row.id);
      else conflicts.push({ kind: "id", id: row.id, decision: "skip" });
      continue;
    }
    if (signatures.has(signature)) { skipped.push(row.id); continue; }
    if (row.type === "fact") {
      const key = JSON.stringify([row.scope.project, row.subject, row.predicate]);
      const earlier = incomingFacts.get(key);
      if (earlier && earlier.object !== row.object) conflicts.push({ kind: "bundle_fact_values", id: row.id, existingIds: [earlier.id], decision: "pending_review" });
      incomingFacts.set(key, row);
    }
    const factConflicts = row.type === "fact" ? items.filter((item) => item.type === "fact" && isActiveFact(item)
      && !["pending", "rejected"].includes(item.status) && (item.scope?.project || "general") === row.scope.project
      && item.subject === row.subject && item.predicate === row.predicate && item.object !== row.object) : [];
    if (factConflicts.length) conflicts.push({ kind: "fact_value", id: row.id, existingIds: factConflicts.map((item) => item.id), decision: "pending_review" });
    add.push(row); signatures.add(signature);
  }
  const additions = new Map(add.map((row) => [row.id, row]));
  for (const row of add) for (const edge of row.relations || []) {
    // Existing IDs win over conflicting bundle rows, because ID conflicts are
    // skipped during import and the imported target will not be installed.
    const target = existing.get(edge.targetId) || additions.get(edge.targetId);
    if (!target) throw new Error(`relation target not found in final import state: ${edge.targetId}`);
    const sourceProject = row.scope?.project || "general", targetProject = target.scope?.project || "general";
    if (sourceProject !== targetProject && ![sourceProject, targetProject].some((scope) => ["general", "global"].includes(scope))) throw new Error("Cross-project memory links are blocked");
  }
  return { add, skipped, conflicts, counts: { add: add.length, skipped: skipped.length, conflicts: conflicts.length } };
}
export function previewMemoryImport(dir, bundle, { project = null } = {}) {
  const incoming = parseMemoryBundle(bundle), bundleHash = digest(bundle);
  if (project && incoming.some((row) => !canManageMemoryScope(row.scope?.project || "general", project))) throw new Error("import contains a memory outside the active project scope");
  return mutateMemoryState(dir, ({ state, items }) => {
    const plan = makePlan(items, incoming);
    const previewId = randomUUID(), expiresAt = Date.now() + 30 * 60 * 1000;
    state.importPreviews = [...(state.importPreviews || []).filter((p) => p.expiresAt > Date.now()).slice(-9),
      { previewId, bundleHash, revision: state.revision + 1, itemsHash: digest(items), expiresAt }];
    return { ok: true, applied: false, previewId, expiresAt: new Date(expiresAt).toISOString(), counts: plan.counts,
      conflicts: plan.conflicts, additions: plan.add.map(({ id, type, desc, scope }) => ({ id, type, desc, scope })),
      note: "All additions require explicit approval; ID conflicts are skipped. This preview expires if local memory changes." };
  });
}
export function applyMemoryImport(dir, bundle, previewId, { project = null } = {}) {
  const incoming = parseMemoryBundle(bundle);
  if (project && incoming.some((row) => !canManageMemoryScope(row.scope?.project || "general", project))) throw new Error("import contains a memory outside the active project scope");
  return mutateMemoryState(dir, ({ state, items }) => {
    const preview = (state.importPreviews || []).find((row) => row.previewId === previewId);
    if (!preview || preview.expiresAt <= Date.now() || preview.bundleHash !== digest(bundle)) throw new Error("Valid previewId for this exact bundle is required; run preview_import again");
    if (preview.revision !== state.revision || preview.itemsHash !== digest(items)) throw new Error("Local memories changed since preview; run preview_import again");
    const plan = makePlan(items, incoming);
    for (const row of plan.add) {
      setManagedRecord(state, { ...row, status: "pending", requiresReview: true, source: "import", importedAt: new Date().toISOString() });
      state.deleted = state.deleted.filter((id) => id !== row.id);
    }
    state.importPreviews = [];
    addMemoryAudit(state, "import", plan.add.map((item) => item.id));
    return { ok: true, applied: true, imported: plan.add.length, counts: plan.counts, conflicts: plan.conflicts,
      reviewIds: plan.add.map((item) => item.id), note: "Imported memories are pending; approve each after reviewing its content and scope." };
  });
}
export function approveMemory(dir, id, { project = null } = {}) {
  return mutateMemoryState(dir, ({ state, items }) => {
    const row = items.find((item) => item.id === id);
    if (!row || !row.requiresReview || row.status !== "pending") throw new Error("Only a pending imported memory can be approved here");
    if (project && !canManageMemoryScope(row.scope?.project || "general", project)) throw new Error("memory belongs to another project scope");
    const approved = { ...row, status: "approved", reviewedAt: new Date().toISOString(), requiresReview: false };
    const superseded = [];
    if (row.type === "fact") {
      if (!isActiveFact(row)) throw new Error("A future, expired or superseded imported fact cannot replace the active fact");
      for (const old of items) {
        if (old.id !== id && old.type === "fact" && isActiveFact(old) && !["pending", "rejected"].includes(old.status)
          && (old.scope?.project || "general") === row.scope.project && old.subject === row.subject && old.predicate === row.predicate && old.object === row.object) {
          throw new Error(`An identical active fact already exists: ${old.id}`);
        }
      }
      for (const old of items) {
        if (old.id === id || old.type !== "fact" || !isActiveFact(old) || ["pending", "rejected"].includes(old.status)) continue;
        if ((old.scope?.project || "general") !== row.scope.project || old.subject !== row.subject || old.predicate !== row.predicate) continue;
        // Restoring history must never make an older assertion replace a more recent one.
        if (Date.parse(old.validFrom || old.scope?.validFrom || 0) > Date.parse(row.validFrom || row.scope?.validFrom || 0)) throw new Error("Imported fact is older than the active fact; edit the memory before approval");
        setManagedRecord(state, { ...old, status: "superseded", supersededBy: id, validTo: row.validFrom,
          scope: { ...old.scope, validTo: row.validFrom } });
        superseded.push(old.id);
      }
      approved.supersedes = superseded;
    }
    approved.reviewedAt = new Date().toISOString();
    if (row.type === "fact") approved.learnedAt = approved.reviewedAt;
    setManagedRecord(state, approved);
    addMemoryAudit(state, "approve", [id, ...superseded]);
    return { ok: true, id, status: "approved", superseded };
  });
}
export function createMemoryBundle(dir, { includeInactive = false, project = null } = {}) {
  const selected = readEffectiveMemories(dir).filter((row) => !project || canManageMemoryScope(row.scope?.project || "general", project))
    .filter((row) => includeInactive || !["rejected", "superseded"].includes(row.status))
    .filter((row) => includeInactive || !row.supersededBy);
  // Portable IDs are re-keyed so legacy IDs derived from user text cannot leak
  // that text into an export filename/content or a predictable dictionary hash.
  const idMap = new Map(selected.map((row) => [row.id, `portable:${randomUUID()}`]));
  const memories = selected.map((row) => {
    const portable = exportableMemory(row);
    portable.id = idMap.get(row.id);
    if (Array.isArray(portable.relations)) portable.relations = portable.relations
      .filter((edge) => idMap.has(edge.targetId))
      .map((edge) => ({ ...edge, targetId: idMap.get(edge.targetId) }));
    return portable;
  });
  const bundle = { format: MEMORY_BUNDLE_FORMAT, version: 2, exportedAt: new Date().toISOString(), memories };
  parseMemoryBundle(bundle);
  return bundle;
}
