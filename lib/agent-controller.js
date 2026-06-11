import { decomposeTask } from "./task-decomposer.js";
import { classifyActionRisk } from "./action-risk.js";
import { previewAndGate } from "./scope-gate.js";
import { executeActionPlan } from "./action-executor.js";
import { createTaskGraph, markGraphNode, nextGraphNode, TASK_GRAPH_NODES, validateTaskGraph } from "./task-graph.js";
import { AGENT_STATES, createAgentState, stateForNode, transitionAgentState, terminalAgentState } from "./agent-state-machine.js";
import { appendAuditEvent, createAuditTrace, saveAuditTrace } from "./audit-trace.js";
import { addApprovalRequest, createApprovalRequest, detectHumanInterrupt } from "./human-interrupt.js";
import { saveAgentTaskState } from "./agent-task-store.js";
import { executeRuntimeRegisteredAction, resolveRuntimeAction } from "./action-registry-runtime.js";

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function asArray(value) { return Array.isArray(value) ? value : []; }

function firstActionPlan(artifacts = []) {
  for (const artifact of [...artifacts].reverse()) {
    const payload = artifact.payload || artifact.result || artifact;
    if (payload?.plan?.actionType || payload?.actionType) return payload;
    if (Array.isArray(payload?.actionPlans) && payload.actionPlans.length) return payload.actionPlans[0];
  }
  return null;
}

function proposalFromActionPlan(actionPlan = {}) {
  return {
    id: actionPlan.id || "agent:action_plan",
    type: "action_plan",
    riskTier: actionPlan.riskTier,
    plan: actionPlan.plan || actionPlan,
    patch: {
      filePatches: actionPlan.plan?.filePatches || actionPlan.plan?.patches || [],
      fileWrites: actionPlan.plan?.fileWrites || [],
    },
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

function latestArtifactByNodeType(artifacts = [], nodeTypes = []) {
  const wanted = new Set(nodeTypes);
  return [...artifacts].reverse().find((artifact) => wanted.has(artifact.nodeType) || wanted.has(artifact.node)) || null;
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
    if (node.type === TASK_GRAPH_NODES.OBSERVE) return this.observeNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.PLAN) return this.planNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.POLICY) return this.policyNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.SCOPE) return this.scopeNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.EXECUTE) return this.executeNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.VERIFY) return this.verifyNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.REPAIR) return this.repairNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.ROLLBACK) return this.rollbackNode(node, state, context);
    if (node.type === TASK_GRAPH_NODES.FEEDBACK || node.type === TASK_GRAPH_NODES.LEARN) return { status: "succeeded", note: `${node.type} recorded` };
    if (node.type === TASK_GRAPH_NODES.FINALIZE) return { status: "succeeded", note: "finalized" };
    return { status: "failed", error: `unsupported task graph node: ${node.type}` };
  }

  observeNode(_node, state, context) {
    return { status: "succeeded", observation: { taskId: state.taskId, input: context.input || context.prompt || null, files: asArray(context.files) } };
  }

  planNode(_node, state, context) {
    if (context.actionPlan) return { status: "succeeded", actionPlans: [context.actionPlan] };
    const task = decomposeTask({ title: state.graph?.title, input: context.input || context.prompt || "", files: context.files || [], riskTier: state.risk?.riskTier || "R2" }, context.taskRuntime || {});
    return { status: "succeeded", task };
  }

  policyNode(_node, state, context = {}) {
    const plan = firstActionPlan(state.artifacts);
    if (!plan) return { status: "succeeded", decision: "allow", reason: "no executable action plan" };
    const registryResolution = resolveRuntimeAction(plan, context, { requireAutoExecutable: true });
    if (registryResolution.definition && !registryResolution.coreAction) {
      const registry = {
        decision: registryResolution.decision,
        reason: registryResolution.reason,
        action: registryResolution.definition?.name,
        source: registryResolution.definition?.source,
        runtimeSource: registryResolution.runtime?.source,
      };
      if (registryResolution.decision === "manual_confirm") {
        return { status: "manual_confirm", decision: "manual_confirm", riskTier: registryResolution.riskTier, summary: `Registry policy requires approval for ${registryResolution.actionType}`, registry };
      }
      if (!registryResolution.ok) {
        return { status: "failed", riskTier: registryResolution.riskTier, error: registryResolution.reason.join("; "), registry };
      }
      return { status: "succeeded", decision: "allow", riskTier: registryResolution.riskTier, registry };
    }
    const risk = classifyActionRisk(plan);
    if (!risk.autoEligible || ["R3", "R4"].includes(risk.riskTier)) return { status: "manual_confirm", riskTier: risk.riskTier, summary: `Policy gate requires approval for ${risk.riskTier}`, risk };
    return { status: "succeeded", decision: "allow", riskTier: risk.riskTier, risk };
  }

  scopeNode(_node, state, context) {
    const plan = firstActionPlan(state.artifacts);
    if (!plan) return { status: "succeeded", decision: "allow", reason: "no file change" };
    const proposal = proposalFromActionPlan(plan);
    if (!proposal.patch.filePatches.length && !proposal.patch.fileWrites.length) return { status: "succeeded", decision: "allow", reason: "no patch" };
    const gate = previewAndGate(proposal, { workspaceRoot: context.workspaceRoot || process.cwd(), taskScope: context.taskScope || context.config?.taskScope || null, config: context.config || {} });
    if (gate.decision === "manual_confirm") return { status: "manual_confirm", scopeGate: gate.scopeGate, diffPreview: gate.diffPreview, summary: "Scope gate requires human approval" };
    if (!gate.ok || gate.decision === "reject") return { status: "failed", error: gate.error || "scope gate rejected", scopeGate: gate.scopeGate, diffPreview: gate.diffPreview };
    return { status: "succeeded", decision: "allow", scopeGate: gate.scopeGate, diffPreview: gate.diffPreview };
  }

  async executeNode(_node, state, context) {
    const plan = firstActionPlan(state.artifacts);
    if (!plan) return { status: "succeeded", skipped: true, reason: "no executable action plan" };
    const registryResolution = resolveRuntimeAction(plan, context, { requireAutoExecutable: true });
    if (registryResolution.definition && !registryResolution.coreAction) {
      const executed = await executeRuntimeRegisteredAction(plan, context, { requireAutoExecutable: true });
      if (executed.status === "queued") {
        return { status: "manual_confirm", decision: "manual_confirm", summary: executed.error || "registered action requires approval", registry: executed.registry, registryRuntime: executed.registryRuntime };
      }
      if (executed.status === "rejected") {
        return { status: "failed", error: executed.error || "registered action rejected", registry: executed.registry, registryRuntime: executed.registryRuntime };
      }
      return { status: executed.status || "succeeded", registryExecution: executed, verification: executed.verification, output: executed.output, rollback: executed.rollback, pluginProcess: executed.pluginProcess, error: executed.error };
    }
    return executeActionPlan(plan, context);
  }

  verifyNode(_node, state) {
    const last = latestArtifactByNodeType(state.artifacts, [TASK_GRAPH_NODES.EXECUTE, TASK_GRAPH_NODES.REPAIR]);
    const payload = last?.payload || {};
    const verification = payload.verification || payload.repairExecution?.verification || null;
    if (verification) {
      return {
        status: verification.verified ? "succeeded" : "failed",
        verification,
        sourceNode: last?.node || null,
        error: verification.verified ? undefined : "verification failed",
      };
    }
    return { status: "succeeded", verification: { verified: true, checks: [{ name: "no_executor_verification", passed: true }] } };
  }

  async repairNode(_node, state, context) {
    const lastExecution = latestArtifactByNodeType(state.artifacts, [TASK_GRAPH_NODES.EXECUTE]);
    const payload = lastExecution?.payload || {};
    if (payload.repair?.attempted) {
      return {
        status: payload.repair.ok ? "succeeded" : "failed",
        repair: payload.repair,
        verification: payload.verification || null,
        sourceNode: lastExecution?.node || null,
        error: payload.repair.ok ? undefined : payload.repair.error || "executor repair failed",
      };
    }
    if (typeof context.repairHandler === "function") {
      const handled = await context.repairHandler({ state, lastExecution: payload, context });
      return handled || { status: "failed", error: "repair handler returned no result" };
    }
    const repairActionPlan = context.repairActionPlan || context.config?.repairActionPlan || null;
    if (repairActionPlan) {
      const repairExecution = await executeActionPlan(repairActionPlan, context);
      const verified = repairExecution.verification?.verified === true;
      return {
        status: verified ? "succeeded" : "failed",
        repair: { attempted: true, ok: verified, mode: "controller_repair_action" },
        repairExecution,
        verification: repairExecution.verification,
        error: verified ? undefined : repairExecution.error || "controller repair action failed verification",
      };
    }
    return {
      status: "manual_confirm",
      verificationFailed: true,
      summary: "Repair branch requires a repairActionPlan or repairHandler",
      repair: { attempted: false, ok: false, reason: "no controller repair strategy available" },
    };
  }

  async rollbackNode(_node, state, context) {
    const lastExecution = latestArtifactByNodeType(state.artifacts, [TASK_GRAPH_NODES.EXECUTE, TASK_GRAPH_NODES.REPAIR]);
    const payload = lastExecution?.payload || {};
    if (payload.rollback) {
      return {
        status: payload.rollback.ok ? "succeeded" : "failed",
        rollback: payload.rollback,
        originalVerification: payload.verification || null,
        sourceNode: lastExecution?.node || null,
        error: payload.rollback.ok ? undefined : payload.rollback.error || "rollback failed",
      };
    }
    if (payload.status === "reverted") {
      return { status: "succeeded", rollback: { attempted: true, ok: true, reason: "execution already reverted" }, sourceNode: lastExecution?.node || null };
    }
    if (typeof context.rollbackHandler === "function") {
      const handled = await context.rollbackHandler({ state, lastExecution: payload, context });
      return handled || { status: "failed", error: "rollback handler returned no result" };
    }
    return {
      status: "manual_confirm",
      verificationFailed: true,
      summary: "Rollback branch requires an executor rollback record or rollbackHandler",
      rollback: { attempted: false, ok: false, reason: "no rollback evidence available" },
    };
  }
}

export async function runAgentController(input = {}, context = {}) {
  const controller = new AgentController({ context: input.context || {} });
  return controller.run(input, context);
}
