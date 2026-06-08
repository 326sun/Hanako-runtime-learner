// Shared helpers extracted from index.js for module use.

const MAX_TEXT = 500;

const TOOL_SHORT = {
  read: "read",
  write: "write",
  edit: "edit",
  bash: "bash",
  grep: "grep",
  find: "find",
  ls: "ls",
  web_search: "web_search",
  web_fetch: "web_fetch",
  browser: "browser",
  todo_write: "todo_write",
  pin_memory: "pin_memory",
  search_memory: "search_memory",
  subagent: "subagent",
  subagent_reply: "subagent_reply",
  subagent_close: "subagent_close",
  workflow: "workflow",
  notify: "notify",
  cron: "cron",
  stage_files: "stage_files",
  install_skill: "install_skill",
  computer: "computer",
  terminal: "terminal",
  current_status: "current_status",
};

const TOOL_CATEGORY = {
  read: "文件探索", find: "文件探索", grep: "文件探索", ls: "文件探索",
  write: "代码编写", edit: "代码编写", bash: "代码编写", terminal: "终端操作",
  web_search: "网络研究", web_fetch: "网络研究", browser: "网络研究",
  todo_write: "任务编排", subagent: "任务编排", subagent_reply: "任务编排", subagent_close: "任务编排", workflow: "任务编排",
  pin_memory: "记忆操作", search_memory: "记忆操作",
  stage_files: "文件交付", install_skill: "技能管理",
  computer: "桌面控制", notify: "通知", current_status: "状态查询",
};

export function toolCategory(name) {
  return TOOL_CATEGORY[name] || "其他";
}

export function safeText(value, max = MAX_TEXT) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeToolName(name) {
  if (!name) return null;
  const text = String(name);
  return TOOL_SHORT[text] || text.replace(/^(hanako-runtime-learner_|runtime-learner_)/, "");
}
