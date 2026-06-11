import { nowIso } from "./common.js";
import { ACTION_TYPE_SET, RISK_TIERS, RISK_TIER_ORDER } from "./action-types.js";
import { isCommandAllowed, runSandboxedCommand } from "./command-allowlist.js";
import { runPluginFunctionInChild } from "./plugin-process-runner.js";

const ACTION_NAME_RE = /^[a-z][a-z0-9_-]{1,79}$/;
const VALID_FILESYSTEM_PERMISSIONS = new Set(["none", "read", "write", "workspace_write"]);
const CORE_SAFETY_FLAGS = new Set([
  "bypassPolicy",
  "bypassScopeGate",
  "bypassVerifier",
  "bypassRollback",
  "bypassSandbox",
  "allowUnsafeCommands",
  "overrideCorePolicy",
  "disablePolicyGate",
  "disableScopeGate",
  "disableVerifier",
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function riskOrder(tier) {
  return RISK_TIER_ORDER[tier] ?? 99;
}

function highestRisk(a, b) {
  return riskOrder(a) >= riskOrder(b) ? a : b;
}

function hasWritePermission(permissions = {}) {
  return ["write", "workspace_write"].includes(permissions.filesystem);
}

function collectUnsafeFlagPaths(value, prefix = "") {
  const hits = [];
  if (!value || typeof value !== "object") return hits;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (CORE_SAFETY_FLAGS.has(key) && child) hits.push(nextPath);
    if (child && typeof child === "object") hits.push(...collectUnsafeFlagPaths(child, nextPath));
  }
  return hits;
}

function normalizePermissions(permissions = {}) {
  return {
    filesystem: permissions.filesystem || "none",
    commands: asArray(permissions.commands).map((command) => String(command || "").trim()).filter(Boolean),
    network: permissions.network === true,
    externalSideEffects: permissions.externalSideEffects === true,
  };
}

function normalizeVerification(verification = {}) {
  return {
    required: verification.required === true,
    commands: asArray(verification.commands).map((command) => String(command || "").trim()).filter(Boolean),
    metrics: asArray(verification.metrics).map((metric) => String(metric || "").trim()).filter(Boolean),
  };
}

function normalizeRollback(rollback = {}) {
  return {
    required: rollback.required === true,
    strategy: rollback.strategy || null,
  };
}

export function normalizeActionDefinition(definition = {}, options = {}) {
  const source = options.source || definition.source || "plugin";
  const permissions = normalizePermissions(definition.permissions || {});
  const verification = normalizeVerification(definition.verification || {});
  const rollback = normalizeRollback(definition.rollback || {});
  return {
    name: String(definition.name || "").trim(),
    title: definition.title || definition.name || "",
    version: definition.version || "1.0.0",
    description: definition.description || "",
    source,
    riskTier: definition.riskTier || RISK_TIERS.R2,
    autoExecutable: definition.autoExecutable === true,
    inputSchema: definition.inputSchema && typeof definition.inputSchema === "object" ? clone(definition.inputSchema) : { type: "object" },
    outputSchema: definition.outputSchema && typeof definition.outputSchema === "object" ? clone(definition.outputSchema) : { type: "object" },
    permissions,
    verification,
    rollback,
    packageDir: definition.packageDir || null,
    executeModulePath: definition.executeModulePath || null,
    verifyModulePath: definition.verifyModulePath || null,
    rollbackModulePath: definition.rollbackModulePath || null,
    handler: definition.handler || null,
    registeredAt: definition.registeredAt || nowIso(),
    metadata: definition.metadata && typeof definition.metadata === "object" ? clone(definition.metadata) : {},
  };
}

export function validateActionDefinition(definition = {}, options = {}) {
  const normalized = normalizeActionDefinition(definition, options);
  const errors = [];
  const warnings = [];
  const coreActionNames = options.coreActionNames || ACTION_TYPE_SET;

  if (!ACTION_NAME_RE.test(normalized.name)) {
    errors.push("action name must match /^[a-z][a-z0-9_-]{1,79}$/");
  }
  if (normalized.source !== "core" && coreActionNames.has(normalized.name)) {
    errors.push(`plugin action cannot override core action type: ${normalized.name}`);
  }
  if (!Object.values(RISK_TIERS).includes(normalized.riskTier)) {
    errors.push(`invalid riskTier: ${normalized.riskTier}`);
  }
  if (!VALID_FILESYSTEM_PERMISSIONS.has(normalized.permissions.filesystem)) {
    errors.push(`invalid filesystem permission: ${normalized.permissions.filesystem}`);
  }
  if ((normalized.riskTier === RISK_TIERS.R0 || normalized.riskTier === RISK_TIERS.R1) && hasWritePermission(normalized.permissions)) {
    errors.push("write-capable plugin actions must be R2 or higher");
  }
  if (riskOrder(normalized.riskTier) >= riskOrder(RISK_TIERS.R2) && hasWritePermission(normalized.permissions) && normalized.rollback.required !== true) {
    errors.push("R2+ write-capable plugin actions must require rollback");
  }
  if (riskOrder(normalized.riskTier) >= riskOrder(RISK_TIERS.R3) && normalized.autoExecutable) {
    errors.push("R3/R4 plugin actions cannot be marked autoExecutable");
  }
  if (normalized.permissions.network) {
    errors.push("plugin actions cannot request network permission in the LTS registry");
  }
  if (normalized.permissions.externalSideEffects) {
    errors.push("plugin actions cannot request external side effects");
  }

  const unsafeFlagPaths = collectUnsafeFlagPaths(definition);
  if (unsafeFlagPaths.length > 0) {
    errors.push(`plugin action attempts to override safety policy: ${unsafeFlagPaths.join(", ")}`);
  }

  const declaredCommands = [...normalized.permissions.commands, ...normalized.verification.commands];
  for (const command of declaredCommands) {
    const check = isCommandAllowed(command, {
      commands: {
        allowlist: [command],
        denylist: ["rm", "del", "git push", "git tag", "npm publish", "curl", "wget"],
        allowProjectScripts: true,
      },
    });
    if (!check.allowed) errors.push(`unsafe command declared by plugin: ${command} (${check.reason})`);
  }

  if (normalized.verification.required !== true) {
    warnings.push("verification.required is false; action must not be auto-executed");
  }
  if (normalized.source === "plugin" && !normalized.handler && !normalized.executeModulePath) {
    warnings.push("plugin has no executable handler; it can be registered but not executed");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    action: normalized,
  };
}

function coreActionDefinition(name) {
  const writeAction = ["apply_patch_sandboxed", "execute_repair_once"].includes(name);
  const commandAction = ["run_tests", "run_lint"].includes(name);
  return normalizeActionDefinition({
    name,
    title: name,
    source: "core",
    riskTier: writeAction ? RISK_TIERS.R2 : commandAction ? RISK_TIERS.R1 : RISK_TIERS.R0,
    autoExecutable: riskOrder(writeAction ? RISK_TIERS.R2 : RISK_TIERS.R1) <= riskOrder(RISK_TIERS.R2),
    permissions: {
      filesystem: writeAction ? "workspace_write" : "read",
      commands: commandAction ? [name === "run_tests" ? "npm test" : "npm run check"] : [],
      network: false,
      externalSideEffects: false,
    },
    verification: { required: writeAction || commandAction, commands: commandAction ? [name === "run_tests" ? "npm test" : "npm run check"] : [] },
    rollback: { required: writeAction },
  }, { source: "core" });
}

export function createActionRegistry({ includeCore = true } = {}) {
  const actions = new Map();
  const registry = {
    createdAt: nowIso(),
    actions,
  };
  if (includeCore) {
    for (const name of ACTION_TYPE_SET) {
      actions.set(name, coreActionDefinition(name));
    }
  }
  return registry;
}

export function listRegisteredActions(registry) {
  return [...(registry?.actions || new Map()).values()].map((action) => ({ ...action, handler: action.handler ? "[function]" : null }));
}

export function getActionDefinition(registry, name) {
  return registry?.actions?.get(String(name || "")) || null;
}

export function registerAction(registry, definition = {}, options = {}) {
  if (!registry?.actions) throw new Error("invalid action registry");
  const validation = validateActionDefinition(definition, options);
  if (!validation.ok) {
    return { ok: false, decision: "reject", errors: validation.errors, warnings: validation.warnings, action: validation.action };
  }
  const existing = registry.actions.get(validation.action.name);
  if (existing?.source === "core" && validation.action.source !== "core") {
    return { ok: false, decision: "reject", errors: [`cannot override core action: ${validation.action.name}`], warnings: validation.warnings, action: validation.action };
  }
  if (existing && options.allowReplace !== true) {
    return { ok: false, decision: "reject", errors: [`action already registered: ${validation.action.name}`], warnings: validation.warnings, action: validation.action };
  }
  registry.actions.set(validation.action.name, validation.action);
  return { ok: true, decision: "registered", warnings: validation.warnings, action: validation.action };
}

export function unregisterAction(registry, name) {
  const existing = getActionDefinition(registry, name);
  if (!existing) return { ok: false, decision: "missing", error: `action not registered: ${name}` };
  if (existing.source === "core") return { ok: false, decision: "reject", error: `core action cannot be unregistered: ${name}` };
  registry.actions.delete(existing.name);
  return { ok: true, decision: "unregistered", action: existing.name };
}

function actionTypeOf(actionPlan = {}) {
  return actionPlan.plan?.actionType || actionPlan.actionType || "";
}

function validateSchemaLite(schema = {}, input = {}) {
  if (!schema || schema.type !== "object") return { ok: true, errors: [] };
  const errors = [];
  for (const required of asArray(schema.required)) {
    if (!(required in input)) errors.push(`missing required input: ${required}`);
  }
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  for (const [key, property] of Object.entries(properties)) {
    if (!(key in input) || !property?.type) continue;
    const actual = Array.isArray(input[key]) ? "array" : typeof input[key];
    if (actual !== property.type) errors.push(`input ${key} must be ${property.type}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateActionPlanAgainstRegistry(actionPlan = {}, registry, context = {}) {
  const actionType = actionTypeOf(actionPlan);
  const definition = getActionDefinition(registry, actionType);
  if (!definition) {
    return { ok: false, decision: "reject", reason: [`unknown action type: ${actionType || "<empty>"}`], riskTier: RISK_TIERS.R4 };
  }

  const reason = [];
  const declaredRisk = actionPlan.riskTier || actionPlan.plan?.riskTier || definition.riskTier;
  const effectiveRisk = highestRisk(declaredRisk, definition.riskTier);
  const input = actionPlan.plan?.input || actionPlan.input || {};
  const schema = validateSchemaLite(definition.inputSchema, input);
  if (!schema.ok) reason.push(...schema.errors);

  const command = actionPlan.plan?.command || actionPlan.command || null;
  if (command && !definition.permissions.commands.includes(command) && definition.verification.commands.includes(command) === false) {
    reason.push(`command not declared by action permission: ${command}`);
  }

  if (riskOrder(effectiveRisk) >= riskOrder(RISK_TIERS.R3)) {
    return { ok: false, decision: "manual_confirm", reason: ["registered action is high risk", ...reason], action: definition, riskTier: effectiveRisk };
  }
  if (definition.verification.required !== true) {
    return { ok: false, decision: "manual_confirm", reason: ["registered action does not require verification", ...reason], action: definition, riskTier: effectiveRisk };
  }
  if (context.requireAutoExecutable === true && definition.autoExecutable !== true) {
    return { ok: false, decision: "manual_confirm", reason: ["registered action is not marked autoExecutable", ...reason], action: definition, riskTier: effectiveRisk };
  }
  if (reason.length > 0) {
    return { ok: false, decision: "reject", reason, action: definition, riskTier: effectiveRisk };
  }
  return { ok: true, decision: "allow", reason: [], action: definition, riskTier: effectiveRisk };
}

function pluginProcessError(processResult, label) {
  const err = new Error(processResult?.error || `${label} plugin process failed`);
  err.pluginProcess = processResult;
  return err;
}

async function invokePluginFunction(definition, modulePath, exportName, inMemoryFunction, actionPlan, context) {
  if (typeof inMemoryFunction === "function") {
    const result = await inMemoryFunction(actionPlan, context, definition);
    return { result, process: { isolated: false, inMemory: true } };
  }
  if (!modulePath) return { result: null, process: null, missing: true };
  const processResult = await runPluginFunctionInChild({ modulePath, exportName, actionPlan, context, definition });
  if (processResult.status !== "succeeded") throw pluginProcessError(processResult, exportName);
  return { result: processResult.result, process: processResult };
}

async function invokeExecuteFunction(definition, actionPlan, context) {
  return invokePluginFunction(definition, definition.executeModulePath, "execute", definition.handler, actionPlan, context);
}

async function invokeVerifyFunction(definition, actionPlan, context) {
  return invokePluginFunction(definition, definition.verifyModulePath, "verify", definition.verifyHandler, actionPlan, context);
}

async function invokeRollbackFunction(definition, actionPlan, context) {
  return invokePluginFunction(definition, definition.rollbackModulePath, "rollback", definition.rollbackHandler, actionPlan, context);
}

function moduleExecutionRequiresApproval(definition, context = {}) {
  if (definition.source !== "plugin") return false;
  const hasPluginModule = Boolean(definition.executeModulePath || definition.verifyModulePath || definition.rollbackModulePath);
  return hasPluginModule && context.allowPluginCodeExecution !== true;
}

function normalizePluginStatus(value, fallback = "succeeded") {
  if (value === true) return "succeeded";
  if (value === false) return "failed";
  if (typeof value === "string") return value;
  return value?.status || (value?.ok === false || value?.verified === false ? "failed" : fallback);
}

function pluginCheckPassed(value) {
  const status = normalizePluginStatus(value);
  if (value?.verified === true || value?.ok === true) return true;
  if (value?.verified === false || value?.ok === false) return false;
  return status === "succeeded";
}

function pluginCheckMessage(value) {
  if (typeof value === "string") return value;
  return value?.message || value?.error || value?.status || (value === true ? "succeeded" : value === false ? "failed" : "completed");
}

function commandPolicyForDefinition(definition, context = {}) {
  const declaredCommands = [...definition.permissions.commands, ...definition.verification.commands];
  return {
    ...(context.commandPolicy || {}),
    commands: {
      ...(context.commandPolicy?.commands || {}),
      allowlist: [...new Set([...(context.commandPolicy?.commands?.allowlist || []), ...declaredCommands])],
      denylist: [...new Set([...(context.commandPolicy?.commands?.denylist || []), "rm", "del", "git push", "git tag", "npm publish", "curl", "wget"])],
      allowProjectScripts: true,
    },
  };
}

async function verifyRegisteredAction(definition, actionPlan, context, output, status) {
  const checks = [{ name: "registered_action_output", passed: status === "succeeded", message: status }];

  if (definition.verifyModulePath || typeof definition.verifyHandler === "function") {
    try {
      const verifyCall = await invokeVerifyFunction(definition, actionPlan, { ...context, output });
      const verifyResult = verifyCall.result;
      checks.push({
        name: "registered_action_verify_module",
        passed: pluginCheckPassed(verifyResult),
        message: pluginCheckMessage(verifyResult),
        result: clone(verifyResult),
        process: verifyCall.process,
      });
    } catch (err) {
      checks.push({
        name: "registered_action_verify_module",
        passed: false,
        message: err.message,
        process: err.pluginProcess || null,
      });
    }
  }

  const workspaceRoot = context.workspaceRoot || process.cwd();
  const timeout = Number(context.config?.autoActions?.maxExecutionMsPerAction || context.timeout || 30000);
  const policy = commandPolicyForDefinition(definition, context);
  for (const command of definition.verification.commands) {
    const commandResult = await runSandboxedCommand(command, { cwd: workspaceRoot, policy, timeout });
    checks.push({
      name: "registered_action_verify_command",
      passed: commandResult.status === "succeeded" && commandResult.exitCode === 0,
      message: commandResult.error || commandResult.status,
      command,
      result: commandResult,
    });
  }

  return {
    verified: checks.every((check) => check.passed),
    checks,
    required: definition.verification.required === true,
  };
}

async function rollbackRegisteredAction(definition, actionPlan, context, output, reason) {
  if (definition.rollback.required !== true) return { attempted: false, reason: "rollback not required" };
  if (!definition.rollbackModulePath && typeof definition.rollbackHandler !== "function") {
    return { attempted: false, ok: false, error: `registered action has no rollback handler: ${definition.name}` };
  }
  try {
    const call = await invokeRollbackFunction(definition, actionPlan, { ...context, output, rollbackReason: reason });
    const result = call.result;
    return { attempted: true, ok: pluginCheckPassed(result), message: pluginCheckMessage(result), result: clone(result), process: call.process };
  } catch (err) {
    return { attempted: true, ok: false, error: err.message, process: err.pluginProcess || null };
  }
}

export async function executeRegisteredAction(actionPlan = {}, registry, context = {}) {
  const validation = validateActionPlanAgainstRegistry(actionPlan, registry, { ...context, requireAutoExecutable: context.requireAutoExecutable === true });
  if (!validation.ok) {
    return { status: validation.decision === "manual_confirm" ? "queued" : "rejected", registry: validation, error: validation.reason.join("; ") };
  }
  const definition = validation.action;
  if (moduleExecutionRequiresApproval(definition, context)) {
    return { status: "queued", registry: { ...validation, decision: "manual_confirm", reason: ["plugin code execution requires explicit allowPluginCodeExecution"] }, error: "plugin code execution requires explicit allowPluginCodeExecution" };
  }
  if (!definition.handler && !definition.executeModulePath) {
    return { status: "failed", registry: validation, error: `registered action has no execute handler: ${definition.name}` };
  }
  const started = Date.now();
  let output = null;
  let executeProcess = null;
  try {
    const executeCall = await invokeExecuteFunction(definition, actionPlan, context);
    output = executeCall.result;
    executeProcess = executeCall.process;
    let status = normalizePluginStatus(output);
    let verification = await verifyRegisteredAction(definition, actionPlan, context, output, status);
    let rollback = null;

    if (!verification.verified && definition.rollback.required === true) {
      rollback = await rollbackRegisteredAction(definition, actionPlan, context, output, "verification_failed");
      status = rollback.ok ? "reverted" : "failed";
    }

    return {
      status,
      actionType: definition.name,
      registry: validation,
      output,
      pluginProcess: { execute: executeProcess },
      verification,
      rollback,
      error: verification.verified ? undefined : "registered action verification failed",
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const rollback = definition.rollback.required === true
      ? await rollbackRegisteredAction(definition, actionPlan, context, output, "execution_exception")
      : null;
    return {
      status: rollback?.ok ? "reverted" : "failed",
      actionType: definition.name,
      registry: validation,
      output,
      pluginProcess: { execute: err.pluginProcess || executeProcess },
      error: err.message,
      rollback,
      verification: {
        verified: false,
        checks: [{ name: "registered_action_exception", passed: false, message: err.message, process: err.pluginProcess || null }],
        required: definition.verification.required === true,
      },
      durationMs: Date.now() - started,
    };
  }
}
