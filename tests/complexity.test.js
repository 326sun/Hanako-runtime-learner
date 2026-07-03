/**
 * Tests for lib/complexity.js — the complexity budget scanner.
 *
 * simplify-S2: root-level entry files (index.js, install.cjs) were a
 * governance blind spot — COMPLEXITY_SCAN_DIRS only covers directories, so
 * the plugin entry never appeared in complexity:report/check. These tests
 * pin the new `rootFiles` option: root files join the scan totals and
 * per-file limits but never count toward the lib module budget.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { scanComplexity, analyzeSource, INDEX_BANNED_DIRECT_IMPORTS, CONTROL_BANNED_DIRECT_IMPORTS } from "../lib/complexity.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "complexity-test-"));

function write(rel, content) {
  const full = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

describe("complexity scan (simplify-S2 rootFiles)", () => {
  after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  it("includes root entry files in the scan by default, outside libModuleCount", () => {
    write("lib/a.js", "export const a = 1;\n");
    write("index.js", 'import { a } from "./lib/a.js";\nexport default a;\n');
    write("install.cjs", 'const fs = require("fs");\nmodule.exports = fs;\n');

    const scan = scanComplexity(tmpRoot);
    const paths = scan.files.map((f) => f.path);
    assert.ok(paths.includes("index.js"), "index.js should be scanned");
    assert.ok(paths.includes("install.cjs"), "install.cjs should be scanned");
    assert.equal(scan.totals.fileCount, 3);
    assert.equal(scan.totals.libModuleCount, 1, "root files must not count as lib modules");
  });

  it("applies per-file hard limits to root files", () => {
    const scan = scanComplexity(tmpRoot, {
      hardLimits: { fileLoc: 1 },
    });
    const violation = scan.violations.find((v) => v.kind === "file_loc" && v.path === "index.js");
    assert.ok(violation, "an oversized root file should trip the per-file hard limit");
    assert.equal(scan.ok, false);
  });

  it("rootFiles: [] restores the pre-S2 directory-only scan (back-compat escape hatch)", () => {
    const scan = scanComplexity(tmpRoot, { rootFiles: [] });
    const paths = scan.files.map((f) => f.path);
    assert.ok(!paths.includes("index.js"));
    assert.ok(!paths.includes("install.cjs"));
    assert.equal(scan.totals.fileCount, 1);
  });

  it("silently skips configured root files that do not exist", () => {
    const scan = scanComplexity(tmpRoot, { rootFiles: ["index.js", "no-such-entry.js"] });
    const paths = scan.files.map((f) => f.path);
    assert.ok(paths.includes("index.js"));
    assert.ok(!paths.includes("no-such-entry.js"));
  });

  it("reports structural warnings without failing the complexity gate", () => {
    write("index.js", 'import { saveCredentials } from "./lib/credentials.js";\nexport default saveCredentials;\n');
    write("tools/control.js", "const CONFIG_ACTIONS = new Set();\nexport const name = 'control';\n");

    const scan = scanComplexity(tmpRoot);
    assert.equal(scan.ok, true);
    assert.ok(scan.structuralWarnings.some((w) => w.rule === "index_runtime_wiring_aggregators"));
    assert.ok(scan.structuralWarnings.some((w) => w.rule === "control_action_registry" && w.symbol === "CONFIG_ACTIONS"));
  });

  it("S2.P3: flags tools/control.js importing a lib module that S2.P2 moved into control-handlers/*", () => {
    write("tools/control.js", 'import { listProposals } from "../lib/proposals.js";\nexport const name = "control";\n');

    const scan = scanComplexity(tmpRoot);
    assert.equal(scan.ok, true, "structural warnings must never fail the hard gate");
    const warning = scan.structuralWarnings.find((w) => w.rule === "control_router_no_business_imports" && w.module === "proposals");
    assert.ok(warning, "expected a control_router_no_business_imports warning for lib/proposals.js");
    assert.equal(warning.replacement, "tools/control-handlers/proposal-review.js");
  });

  it("S2.P3: does not flag tools/control.js for modules still legitimately imported (must-remain actions)", () => {
    write(
      "tools/control.js",
      [
        'import { appendEvent } from "../lib/event-log.js";',
        'import { mergeCredentials } from "../lib/credentials.js";',
        'import { runModelAdvisor } from "../lib/model-advisor.js";',
        'import { exportReleaseReadiness } from "../lib/release-readiness.js";',
        'import { runSkillPromotionLoop } from "../lib/skill-promotion-loop.js";',
        'export const name = "control";',
        "",
      ].join("\n"),
    );

    const scan = scanComplexity(tmpRoot);
    assert.equal(
      scan.structuralWarnings.filter((w) => w.rule === "control_router_no_business_imports").length,
      0,
      "modules still owned by a must-remain control.js action must not trip the router rule",
    );
  });
});

describe("S3.P3: index_runtime_wiring_aggregators ban list stays in sync with reality", () => {
  // Foundation modules legitimately imported from many places, including
  // index.js directly — not owned by either aggregator, so absence from the
  // ban list is correct, not a gap.
  const FOUNDATION_MODULES = new Set(["common", "helpers"]);

  it("every lib/ import of runtime-live-config.js and runtime-skill-refresh.js (besides shared foundation modules) has a matching INDEX_BANNED_DIRECT_IMPORTS entry", () => {
    // node --test (and npm test) always run with cwd at the project root.
    const repoRoot = process.cwd();
    const bannedModules = new Set(INDEX_BANNED_DIRECT_IMPORTS.map((item) => item.module));
    const aggregatorFiles = ["lib/runtime-live-config.js", "lib/runtime-skill-refresh.js"];
    const missing = [];
    for (const rel of aggregatorFiles) {
      const text = fs.readFileSync(path.join(repoRoot, rel), "utf-8");
      const imports = [...text.matchAll(/from\s+["']\.\/([\w-]+)\.js["']/g)].map((m) => m[1]);
      for (const mod of imports) {
        if (FOUNDATION_MODULES.has(mod)) continue;
        if (!bannedModules.has(mod)) missing.push(`${rel} imports ./${mod}.js, not in INDEX_BANNED_DIRECT_IMPORTS`);
      }
    }
    assert.deepEqual(missing, [], "INDEX_BANNED_DIRECT_IMPORTS has fallen out of sync with the aggregator modules' real imports");
  });
});

describe("control_router_no_business_imports ban list stays in sync with reality (code-review follow-up, S2.P3/S3.P3)", () => {
  const repoRoot = process.cwd();

  function realLibImports(rel) {
    // tools/control.js is one directory above lib/ (../lib/...); files under
    // tools/control-handlers/ are two directories above it (../../lib/...).
    // Match either depth so this helper works for both callers below.
    const text = fs.readFileSync(path.join(repoRoot, rel), "utf-8");
    return [...text.matchAll(/from\s+["'](?:\.\.\/)+lib\/([\w-]+)\.js["']/g)].map((m) => m[1]);
  }

  it("the real tools/control.js does not import any CONTROL_BANNED_DIRECT_IMPORTS module directly", () => {
    const bannedModules = new Set(CONTROL_BANNED_DIRECT_IMPORTS.map((item) => item.module));
    const imports = realLibImports("tools/control.js");
    const violations = imports.filter((mod) => bannedModules.has(mod));
    assert.deepEqual(violations, [], "tools/control.js has regrown a direct import of a module that should live in tools/control-handlers/*.js");
  });

  it("every CONTROL_BANNED_DIRECT_IMPORTS entry is actually imported by a real tools/control-handlers/*.js file (catches stale/typo'd ban entries)", () => {
    const controlHandlersDir = path.join(repoRoot, "tools/control-handlers");
    const handlerFiles = fs.readdirSync(controlHandlersDir).filter((f) => f.endsWith(".js"));
    const importedByHandlers = new Set();
    for (const file of handlerFiles) {
      for (const mod of realLibImports(`tools/control-handlers/${file}`)) importedByHandlers.add(mod);
    }
    const stale = CONTROL_BANNED_DIRECT_IMPORTS
      .map((item) => item.module)
      .filter((mod) => !importedByHandlers.has(mod));
    assert.deepEqual(stale, [], "CONTROL_BANNED_DIRECT_IMPORTS names a module no tools/control-handlers/*.js file actually imports — the ban entry is stale or was never accurate");
  });
});

describe("analyzeSource", () => {
  it("counts loc, code loc, imports (import + require), exports, and tag-form todos", () => {
    // The tag-form marker is assembled at runtime so this test file itself
    // never trips the repo-wide TODO scan (the scanner reads raw source).
    const tag = "TO" + "DO:";
    const src = [
      'import a from "a";',
      'const b = require("b");',
      `// ${tag} tag-form counts`,
      "// merely mentioning the word does not",
      "export const c = 1;",
      "",
    ].join("\n");
    const m = analyzeSource(src);
    assert.equal(m.imports, 2);
    assert.equal(m.exports, 1);
    assert.equal(m.todos, 1);
    assert.ok(m.loc >= 5);
    assert.ok(m.codeLoc >= 3);
  });
});
