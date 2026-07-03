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
  // C-005 (2026-07-03): raised 110 -> 118. The simplify-S3 census proved
  // splitting-into-a-new-file had exhausted its safe merge-back candidates
  // (98 at the v5.1.1 audit baseline -> 107 today, all justified), so the
  // old limit had lost its "headroom above current max" purpose. See
  // docs/COMPLEXITY_DEBT.md C-005 for the full rationale.
  libModuleCount: 118, // module count under lib/
});

export const COMPLEXITY_SOFT_TARGETS = Object.freeze({
  fileLoc: 600,
  fileImports: 20,
  fileExports: 18,
  totalTodos: 10,
  libModuleCount: 105, // C-005 (2026-07-03): raised 95 -> 105, see hard limit note above.
});

const JS_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);

// Exported (not just module-private) so tests/complexity.test.js can assert this
// list stays in sync with what lib/runtime-live-config.js and
// lib/runtime-skill-refresh.js actually import — S3.P3 (subsystem-simplify-v5.1.6)
// found the list already matched exactly, and this export lets that fact be
// enforced automatically instead of re-verified by hand each future audit.
export const INDEX_BANNED_DIRECT_IMPORTS = [
  { module: "runtime-config-path", replacement: "runtime-live-config" },
  { module: "credentials", replacement: "runtime-live-config" },
  { module: "live-config", replacement: "runtime-live-config" },
  { module: "proposals", replacement: "runtime-skill-refresh" },
  { module: "proposal-apply-safe", replacement: "runtime-skill-refresh" },
  { module: "feedback-signals", replacement: "runtime-skill-refresh" },
  { module: "advisor-insights", replacement: "runtime-skill-refresh" },
  { module: "skill-lifecycle", replacement: "runtime-skill-refresh" },
  { module: "review-queue", replacement: "runtime-skill-refresh" },
  { module: "session-messenger", replacement: "runtime-skill-refresh" },
];

// S2.P3 (subsystem-simplify-v5.1.6): tools/control.js was pulled back from a
// business-logic aggregator to a router by S2.P2a-d, which moved these modules'
// only consumers into tools/control-handlers/*.js. Listed here only where the
// import is now fully absent from control.js (verified against the S2.P2a-d
// findings) — modules a still-`must-remain` control.js action legitimately
// imports (e.g. lib/event-log.js, lib/credentials.js, lib/model-advisor.js,
// lib/release-readiness.js, lib/skill-promotion-loop.js) are intentionally
// NOT listed, since banning them would immediately fire on main and this rule
// must stay report-only-and-currently-clean (see docs/COMPLEXITY_BUDGET.md).
// Exported for the same reason as INDEX_BANNED_DIRECT_IMPORTS above: so
// tests/complexity.test.js can assert this list stays in sync with reality —
// specifically, that every banned module is actually imported by one of the
// real tools/control-handlers/*.js files it claims to have moved into (S3.P3
// code-review follow-up, subsystem-simplify-v5.1.6: the sibling
// INDEX_BANNED_DIRECT_IMPORTS list got this kind of drift check in S3.P3, but
// this list did not, until now).
export const CONTROL_BANNED_DIRECT_IMPORTS = [
  { module: "proposals", replacement: "tools/control-handlers/proposal-review.js" },
  { module: "proposal-apply-safe", replacement: "tools/control-handlers/proposal-review.js" },
  { module: "review-queue", replacement: "tools/control-handlers/proposal-review.js" },
  { module: "validation-gate", replacement: "tools/control-handlers/proposal-review.js or maintenance.js" },
  { module: "skill-lifecycle", replacement: "tools/control-handlers/maintenance.js" },
  { module: "memfs", replacement: "tools/control-handlers/maintenance.js" },
  { module: "policy-profiles", replacement: "tools/control-handlers/maintenance.js" },
  { module: "project-script-trust", replacement: "tools/control-handlers/maintenance.js" },
  { module: "agent-task-store", replacement: "tools/control-handlers/status.js or agent-tasks.js" },
];

const CONTROL_LEGACY_CLASSIFICATION_NAMES = [
  "READ_ONLY_CONTROL_ACTIONS",
  "FILE_OUTPUT_ACTIONS",
  "REVIEW_QUEUE_ACTIONS",
  "EXTERNAL_MODEL_ACTIONS",
  "LOCAL_STATE_MUTATION_ACTIONS",
  "CONFIG_ACTIONS",
  "PATTERN_ACTIONS",
];

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

function readText(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf-8");
  } catch {
    return null;
  }
}

function scanStructuralWarnings(root) {
  const warnings = [];
  const indexText = readText(root, "index.js");
  if (indexText != null) {
    for (const item of INDEX_BANNED_DIRECT_IMPORTS) {
      const re = new RegExp(`from\\s+["']\\./lib/${item.module}\\.js["']`);
      if (re.test(indexText)) {
        warnings.push({
          kind: "structural_import",
          rule: "index_runtime_wiring_aggregators",
          path: "index.js",
          module: item.module,
          replacement: item.replacement,
          message: `index.js directly imports ./lib/${item.module}.js; use the ${item.replacement} runtime wiring module instead`,
        });
      }
    }
  }

  const controlText = readText(root, "tools/control.js");
  if (controlText != null) {
    if (!controlText.includes("./control-action-registry.js")) {
      warnings.push({
        kind: "structural_control_registry",
        rule: "control_action_registry",
        path: "tools/control.js",
        message: "tools/control.js should derive action metadata from tools/control-action-registry.js",
      });
    }
    for (const name of CONTROL_LEGACY_CLASSIFICATION_NAMES) {
      if (new RegExp(`\\b${name}\\b`).test(controlText)) {
        warnings.push({
          kind: "structural_control_registry",
          rule: "control_action_registry",
          path: "tools/control.js",
          symbol: name,
          message: `tools/control.js contains legacy action classification symbol ${name}; keep classification in tools/control-action-registry.js`,
        });
      }
    }
    for (const item of CONTROL_BANNED_DIRECT_IMPORTS) {
      const re = new RegExp(`from\\s+["']\\.\\./lib/${item.module}\\.js["']`);
      if (re.test(controlText)) {
        warnings.push({
          kind: "structural_import",
          rule: "control_router_no_business_imports",
          path: "tools/control.js",
          module: item.module,
          replacement: item.replacement,
          message: `tools/control.js directly imports ../lib/${item.module}.js; move the consuming handler into ${item.replacement}`,
        });
      }
    }
  }
  return warnings;
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
  const structuralWarnings = scanStructuralWarnings(root);

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
    structuralWarnings,
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
    structuralWarningCount: scan.structuralWarnings?.length || 0,
    structuralWarnings: scan.structuralWarnings || [],
  };
}

export function topFilesBy(scan, key, limit = 10) {
  return [...scan.files].sort((a, b) => b[key] - a[key] || a.path.localeCompare(b.path)).slice(0, limit);
}
