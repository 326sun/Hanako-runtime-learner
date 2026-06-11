import fs from "fs";
import path from "path";
import { registerAction, validateActionDefinition } from "./action-registry.js";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function realInside(child, parent) {
  const realChild = fs.realpathSync(child);
  const realParent = fs.realpathSync(parent);
  return realChild === realParent || realChild.startsWith(`${realParent}${path.sep}`);
}

function existingFileOrNull(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

export function loadActionPackage(packageDir, options = {}) {
  const root = path.resolve(options.actionsRoot || path.dirname(path.resolve(packageDir)));
  const dir = path.resolve(packageDir);
  if (!fs.existsSync(dir)) return { ok: false, decision: "reject", errors: [`action package not found: ${packageDir}`] };
  if (!realInside(dir, root)) return { ok: false, decision: "reject", errors: ["action package escapes actions root"] };

  const manifestPath = path.join(dir, "action.json");
  if (!existingFileOrNull(manifestPath)) return { ok: false, decision: "reject", errors: ["action.json missing"] };

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (err) {
    return { ok: false, decision: "reject", errors: [`invalid action.json: ${err.message}`] };
  }

  const executeModulePath = existingFileOrNull(path.join(dir, "execute.js"));
  const verifyModulePath = existingFileOrNull(path.join(dir, "verify.js"));
  const rollbackModulePath = existingFileOrNull(path.join(dir, "rollback.js"));
  const definition = {
    ...manifest,
    source: "plugin",
    packageDir: dir,
    executeModulePath,
    verifyModulePath,
    rollbackModulePath,
  };

  const missing = [];
  if (!executeModulePath) missing.push("execute.js missing");
  if (definition.verification?.required === true && !verifyModulePath && (!Array.isArray(definition.verification?.commands) || definition.verification.commands.length === 0)) {
    missing.push("verify.js or verification.commands required when verification.required=true");
  }
  if (definition.rollback?.required === true && !rollbackModulePath) missing.push("rollback.js missing when rollback.required=true");

  const validation = validateActionDefinition(definition);
  const errors = [...missing, ...validation.errors];
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
