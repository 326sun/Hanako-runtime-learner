import path from "path";
import { ACTION_TYPE_SET } from "./action-types.js";
import {
  createActionRegistry,
  executeRegisteredAction,
  getActionDefinition,
  validateActionPlanAgainstRegistry,
} from "./action-registry.js";
import { loadActionPackages } from "./action-loader.js";

function actionTypeOf(actionPlan = {}) {
  return actionPlan.plan?.actionType || actionPlan.actionType || "";
}

function cloneSummaryLoaded(loaded = null) {
  if (!loaded) return null;
  return {
    ok: loaded.ok,
    loaded: loaded.loaded || 0,
    rejected: loaded.rejected || 0,
    results: (loaded.results || []).map((item) => ({
      packageDir: item.packageDir,
      ok: item.ok,
      decision: item.decision,
      errors: item.errors || [],
      warnings: item.warnings || [],
      action: item.action?.name || null,
      registered: item.registered ? { ok: item.registered.ok, decision: item.registered.decision, errors: item.registered.errors || [] } : null,
    })),
  };
}

function runtimeActionsDir(context = {}) {
  return context.actionsDir || context.config?.actionsDir || null;
}

function buildRuntimeActionRegistry(context = {}) {
  if (context.actionRegistry?.actions) {
    return { registry: context.actionRegistry, loaded: null, source: "provided" };
  }
  const registry = createActionRegistry({ includeCore: true });
  const actionsDir = runtimeActionsDir(context);
  let loaded = null;
  if (actionsDir) {
    loaded = loadActionPackages(path.resolve(actionsDir), registry, context.actionLoaderOptions || {});
  }
  return { registry, loaded: cloneSummaryLoaded(loaded), source: actionsDir ? "actionsDir" : "core" };
}

export function resolveRuntimeAction(actionPlan = {}, context = {}, options = {}) {
  const actionType = actionTypeOf(actionPlan);
  const runtime = buildRuntimeActionRegistry(context);
  const definition = getActionDefinition(runtime.registry, actionType);
  if (!definition) {
    return {
      ok: false,
      decision: "reject",
      actionType,
      runtime,
      definition: null,
      reason: [`unknown action type: ${actionType || "<empty>"}`],
      executeViaRegistry: false,
      coreAction: false,
    };
  }
  const validation = validateActionPlanAgainstRegistry(actionPlan, runtime.registry, {
    ...context,
    requireAutoExecutable: options.requireAutoExecutable === true,
  });
  const coreAction = definition.source === "core" && ACTION_TYPE_SET.has(actionType);
  return {
    ok: validation.ok,
    decision: validation.decision,
    actionType,
    runtime,
    definition,
    validation,
    reason: validation.reason || [],
    riskTier: validation.riskTier || definition.riskTier,
    coreAction,
    executeViaRegistry: !coreAction,
  };
}

export async function executeRuntimeRegisteredAction(actionPlan = {}, context = {}, options = {}) {
  const runtime = buildRuntimeActionRegistry(context);
  const result = await executeRegisteredAction(actionPlan, runtime.registry, {
    ...context,
    allowPluginCodeExecution: context.allowPluginCodeExecution === true || options.allowPluginCodeExecution === true,
    requireAutoExecutable: options.requireAutoExecutable === true,
  });
  return {
    ...result,
    registryRuntime: {
      source: runtime.source,
      loaded: runtime.loaded,
    },
  };
}
