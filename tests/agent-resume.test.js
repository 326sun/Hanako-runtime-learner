import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { AgentController } from "../lib/agent-controller.js";
import { approveAgentTask, cancelAgentTask, rejectAgentTask, resumeAgentTask } from "../lib/agent-resume.js";
import { AGENT_STATES } from "../lib/agent-state-machine.js";
import { TASK_GRAPH_NODES } from "../lib/task-graph.js";
import { latestPendingApproval } from "../lib/human-interrupt.js";
import { listAgentTaskStates, readAgentTaskBundle, saveAgentTaskState } from "../lib/agent-task-store.js";
import { loadAuditTrace, summarizeAuditTrace } from "../lib/audit-trace.js";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-"));
}

async function createPausedTask(learnerDir) {
  const controller = new AgentController({
    handlers: {
      [TASK_GRAPH_NODES.POLICY]: () => ({
        status: "manual_confirm",
        riskTier: "R3",
        summary: "synthetic approval required",
      }),
    },
  });
  return controller.run({ title: "requires approval" }, { learnerDir });
}

test("agent controller persists paused tasks for resume tooling", async () => {
  const learnerDir = tmpdir();
  const paused = await createPausedTask(learnerDir);
  assert.equal(paused.state.state, AGENT_STATES.WAITING_FOR_HUMAN);

  const tasks = listAgentTaskStates(learnerDir);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].state, AGENT_STATES.WAITING_FOR_HUMAN);
  assert.equal(tasks[0].pendingApprovals, 1);

  const bundle = readAgentTaskBundle(learnerDir, paused.state.taskId);
  assert.equal(bundle.summary.taskId, paused.state.taskId);
  assert.ok(bundle.trace.events.some((event) => event.type === "human.interrupt"));
});

test("approved agent task resumes after the approved node", async () => {
  const learnerDir = tmpdir();
  const paused = await createPausedTask(learnerDir);
  const pending = latestPendingApproval(paused.state);
  assert.ok(pending);

  const approved = approveAgentTask(learnerDir, paused.state.taskId, { requestId: pending.id, reason: "unit test approval" });
  assert.equal(approved.state.state, AGENT_STATES.SCOPE_CHECKING);
  assert.equal(latestPendingApproval(approved.state), null);

  const resumed = await resumeAgentTask(learnerDir, paused.state.taskId, { learnerDir });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.state.state, AGENT_STATES.COMPLETED);

  const trace = loadAuditTrace(learnerDir, paused.state.taskId);
  const summary = summarizeAuditTrace(trace);
  assert.equal(summary.byType["human.approved"], 1);
  assert.ok(summary.byType["state.completed"] >= 1);
});

test("agent task approval rejects stale pending requests", async () => {
  const learnerDir = tmpdir();
  const paused = await createPausedTask(learnerDir);
  const pending = latestPendingApproval(paused.state);
  assert.ok(pending);

  const stale = {
    ...pending,
    id: "approval:stale",
    node: TASK_GRAPH_NODES.PLAN,
    status: "pending",
    createdAt: new Date(Date.now() + 1000).toISOString(),
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  saveAgentTaskState(learnerDir, {
    ...paused.state,
    approvalRequests: [...paused.state.approvalRequests, stale],
  });

  assert.throws(
    () => approveAgentTask(learnerDir, paused.state.taskId, { reason: "ambiguous approval" }),
    /approval request node mismatch|ambiguous pending approval requests/,
  );
  assert.throws(
    () => rejectAgentTask(learnerDir, paused.state.taskId, { requestId: stale.id, reason: "reject stale" }),
    /approval request node mismatch/,
  );
});

test("agent task cancel does not rewrite resolved approval requests", async () => {
  const learnerDir = tmpdir();
  const paused = await createPausedTask(learnerDir);
  const pending = latestPendingApproval(paused.state);
  assert.ok(pending);

  approveAgentTask(learnerDir, paused.state.taskId, { requestId: pending.id, reason: "unit test approval" });
  assert.throws(
    () => cancelAgentTask(learnerDir, paused.state.taskId, { requestId: pending.id, reason: "rewrite approval" }),
    /pending approval request not found/,
  );
});

test("rejected agent task becomes failed and cannot resume work", async () => {
  const learnerDir = tmpdir();
  const paused = await createPausedTask(learnerDir);
  const rejected = rejectAgentTask(learnerDir, paused.state.taskId, { reason: "unsafe" });
  assert.equal(rejected.state.state, AGENT_STATES.FAILED);

  const resumed = await resumeAgentTask(learnerDir, paused.state.taskId, { learnerDir });
  assert.equal(resumed.skipped, true);
  assert.equal(resumed.state.state, AGENT_STATES.FAILED);
});

test("cancelled agent task is terminal", async () => {
  const learnerDir = tmpdir();
  const paused = await createPausedTask(learnerDir);
  const cancelled = cancelAgentTask(learnerDir, paused.state.taskId, { reason: "stop" });
  assert.equal(cancelled.state.state, AGENT_STATES.CANCELLED);

  const tasks = listAgentTaskStates(learnerDir, { status: AGENT_STATES.CANCELLED });
  assert.equal(tasks.length, 1);
});
