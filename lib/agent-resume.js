import { AgentController } from "./agent-controller.js";
import { appendAuditEvent, createAuditTrace, loadAuditTrace, saveAuditTrace } from "./audit-trace.js";
import { AGENT_STATES, stateForNode, transitionAgentState } from "./agent-state-machine.js";
import { latestPendingApproval, resolveApprovalRequest } from "./human-interrupt.js";
import { markGraphNode, nextGraphNode } from "./task-graph.js";
import { loadAgentTaskState, saveAgentTaskState } from "./agent-task-store.js";

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function now() { return new Date().toISOString(); }

function loadBundle(baseDir, taskId) {
  const state = loadAgentTaskState(baseDir, taskId);
  if (!state) throw new Error(`agent task not found: ${taskId}`);
  const trace = loadAuditTrace(baseDir, taskId) || createAuditTrace({ taskId: state.taskId, runId: state.runId });
  return { state, trace };
}

function saveBundle(baseDir, state, trace) {
  const savedState = saveAgentTaskState(baseDir, state);
  const savedTrace = saveAuditTrace(baseDir, trace);
  return { statePath: savedState.path, tracePath: savedTrace.path };
}

function pendingApprovals(state = {}) {
  return (state.approvalRequests || []).filter((request) => request.status === "pending");
}

function assertTaskBoundApproval(state = {}, request = {}) {
  if (request.taskId && state.taskId && request.taskId !== state.taskId) {
    throw new Error(`approval request task mismatch: ${request.taskId} != ${state.taskId}`);
  }
  return request;
}

function assertCurrentNodeApproval(state = {}, request = {}) {
  assertTaskBoundApproval(state, request);
  if (request.node && state.currentNode && request.node !== state.currentNode) {
    throw new Error(`approval request node mismatch: ${request.node} != ${state.currentNode}`);
  }
  return request;
}

function selectCurrentPendingApproval(state = {}, requestId = null) {
  const allPending = pendingApprovals(state);
  const request = requestId
    ? (state.approvalRequests || []).find((item) => item.id === requestId && item.status === "pending")
    : latestPendingApproval(state);
  if (!request) throw new Error("pending approval request not found");
  assertCurrentNodeApproval(state, request);
  if (allPending.length !== 1) {
    throw new Error(`ambiguous pending approval requests: ${allPending.map((item) => item.id).join(", ")}`);
  }
  return request;
}

export function approveAgentTask(baseDir, taskId, { requestId = null, reason = "approved by user" } = {}) {
  let { state, trace } = loadBundle(baseDir, taskId);
  if (state.state !== AGENT_STATES.WAITING_FOR_HUMAN) throw new Error(`agent task is not waiting for human: ${state.state}`);
  const request = selectCurrentPendingApproval(state, requestId);

  state = resolveApprovalRequest(state, request.id, "approved", { reason });
  const approvedNode = request.node || state.currentNode;
  const graphNodes = state.graph?.nodes || [];
  const approvedIndex = graphNodes.findIndex((node) => node.id === approvedNode || node.type === approvedNode);
  const approvedGraphNode = approvedIndex >= 0 ? graphNodes[approvedIndex] : null;
  if (approvedGraphNode?.type === "ExecuteNode") {
    // Execute approval authorizes one real retry; it is not execution evidence.
    // Rewind the cursor to the preceding node so AgentController selects the
    // still-pending ExecuteNode again on resume.
    state.approvedNodeIds = [...new Set([...(state.approvedNodeIds || []), approvedGraphNode.id])];
    const previous = approvedIndex > 0 ? graphNodes[approvedIndex - 1] : null;
    state = transitionAgentState(state, AGENT_STATES.EXECUTING, { node: approvedNode, reason: `approved ${approvedNode}; retry execution` });
    state.currentNode = previous?.id || null;
  } else if (approvedNode) {
    state.graph = markGraphNode(state.graph, approvedNode, "completed", { result: { status: "approved", approvalRequestId: request.id, reason } });
    const next = nextGraphNode(state.graph, approvedNode);
    if (next) {
      state = transitionAgentState(state, stateForNode(next.type), { node: approvedNode, reason: `approved ${approvedNode}; resume at ${next.type}` });
    } else {
      state = transitionAgentState(state, AGENT_STATES.LEARNING, { node: approvedNode, reason: `approved ${approvedNode}; finalize` });
    }
  }
  state.updatedAt = now();
  trace = appendAuditEvent(trace, { type: "human.approved", node: approvedNode, state: state.state, summary: reason, data: { requestId: request.id } });
  const saved = saveBundle(baseDir, state, trace);
  return { ok: true, decision: "approved", requestId: request.id, state, trace, saved };
}

export function rejectAgentTask(baseDir, taskId, { requestId = null, reason = "rejected by user" } = {}) {
  let { state, trace } = loadBundle(baseDir, taskId);
  if (state.state !== AGENT_STATES.WAITING_FOR_HUMAN) throw new Error(`agent task is not waiting for human: ${state.state}`);
  const request = selectCurrentPendingApproval(state, requestId);

  state = resolveApprovalRequest(state, request.id, "rejected", { reason });
  const rejectedNode = request.node || state.currentNode;
  if (rejectedNode) {
    state.graph = markGraphNode(state.graph, rejectedNode, "failed", { result: { status: "rejected", approvalRequestId: request.id, reason } });
  }
  state = transitionAgentState(state, AGENT_STATES.FAILED, { node: rejectedNode, reason });
  state.updatedAt = now();
  trace = appendAuditEvent(trace, { type: "human.rejected", node: rejectedNode, state: state.state, summary: reason, data: { requestId: request.id } });
  const saved = saveBundle(baseDir, state, trace);
  return { ok: true, decision: "rejected", requestId: request.id, state, trace, saved };
}

export function cancelAgentTask(baseDir, taskId, { requestId = null, reason = "cancelled by user" } = {}) {
  let { state, trace } = loadBundle(baseDir, taskId);
  const cancelledRequestIds = [];
  if (requestId) {
    const request = (state.approvalRequests || []).find((item) => item.id === requestId && item.status === "pending");
    if (!request) throw new Error("pending approval request not found");
    assertTaskBoundApproval(state, request);
    state = resolveApprovalRequest(state, request.id, "cancelled", { reason });
    cancelledRequestIds.push(request.id);
  } else {
    for (const request of pendingApprovals(state)) {
      assertTaskBoundApproval(state, request);
      state = resolveApprovalRequest(state, request.id, "cancelled", { reason });
      cancelledRequestIds.push(request.id);
    }
  }
  state = transitionAgentState(state, AGENT_STATES.CANCELLED, { node: state.currentNode, reason });
  state.updatedAt = now();
  trace = appendAuditEvent(trace, { type: "human.cancelled", node: state.currentNode, state: state.state, summary: reason, data: { requestId: requestId || cancelledRequestIds[0] || null, requestIds: cancelledRequestIds } });
  const saved = saveBundle(baseDir, state, trace);
  return { ok: true, decision: "cancelled", state, trace, saved };
}

export async function resumeAgentTask(baseDir, taskId, context = {}, options = {}) {
  const { state, trace } = loadBundle(baseDir, taskId);
  if (state.state === AGENT_STATES.WAITING_FOR_HUMAN) {
    throw new Error("agent task still requires approval before resume");
  }
  if ([AGENT_STATES.COMPLETED, AGENT_STATES.FAILED, AGENT_STATES.CANCELLED].includes(state.state)) {
    return { ok: state.state === AGENT_STATES.COMPLETED, skipped: true, state, trace, reason: `agent task is terminal: ${state.state}` };
  }
  const controller = new AgentController(options);
  return controller.run({ state: clone(state), trace }, { ...context, learnerDir: baseDir });
}
