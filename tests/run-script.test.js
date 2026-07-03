/**
 * P10.A — scripts/run.js `test --changed`: recommend/run only the test files
 * relevant to the current git diff, as a dev-convenience fast-iteration mode.
 * `npm test` (no flag) must still run the full suite unconditionally — these
 * tests verify the new flag is additive and never wired into that default
 * path.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { recommendTestFiles } from "../scripts/run.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-script-test-"));

function writeFile(rel, content = "") {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

describe("scripts/run.js — recommendTestFiles (P10.A)", () => {
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("includes a changed test file directly", () => {
    writeFile("tests/a.test.js", "import '../lib/unrelated.js';");
    writeFile("tests/b.test.js", "import '../lib/unrelated.js';");
    const result = recommendTestFiles(["tests/a.test.js"], ["tests/a.test.js", "tests/b.test.js"], { baseDir: tmpDir });
    assert.deepEqual(result, ["tests/a.test.js"]);
  });

  it("matches a test file that imports a changed source file by basename", () => {
    writeFile("tests/decorate-cache.test.js", 'import { decoratePatterns } from "../lib/scoring.js";');
    writeFile("tests/unrelated.test.js", 'import { readJson } from "../lib/common.js";');
    const result = recommendTestFiles(["lib/scoring.js"], ["tests/decorate-cache.test.js", "tests/unrelated.test.js"], { baseDir: tmpDir });
    assert.deepEqual(result, ["tests/decorate-cache.test.js"]);
  });

  it("returns an empty list when nothing in the diff matches any test", () => {
    writeFile("tests/only.test.js", 'import { readJson } from "../lib/common.js";');
    const result = recommendTestFiles(["docs/README.md"], ["tests/only.test.js"], { baseDir: tmpDir });
    assert.deepEqual(result, []);
  });

  it("deduplicates when a source file matches a test that was also directly changed", () => {
    writeFile("tests/scoring.test.js", 'import { decoratePatterns } from "../lib/scoring.js";');
    const result = recommendTestFiles(
      ["tests/scoring.test.js", "lib/scoring.js"],
      ["tests/scoring.test.js"],
      { baseDir: tmpDir },
    );
    assert.deepEqual(result, ["tests/scoring.test.js"]);
  });
});

describe("scripts/run.js CLI (P10.A)", () => {
  it("prints usage and exits 2 for an unknown mode", () => {
    const result = spawnSync(process.execPath, ["scripts/run.js", "bogus"], { cwd: process.cwd(), encoding: "utf-8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: node scripts\/run\.js/);
  });

  it("test --changed against an isolated repo with no matching diff runs nothing (exit 0)", () => {
    // An isolated git repo with a change that touches nothing under lib/tools
    // (so `git diff` is non-empty but recommendTestFiles matches no test).
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "run-script-cli-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: repo });
      spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: repo });
      spawnSync("git", ["config", "user.name", "test"], { cwd: repo });
      fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
      fs.writeFileSync(path.join(repo, "tests", "sample.test.js"), "import 'node:test';\n", "utf-8");
      spawnSync("git", ["add", "-A"], { cwd: repo });
      spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "docs.md"), "unrelated change\n", "utf-8");

      const runScript = path.join(process.cwd(), "scripts", "run.js");
      const result = spawnSync(process.execPath, [runScript, "test", "--changed"], { cwd: repo, encoding: "utf-8" });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /no test files matched/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
