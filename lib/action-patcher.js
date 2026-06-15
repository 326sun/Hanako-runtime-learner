import fs from "fs";
import path from "path";
import { writeTransactionFile } from "./action-transaction.js";
import { safeReadFile } from "./filesystem-boundary.js";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    index = text.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}

function replaceNth(text, oldText, newText, occurrenceIndex) {
  let index = -1;
  let from = 0;
  for (let i = 0; i <= occurrenceIndex; i += 1) {
    index = text.indexOf(oldText, from);
    if (index === -1) return null;
    from = index + oldText.length;
  }
  return text.slice(0, index) + newText + text.slice(index + oldText.length);
}

function applyTextPatch(txn, patch = {}) {
  if (!patch.path) throw new Error("text patch missing path");
  if (typeof patch.oldText !== "string" || typeof patch.newText !== "string") {
    throw new Error(`text patch for ${patch.path} requires oldText and newText strings`);
  }
  const full = path.resolve(txn.workspaceRoot, patch.path);
  if (!fs.existsSync(full)) throw new Error(`patch target not found: ${patch.path}`);
  const read = safeReadFile(full, txn.workspaceRoot, { filesystem: { deny: [] } });
  if (!read.ok) throw new Error(`${read.error}: ${patch.path}`);
  const before = read.content;
  const count = countOccurrences(before, patch.oldText);
  const occurrence = patch.occurrence ?? "unique";
  if (occurrence === "unique" && count !== 1) {
    throw new Error(`patch oldText for ${patch.path} must match exactly once; matched ${count}`);
  }
  if (count === 0) throw new Error(`patch oldText not found in ${patch.path}`);
  const next = Number.isInteger(occurrence)
    ? replaceNth(before, patch.oldText, patch.newText, occurrence)
    : before.replace(patch.oldText, () => patch.newText);
  if (next === null) throw new Error(`patch occurrence not found in ${patch.path}: ${occurrence}`);
  writeTransactionFile(txn, patch.path, next);
  return { path: path.relative(txn.workspaceRoot, full), oldTextLength: patch.oldText.length, newTextLength: patch.newText.length, matches: count };
}

export function applyPatchSet(txn, { fileWrites = [], filePatches = [] } = {}) {
  const writeResults = [];
  const patchResults = [];
  for (const write of normalizeArray(fileWrites)) {
    if (!write?.path) throw new Error("file write missing path");
    writeResults.push(writeTransactionFile(txn, write.path, write.content ?? ""));
  }
  for (const patch of normalizeArray(filePatches)) {
    patchResults.push(applyTextPatch(txn, patch));
  }
  return { writeResults, patchResults };
}

export function applyWritesAndPatches(txn, actionPlan = {}) {
  const plan = actionPlan.plan || {};
  return applyPatchSet(txn, {
    fileWrites: plan.fileWrites,
    filePatches: plan.filePatches || plan.patches,
  });
}
