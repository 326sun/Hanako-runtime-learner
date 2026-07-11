import { decomposeTask } from "./task-decomposer.js";
import { classifyActionRisk } from "./action-risk.js";
import { previewAndGate } from "./scope-gate.js";
import { executeActionPlan } from "./action-executor.js";
import { TASK_GRAPH_NODES } from "./task-graph.js";
import { executeRuntimeRegisteredAction, resolveRuntimeAction } from "./action-registry-runtime.js";

/**
 * agent-controller-nodes.js
 *
 * The behaviour of each task-graph node (Observe/Plan/Policy/Scope/Execute/
 * Verify/Repair/Rollback), plus the artifact helpers they read. Pure of agent
 * FSM concerns: every function takes (node, state, context) and returns a node
 * result object — the controller owns dispatch, transitions, and persistence.
 * Split out of agent-controller.js (S8.P2 equivalence refactor), behavior
 * unchanged.
 */

function asArray(value) { return Array.isArray(value) ? value : []; }

export function firstActionPlan(artifacts = []) {
  for (const artifact of [...artifacts].reverse()) {
    const payload = artifact.payload || artifact.result || artifact;
    if (payload?.plan?.actionType || payload?.actionType) return payload;
    if (Array.isArray(payload?.actionPlans) && payload.actionPlans.length) return payload.actionPlans[0];
  }
  return null;
}

export function proposalFromActionPlan(actionPlan = {}) {
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

export function latestArtifactByNodeType(artifacts = [], nodeTypes = []) {
  const wanted = new Set(nodeTypes);
  return [...artifacts].reverse().find((artifact) => wanted.has(artifact.nodeType) || wanted.has(artifact.node)) || null;
}

export function observeNode(_node, state, context) {
  return { status: "succeeded", observation: { taskId: state.taskId, input: context.input || context.prompt || null, files: asArray(context.files) } };
}

export function planNode(_node, state, context) {
  if (context.actionPlan) return { status: "succeeded", actionPlans: [context.actionPlan] };
  const task = decomposeTask({ title: state.graph?.title, input: context.input || context.prompt || "", files: context.files || [], riskTier: state.risk?.riskTier || "R2" }, context.taskRuntime || {});
  return { status: "succeeded", task };
}

export function policyNode(_node, state, context = {}) {
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

export function scopeNode(_node, state, context) {
  const plan = firstActionPlan(state.artifacts);
  if (!plan) return { status: "succeeded", decision: "allow", reason: "no file change" };
  const proposal = proposalFromActionPlan(plan);
  if (!proposal.patch.filePatches.length && !proposal.patch.fileWrites.length) return { status: "succeeded", decision: "allow", reason: "no patch" };
  const gate = previewAndGate(proposal, { workspaceRoot: context.workspaceRoot || process.cwd(), taskScope: context.taskScope || context.config?.taskScope || null, config: context.config || {} });
  if (gate.decision === "manual_confirm") return { status: "manual_confirm", scopeGate: gate.scopeGate, diffPreview: gate.diffPreview, summary: "Scope gate requires human approval" };
  if (!gate.ok || gate.decision === "reject") return { status: "failed", error: gate.error || "scope gate rejected", scopeGate: gate.scopeGate, diffPreview: gate.diffPreview };
  return { status: "succeeded", decision: "allow", scopeGate: gate.scopeGate, diffPreview: gate.diffPreview };
}

export async function executeNode(_node, state, context) {
  const plan = firstActionPlan(state.artifacts);
  if (!plan) return { status: "succeeded", skipped: true, reason: "no executable action plan" };
  const approved = (state.approvedNodeIds || []).includes(_node.id);
  const executionContext = approved ? { ...context, allowPluginCodeExecution: true } : context;
  const registryResolution = resolveRuntimeAction(plan, executionContext, { requireAutoExecutable: !approved });
  if (registryResolution.definition && !registryResolution.coreAction) {
    const executed = await executeRuntimeRegisteredAction(plan, executionContext, {
      requireAutoExecutable: !approved,
      allowPluginCodeExecution: approved,
    });
    if (executed.status === "queued") {
      return { status: "manual_confirm", decision: "manual_confirm", summary: executed.error || "registered action requires approval", registry: executed.registry, registryRuntime: executed.registryRuntime };
    }
    if (executed.status === "rejected") {
      return { status: "failed", error: executed.error || "registered action rejected", registry: executed.registry, registryRuntime: executed.registryRuntime };
    }
    return { status: executed.status || "succeeded", registryExecution: executed, verification: executed.verification, output: executed.output, rollback: executed.rollback, pluginProcess: executed.pluginProcess, error: executed.error };
  }
  return executeActionPlan(plan, executionContext);
}

export function verifyNode(_node, state) {
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
  if (payload.skipped === true) {
    return { status: "succeeded", verification: { verified: true, checks: [{ name: "no_execution_required", passed: true }] } };
  }
  return { status: "failed", error: "execution completed without verification evidence", verification: { verified: false, checks: [{ name: "missing_execution_verification", passed: false }] } };
}

export async function repairNode(_node, state, context) {
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

export async function rollbackNode(_node, state, context) {
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
