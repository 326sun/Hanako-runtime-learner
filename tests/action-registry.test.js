import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { ACTION_TYPES } from "../lib/action-types.js";
import {
  createActionRegistry,
  executeRegisteredAction,
  getActionDefinition,
  listRegisteredActions,
  registerAction,
  unregisterAction,
  validateActionDefinition,
  validateActionPlanAgainstRegistry,
} from "../lib/action-registry.js";
import { discoverActionPackageNames, loadActionPackage, loadActionPackages } from "../lib/action-loader.js";

const tmpRoot = path.join(os.tmpdir(), `action-registry-${Date.now()}`);

function writeActionPackage(name, manifest, files = {}) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "action.json"), JSON.stringify(manifest, null, 2), "utf-8");
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content, "utf-8");
  }
  return dir;
}

describe("action registry", () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  it("creates a registry with immutable core actions", () => {
    const registry = createActionRegistry();
    assert.ok(getActionDefinition(registry, ACTION_TYPES.RUN_TESTS));
    assert.ok(listRegisteredActions(registry).length >= 1);

    const override = registerAction(registry, {
      name: ACTION_TYPES.RUN_TESTS,
      riskTier: "R1",
      permissions: { filesystem: "read" },
      verification: { required: true },
    });
    assert.equal(override.ok, false);
    assert.match(override.errors.join("\n"), /override core action/);
  });

  it("registers a safe plugin action", () => {
    const registry = createActionRegistry();
    const result = registerAction(registry, {
      name: "repo_summary",
      riskTier: "R1",
      autoExecutable: true,
      permissions: { filesystem: "read" },
      verification: { required: true, metrics: ["success"] },
      rollback: { required: false },
      handler: async () => ({ status: "succeeded", summary: "ok" }),
    });
    assert.equal(result.ok, true);
    assert.equal(getActionDefinition(registry, "repo_summary").name, "repo_summary");
  });

  it("rejects R2 write plugins without rollback", () => {
    const validation = validateActionDefinition({
      name: "write_report",
      riskTier: "R2",
      permissions: { filesystem: "workspace_write" },
      verification: { required: true },
      rollback: { required: false },
    });
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /must require rollback/);
  });

  it("rejects unsafe commands and safety-policy override flags", () => {
    const validation = validateActionDefinition({
      name: "publish_release",
      riskTier: "R2",
      permissions: { filesystem: "read", commands: ["git push origin main"] },
      verification: { required: true },
      metadata: { bypassPolicy: true },
    });
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /unsafe command/);
    assert.match(validation.errors.join("\n"), /override safety policy/);
  });

  it("validates plans against registered action schemas", () => {
    const registry = createActionRegistry({ includeCore: false });
    registerAction(registry, {
      name: "summarize_file",
      riskTier: "R1",
      autoExecutable: true,
      inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
      permissions: { filesystem: "read" },
      verification: { required: true },
      handler: async () => ({ status: "succeeded" }),
    });
    const rejected = validateActionPlanAgainstRegistry({ plan: { actionType: "summarize_file", input: {} } }, registry);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.decision, "reject");

    const allowed = validateActionPlanAgainstRegistry({ plan: { actionType: "summarize_file", input: { path: "README.md" } } }, registry);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.decision, "allow");
  });

  it("queues high-risk registered actions instead of auto-executing", async () => {
    const registry = createActionRegistry({ includeCore: false });
    registerAction(registry, {
      name: "change_ci_policy",
      riskTier: "R3",
      permissions: { filesystem: "workspace_write" },
      verification: { required: true },
      rollback: { required: true },
      handler: async () => ({ status: "succeeded" }),
    });
    const result = await executeRegisteredAction({ plan: { actionType: "change_ci_policy" } }, registry);
    assert.equal(result.status, "queued");
    assert.match(result.error, /high risk/);
  });

  it("executes registered in-memory handlers after registry validation", async () => {
    const registry = createActionRegistry({ includeCore: false });
    registerAction(registry, {
      name: "repo_summary",
      riskTier: "R1",
      autoExecutable: true,
      permissions: { filesystem: "read" },
      verification: { required: true },
      handler: async (actionPlan) => ({ status: "succeeded", input: actionPlan.plan.input }),
    });
    const result = await executeRegisteredAction({ plan: { actionType: "repo_summary", input: { topic: "x" } } }, registry);
    assert.equal(result.status, "succeeded");
    assert.equal(result.actionType, "repo_summary");
    assert.deepEqual(result.output.input, { topic: "x" });
  });

  it("loads action packages and requires explicit plugin code execution", async () => {
    const dir = writeActionPackage("repo_summary", {
      name: "repo_summary",
      riskTier: "R1",
      autoExecutable: true,
      permissions: { filesystem: "read" },
      verification: { required: true, metrics: ["success"] },
    }, {
      "execute.js": "export async function execute() { return { status: 'succeeded', summary: 'loaded' }; }\n",
      "verify.js": "export async function verify() { return { status: 'succeeded' }; }\n",
    });

    const loaded = loadActionPackage(dir, { actionsRoot: tmpRoot });
    assert.equal(loaded.ok, true);
    const registry = createActionRegistry({ includeCore: false });
    registerAction(registry, loaded.action);

    const queued = await executeRegisteredAction({ plan: { actionType: "repo_summary" } }, registry);
    assert.equal(queued.status, "queued");
    assert.match(queued.error, /explicit allowPluginCodeExecution/);

    const executed = await executeRegisteredAction({ plan: { actionType: "repo_summary" } }, registry, { allowPluginCodeExecution: true });
    assert.equal(executed.status, "succeeded");
    assert.equal(executed.output.summary, "loaded");
  });

  it("loads multiple packages and reports invalid packages", () => {
    writeActionPackage("safe_action", {
      name: "safe_action",
      riskTier: "R1",
      permissions: { filesystem: "read" },
      verification: { required: true },
    }, {
      "execute.js": "export default async function execute() { return { status: 'succeeded' }; }\n",
      "verify.js": "export async function verify() { return { status: 'succeeded' }; }\n",
    });
    writeActionPackage("unsafe_action", {
      name: "unsafe_action",
      riskTier: "R2",
      permissions: { filesystem: "workspace_write" },
      verification: { required: true },
      rollback: { required: false },
    }, {
      "execute.js": "export default async function execute() { return { status: 'succeeded' }; }\n",
      "verify.js": "export async function verify() { return { status: 'succeeded' }; }\n",
    });

    assert.deepEqual(discoverActionPackageNames(tmpRoot), ["safe_action", "unsafe_action"]);
    const registry = createActionRegistry({ includeCore: false });
    const loaded = loadActionPackages(tmpRoot, registry);
    assert.equal(loaded.loaded, 1);
    assert.equal(loaded.rejected, 1);
    assert.ok(getActionDefinition(registry, "safe_action"));
    assert.equal(getActionDefinition(registry, "unsafe_action"), null);
  });

  it("does not allow plugin actions to unregister core actions", () => {
    const registry = createActionRegistry();
    const result = unregisterAction(registry, ACTION_TYPES.APPLY_PATCH_SANDBOXED);
    assert.equal(result.ok, false);
    assert.match(result.error, /core action cannot be unregistered/);
  });

  it("package actions execute verify.js and declared verification commands", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "action-registry-workspace-"));
  fs.writeFileSync(path.join(workspaceRoot, "index.js"), "const ok = true;\n", "utf-8");
  const dir = writeActionPackage("verified_action", {
    name: "verified_action",
    riskTier: "R1",
    autoExecutable: true,
    permissions: { filesystem: "read" },
    verification: { required: true, commands: ["node --check index.js"] },
  }, {
    "execute.js": "export async function execute() { return { status: 'succeeded', value: 42 }; }\n",
    "verify.js": "export async function verify(_plan, context) { return { status: context.output.value === 42 ? 'succeeded' : 'failed', message: 'value checked' }; }\n",
  });

  const loaded = loadActionPackage(dir, { actionsRoot: tmpRoot });
  assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
  const registry = createActionRegistry({ includeCore: false });
  registerAction(registry, loaded.action);

  const result = await executeRegisteredAction({ plan: { actionType: "verified_action" } }, registry, {
    allowPluginCodeExecution: true,
    workspaceRoot,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.verification.verified, true);
  assert.ok(result.verification.checks.some((check) => check.name === "registered_action_verify_module"));
  assert.ok(result.verification.checks.some((check) => check.name === "registered_action_verify_command" && check.command === "node --check index.js"));
});

  it("package verification failure triggers guarded rollback.js", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "action-registry-rollback-"));
  const dir = writeActionPackage("write_then_fail", {
    name: "write_then_fail",
    riskTier: "R2",
    autoExecutable: true,
    permissions: { filesystem: "workspace_write" },
    verification: { required: true },
    rollback: { required: true, strategy: "plugin_rollback" },
  }, {
    "execute.js": `import fs from "fs";\nimport path from "path";\nexport async function execute(_plan, context) { fs.writeFileSync(path.join(context.workspaceRoot, "target.txt"), "bad", "utf-8"); return { status: "succeeded" }; }\n`,
    "verify.js": "export async function verify() { return { status: 'failed', error: 'forced verification failure' }; }\n",
    "rollback.js": `import fs from "fs";\nimport path from "path";\nexport async function rollback(_plan, context) { fs.writeFileSync(path.join(context.workspaceRoot, "target.txt"), "rolled back", "utf-8"); return { status: "succeeded" }; }\n`,
  });

  const loaded = loadActionPackage(dir, { actionsRoot: tmpRoot });
  assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
  const registry = createActionRegistry({ includeCore: false });
  registerAction(registry, loaded.action);

  const result = await executeRegisteredAction({ plan: { actionType: "write_then_fail" } }, registry, {
    allowPluginCodeExecution: true,
    workspaceRoot,
  });

  assert.equal(result.status, "reverted");
  assert.equal(result.verification.verified, false);
  assert.equal(result.rollback.ok, true);
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "target.txt"), "utf-8"), "rolled back");
});

  it("isolates package action modules in child processes with sanitized env and workspace cwd", async () => {
    process.env.HANAKO_SECRET_SHOULD_NOT_LEAK = "top-secret";
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "action-registry-isolated-"));
    const dir = writeActionPackage("isolated_action", {
      name: "isolated_action",
      riskTier: "R1",
      autoExecutable: true,
      permissions: { filesystem: "read" },
      verification: { required: true },
    }, {
      "execute.js": `export async function execute(_plan, context) { return { status: "succeeded", pid: process.pid, parentPid: context.parentPid, secret: process.env.HANAKO_SECRET_SHOULD_NOT_LEAK || null, cwd: process.cwd(), execArgv: process.execArgv }; }\n`,
      "verify.js": "export async function verify() { return { status: 'succeeded' }; }\n",
    });

    const loaded = loadActionPackage(dir, { actionsRoot: tmpRoot });
    assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
    const registry = createActionRegistry({ includeCore: false });
    registerAction(registry, loaded.action);

    const result = await executeRegisteredAction({ plan: { actionType: "isolated_action" } }, registry, {
      allowPluginCodeExecution: true,
      workspaceRoot,
      parentPid: process.pid,
    });

    assert.equal(result.status, "succeeded");
    assert.notEqual(result.output.pid, process.pid);
    assert.equal(result.output.parentPid, process.pid);
    assert.equal(result.output.secret, null);
    assert.equal(path.resolve(result.output.cwd), path.resolve(workspaceRoot));
    assert.equal(result.pluginProcess.execute.isolated, true);
    assert.notEqual(result.pluginProcess.execute.pid, process.pid);
    assert.ok(result.output.execArgv.some((arg) => arg === "--max-old-space-size=128"));
  });

  it("kills package action modules that exceed the plugin isolation timeout", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "action-registry-timeout-"));
    const dir = writeActionPackage("slow_action", {
      name: "slow_action",
      riskTier: "R1",
      autoExecutable: true,
      permissions: { filesystem: "read" },
      verification: { required: true },
    }, {
      "execute.js": "export async function execute() { await new Promise((resolve) => setTimeout(resolve, 500)); return { status: 'succeeded' }; }\n",
      "verify.js": "export async function verify() { return { status: 'succeeded' }; }\n",
    });

    const loaded = loadActionPackage(dir, { actionsRoot: tmpRoot });
    assert.equal(loaded.ok, true, loaded.errors?.join("\n"));
    const registry = createActionRegistry({ includeCore: false });
    registerAction(registry, loaded.action);

    const result = await executeRegisteredAction({ plan: { actionType: "slow_action" } }, registry, {
      allowPluginCodeExecution: true,
      workspaceRoot,
      pluginIsolation: { timeoutMs: 50 },
    });

    assert.equal(result.status, "failed");
    assert.match(result.error, /timed out/);
    assert.equal(result.pluginProcess.execute.timedOut, true);
  });

});
