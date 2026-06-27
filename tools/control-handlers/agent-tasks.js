// Agent-task control handlers (C-001 HANDLERS split — agent domain).
//
// Extracted verbatim from tools/control.js. These handlers take (input, p[, config])
// and drive the experimental agent task lifecycle (read-only preview/list/show +
// approve/reject/cancel/resume). They own NO permission/side-effect decisions —
// control.js keeps the action dispatch, the *_ACTIONS classification sets,
// describeControlSideEffect and sessionPermission. This module only implements
// the handler bodies and is spread back into the control HANDLERS table under the
// same action names. Moving them here removes the agent-graph-readonly /
// agent-task-store / agent-resume imports from control.js (import-budget relief).

import { runReadonlyAgentGraph } from "../../lib/agent-graph-readonly.js";
import { listAgentTaskStates, readAgentTaskBundle } from "../../lib/agent-task-store.js";
import { approveAgentTask, cancelAgentTask, rejectAgentTask, resumeAgentTask } from "../../lib/agent-resume.js";

export const agentTaskHandlers = {
  agent_graph_preview(input) {
    return runReadonlyAgentGraph({ context: input.context, plan: input.plan });
  },

  list_agent_tasks(input, p) {
    const tasks = listAgentTaskStates(p.learnerDir, { limit: input.limit || 50 });
    return JSON.stringify({ ok: true, tasks, nextAction: "show_agent_task" }, null, 2);
  },

  show_agent_task(input, p) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const bundle = readAgentTaskBundle(p.learnerDir, taskId);
    if (!bundle) throw new Error(`agent task not found: ${taskId}`);
    return JSON.stringify({ ok: true, ...bundle, nextAction: bundle.summary.pendingApprovals > 0 ? "approve_agent_task or reject_agent_task" : "resume_agent_task" }, null, 2);
  },

  approve_agent_task(input, p) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const approved = approveAgentTask(p.learnerDir, taskId, { requestId: input.requestId || null, reason: input.reason || "approved through self_learning_control" });
    return JSON.stringify({ ok: true, taskId, requestId: approved.requestId, state: approved.state.state, nextAction: "resume_agent_task" }, null, 2);
  },

  reject_agent_task(input, p) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const rejected = rejectAgentTask(p.learnerDir, taskId, { requestId: input.requestId || null, reason: input.reason || "rejected through self_learning_control" });
    return JSON.stringify({ ok: true, taskId, requestId: rejected.requestId, state: rejected.state.state, nextAction: "show_agent_task" }, null, 2);
  },

  cancel_agent_task(input, p) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const cancelled = cancelAgentTask(p.learnerDir, taskId, { requestId: input.requestId || null, reason: input.reason || "cancelled through self_learning_control" });
    return JSON.stringify({ ok: true, taskId, state: cancelled.state.state, nextAction: "show_agent_task" }, null, 2);
  },

  async resume_agent_task(input, p, config) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const resumed = await resumeAgentTask(p.learnerDir, taskId, { learnerDir: p.learnerDir, config, workspaceRoot: p.pluginDir });
    return JSON.stringify({ ok: resumed.ok, taskId, state: resumed.state.state, traceEvents: resumed.trace?.events?.length || 0, nextAction: resumed.state.state === "waiting_for_human" ? "show_agent_task then approve_agent_task or reject_agent_task" : "show_agent_task" }, null, 2);
  },
};
