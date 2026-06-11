import crypto from "crypto";
import { TASK_GRAPH_NODES, createTaskGraph } from "./task-graph.js";

export const AGENT_STATES = Object.freeze({
  CREATED: "created",
  OBSERVING: "observing",
  PLANNING: "planning",
  POLICY_CHECKING: "policy_checking",
  SCOPE_CHECKING: "scope_checking",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  REPAIRING: "repairing",
  ROLLING_BACK: "rolling_back",
  WAITING_FOR_HUMAN: "waiting_for_human",
  LEARNING: "learning",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const TRANSITIONS = Object.freeze({
  [AGENT_STATES.CREATED]: [AGENT_STATES.OBSERVING, AGENT_STATES.CANCELLED],
  [AGENT_STATES.OBSERVING]: [AGENT_STATES.PLANNING, AGENT_STATES.WAITING_FOR_HUMAN, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.PLANNING]: [AGENT_STATES.POLICY_CHECKING, AGENT_STATES.WAITING_FOR_HUMAN, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.POLICY_CHECKING]: [AGENT_STATES.SCOPE_CHECKING, AGENT_STATES.WAITING_FOR_HUMAN, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.SCOPE_CHECKING]: [AGENT_STATES.EXECUTING, AGENT_STATES.WAITING_FOR_HUMAN, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.EXECUTING]: [AGENT_STATES.VERIFYING, AGENT_STATES.REPAIRING, AGENT_STATES.ROLLING_BACK, AGENT_STATES.WAITING_FOR_HUMAN, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.VERIFYING]: [AGENT_STATES.LEARNING, AGENT_STATES.REPAIRING, AGENT_STATES.ROLLING_BACK, AGENT_STATES.WAITING_FOR_HUMAN, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.REPAIRING]: [AGENT_STATES.VERIFYING, AGENT_STATES.ROLLING_BACK, AGENT_STATES.WAITING_FOR_HUMAN, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.ROLLING_BACK]: [AGENT_STATES.LEARNING, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.WAITING_FOR_HUMAN]: [AGENT_STATES.POLICY_CHECKING, AGENT_STATES.SCOPE_CHECKING, AGENT_STATES.EXECUTING, AGENT_STATES.VERIFYING, AGENT_STATES.LEARNING, AGENT_STATES.CANCELLED, AGENT_STATES.FAILED],
  [AGENT_STATES.LEARNING]: [AGENT_STATES.COMPLETED, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED],
  [AGENT_STATES.COMPLETED]: [],
  [AGENT_STATES.FAILED]: [],
  [AGENT_STATES.CANCELLED]: [],
});

const NODE_TO_STATE = Object.freeze({
  [TASK_GRAPH_NODES.OBSERVE]: AGENT_STATES.OBSERVING,
  [TASK_GRAPH_NODES.PLAN]: AGENT_STATES.PLANNING,
  [TASK_GRAPH_NODES.POLICY]: AGENT_STATES.POLICY_CHECKING,
  [TASK_GRAPH_NODES.SCOPE]: AGENT_STATES.SCOPE_CHECKING,
  [TASK_GRAPH_NODES.EXECUTE]: AGENT_STATES.EXECUTING,
  [TASK_GRAPH_NODES.VERIFY]: AGENT_STATES.VERIFYING,
  [TASK_GRAPH_NODES.REPAIR]: AGENT_STATES.REPAIRING,
  [TASK_GRAPH_NODES.ROLLBACK]: AGENT_STATES.ROLLING_BACK,
  [TASK_GRAPH_NODES.FEEDBACK]: AGENT_STATES.LEARNING,
  [TASK_GRAPH_NODES.LEARN]: AGENT_STATES.LEARNING,
  [TASK_GRAPH_NODES.HUMAN_APPROVAL]: AGENT_STATES.WAITING_FOR_HUMAN,
  [TASK_GRAPH_NODES.FINALIZE]: AGENT_STATES.LEARNING,
});

function stableId(prefix, payload) {
  return `${prefix}:${crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex").slice(0, 12)}`;
}

function now() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function stateForNode(nodeType) {
  return NODE_TO_STATE[nodeType] || AGENT_STATES.EXECUTING;
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function createAgentState(input = {}) {
  const graph = input.graph || createTaskGraph(input);
  const createdAt = input.createdAt || now();
  return {
    schemaVersion: 1,
    taskId: graph.taskId || input.taskId || stableId("task", input),
    runId: input.runId || stableId("agent_run", { taskId: graph.taskId, createdAt }),
    state: input.state || AGENT_STATES.CREATED,
    currentNode: input.currentNode || null,
    graph,
    history: [{ at: createdAt, from: null, to: input.state || AGENT_STATES.CREATED, node: null, reason: "created" }],
    artifacts: [],
    approvalRequests: [],
    budget: input.budget || {},
    risk: input.risk || { riskTier: graph.riskTier || input.riskTier || "R2" },
    createdAt,
    updatedAt: createdAt,
  };
}

export function transitionAgentState(agentState = {}, nextState, { node = null, reason = "transition", artifact = null } = {}) {
  if (!Object.values(AGENT_STATES).includes(nextState)) throw new Error(`invalid agent state: ${nextState}`);
  const current = agentState.state || AGENT_STATES.CREATED;
  if (current !== nextState && !canTransition(current, nextState)) {
    throw new Error(`invalid agent transition: ${current} -> ${nextState}`);
  }
  const at = now();
  const next = clone(agentState);
  next.state = nextState;
  next.currentNode = node || next.currentNode || null;
  next.updatedAt = at;
  next.history = [...(next.history || []), { at, from: current, to: nextState, node: node || next.currentNode || null, reason }];
  if (artifact) next.artifacts = [...(next.artifacts || []), { createdAt: at, ...artifact }];
  return next;
}

export function serializeAgentState(agentState = {}) {
  return JSON.stringify(agentState, null, 2);
}

export function restoreAgentState(serialized) {
  if (!serialized) return null;
  return typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized);
}

export function terminalAgentState(agentState = {}) {
  return [AGENT_STATES.COMPLETED, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED, AGENT_STATES.WAITING_FOR_HUMAN].includes(agentState.state);
}
