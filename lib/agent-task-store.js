import fs from "fs";
import path from "path";
import { loadAuditTrace } from "./audit-trace.js";
import { safeFileSlug, writeJson } from "./common.js";

function now() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function safeAgentTaskId(taskId) {
  return safeFileSlug(taskId, "task");
}

function agentTasksDir(baseDir) {
  return path.join(baseDir, "agent_tasks");
}

function agentTaskStatePath(baseDir, taskId) {
  return path.join(agentTasksDir(baseDir), `${safeAgentTaskId(taskId)}.json`);
}

function summarizeAgentTaskState(state = {}) {
  const approvals = state.approvalRequests || [];
  return {
    taskId: state.taskId || null,
    runId: state.runId || null,
    title: state.graph?.title || null,
    state: state.state || null,
    currentNode: state.currentNode || null,
    riskTier: state.risk?.riskTier || state.graph?.riskTier || null,
    pendingApprovals: approvals.filter((request) => request.status === "pending").length,
    approvalRequests: approvals.length,
    artifacts: (state.artifacts || []).length,
    history: (state.history || []).length,
    createdAt: state.createdAt || null,
    updatedAt: state.updatedAt || null,
  };
}

export function saveAgentTaskState(baseDir, state = {}) {
  if (!baseDir) throw new Error("baseDir missing");
  if (!state.taskId) throw new Error("agent taskId missing");
  const file = agentTaskStatePath(baseDir, state.taskId);
  const next = { ...clone(state), persistedAt: now() };
  writeJson(file, next);
  return { ok: true, path: file, summary: summarizeAgentTaskState(next) };
}

export function loadAgentTaskState(baseDir, taskId) {
  try {
    return JSON.parse(fs.readFileSync(agentTaskStatePath(baseDir, taskId), "utf-8"));
  } catch {
    return null;
  }
}

export function listAgentTaskStates(baseDir, { status = null, limit = 50 } = {}) {
  let files = [];
  try {
    files = fs.readdirSync(agentTasksDir(baseDir)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const states = [];
  for (const file of files) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(agentTasksDir(baseDir), file), "utf-8"));
      if (status && state.state !== status) continue;
      states.push(summarizeAgentTaskState(state));
    } catch {}
  }
  return states
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, Math.max(0, Number(limit || 50)));
}

export function readAgentTaskBundle(baseDir, taskId) {
  const state = loadAgentTaskState(baseDir, taskId);
  if (!state) return null;
  return {
    state,
    summary: summarizeAgentTaskState(state),
    trace: loadAuditTrace(baseDir, taskId),
  };
}
