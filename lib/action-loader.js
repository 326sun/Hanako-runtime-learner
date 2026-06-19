import fs from "fs";
import path from "path";
import { registerAction, validateActionDefinition } from "./action-registry.js";
import { DEFAULT_ALLOWED_COMMANDS } from "./action-types.js";
import { isCommandAllowed } from "./command-allowlist.js";
import { resolvePluginModulePath } from "./plugin-module-boundary.js";

const DEFAULT_LOADER_DENYLIST = Object.freeze(["rm", "del", "git push", "git tag", "npm publish", "curl", "wget"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function realInside(child, parent) {
  const realChild = fs.realpathSync(child);
  const realParent = fs.realpathSync(parent);
  return realChild === realParent || realChild.startsWith(`${realParent}${path.sep}`);
}

function existingPackageFile(filePath, packageDir, label, realPackageDir = null) {
  return resolvePluginModulePath(filePath, packageDir, { optional: true, label, realPackageDir });
}

function commandPolicyFromOptions(options = {}) {
  const configured = options.commandPolicy?.commands || {};
  return {
    ...(options.commandPolicy || {}),
    commands: {
      ...configured,
      allowlist: Array.isArray(configured.allowlist)
        ? configured.allowlist
        : Array.isArray(options.commandAllowlist) ? options.commandAllowlist : DEFAULT_ALLOWED_COMMANDS,
      denylist: Array.isArray(configured.denylist)
        ? configured.denylist
        : Array.isArray(options.commandDenylist) ? options.commandDenylist : DEFAULT_LOADER_DENYLIST,
      allowProjectScripts: configured.allowProjectScripts === true || options.allowProjectScripts === true,
    },
  };
}

function validateDeclaredCommands(definition = {}, options = {}) {
  const policy = commandPolicyFromOptions(options);
  const declared = [
    ...(Array.isArray(definition.permissions?.commands) ? definition.permissions.commands : []),
    ...(Array.isArray(definition.verification?.commands) ? definition.verification.commands : []),
  ];
  const errors = [];
  for (const rawCommand of declared) {
    const command = String(rawCommand || "").trim();
    if (!command) continue;
    const check = isCommandAllowed(command, policy);
    if (!check.allowed) errors.push(`declared command not allowed by action loader command policy: ${command} (${check.reason})`);
  }
  return errors;
}

export function loadActionPackage(packageDir, options = {}) {
  const root = path.resolve(options.actionsRoot || path.dirname(path.resolve(packageDir)));
  const dir = path.resolve(packageDir);
  if (!fs.existsSync(dir)) return { ok: false, decision: "reject", errors: [`action package not found: ${packageDir}`] };
  if (!realInside(dir, root)) return { ok: false, decision: "reject", errors: ["action package escapes actions root"] };

  const manifestPath = path.join(dir, "action.json");
  let realPackageDir = null;
  try { realPackageDir = fs.realpathSync(dir); } catch {}
  const manifestCheck = existingPackageFile(manifestPath, dir, "action.json", realPackageDir);
  if (!manifestCheck.ok || !manifestCheck.path) {
    return { ok: false, decision: "reject", errors: [manifestCheck.error || "action.json missing"] };
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (err) {
    return { ok: false, decision: "reject", errors: [`invalid action.json: ${err.message}`] };
  }

  const executeModule = existingPackageFile(path.join(dir, "execute.js"), dir, "execute.js", realPackageDir);
  const verifyModule = existingPackageFile(path.join(dir, "verify.js"), dir, "verify.js", realPackageDir);
  const rollbackModule = existingPackageFile(path.join(dir, "rollback.js"), dir, "rollback.js", realPackageDir);
  const executeModulePath = executeModule.path;
  const verifyModulePath = verifyModule.path;
  const rollbackModulePath = rollbackModule.path;
  const definition = {
    ...manifest,
    source: "plugin",
    packageDir: dir,
    executeModulePath,
    verifyModulePath,
    rollbackModulePath,
  };

  const missing = [];
  if (!executeModule.ok) missing.push(executeModule.error);
  if (!verifyModule.ok) missing.push(verifyModule.error);
  if (!rollbackModule.ok) missing.push(rollbackModule.error);
  if (!executeModulePath) missing.push("execute.js missing");
  if (definition.verification?.required === true && !verifyModulePath && (!Array.isArray(definition.verification?.commands) || definition.verification.commands.length === 0)) {
    missing.push("verify.js or verification.commands required when verification.required=true");
  }
  if (definition.rollback?.required === true && !rollbackModulePath) missing.push("rollback.js missing when rollback.required=true");

  const validation = validateActionDefinition(definition);
  const commandErrors = validateDeclaredCommands(definition, options);
  const errors = [...missing, ...commandErrors, ...validation.errors];
  return {
    ok: errors.length === 0,
    decision: errors.length === 0 ? "loaded" : "reject",
    errors,
    warnings: validation.warnings,
    action: validation.action,
    manifestPath,
  };
}

export function loadActionPackages(actionsDir, registry, options = {}) {
  const root = path.resolve(actionsDir);
  const results = [];
  if (!fs.existsSync(root)) return { ok: true, loaded: 0, rejected: 0, results };

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(root, entry.name);
    const loaded = loadActionPackage(packageDir, { ...options, actionsRoot: root });
    if (loaded.ok && registry) {
      const registered = registerAction(registry, loaded.action);
      results.push({ packageDir, ...loaded, registered });
    } else {
      results.push({ packageDir, ...loaded });
    }
  }

  const loadedCount = results.filter((item) => item.ok && (!item.registered || item.registered.ok)).length;
  const rejectedCount = results.length - loadedCount;
  return {
    ok: rejectedCount === 0,
    loaded: loadedCount,
    rejected: rejectedCount,
    results,
  };
}

export function discoverActionPackageNames(actionsDir) {
  const root = path.resolve(actionsDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "action.json")))
    .map((entry) => entry.name)
    .sort();
}
