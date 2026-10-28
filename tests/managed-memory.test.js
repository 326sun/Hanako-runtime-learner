import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { upsertMemory, deleteMemory, readEffectiveMemories, readMemoryState } from "../lib/managed-memory-store.js";
import { previewMemoryImport, applyMemoryImport, approveMemory, createMemoryBundle } from "../lib/memory-exchange.js";

function temp(test) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learner-managed-"));
  try { return test(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const bundle = (memories) => ({ format: "hanako-self-learning-memory", version: 2, memories });
const preference = (id, desc = "使用三线表") => ({ id, type: "preference", desc, fix: desc });
describe("managed memory persistence", () => {
  it("keeps edits and deletions after the legacy detector rewrites its store", () => temp((dir) => {
    const legacy = [{ id: "legacy:p", type: "preference", desc: "old", fix: "old", status: "approved", score: 30 }];
    const file = path.join(dir, "patterns.json"); fs.writeFileSync(file, JSON.stringify(legacy));
    upsertMemory(dir, { id: "legacy:p", desc: "new", fix: "new" });
    fs.writeFileSync(file, JSON.stringify(legacy));
    assert.equal(readEffectiveMemories(dir)[0].fix, "new");
    deleteMemory(dir, "legacy:p"); fs.writeFileSync(file, JSON.stringify(legacy));
    assert.equal(readEffectiveMemories(dir).length, 0);
    assert.match(readMemoryState(dir).deleted[0], /^sha256:/);
  }));
  it("keeps provenance source references and validates relation graph edges", () => temp((dir) => {
    const a = upsertMemory(dir, { id: "a", type: "fact", subject: "Atlas", predicate: "owner", object: "Sun" });
    assert.throws(() => upsertMemory(dir, { id: "a", sourceRefs: ["forged-episode-id"] }), /cannot be edited directly/);
    upsertMemory(dir, { id: "b", type: "other", desc: "Contact preference", entities: ["Sun"] });
    const linked = upsertMemory(dir, { id: "a", relations: [{ targetId: "b", type: "related_to", label: "owner preference", weight: 0.8 }] });
    assert.equal(linked.memory.relations[0].targetId, "b");
    assert.throws(() => upsertMemory(dir, { id: "a", relations: [{ targetId: "missing", type: "related_to" }] }), /target not found/);
    assert.throws(() => upsertMemory(dir, { id: "a", relations: [{ targetId: "a", type: "related_to" }] }), /cannot link to itself/);
  }));
  it("patches content, keeps history, and rejects governance payloads", () => temp((dir) => {
    upsertMemory(dir, preference("p"));
    const next = upsertMemory(dir, { id: "p", desc: "只改格式", aliases: ["排版规则"] });
    assert.equal(next.memory.history.length, 1); assert.equal(next.memory.fix, "使用三线表");
    assert.throws(() => upsertMemory(dir, { id: "p", score: 900, desc: "injection" }), /not editable/);
    assert.throws(() => upsertMemory(dir, { id: "p", scope: { project: 8 } }), /text/);
    assert.throws(() => upsertMemory(dir, { id: "p", validTo: "bad" }), /timestamp/);
  }));
  it("versions facts and keeps the old assertion inactive", () => temp((dir) => {
    const a = upsertMemory(dir, { type: "fact", subject: "robot", predicate: "controller", object: "A" });
    const b = upsertMemory(dir, { id: a.id, object: "B" });
    assert.notEqual(a.id, b.id); assert.deepEqual(b.superseded, [a.id]);
    const rows = readEffectiveMemories(dir); assert.equal(rows.find((r) => r.id === a.id).status, "superseded");
    assert.equal(rows.find((r) => r.id === b.id).object, "B");
  }));
  it("does not treat a corrupt managed state as empty", () => temp((dir) => {
    fs.writeFileSync(path.join(dir, "memory-state.json"), "[");
    assert.throws(() => upsertMemory(dir, preference("p")), SyntaxError);
    assert.equal(fs.readFileSync(path.join(dir, "memory-state.json"), "utf8"), "[");
  }));
});
describe("memory exchange governance", () => {
  it("requires preview bound to exact content and current data", () => temp((dir) => {
    const incoming = bundle([preference("p")]);
    assert.throws(() => applyMemoryImport(dir, incoming), /previewId/);
    const preview = previewMemoryImport(dir, incoming);
    assert.throws(() => applyMemoryImport(dir, bundle([preference("p", "changed")]), preview.previewId), /previewId/);
    upsertMemory(dir, preference("local"));
    assert.throws(() => applyMemoryImport(dir, incoming, preview.previewId), /changed/);
  }));
  it("imports pending and only explicit approval activates a fact", () => temp((dir) => {
    const a = upsertMemory(dir, { type: "fact", subject: "robot", predicate: "controller", object: "A" });
    const incoming = bundle([{ id: "external:b", type: "fact", subject: "robot", predicate: "controller", object: "B" }]);
    const preview = previewMemoryImport(dir, incoming);
    assert.equal(preview.conflicts[0].kind, "fact_value");
    const applied = applyMemoryImport(dir, incoming, preview.previewId); assert.equal(applied.imported, 1);
    let rows = readEffectiveMemories(dir);
    assert.equal(rows.find((r) => r.id === a.id).status, "approved");
    assert.equal(rows.find((r) => r.id === "external:b").status, "pending");
    approveMemory(dir, "external:b"); rows = readEffectiveMemories(dir);
    assert.equal(rows.find((r) => r.id === a.id).status, "superseded");
  }));
  it("keeps pending fact edits pending and refuses expired fact activation", () => temp((dir) => {
    const active = upsertMemory(dir, { type: "fact", subject: "robot", predicate: "controller", object: "A" });
    const input = bundle([{ id: "expired", type: "fact", subject: "robot", predicate: "controller", object: "B", validFrom: "2020-01-01", validTo: "2021-01-01" }]);
    const preview = previewMemoryImport(dir, input); applyMemoryImport(dir, input, preview.previewId);
    const edited = upsertMemory(dir, { id: "expired", tags: ["reviewed"] });
    assert.equal(edited.id, "expired"); assert.equal(edited.memory.status, "pending");
    assert.equal(readEffectiveMemories(dir).find((row) => row.id === active.id).status, "approved");
    assert.throws(() => approveMemory(dir, "expired"), /expired/);
  }));
  it("refuses to rebind a pending fact candidate to an active identical assertion", () => temp((dir) => {
    const active = upsertMemory(dir, { type: "fact", subject: "robot", predicate: "controller", object: "A" });
    const bundleData = bundle([{ id: "candidate", type: "fact", subject: "robot", predicate: "controller", object: "A", aliases: ["same assertion"] }]);
    const preview = previewMemoryImport(dir, bundleData); applyMemoryImport(dir, bundleData, preview.previewId);
    const candidate = upsertMemory(dir, { id: "candidate", tags: ["reviewed"] });
    assert.equal(candidate.id, "candidate"); assert.equal(candidate.memory.status, "pending");
    assert.equal(readEffectiveMemories(dir).find((row) => row.id === active.id).status, "approved");
  }));
  it("validates imported relation targets and forbids cross-project graph edges", () => temp((dir) => {
    assert.throws(() => previewMemoryImport(dir, bundle([{ id: "a", type: "other", desc: "A", relations: [{ targetId: "missing", type: "related_to" }] }])), /relation target not found/);
    assert.throws(() => previewMemoryImport(dir, bundle([
      { id: "a", type: "other", desc: "A", scope: { project: "alpha", taskType: "general" }, relations: [{ targetId: "b", type: "related_to" }] },
      { id: "b", type: "other", desc: "B", scope: { project: "beta", taskType: "general" } },
    ])), /Cross-project/);
  }));
  it("does not deduplicate memories with different summaries or aliases", () => temp((dir) => {
    const input = bundle([{ id: "a", type: "other", summary: "Project A", aliases: ["甲"] }, { id: "b", type: "other", summary: "Project B", aliases: ["乙"] }]);
    const preview = previewMemoryImport(dir, input); assert.equal(preview.counts.add, 2);
  }));
  it("skips conflicting IDs and rejects duplicate IDs in the same bundle", () => temp((dir) => {
    upsertMemory(dir, preference("existing", "original"));
    const incoming = bundle([preference("existing", "overwrite"), preference("new")]);
    const preview = previewMemoryImport(dir, incoming); assert.equal(preview.conflicts[0].kind, "id");
    applyMemoryImport(dir, incoming, preview.previewId);
    assert.equal(readEffectiveMemories(dir).find((r) => r.id === "existing").desc, "original");
    assert.throws(() => previewMemoryImport(dir, bundle([preference("same"), preference("same")])), /Duplicate id/);
  }));
  it("exports only the active project and blocks cross-project bundle import", () => temp((dir) => {
    upsertMemory(dir, { id: "general", type: "preference", desc: "Shared language" });
    upsertMemory(dir, { id: "alpha", type: "other", desc: "Alpha note", scope: { project: "alpha", taskType: "general" } });
    const output = createMemoryBundle(dir, { project: "alpha" });
    assert.deepEqual(new Set(output.memories.map((row) => row.desc)), new Set(["Shared language", "Alpha note"]));
    const foreign = preference("foreign", "private"); foreign.scope = { project: "beta", taskType: "general" };
    assert.throws(() => previewMemoryImport(dir, bundle([foreign]), { project: "alpha" }), /outside the active project/);
    assert.throws(() => applyMemoryImport(dir, output, "none", { project: "beta" }), /outside the active project/);
  }));
  it("exports portable data without audit/history, remaps relation IDs and restores through review", () => temp((dir) => {
    upsertMemory(dir, preference("p")); upsertMemory(dir, { id: "p", desc: "updated" });
    upsertMemory(dir, { id: "related", type: "other", desc: "related note" });
    upsertMemory(dir, { id: "p", relations: [{ targetId: "related", type: "related_to" }] });
    const output = createMemoryBundle(dir); assert.equal(output.memories.length, 2);
    assert.notEqual(output.memories.find((row) => row.desc === "updated").id, "p");
    assert.equal(output.memories.find((row) => row.desc === "updated").relations[0].targetId, output.memories.find((row) => row.desc === "related note").id);
    assert.equal(output.memories[0].history, undefined); assert.equal(output.memories[0].status, undefined);
    temp((target) => {
      const preview = previewMemoryImport(target, output); applyMemoryImport(target, output, preview.previewId);
      assert.equal(readEffectiveMemories(target).length, 2);
      const importedId = output.memories.find((row) => row.desc === "updated").id;
      assert.equal(readEffectiveMemories(target).find((row) => row.id === importedId).status, "pending");
      approveMemory(target, importedId); assert.equal(readEffectiveMemories(target).find((row) => row.id === importedId).status, "approved");
    });
  }));
  it("removes dangling relation edges when the target is inactive or excluded from an export", () => temp((dir) => {
    upsertMemory(dir, { id: "source", type: "other", desc: "Current note" });
    upsertMemory(dir, { id: "retired-target", type: "other", desc: "retired target" });
    upsertMemory(dir, { id: "source", relations: [{ targetId: "retired-target", type: "related_to" }] });
    deleteMemory(dir, "retired-target");
    const output = createMemoryBundle(dir);
    assert.equal(output.memories.length, 1);
    assert.deepEqual(output.memories[0].relations, []);
    temp((target) => { const preview = previewMemoryImport(target, output); assert.equal(preview.counts.add, 1); });
  }));
  it("accepts v1 backups while discarding untrusted ranking and approval fields", () => temp((dir) => {
    const input = { format: "hanako-self-learning-memory", version: 1,
      patterns: [{ ...preference("p"), score: 900, status: "approved", count: 1000 }], facts: [] };
    const preview = previewMemoryImport(dir, input); applyMemoryImport(dir, input, preview.previewId);
    const row = readEffectiveMemories(dir)[0]; assert.equal(row.status, "pending"); assert.equal(row.score, 10);
    assert.equal(row.requiresReview, true);
  }));
});
