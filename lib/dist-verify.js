/**
 * dist-verify — pure build self-checks for the v5.0 esbuild package (plan §6.7).
 *
 * The bundler (scripts/build.js) produces dist/ as the publishable plugin root.
 * These checks assert the produced tree is a clean, self-contained package:
 * required runtime files present, no source leakage (lib/, sourcemaps, dotfiles,
 * node_modules), no unresolved internal imports left in the bundle, and a zip
 * whose root is the plugin itself (not a nested dist/ folder).
 *
 * Kept dependency-free and side-effect-free (apart from reading the dist dir it
 * is asked to inspect) so it is fully unit-testable without running esbuild.
 */

import fs from "fs";
import path from "path";

// The runtime files the bundle must reproduce next to the bundled entry. The
// child runner is forked by path at runtime (lib/plugin-process-runner.js), so
// it is copied verbatim beside the bundle rather than inlined.
export const REQUIRED_DIST_FILES = Object.freeze([
  "index.js",
  "manifest.json",
  "README.md",
  "LICENSE",
  "plugin-process-runner-child.js",
]);

// The 8 host-loaded tool entries. Each keeps its source filename (the host maps
// a tool by the `name` it exports, so the directory contract must be preserved)
// and is emitted as an independent, self-contained bundle under dist/tools/.
export const REQUIRED_TOOL_FILES = Object.freeze([
  "tools/activity.js",
  "tools/console.js",
  "tools/control.js",
  "tools/doctor.js",
  "tools/open-dir.js",
  "tools/report.js",
  "tools/search.js",
  "tools/stats.js",
]);

// Internal source specifiers that MUST have been bundled away. A leftover means
// esbuild failed to inline a module and the dist would break at load time. This
// covers ../lib, ../tools and a tool bundle reaching back to ../index.
const INTERNAL_SPECIFIER = /^\.\.?\/(?:lib|tools|index)(?:[./]|$)|\/(?:lib|tools)\//;
// Pull the string literal out of import/export-from/require/dynamic-import forms.
const SPECIFIER_FORMS = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;

export function scanUnresolvedSourceImports(text) {
  const offenders = [];
  const src = String(text || "");
  let m;
  SPECIFIER_FORMS.lastIndex = 0;
  while ((m = SPECIFIER_FORMS.exec(src)) !== null) {
    const spec = m[1];
    if (INTERNAL_SPECIFIER.test(spec)) offenders.push(spec);
  }
  return offenders;
}

function walk(dir, base = dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      out.push({ rel, dir: true });
      walk(full, base, out);
    } else {
      out.push({ rel, dir: false });
    }
  }
  return out;
}

/**
 * Verify a built dist directory. Returns { ok, problems: string[] }.
 */
export function verifyDistStructure(distDir, { requiredFiles = REQUIRED_DIST_FILES, requiredToolFiles = REQUIRED_TOOL_FILES } = {}) {
  const problems = [];

  const checkFile = (rel) => {
    const full = path.join(distDir, rel);
    let stat = null;
    try { stat = fs.statSync(full); } catch {}
    if (!stat || !stat.isFile()) { problems.push(`missing required dist file: ${rel}`); return; }
    if (stat.size === 0) { problems.push(`required dist file is empty: ${rel}`); return; }
    // Bundled JS entries must carry no unresolved internal imports.
    if (rel.endsWith(".js")) {
      try {
        const offenders = scanUnresolvedSourceImports(fs.readFileSync(full, "utf-8"));
        if (offenders.length) problems.push(`${rel} has unresolved source imports: ${[...new Set(offenders)].join(", ")}`);
      } catch {}
    }
  };

  for (const file of requiredFiles) checkFile(file);
  for (const tool of requiredToolFiles) checkFile(tool);

  const entries = walk(distDir);
  for (const { rel, dir } of entries) {
    const name = rel.split("/").pop();
    if (!dir && rel.endsWith(".map")) problems.push(`dist must not contain sourcemaps: ${rel}`);
    if (name.startsWith(".")) problems.push(`dist must not contain dotfiles: ${rel}`);
    if (dir && name === "node_modules") problems.push(`dist must not contain node_modules: ${rel}`);
    // The bundle inlines lib/**; a shipped source lib/ dir means the package
    // leaks unbundled source. dist/tools/ is legitimate (bundled tool entries);
    // assets/ is reserved for future copied assets.
    if (dir && rel === "lib") problems.push(`dist must not ship source directory: ${rel}/`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Verify a zip's entry names: the plugin must sit at the archive root (so the
 * host sees index.js / manifest.json directly), never wrapped in a dist/ folder.
 */
export function verifyZipRoot(entryNames = [], { requiredToolFiles = REQUIRED_TOOL_FILES } = {}) {
  const problems = [];
  const names = entryNames.map((n) => String(n).replace(/\\/g, "/"));
  for (const required of ["index.js", "manifest.json"]) {
    if (!names.includes(required)) problems.push(`zip root must contain ${required}`);
  }
  for (const tool of requiredToolFiles) {
    if (!names.includes(tool)) problems.push(`zip must contain tool entry ${tool}`);
  }
  for (const name of names) {
    if (name.startsWith("dist/")) problems.push(`zip must not nest the plugin under dist/: ${name}`);
  }
  return { ok: problems.length === 0, problems };
}
