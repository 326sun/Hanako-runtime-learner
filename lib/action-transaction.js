import fs from "fs";
import path from "path";
import crypto from "crypto";
import { safeReadFile, safeWriteFile, isWriteAllowed } from "./filesystem-boundary.js";

function sha(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function resolveTransactionPath(workspaceRoot, filePath, { forWrite = false } = {}) {
  const root = path.resolve(workspaceRoot || process.cwd());
  const full = path.resolve(root, filePath || ".");
  const policy = { filesystem: { deny: [] } };
  const allowed = forWrite
    ? isWriteAllowed(full, root, policy).allowed
    : safeReadFile(full, root, policy).ok;
  if (!allowed) throw new Error(`path outside workspace: ${filePath}`);
  return { root, full, relative: path.relative(root, full) };
}

function readWorkspaceFile(full, root, originalPath) {
  const result = safeReadFile(full, root, { filesystem: { deny: [] } });
  if (!result.ok) throw new Error(`${result.error}: ${originalPath}`);
  return result.content;
}

function writeWorkspaceFile(full, content, root, originalPath) {
  const result = safeWriteFile(full, String(content), root, { filesystem: { deny: [] } });
  if (!result.ok) throw new Error(`${result.error}: ${originalPath}`);
  return result;
}

export function createActionTransaction({ learnerDir = null, workspaceRoot = process.cwd(), actionId = "action", filePaths = [] } = {}) {
  const transactionId = `txn:${Date.now()}:${sha(actionId).slice(0, 8)}`;
  const files = [];
  const root = path.resolve(workspaceRoot || process.cwd());
  for (const filePath of filePaths || []) {
    const { full, relative } = resolveTransactionPath(root, filePath, { forWrite: true });
    // A failed snapshot read must abort the transaction: proceeding with a null
    // snapshot would make a later rollback overwrite the file with "".
    const existed = fs.existsSync(full);
    const content = existed ? readWorkspaceFile(full, root, filePath) : null;
    files.push({ path: relative, existed, content, hash: existed ? sha(content) : null });
  }
  return {
    transactionId,
    actionId,
    learnerDir,
    workspaceRoot: path.resolve(workspaceRoot || process.cwd()),
    snapshot: { files },
    operations: [],
    status: "created",
    createdAt: new Date().toISOString(),
  };
}

export function writeTransactionFile(txn, filePath, content) {
  if (!txn) throw new Error("transaction missing");
  const { full, relative } = resolveTransactionPath(txn.workspaceRoot, filePath, { forWrite: true });
  if (!txn.snapshot.files.some((f) => f.path === relative)) {
    // Same fail-closed rule as createActionTransaction: no snapshot, no write.
    const existed = fs.existsSync(full);
    const before = existed ? readWorkspaceFile(full, txn.workspaceRoot, filePath) : null;
    txn.snapshot.files.push({ path: relative, existed, content: before, hash: existed ? sha(before) : null });
  }
  writeWorkspaceFile(full, content, txn.workspaceRoot, filePath);
  txn.operations.push({ type: "write", path: relative, at: new Date().toISOString() });
  txn.status = "executing";
  return { path: relative };
}

export function changedTransactionFiles(txn) {
  if (!txn) return [];
  const changed = [];
  for (const item of txn.snapshot.files) {
    const { full } = resolveTransactionPath(txn.workspaceRoot, item.path, { forWrite: true });
    const exists = fs.existsSync(full);
    const content = exists ? readWorkspaceFile(full, txn.workspaceRoot, item.path) : null;
    const hash = exists ? sha(content) : null;
    if (exists !== item.existed || hash !== item.hash) changed.push(item.path);
  }
  return changed;
}

export function rollbackActionTransaction(txn) {
  if (!txn) return { ok: false, error: "transaction missing" };
  for (const item of txn.snapshot.files.slice().reverse()) {
    const { full } = resolveTransactionPath(txn.workspaceRoot, item.path, { forWrite: true });
    if (item.existed) {
      writeWorkspaceFile(full, item.content ?? "", txn.workspaceRoot, item.path);
    } else {
      fs.rmSync(full, { force: true });
    }
  }
  txn.status = "reverted";
  txn.rolledBackAt = new Date().toISOString();
  return { ok: true, changedFiles: changedTransactionFiles(txn) };
}

export function commitActionTransaction(txn) {
  if (!txn) return { ok: false, error: "transaction missing" };
  const changedFiles = changedTransactionFiles(txn);
  txn.status = "committed";
  txn.committedAt = new Date().toISOString();
  txn.changedFiles = changedFiles;
  return { ok: true, changedFiles };
}
