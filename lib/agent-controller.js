import { createTaskGraph, markGraphNode, nextGraphNode, TASK_GRAPH_NODES, validateTaskGraph } from "./task-graph.js";
import { AGENT_STATES, createAgentState, stateForNode, transitionAgentState, terminalAgentState } from "./agent-state-machine.js";
import { appendAuditEvent, createAuditTrace, saveAuditTrace } from "./audit-trace.js";
import { addApprovalRequest, createApprovalRequest, detectHumanInterrupt } from "./human-interrupt.js";
import { saveAgentTaskState } from "./agent-task-store.js";
import {
  observeNode, planNode, policyNode, scopeNode, executeNode, verifyNode, repairNode, rollbackNode,
} from "./agent-controller-nodes.js";

function clone(value) { return JSON.parse(JSON.stringify(value)); }

// Force a run into terminal FAILED after an unexpected throw. Bypasses the FSM
// transition guard on purpose: FAILED is not a legal successor of every state
// (e.g. CREATED), and a crash handler must always be able to record failure.
function forceFailState(state = {}, err) {
  const at = new Date().toISOString();
  const from = state.state || AGENT_STATES.CREATED;
  return {
    ...state,
    state: AGENT_STATES.FAILED,
    updatedAt: at,
    history: [...(state.history || []), { at, from, to: AGENT_STATES.FAILED, node: state.currentNode || null, reason: `controller error: ${String(err?.message || err)}` }],
  };
}

function mergeContext(base, additions) {
  return { ...(base || {}), ...(additions || {}) };
}

function isRecoveryNode(node = {}) {
  return [TASK_GRAPH_NODES.REPAIR, TASK_GRAPH_NODES.ROLLBACK].includes(node.type);
}

function shouldRouteToRecovery(currentNode = {}, result = {}, nextNode = null) {
  if (!nextNode || !isRecoveryNode(nextNode)) return false;
  if (![TASK_GRAPH_NODES.EXECUTE, TASK_GRAPH_NODES.VERIFY].includes(currentNode.type)) return false;
  if (result.status === "failed") return true;
  if (result.verification?.verified === false) return true;
  return false;
}

function shouldDeferToVerifyNode(currentNode = {}, result = {}, nextNode = null) {
  return currentNode.type === TASK_GRAPH_NODES.EXECUTE
    && nextNode?.type === TASK_GRAPH_NODES.VERIFY
    && result.verification?.verified === false
    && result.status !== "failed";
}

export class AgentController {
  constructor(options = {}) {
    this.options = options;
    this.handlers = options.handlers || {};
    this.context = options.context || {};
  }

  create(input = {}) {
    const graph = input.graph || createTaskGraph(input);
    const validation = validateTaskGraph(graph);
    if (!validation.ok) throw new Error(`invalid task graph: ${validation.errors.join("; ")}`);
    const state = createAgentState({ ...input, graph });
    const trace = createAuditTrace({ taskId: state.taskId, runId: state.runId });
    return { state, trace: appendAuditEvent(trace, { type: "state.created", state: state.state, summary: "Agent task created" }) };
  }

  async run(input = {}, context = {}) {
    let { state, trace } = input.state ? { state: clone(input.state), trace: input.trace || createAuditTrace({ taskId: input.state.taskId, runId: input.state.runId }) } : this.create(input);
    const runContext = mergeContext(this.context, context);
    const maxSteps = Number(runContext.maxAgentSteps || this.options.maxAgentSteps || 32);
    try {
      for (let step = 0; step < maxSteps && !terminalAgentState(state); step += 1) {
        const advanced = await this.step(state, trace, runContext);
        state = advanced.state;
        trace = advanced.trace;
        if (state.state === AGENT_STATES.WAITING_FOR_HUMAN) break;
      }
      if (!terminalAgentState(state)) {
        state = transitionAgentState(state, AGENT_STATES.WAITING_FOR_HUMAN, { reason: "max agent steps reached" });
        trace = appendAuditEvent(trace, { type: "human.interrupt", state: state.state, summary: "Maximum controller steps reached" });
      }
    } catch (err) {
      // An unexpected throw from a node handler/executor (or an illegal FSM
      // transition on a hand-built graph) must not escape silently: force the
      // run into a terminal FAILED state and audit it, so the persisted state
      // reflects the crash and a later resume does not re-run a stale state.
      state = forceFailState(state, err);
      trace = appendAuditEvent(trace, { type: "state.crashed", node: state.currentNode || null, state: state.state, summary: `Controller error: ${String(err?.message || err)}`, data: { error: String(err?.message || err) } });
    }
    if (runContext.learnerDir) {
      try { saveAuditTrace(runContext.learnerDir, trace); } catch {}
      try { saveAgentTaskState(runContext.learnerDir, state); } catch {}
    }
    return { ok: state.state === AGENT_STATES.COMPLETED, state, trace };
  }

  async step(agentState = {}, trace = createAuditTrace({ taskId: agentState.taskId, runId: agentState.runId }), context = {}) {
    let state = clone(agentState);
    let currentNode = state.currentNode ? nextGraphNode(state.graph, state.currentNode) : nextGraphNode(state.graph, null);
    if (state.state === AGENT_STATES.CREATED && currentNode) {
      state = transitionAgentState(state, stateForNode(currentNode.type), { node: currentNode.id, reason: `enter ${currentNode.type}` });
    } else if (!currentNode) {
      state = transitionAgentState(state, AGENT_STATES.COMPLETED, { reason: "graph completed" });
      trace = appendAuditEvent(trace, { type: "state.completed", state: state.state, summary: "Agent graph completed" });
      return { state, trace };
    } else if (state.currentNode !== currentNode.id && state.state !== stateForNode(currentNode.type)) {
      state = transitionAgentState(state, stateForNode(currentNode.type), { node: currentNode.id, reason: `enter ${currentNode.type}` });
    } else {
      state.currentNode = currentNode.id;
    }

    trace = appendAuditEvent(trace, { type: "node.start", node: currentNode.id, state: state.state, summary: currentNode.title });
    const result = await this.runNode(currentNode, state, context);
    const nextAfterCurrent = nextGraphNode(state.graph, currentNode.id);
    const recoveryNode = shouldRouteToRecovery(currentNode, result, nextAfterCurrent) ? nextAfterCurrent : null;
    if (recoveryNode) {
      state.graph = markGraphNode(state.graph, currentNode.id, "failed", { result, recoveryTarget: recoveryNode.id });
      state = transitionAgentState(state, stateForNode(recoveryNode.type), {
        node: currentNode.id,
        reason: `${currentNode.type} routed to ${recoveryNode.type}`,
        artifact: { kind: "node_result", node: currentNode.id, nodeType: currentNode.type, payload: result },
      });
      trace = appendAuditEvent(trace, {
        type: "node.recovery_branch",
        node: currentNode.id,
        state: state.state,
        summary: `${currentNode.title} routed to ${recoveryNode.title}`,
        data: { status: result.status, verification: result.verification, recoveryNode: recoveryNode.id },
      });
      return { state, trace };
    }

    const deferVerificationToNextNode = shouldDeferToVerifyNode(currentNode, result, nextAfterCurrent);
    const interrupt = deferVerificationToNextNode ? { required: false, reasons: [] } : detectHumanInterrupt(result, { risk: state.risk });
    if (interrupt.required || result.status === "manual_confirm") {
      const request = createApprovalRequest({ taskId: state.taskId, node: currentNode.id, reasons: interrupt.reasons, summary: result.summary || `${currentNode.title} requires human approval` });
      state = addApprovalRequest(state, request);
      state = transitionAgentState(state, AGENT_STATES.WAITING_FOR_HUMAN, { node: currentNode.id, reason: request.summary, artifact: { kind: "node_result", node: currentNode.id, nodeType: currentNode.type, payload: result } });
      trace = appendAuditEvent(trace, { type: "human.interrupt", node: currentNode.id, state: state.state, summary: request.summary, data: { reasons: request.reasons, requestId: request.id } });
      return { state, trace };
    }
    if (result.status === "failed") {
      state.graph = markGraphNode(state.graph, currentNode.id, "failed", { result });
      state = transitionAgentState(state, AGENT_STATES.FAILED, { node: currentNode.id, reason: result.error || "node failed", artifact: { kind: "node_result", node: currentNode.id, nodeType: currentNode.type, payload: result } });
      trace = appendAuditEvent(trace, { type: "node.failed", node: currentNode.id, state: state.state, summary: result.error || "Node failed", data: result });
      return { state, trace };
    }
    state.graph = markGraphNode(state.graph, currentNode.id, "completed", { result });
    state = {
      ...state,
      artifacts: [...(state.artifacts || []), { createdAt: new Date().toISOString(), kind: "node_result", node: currentNode.id, nodeType: currentNode.type, payload: result }],
      updatedAt: new Date().toISOString(),
    };
    trace = appendAuditEvent(trace, { type: "node.completed", node: currentNode.id, state: state.state, summary: currentNode.title, data: { status: result.status || "succeeded" } });

    const next = nextGraphNode(state.graph, currentNode.id);
    if (!next) {
      state = transitionAgentState(state, AGENT_STATES.COMPLETED, { node: currentNode.id, reason: "final node completed" });
      trace = appendAuditEvent(trace, { type: "state.completed", node: currentNode.id, state: state.state, summary: "Agent task completed" });
      return { state, trace };
    }
    state = transitionAgentState(state, stateForNode(next.type), { node: currentNode.id, reason: `advance to ${next.type}` });
    return { state, trace };
  }

  async runNode(node, state, context) {
    const handler = this.handlers[node.type] || this.handlers[node.id];
    if (handler) return handler({ node, state, context, controller: this });
    if (node.type === TASK_GRAPH_NODES.OBSERVE) return observeNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.PLAN) return planNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.POLICY) return policyNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.SCOPE) return scopeNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.EXECUTE) return executeNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.VERIFY) return verifyNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.REPAIR) return repairNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.ROLLBACK) return rollbackNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.FEEDBACK || node.type === TASK_GRAPH_NODES.LEARN) return { status: "succeeded", note: `${node.type} recorded` };
    if (node.type === TASK_GRAPH_NODES.FINALIZE) return { status: "succeeded", note: "finalized" };
    return { status: "failed", error: `unsupported task graph node: ${node.type}` };
  }
}

export async function runAgentController(input = {}, context = {}) {
  const controller = new AgentController({ context: input.context || {} });
  return controller.run(input, context);
}
