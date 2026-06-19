import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createTaskGraph, TASK_GRAPH_NODES, validateTaskGraph, readyGraphNodes, markGraphNode } from "../lib/task-graph.js";
import { AGENT_STATES, createAgentState, restoreAgentState, serializeAgentState, transitionAgentState } from "../lib/agent-state-machine.js";
import { AgentController, runAgentController } from "../lib/agent-controller.js";
import { latestPendingApproval, resolveApprovalRequest } from "../lib/human-interrupt.js";
import { loadAuditTrace, summarizeAuditTrace } from "../lib/audit-trace.js";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-controller-"));
}

test("task graph validates linear runtime controller nodes", () => {
  const graph = createTaskGraph({ title: "audit code", riskTier: "R2" });
  const validation = validateTaskGraph(graph);
  assert.equal(validation.ok, true);
  assert.equal(graph.nodes[0].type, TASK_GRAPH_NODES.OBSERVE);
  assert.equal(graph.nodes.at(-1).type, TASK_GRAPH_NODES.FINALIZE);

  const afterObserve = markGraphNode(graph, TASK_GRAPH_NODES.OBSERVE, "completed");
  const ready = readyGraphNodes(afterObserve);
  assert.equal(ready[0].type, TASK_GRAPH_NODES.PLAN);
});

test("agent state machine serializes and rejects illegal transitions", () => {
  const state = createAgentState({ title: "stateful task" });
  const observing = transitionAgentState(state, AGENT_STATES.OBSERVING, { node: TASK_GRAPH_NODES.OBSERVE });
  assert.equal(observing.state, AGENT_STATES.OBSERVING);
  assert.throws(() => transitionAgentState(observing, AGENT_STATES.COMPLETED), /invalid agent transition/);
  const restored = restoreAgentState(serializeAgentState(observing));
  assert.equal(restored.taskId, observing.taskId);
});

test("agent controller runs a safe graph to completion and writes audit trace", async () => {
  const learnerDir = tmpdir();
  const result = await runAgentController({ title: "plain analysis", input: "small task" }, { learnerDir });
  assert.equal(result.ok, true);
  assert.equal(result.state.state, AGENT_STATES.COMPLETED);
  assert.ok(result.state.history.length >= 5);
  const trace = loadAuditTrace(learnerDir, result.state.taskId);
  const summary = summarizeAuditTrace(trace);
  assert.equal(summary.taskId, result.state.taskId);
  assert.ok(summary.eventCount > 0);
  assert.ok(summary.byType["node.completed"] >= 1);
});

test("agent controller pauses for human approval on R4 action plan", async () => {
  const controller = new AgentController();
  const actionPlan = {
    id: "dangerous:1",
    riskTier: "R4",
    plan: { actionType: "ask_user_confirmation", steps: ["ask"] },
  };
  const result = await controller.run({ title: "dangerous task" }, { actionPlan });
  assert.equal(result.ok, false);
  assert.equal(result.state.state, AGENT_STATES.WAITING_FOR_HUMAN);
  const pending = latestPendingApproval(result.state);
  assert.ok(pending);
  assert.ok(pending.reasons.includes("risk_too_high"));

  const resolved = resolveApprovalRequest(result.state, pending.id, "approved");
  assert.equal(latestPendingApproval(resolved), null);
});

test("approval resolution rejects stale or mismatched requests", () => {
  const state = {
    taskId: "task:approval",
    currentNode: TASK_GRAPH_NODES.POLICY,
    approvalRequests: [{
      id: "approval:1",
      taskId: "task:approval",
      node: TASK_GRAPH_NODES.POLICY,
      status: "pending",
    }],
  };

  const resolved = resolveApprovalRequest(state, "approval:1", "approved");
  assert.equal(resolved.approvalRequests[0].status, "approved");
  assert.throws(() => resolveApprovalRequest(resolved, "approval:1", "cancelled"), /already resolved/);
  assert.throws(() => resolveApprovalRequest({ ...state, taskId: "task:other" }, "approval:1", "approved"), /task mismatch/);
  assert.throws(() => resolveApprovalRequest({ ...state, currentNode: TASK_GRAPH_NODES.SCOPE }, "approval:1", "approved"), /node mismatch/);
});

test("custom handler pauses on verification failure", async () => {
  const controller = new AgentController({
    handlers: {
      [TASK_GRAPH_NODES.VERIFY]: () => ({ status: "failed", error: "synthetic verification failed", verification: { verified: false } }),
    },
  });
  const result = await controller.run({ title: "verify fail" }, {});
  assert.equal(result.state.state, AGENT_STATES.WAITING_FOR_HUMAN);
  const pending = latestPendingApproval(result.state);
  assert.ok(pending.reasons.includes("verification_failed"));
});

test("agent controller routes failed verification to explicit rollback branch", async () => {
  const workspaceRoot = tmpdir();
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "src/rollback-target.mjs"), "export const value = 1;\n", "utf-8");

  const actionPlan = {
    id: "controller:rollback-branch",
    type: "action_plan",
    riskTier: "R2",
    plan: {
      actionType: "apply_patch_sandboxed",
      fileWrites: [{ path: "src/rollback-target.mjs", content: "export const broken = ;\n" }],
    },
    verification: { commands: ["node --check src/rollback-target.mjs"], metrics: ["verification_commands_pass", "rollback_clean"] },
  };

  const nodes = [
    { id: "observe", type: TASK_GRAPH_NODES.OBSERVE },
    { id: "plan", type: TASK_GRAPH_NODES.PLAN },
    { id: "policy", type: TASK_GRAPH_NODES.POLICY },
    { id: "scope", type: TASK_GRAPH_NODES.SCOPE },
    { id: "execute", type: TASK_GRAPH_NODES.EXECUTE },
    { id: "verify", type: TASK_GRAPH_NODES.VERIFY },
    { id: "rollback", type: TASK_GRAPH_NODES.ROLLBACK },
    { id: "feedback", type: TASK_GRAPH_NODES.FEEDBACK },
    { id: "finalize", type: TASK_GRAPH_NODES.FINALIZE },
  ];

  const result = await runAgentController(
    { title: "rollback branch task", nodes },
    {
      workspaceRoot,
      actionPlan,
      config: {
        autoActionCommands: { allowlist: ["node --check"], denylist: ["rm", "del", "git push", "git tag", "npm publish"] },
        autoActions: { autoRepairEnabled: false },
      },
      taskScope: { allowedFiles: ["src/rollback-target.mjs"], maxChangedFiles: 1 },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.state.state, AGENT_STATES.COMPLETED);
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "src/rollback-target.mjs"), "utf-8"), "export const value = 1;\n");
  assert.ok(result.trace.events.some((event) => event.type === "node.recovery_branch" && event.data?.recoveryNode === "rollback"));
  const rollbackArtifact = result.state.artifacts.find((artifact) => artifact.node === "rollback");
  assert.equal(rollbackArtifact?.payload?.rollback?.ok, true);
});

test("agent controller routes failed verification to explicit repair branch", async () => {
  const workspaceRoot = tmpdir();
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "src/repair-target.mjs"), "export const value = 1;\n", "utf-8");

  const actionPlan = {
    id: "controller:needs-repair",
    type: "action_plan",
    riskTier: "R2",
    plan: {
      actionType: "apply_patch_sandboxed",
      fileWrites: [{ path: "src/repair-target.mjs", content: "export const broken = ;\n" }],
    },
    verification: { commands: ["node --check src/repair-target.mjs"], metrics: ["verification_commands_pass"] },
  };
  const repairActionPlan = {
    id: "controller:repair-branch",
    type: "action_plan",
    riskTier: "R2",
    plan: {
      actionType: "apply_patch_sandboxed",
      fileWrites: [{ path: "src/repair-target.mjs", content: "export const repaired = 2;\n" }],
    },
    verification: { commands: ["node --check src/repair-target.mjs"], metrics: ["verification_commands_pass"] },
  };

  const nodes = [
    { id: "observe", type: TASK_GRAPH_NODES.OBSERVE },
    { id: "plan", type: TASK_GRAPH_NODES.PLAN },
    { id: "policy", type: TASK_GRAPH_NODES.POLICY },
    { id: "scope", type: TASK_GRAPH_NODES.SCOPE },
    { id: "execute", type: TASK_GRAPH_NODES.EXECUTE },
    { id: "verify_initial", type: TASK_GRAPH_NODES.VERIFY },
    { id: "repair", type: TASK_GRAPH_NODES.REPAIR },
    { id: "verify_after_repair", type: TASK_GRAPH_NODES.VERIFY },
    { id: "feedback", type: TASK_GRAPH_NODES.FEEDBACK },
    { id: "finalize", type: TASK_GRAPH_NODES.FINALIZE },
  ];

  const result = await runAgentController(
    { title: "repair branch task", nodes },
    {
      workspaceRoot,
      actionPlan,
      repairActionPlan,
      config: {
        autoActionCommands: { allowlist: ["node --check"], denylist: ["rm", "del", "git push", "git tag", "npm publish"] },
        autoActions: { autoRepairEnabled: false },
      },
      taskScope: { allowedFiles: ["src/repair-target.mjs"], maxChangedFiles: 1 },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.state.state, AGENT_STATES.COMPLETED);
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "src/repair-target.mjs"), "utf-8"), "export const repaired = 2;\n");
  assert.ok(result.trace.events.some((event) => event.type === "node.recovery_branch" && event.data?.recoveryNode === "repair"));
  const repairArtifact = result.state.artifacts.find((artifact) => artifact.node === "repair");
  assert.equal(repairArtifact?.payload?.repair?.ok, true);
});
