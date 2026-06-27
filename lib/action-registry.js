import { nowIso } from "./common.js";
import { ACTION_TYPE_SET, RISK_TIERS, RISK_TIER_ORDER } from "./action-types.js";
import { isCommandAllowed } from "./command-allowlist.js";

export { validateActionPlanAgainstRegistry, executeRegisteredAction } from "./action-registry-execute.js";

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

function normalizeActionDefinition(definition = {}, options = {}) {
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
