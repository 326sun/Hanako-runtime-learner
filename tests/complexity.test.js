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
import { scanComplexity, analyzeSource } from "../lib/complexity.js";

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
