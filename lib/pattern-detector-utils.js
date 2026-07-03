import { normalizeToolName, safeText } from "./helpers.js";

export const MAX_PATTERN_COUNT = 50;

const TOOL_CATEGORY = {
  read: "文件探索", find: "文件探索", grep: "文件探索", ls: "文件探索",
  write: "代码编写", edit: "代码编写", bash: "代码编写", terminal: "终端操作",
  web_search: "网络研究", web_fetch: "网络研究", browser: "网络研究",
  todo_write: "任务编排", subagent: "任务编排", subagent_reply: "任务编排", subagent_close: "任务编排", workflow: "任务编排",
  pin_memory: "记忆操作", search_memory: "记忆操作",
  stage_files: "文件交付", install_skill: "技能管理",
  computer: "桌面控制", notify: "通知", current_status: "状态查询",
};

function toolCategory(name) {
  return TOOL_CATEGORY[name] || "其他";
}

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
