import { RISK_TIERS, RISK_TIER_ORDER } from "./action-types.js";
import { runSandboxedCommand } from "./command-allowlist.js";
import { runPluginFunctionInChild } from "./plugin-process-runner.js";

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

function getRegisteredDefinition(registry, name) {
  return registry?.actions?.get(String(name || "")) || null;
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
  const definition = getRegisteredDefinition(registry, actionType);
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
