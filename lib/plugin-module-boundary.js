import fs from "node:fs";
import path from "node:path";

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathInside(child, parent) {
  const relative = path.relative(comparablePath(parent), comparablePath(child));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolvePluginModulePath(modulePath, packageDir, options = {}) {
  const label = options.label || "plugin module";
  if (!modulePath) {
    return options.optional ? { ok: true, path: null, realPath: null } : { ok: false, error: `${label} path is required` };
  }

  const resolved = path.resolve(modulePath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (err) {
    if (options.optional && err.code === "ENOENT") return { ok: true, path: null, realPath: null };
    return { ok: false, error: `${label} not found: ${resolved}` };
  }

  if (stat.isSymbolicLink()) {
    return { ok: false, error: `${label} must be a regular file inside action package: ${resolved}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `${label} is not a regular file: ${resolved}` };
  }

  let realModule;
  try {
    realModule = fs.realpathSync(resolved);
  } catch (err) {
    return { ok: false, error: `${label} cannot be resolved: ${err.message}` };
  }

  if (packageDir) {
    let realPackageDir = options.realPackageDir || null;
    try {
      realPackageDir ||= fs.realpathSync(path.resolve(packageDir));
    } catch (err) {
      return { ok: false, error: `action package cannot be resolved: ${err.message}` };
    }
    if (!pathInside(realModule, realPackageDir)) {
      return { ok: false, error: `${label} escapes action package: ${resolved}` };
    }
  }

  return { ok: true, path: resolved, realPath: realModule };
}
