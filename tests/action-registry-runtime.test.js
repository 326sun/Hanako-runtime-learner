import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { executeActionPlan } from "../lib/action-executor.js";
import { createActionRegistry, registerAction } from "../lib/action-registry.js";
import { AgentController } from "../lib/agent-controller.js";
import { AGENT_STATES } from "../lib/agent-state-machine.js";
import { latestPendingApproval } from "../lib/human-interrupt.js";

function tmpdir(prefix = "registry-runtime-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function pluginRegistry(definition = {}) {
  const registry = createActionRegistry();
  const registered = registerAction(registry, {
    name: "repo_summary",
    riskTier: "R1",
    autoExecutable: true,
    permissions: { filesystem: "read" },
    verification: { required: true, metrics: ["success"] },
    handler: async (actionPlan) => ({ status: "succeeded", summary: actionPlan.plan.input?.topic || "ok" }),
    ...definition,
  });
  assert.equal(registered.ok, true, registered.errors?.join("\n"));
  return registry;
}

test("executor routes non-core registered actions through the runtime registry", async () => {
  const registry = pluginRegistry();
  const result = await executeActionPlan({
    id: "plugin:1",
    plan: { actionType: "repo_summary", input: { topic: "registry" } },
  }, { actionRegistry: registry, workspaceRoot: tmpdir() });

  assert.equal(result.status, "succeeded");
  assert.equal(result.actionType, "repo_summary");
  assert.equal(result.output.summary, "registry");
  assert.equal(result.registry.action.name, "repo_summary");
  assert.equal(result.verification.verified, true);
});

test("executor queues registered actions that are not auto executable", async () => {
  const registry = pluginRegistry({ autoExecutable: false });
  const result = await executeActionPlan({ plan: { actionType: "repo_summary" } }, {
    actionRegistry: registry,
    workspaceRoot: tmpdir(),
  });

  assert.equal(result.status, "queued");
  assert.match(result.error, /not marked autoExecutable/);
  assert.equal(result.verification.verified, false);
});

test("agent controller executes registered plugin actions through ExecuteNode", async () => {
  const registry = pluginRegistry();
  const controller = new AgentController();
  const result = await controller.run({ title: "plugin runtime task" }, {
    actionRegistry: registry,
    workspaceRoot: tmpdir(),
    actionPlan: { id: "agent-plugin:1", plan: { actionType: "repo_summary", input: { topic: "agent" } } },
  });

  assert.equal(result.state.state, AGENT_STATES.COMPLETED);
  const executeArtifact = result.state.artifacts.find((artifact) => artifact.node === "ExecuteNode");
  assert.equal(executeArtifact.payload.registryExecution.actionType, "repo_summary");
  assert.equal(executeArtifact.payload.output.summary, "agent");
});

test("agent controller pauses before executing plugin package code without explicit allow flag", async () => {
  const packageDir = tmpdir("registry-package-");
  const executeModulePath = path.join(packageDir, "execute.js");
  fs.writeFileSync(executeModulePath, "export async function execute() { return { status: 'succeeded' }; }\n");
  const registry = createActionRegistry();
  const registered = registerAction(registry, {
    name: "repo_summary",
    source: "plugin",
    riskTier: "R1",
    autoExecutable: true,
    permissions: { filesystem: "read" },
    verification: { required: true, metrics: ["success"] },
    executeModulePath,
  });
  assert.equal(registered.ok, true, registered.errors?.join("\n"));

  const controller = new AgentController();
  const result = await controller.run({ title: "plugin code task" }, {
    actionRegistry: registry,
    workspaceRoot: tmpdir(),
    actionPlan: { id: "agent-plugin:code", plan: { actionType: "repo_summary" } },
  });

  assert.equal(result.state.state, AGENT_STATES.WAITING_FOR_HUMAN);
  const pending = latestPendingApproval(result.state);
  assert.ok(pending);
  assert.match(pending.summary, /plugin code execution requires explicit/);
});
