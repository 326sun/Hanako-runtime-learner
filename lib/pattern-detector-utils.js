import { normalizeToolName, safeText, toolCategory } from "./helpers.js";

export const MAX_PATTERN_COUNT = 50;

const DURABLE_SETTING_PATTERNS = [
  /(?:请?记住|以后都|以后默认|默认使用|长期|固定|总是|每次都|作为设定|写入记忆)/i,
  /(?:remember this|from now on|always|default to|make this a setting|pin this)/i,
];

// Build the scope stamped onto a pattern from an ingested experience/error.
// Kept lean for v0.9 (project / taskType / source); temporal fields
// (validFrom / validTo) arrive with facts in v1.1.
export function scopeFrom(source) {
  const s = source?.scope || {};
  return {
    project: s.project || source?.project || "general",
    taskType: s.taskType || source?.taskType || "general",
    source: s.source || "runtime",
  };
}

export function uniqueSortedToolCategories(toolsUsed = []) {
  const seen = new Set();
  for (const tool of toolsUsed || []) {
    seen.add(toolCategory(normalizeToolName(tool)));
  }
  return [...seen].sort();
}

export function preferenceTierFromText(text, toolsUsed = []) {
  for (const tool of toolsUsed || []) {
    if (normalizeToolName(tool) === "pin_memory") return "durable";
  }
  const clean = safeText(text, 300);
  if (DURABLE_SETTING_PATTERNS.some((pattern) => pattern.test(clean))) return "durable";
  return "core";
}
