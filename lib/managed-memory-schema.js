import { randomUUID } from "node:crypto";
import { slugifyProject } from "./scope.js";

export const MEMORY_CATEGORIES = ["preference", "fact", "project_state", "workflow", "error", "event", "other"];
export const CONTENT_FIELDS = ["type", "memoryCategory", "memoryTier", "desc", "fix", "summary", "aliases", "entities", "relations", "sourceRefs", "tags", "keywords", "scope", "subject", "predicate", "object", "validFrom", "validTo"];
const allowed = new Set(["id", ...CONTENT_FIELDS, "metadata"]);
export function assertPlain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be a plain object`);
  if (Object.keys(value).some((key) => ["__proto__", "constructor", "prototype"].includes(key))) throw new Error(`${label} has a forbidden key`);
}
function boundedText(value, label, max = 8000, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max || /\u0000/.test(value)) throw new Error(`${label} must be ${required ? "nonempty " : ""}text of at most ${max} characters`);
  return value.trim();
}
function timestamp(value, label) {
  if (value == null) return null;
  const result = boundedText(value, label, 64, true);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be a valid timestamp`);
  return new Date(result).toISOString();
}
function textList(value, label) {
  if (!Array.isArray(value) || value.length > 40) throw new Error(`${label} must contain at most 40 strings`);
  return [...new Set(value.map((item) => boundedText(item, label, 160, true)))];
}
export function normalizeMemory(input, existing = null) {
  assertPlain(input, "memory");
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`memory field is not editable: ${key}`);
  const category = input.memoryCategory || input.type || existing?.memoryCategory || (MEMORY_CATEGORIES.includes(existing?.type) ? existing.type : "other");
  if (!MEMORY_CATEGORIES.includes(category)) throw new Error(`unsupported memory type: ${category}`);
  if (input.type && input.memoryCategory && input.type !== input.memoryCategory) throw new Error("type and memoryCategory must agree");
  if (input.metadata != null) {
    assertPlain(input.metadata, "metadata");
    if (Object.keys(input.metadata).some((key) => !["aliases", "summary"].includes(key))) throw new Error("Only metadata.aliases and metadata.summary are supported");
    if (input.summary != null && input.metadata.summary != null && input.summary !== input.metadata.summary) throw new Error("summary fields must agree");
    if (input.aliases != null && input.metadata.aliases != null && JSON.stringify(input.aliases) !== JSON.stringify(input.metadata.aliases)) throw new Error("aliases fields must agree");
  }
  if (input.scope) assertPlain(input.scope, "scope");
  const scopeInput = { ...(existing?.scope || {}), ...(input.scope || {}) };
  assertPlain(scopeInput, "scope");
  const scope = { project: boundedText(scopeInput.project || "general", "scope.project", 256, true),
    taskType: boundedText(scopeInput.taskType || "general", "scope.taskType", 128, true) };
  scope.project = slugifyProject(scope.project);
  if (!scope.project) throw new Error("scope.project must identify a project");
  const now = new Date().toISOString();
  const result = { id: boundedText(input.id || existing?.id || `manual:${randomUUID()}`, "id", 240, true),
    type: category, memoryCategory: category, scope,
    status: existing?.status || "approved", count: existing?.count || 1, score: existing?.score || 10,
    source: existing?.source || "user", firstSeen: existing?.firstSeen || now, lastSeen: now, updatedByUser: true };
  for (const key of ["desc", "fix", "subject", "predicate", "object"]) {
    if (Object.hasOwn(input, key) || existing?.[key] != null) result[key] = boundedText(input[key] ?? existing?.[key], key, key === "subject" || key === "predicate" ? 512 : 8000);
  }
  const summaryValue = input.summary ?? input.metadata?.summary ?? existing?.summary ?? existing?.metadata?.summary;
  if (summaryValue != null) result.summary = boundedText(summaryValue, "summary", 8000);
  for (const key of ["aliases", "entities", "tags", "keywords", "sourceRefs"]) {
    const value = key === "aliases" ? input.aliases ?? input.metadata?.aliases ?? existing?.aliases ?? existing?.metadata?.aliases : input[key] ?? existing?.[key];
    if (value != null) result[key] = textList(value, key);
  }
  if (input.relations != null || existing?.relations) {
    const relations = input.relations ?? existing.relations;
    if (!Array.isArray(relations) || relations.length > 80) throw new Error("relations must be an array of at most 80 rows");
    result.relations = relations.map((relation) => {
      assertPlain(relation, "relation");
      if (Object.keys(relation).some((key) => !["targetId", "type", "label", "weight"].includes(key))) throw new Error("unsupported relation field");
      const targetId = boundedText(relation.targetId, "relation.targetId", 240, true);
      const type = boundedText(relation.type || "related_to", "relation.type", 64, true);
      const label = boundedText(relation.label || type, "relation.label", 160, true);
      const weight = relation.weight == null ? 0.2 : Number(relation.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("relation.weight must be between 0 and 1");
      return { targetId, type, label, weight };
    });
  }
  if (input.memoryTier != null && !["core", "archive"].includes(input.memoryTier)) throw new Error("memoryTier must be core or archive");
  result.memoryTier = input.memoryTier || existing?.memoryTier || (["preference", "fact", "project_state"].includes(category) ? "core" : "archive");
  for (const key of ["validFrom", "validTo"]) {
    const value = Object.hasOwn(input, key) ? input[key] : scopeInput[key] ?? existing?.[key];
    if (value !== undefined) result[key] = timestamp(value, key);
    if (result[key]) result.scope[key] = result[key];
  }
  if (result.validFrom && result.validTo && Date.parse(result.validFrom) >= Date.parse(result.validTo)) throw new Error("validTo must be later than validFrom");
  if (category === "fact") {
    for (const key of ["subject", "predicate", "object"]) boundedText(result[key], key, key === "object" ? 8000 : 512, true);
    result.desc = `${result.subject} ${result.predicate}: ${result.object}`;
    result.fix = `${result.subject} 的 ${result.predicate} 当前为 ${result.object}`;
    result.validFrom ||= now;
    result.scope.validFrom = result.validFrom;
    result.validTo ??= null;
  } else if (!(result.desc || result.fix || result.summary)) throw new Error("memory.desc, memory.fix or memory.summary is required");
  if (category === "preference") result.knowledgeTier = "durable";
  else result.knowledgeTier = "core";
  if (existing?.requiresReview) result.requiresReview = true;
  return result;
}

export function exportableMemory(item) {
  const category = item.memoryCategory || (MEMORY_CATEGORIES.includes(item.type) ? item.type : "other");
  const output = { id: item.id, type: category };
  for (const key of CONTENT_FIELDS) if (key !== "type" && key !== "memoryCategory" && key !== "aliases" && key !== "summary" && item[key] !== undefined) output[key] = structuredClone(item[key]);
  const aliases = item.aliases ?? item.metadata?.aliases;
  const summary = item.summary ?? item.metadata?.summary;
  if (aliases !== undefined) output.aliases = structuredClone(aliases);
  if (summary !== undefined) output.summary = structuredClone(summary);
  // Context, evidence, histories and approval metadata are deliberately not portable.
  return output;
}
