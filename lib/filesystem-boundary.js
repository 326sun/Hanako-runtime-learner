import fs from "fs";
import path from "path";
import { atomicWriteFileSync } from "./atomic-file.js";

/**
 * filesystem-boundary.js
 *
 * v4.0.2 LTS audit hardening — Filesystem access boundary enforcement.
 *
 * The boundary check is symlink-aware. A path that lexically appears inside
 * the workspace is not trusted until existing targets or nearest existing
 * parents resolve inside the workspace with fs.realpathSync().
 */

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function realpathIfExists(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

function nearestExistingParent(targetPath) {
  let current = path.resolve(targetPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

/**
 * 检查路径是否在 workspace 范围内。
 */
export function isWithinWorkspace(targetPath, workspaceRoot) {
  const resolved = path.resolve(targetPath);
  const rootResolved = path.resolve(workspaceRoot);
  const rootReal = realpathIfExists(rootResolved) || rootResolved;
  const targetReal = realpathIfExists(resolved) || resolved;
  return targetReal === rootReal || targetReal.startsWith(rootReal + path.sep);
}

/**
 * 检查写入目标或其最近存在父目录是否仍在 workspace 内。
 */
function isWriteTargetWithinWorkspace(targetPath, workspaceRoot) {
  const resolved = path.resolve(targetPath);
  const rootResolved = path.resolve(workspaceRoot);
  const rootReal = realpathIfExists(rootResolved);

  // If the workspace itself does not exist yet, fall back to lexical containment.
  // This keeps pre-create validation usable while still hardening existing
  // workspaces against symlink escape.
  if (!rootReal) {
    return resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
  }

  const targetReal = realpathIfExists(resolved);
  if (targetReal) {
    return targetReal === rootReal || targetReal.startsWith(rootReal + path.sep);
  }

  const parent = nearestExistingParent(path.dirname(resolved));
  const parentReal = parent ? realpathIfExists(parent) : null;
  if (!parentReal) return false;
  return parentReal === rootReal || parentReal.startsWith(rootReal + path.sep);
}

/**
 * 检查路径是否被禁止。
 */
export function isPathForbidden(targetPath, policy) {
  const normalized = normalizeSlashes(path.resolve(targetPath));
  const denyPatterns = policy?.filesystem?.deny || [];

  for (const pattern of denyPatterns) {
    const cleaned = normalizeSlashes(pattern);
    if (!cleaned) continue;
    if (normalized.includes(cleaned)) {
      return { forbidden: true, reason: `path matches deny pattern: ${pattern}` };
    }
  }

  return { forbidden: false };
}

/**
 * 检查写入路径是否允许。
 */
export function isWriteAllowed(targetPath, workspaceRoot, policy) {
  const resolved = path.resolve(targetPath);

  if (!isWriteTargetWithinWorkspace(resolved, workspaceRoot)) {
    return { allowed: false, reason: "path outside workspace" };
  }

  const forbidden = isPathForbidden(resolved, policy);
  if (forbidden.forbidden) {
    return { allowed: false, reason: forbidden.reason };
  }

  const allowWriteDirs = policy?.filesystem?.allowWrite || [];
  if (allowWriteDirs.length > 0) {
    const relative = normalizeSlashes(path.relative(path.resolve(workspaceRoot), resolved));
    const allowed = allowWriteDirs.some((dir) => {
      const cleaned = normalizeSlashes(dir).replace(/\/$/, "");
      return cleaned === "*" || relative === cleaned || relative.startsWith(`${cleaned}/`);
    });
    if (!allowed) {
      return { allowed: false, reason: `write not allowed outside: ${allowWriteDirs.join(", ")}` };
    }
  }

  return { allowed: true };
}

/**
 * 安全读取文件。
 */
export function safeReadFile(targetPath, workspaceRoot, policy, { encoding = "utf-8" } = {}) {
  const resolved = path.resolve(targetPath);

  if (!isWithinWorkspace(resolved, workspaceRoot)) {
    return { ok: false, error: "path outside workspace" };
  }

  const forbidden = isPathForbidden(resolved, policy);
  if (forbidden.forbidden) {
    return { ok: false, error: forbidden.reason };
  }

  try {
    const content = fs.readFileSync(resolved, encoding);
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 安全写入文件。
 */
export function safeWriteFile(targetPath, content, workspaceRoot, policy) {
  const check = isWriteAllowed(targetPath, workspaceRoot, policy);
  if (!check.allowed) {
    return { ok: false, error: check.reason };
  }

  const resolved = path.resolve(targetPath);
  const maxSize = policy?.limits?.maxFileSizeBytes || Infinity;
  const contentBytes = Buffer.byteLength(content, "utf-8");
  if (contentBytes > maxSize) {
    return { ok: false, error: `file size ${contentBytes} exceeds limit ${maxSize}` };
  }

  try {
    atomicWriteFileSync(resolved, content, "utf-8");
    return { ok: true, bytesWritten: contentBytes };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
