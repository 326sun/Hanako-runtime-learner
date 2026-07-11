#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";
import { computeSourceFingerprint } from "../lib/source-fingerprint.js";

const root = process.cwd();

export function listFiles(dir, { extensions = [".js"], suffix = "", baseDir = root } = {}) {
  const base = path.join(baseDir, dir);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(rel, { extensions, suffix, baseDir }));
    else if (entry.isFile() && extensions.includes(path.extname(entry.name)) && (!suffix || entry.name.endsWith(suffix))) out.push(rel.replace(/\\/g, "/"));
  }
  return out.sort();
}

function runNode(args, { cwd = root } = {}) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd });
  if (result.error) throw result.error;
  return result.status || 0;
}

function runFullTestSuite(testFiles, { cwd = root } = {}) {
  const result = spawnSync(process.execPath, ["--test", ...testFiles], { cwd, encoding: "utf-8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const count = (name) => Number(output.match(new RegExp(`(?:ℹ\\s*)?${name}\\s+(\\d+)`, "i"))?.[1]);
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: computeSourceFingerprint(cwd),
    tests: count("tests"),
    pass: count("pass"),
    fail: count("fail"),
    skipped: count("skipped"),
    cancelled: count("cancelled"),
    todo: count("todo"),
    exitCode: result.status ?? 1,
  };
  const evidenceDir = path.join(cwd, "benchmark-results");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "test-results.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf-8");
  return result.status || 0;
}

// P10.A: dev-convenience only — `npm test` (no flag) always runs the full
// suite; this is an opt-in fast-iteration mode, never wired into any gate.
export function gitChangedFiles({ cwd = root } = {}) {
  const tracked = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf-8" });
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd, encoding: "utf-8" });
  const files = new Set();
  for (const out of [tracked.stdout, untracked.stdout]) {
    for (const line of (out || "").split("\n")) {
      const f = line.trim().replace(/\\/g, "/");
      if (f) files.add(f);
    }
  }
  return [...files];
}

/** Heuristically map changed files to test files: direct test-file edits, plus any test file that imports a changed source file by basename. */
export function recommendTestFiles(changed, allTests, { baseDir = root } = {}) {
  const matched = new Set(changed.filter((f) => f.startsWith("tests/") && f.endsWith(".test.js")));
  const changedBasenames = [...new Set(
    changed.filter((f) => !f.startsWith("tests/")).map((f) => path.basename(f, path.extname(f))).filter(Boolean),
  )];
  for (const testFile of allTests) {
    if (matched.has(testFile)) continue;
    let content;
    try { content = fs.readFileSync(path.join(baseDir, testFile), "utf-8"); } catch { continue; }
    if (changedBasenames.some((base) => new RegExp(`["'\`][^"'\`]*/${base}(\\.js)?["'\`]`).test(content))) {
      matched.add(testFile);
    }
  }
  return [...matched].sort();
}

export function runCli(argv = process.argv.slice(2)) {
  const mode = argv[0];
  if (mode === "check") {
    let failed = 0;
    for (const file of ["index.js", "install.cjs", ...listFiles("lib"), ...listFiles("tools"), ...listFiles("scripts")]) {
      const status = runNode(["--check", file]);
      if (status !== 0) failed = status;
    }
    return failed;
  }
  if (mode === "test") {
    if (argv.includes("--changed")) {
      const allTests = listFiles("tests", { suffix: ".test.js" });
      const recommended = recommendTestFiles(gitChangedFiles(), allTests);
      if (recommended.length === 0) {
        console.log("run.js test --changed: no test files matched the current git diff; nothing to run.");
        return 0;
      }
      console.log(`run.js test --changed: running ${recommended.length}/${allTests.length} test file(s) based on git diff:\n  ${recommended.join("\n  ")}`);
      return runNode(["--test", ...recommended]);
    }
    return runFullTestSuite(listFiles("tests", { suffix: ".test.js" }));
  }
  console.error("Usage: node scripts/run.js <check|test> [--changed]");
  return 2;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  process.exitCode = runCli();
}
