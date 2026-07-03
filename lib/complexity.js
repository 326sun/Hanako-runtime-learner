import fs from "fs";
import path from "path";

// Complexity governance for v4.x LTS.
//
// This module is the single source of truth for the complexity budget. Both the
// CLI tooling (scripts/complexity-check.js, scripts/complexity-report.js) and the
// release-readiness gate (lib/release-readiness.js) consume the same pure scan so
// that "what the report says" and "what the gate enforces" can never drift.
//
// Limits are deliberately set with headroom above the current code base so that
// turning the gate on does not retroactively block an already-shipping LTS line.
// Tightening a limit is a deliberate governance act; see docs/COMPLEXITY_BUDGET.md.

export const COMPLEXITY_SCAN_DIRS = ["lib", "scripts", "tests", "tools"];

// simplify-S2: root-level entry files were a governance blind spot — the
// directory scan above never covered them, so index.js could grow unbounded
// without ever appearing in complexity:report/check. Scanned like any other
// file (totals + per-file limits) but never counted as lib modules.
export const COMPLEXITY_ROOT_FILES = ["index.js", "install.cjs"];

export const COMPLEXITY_HARD_LIMITS = Object.freeze({
  fileLoc: 900, // per-file total lines
  fileImports: 35, // per-file import + require count
  fileExports: 25, // per-file export count
  totalTodos: 40, // TODO/FIXME across all scanned files
  libModuleCount: 110, // module count under lib/
});

export const COMPLEXITY_SOFT_TARGETS = Object.freeze({
  fileLoc: 600,
  fileImports: 20,
  fileExports: 18,
  totalTodos: 10,
  libModuleCount: 95,
});

const JS_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

function listJsFiles(root, dir) {
  const base = path.join(root, dir);
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(root, rel));
    else if (entry.isFile() && JS_EXTENSIONS.has(path.extname(entry.name))) out.push(rel);
  }
  return out;
}

// Lightweight, dependency-free source metrics. Intentionally heuristic: this is a
// governance signal, not a parser. It must never throw on odd input.
export function analyzeSource(text) {
  const lines = String(text).split(/\r?\n/);
  const loc = lines.length;
  let codeLoc = 0;
  let inBlockComment = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    codeLoc += 1;
  }
  const imports = (text.match(/^\s*import\b/gm) || []).length + (text.match(/\brequire\s*\(/g) || []).length;
  const exports = (text.match(/^\s*export\b/gm) || []).length;
  // Count only tag-form markers: the word, an optional (author) group, then a colon.
  // Merely mentioning the words in code/strings (including this tool) is not flagged.
  const todos = (text.match(/\b(?:TODO|FIXME)(?:\([^)\n]*\))?:/g) || []).length;
  return { loc, codeLoc, imports, exports, todos };
}

function pushViolation(list, entry) {
  list.push(entry);
}

export function scanComplexity(projectRoot = process.cwd(), options = {}) {
  const root = path.resolve(projectRoot);
  const dirs = options.dirs || COMPLEXITY_SCAN_DIRS;
  const hardLimits = { ...COMPLEXITY_HARD_LIMITS, ...(options.hardLimits || {}) };
  const softTargets = { ...COMPLEXITY_SOFT_TARGETS, ...(options.softTargets || {}) };

  const rootFiles = options.rootFiles || COMPLEXITY_ROOT_FILES;

  const files = [];
  for (const rel of rootFiles) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf-8");
    } catch {
      continue; // configured root file absent in this project — skip silently
    }
    // dir "." keeps root files out of the per-directory buckets (and thus out
    // of libModuleCount, which filters on dir === "lib").
    files.push({ path: rel, dir: ".", ...analyzeSource(text) });
  }
  for (const dir of dirs) {
    for (const rel of listJsFiles(root, dir)) {
      let text;
      try {
        text = fs.readFileSync(path.join(root, rel), "utf-8");
      } catch {
        continue;
      }
      files.push({ path: rel, dir, ...analyzeSource(text) });
    }
  }

  const sum = (key) => files.reduce((acc, f) => acc + f[key], 0);
  const max = (key) => files.reduce((acc, f) => Math.max(acc, f[key]), 0);
  const totals = {
    fileCount: files.length,
    libModuleCount: files.filter((f) => f.dir === "lib").length,
    loc: sum("loc"),
    codeLoc: sum("codeLoc"),
    imports: sum("imports"),
    exports: sum("exports"),
    todos: sum("todos"),
    maxLoc: max("loc"),
    maxImports: max("imports"),
    maxExports: max("exports"),
  };

  const violations = [];
  const softWarnings = [];
  for (const f of files) {
    if (f.loc > hardLimits.fileLoc) pushViolation(violations, { kind: "file_loc", path: f.path, value: f.loc, limit: hardLimits.fileLoc, message: `${f.path} has ${f.loc} LOC > hard limit ${hardLimits.fileLoc}` });
    else if (f.loc > softTargets.fileLoc) softWarnings.push({ kind: "file_loc", path: f.path, value: f.loc, target: softTargets.fileLoc, message: `${f.path} has ${f.loc} LOC > soft target ${softTargets.fileLoc}` });
    if (f.imports > hardLimits.fileImports) pushViolation(violations, { kind: "file_imports", path: f.path, value: f.imports, limit: hardLimits.fileImports, message: `${f.path} has ${f.imports} imports > hard limit ${hardLimits.fileImports}` });
    else if (f.imports > softTargets.fileImports) softWarnings.push({ kind: "file_imports", path: f.path, value: f.imports, target: softTargets.fileImports, message: `${f.path} has ${f.imports} imports > soft target ${softTargets.fileImports}` });
    if (f.exports > hardLimits.fileExports) pushViolation(violations, { kind: "file_exports", path: f.path, value: f.exports, limit: hardLimits.fileExports, message: `${f.path} has ${f.exports} exports > hard limit ${hardLimits.fileExports}` });
    else if (f.exports > softTargets.fileExports) softWarnings.push({ kind: "file_exports", path: f.path, value: f.exports, target: softTargets.fileExports, message: `${f.path} has ${f.exports} exports > soft target ${softTargets.fileExports}` });
  }
  if (totals.todos > hardLimits.totalTodos) pushViolation(violations, { kind: "total_todos", value: totals.todos, limit: hardLimits.totalTodos, message: `total TODO/FIXME ${totals.todos} > hard limit ${hardLimits.totalTodos}` });
  else if (totals.todos > softTargets.totalTodos) softWarnings.push({ kind: "total_todos", value: totals.todos, target: softTargets.totalTodos, message: `total TODO/FIXME ${totals.todos} > soft target ${softTargets.totalTodos}` });
  if (totals.libModuleCount > hardLimits.libModuleCount) pushViolation(violations, { kind: "lib_module_count", value: totals.libModuleCount, limit: hardLimits.libModuleCount, message: `lib module count ${totals.libModuleCount} > hard limit ${hardLimits.libModuleCount}` });
  else if (totals.libModuleCount > softTargets.libModuleCount) softWarnings.push({ kind: "lib_module_count", value: totals.libModuleCount, target: softTargets.libModuleCount, message: `lib module count ${totals.libModuleCount} > soft target ${softTargets.libModuleCount}` });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dirs,
    hardLimits,
    softTargets,
    files,
    totals,
    violations,
    softWarnings,
    ok: violations.length === 0,
  };
}

// Machine-readable digest for release-readiness and CI artifacts.
export function summarizeComplexity(scan) {
  return {
    schemaVersion: scan.schemaVersion,
    generatedAt: scan.generatedAt,
    ok: scan.ok,
    totals: scan.totals,
    hardLimits: scan.hardLimits,
    softTargets: scan.softTargets,
    violations: scan.violations,
    softWarningCount: scan.softWarnings.length,
  };
}

export function topFilesBy(scan, key, limit = 10) {
  return [...scan.files].sort((a, b) => b[key] - a[key] || a.path.localeCompare(b.path)).slice(0, limit);
}
