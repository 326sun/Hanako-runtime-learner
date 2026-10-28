import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeJson } from "../lib/json-io.js";
import { readEffectiveMemories, readMemoryState, upsertMemory, deleteMemory } from "../lib/managed-memory-store.js";
import { MEMORY_CATEGORIES } from "../lib/managed-memory-schema.js";
import { previewMemoryImport, applyMemoryImport, createMemoryBundle, approveMemory } from "../lib/memory-exchange.js";
import { searchLongMemories } from "../lib/long-memory-retrieval.js";
import { inferScope, normalizeScope, memoryScopeVisible } from "../lib/scope.js";
import { episodesForEvidence, readEpisodes } from "../lib/episode-ledger.js";
import { memoryTier } from "../lib/memory-relations.js";
import { toolPaths, loadConfig } from "./_shared.js";

export const name = "self_learning_memory";
export const description = "内部共享的记忆管理实现；App 注册时拆成 self_learning_memory（只读）与 self_learning_memory_manage（写入需审阅）。";
export const sessionPermission = { kind: "external_side_effect" };
export const parameters = {
  type: "object", additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["list", "get", "search", "upsert", "delete", "export", "preview_import", "import", "approve", "history", "provenance", "episodes"] },
    id: { type: "string", description: "get/delete/approve/history 必填；修改时也可传 memory.id" },
    query: { type: "string" }, project: { type: "string" }, taskType: { type: "string" },
    type: { type: "string", enum: MEMORY_CATEGORIES },
    memoryLayer: { type: "string", enum: ["all", "core", "archive"] },
    memory: { type: "object", description: "只接受内容字段；type、desc、fix、summary、aliases、tags、keywords、scope、subject/predicate/object、validFrom/validTo；修改可只传 id 与要改的字段。", additionalProperties: true },
    bundle: { type: "object", additionalProperties: true },
    previewId: { type: "string", description: "import 必填，来自同一包、当前数据版本的 preview_import" },
    includeInactive: { type: "boolean", description: "list/export 是否包括被替代或拒绝的记忆，默认 false" },
    offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 200 },
  }, required: ["action"],
};
const result = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: data });
const boundedInt = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Math.floor(Number(value)))) : fallback;
function displayMemory(row) { const { history, ...publicRow } = row; return publicRow; }
function sessionProject(ctx) { return inferScope({ sessionPath: ctx?.sessionPath || null }).project; }
function requestedProject(input, ctx) {
  const active = sessionProject(ctx);
  if (input.project && normalizeScope({ project: input.project }).project !== active) throw new Error("project selector cannot override the active session scope");
  return active;
}
function visibleInProject(row, project) { return memoryScopeVisible(row.scope || row.context, project); }
function scopedRows(items, input, ctx) {
  const project = requestedProject(input, ctx);
  return items.filter((row) => visibleInProject(row, project)
    && (!input.taskType || (row.scope?.taskType || "general") === input.taskType)
    && (!input.type || (row.memoryCategory || row.type) === input.type)
    && (!input.memoryLayer || input.memoryLayer === "all" || memoryTier(row) === input.memoryLayer));
}
function activeRow(row) {
  if (["superseded", "rejected"].includes(row.status) || row.supersededBy) return false;
  const to = row.validTo || row.scope?.validTo;
  return !to || Date.parse(to) > Date.now();
}
async function run(input, ctx) {
  const p = toolPaths(ctx), dir = p.learnerDir;
  switch (input.action) {
    case "search": {
      if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 4000) throw new Error("search requires a nonempty query of at most 4000 characters");
      const found = searchLongMemories(readEffectiveMemories(dir), input.query, { config: loadConfig(p.configPath),
        project: requestedProject(input, ctx),
        taskType: input.taskType || null, type: input.type || null, memoryLayer: input.memoryLayer || "all",
        limit: Math.max(1, boundedInt(input.limit, 10, 50)) });
      return { ok: true, queryScope: found.queryScope, count: found.results.length, memories: found.results };
    }
    case "list": {
      let rows = scopedRows(readEffectiveMemories(dir), input, ctx);
      if (!input.includeInactive) rows = rows.filter(activeRow);
      if (input.query) rows = rows.filter((row) => JSON.stringify(displayMemory(row)).toLowerCase().includes(String(input.query).toLowerCase()));
      const offset = boundedInt(input.offset, 0, Number.MAX_SAFE_INTEGER), limit = Math.max(1, boundedInt(input.limit, 50, 200));
      return { ok: true, revision: readMemoryState(dir).revision, count: rows.length, offset,
        nextOffset: offset + limit < rows.length ? offset + limit : null, memories: rows.slice(offset, offset + limit).map(displayMemory) };
    }
    case "get":
    case "history":
    case "provenance": {
      if (!input.id) throw new Error("id is required");
      const row = readEffectiveMemories(dir).find((item) => item.id === input.id && visibleInProject(item, requestedProject(input, ctx)));
      if (!row) throw new Error(`memory not found in the active project scope`);
      if (input.action === "provenance") {
        const ids = [...new Set([...(row.sourceRefs || []), ...(row.evidence || []).map((evidence) => evidence?.id).filter(Boolean)])];
        return { ok: true, id: row.id,
        sources: (await episodesForEvidence(dir, ids.map((id) => ({ id })), { limit: boundedInt(input.limit, 50, 200), project: requestedProject(input, ctx) }))
          .filter((episode) => [row.scope?.project || "general", "general", "global"].includes(episode.project || "general")
            && (!(row.scope?.taskType && row.scope.taskType !== "general") || episode.taskType === row.scope.taskType)),
        note: "Episode records contain bounded task/tool summaries and opaque session hashes, not original transcript text." };
      }
      if (input.action === "get") return { ok: true, memory: displayMemory(row) };
      return { ok: true, id: row.id, history: row.history || [], supersedes: row.supersedes || [], supersededBy: row.supersededBy || null };
    }
    case "episodes": {
      const limit = boundedInt(input.limit, 50, 200), project = requestedProject(input, ctx);
      const episodes = await readEpisodes(dir, { limit, project });
      return { ok: true, count: episodes.length, episodes };
    }
    case "upsert": {
      const project = sessionProject(ctx);
      const memoryInput = { ...(input.memory || {}), scope: { ...(input.memory?.scope || {}), project: input.memory?.scope?.project || project } };
      const saved = upsertMemory(dir, input.id ? { ...memoryInput, id: input.id } : memoryInput, { project });
      return { ...saved, memory: displayMemory(saved.memory), status: saved.memory.status, type: saved.memory.type };
    }
    case "delete": return deleteMemory(dir, input.id, { project: sessionProject(ctx) });
    case "approve": return approveMemory(dir, input.id, { project: sessionProject(ctx) });
    case "preview_import": return previewMemoryImport(dir, input.bundle, { project: sessionProject(ctx) });
    case "import": return applyMemoryImport(dir, input.bundle, input.previewId, { project: sessionProject(ctx) });
    case "export": {
      const bundle = createMemoryBundle(dir, { includeInactive: input.includeInactive === true, project: sessionProject(ctx) });
      const filePath = path.join(dir, "exports", `memory-export-${randomUUID()}.json`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true }); writeJson(filePath, bundle);
      const staged = typeof ctx?.stageFile === "function" ? await ctx.stageFile({ filePath, label: path.basename(filePath) }) : null;
      return { ok: true, path: filePath, count: bundle.memories.length, format: bundle.format, version: bundle.version,
        ...(staged ? { staged, ...(staged.mediaItem ? { media: { items: [staged.mediaItem] } } : {}) } : {}) };
    }
    default: throw new Error(`unknown memory action: ${input.action}`);
  }
}
export async function execute(input = {}, ctx = {}) { return result(await run(input, ctx)); }
