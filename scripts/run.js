#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const mode = process.argv[2];
const root = process.cwd();

function listFiles(dir, { extensions = [".js"], suffix = "" } = {}) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(rel, { extensions, suffix }));
    else if (entry.isFile() && extensions.includes(path.extname(entry.name)) && (!suffix || entry.name.endsWith(suffix))) out.push(rel);
  }
  return out.sort();
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root });
  if (result.error) throw result.error;
  return result.status || 0;
}

if (mode === "check") {
  let failed = 0;
  for (const file of ["index.js", "install.cjs", ...listFiles("lib"), ...listFiles("tools"), ...listFiles("scripts")]) {
    const status = runNode(["--check", file]);
    if (status !== 0) failed = status;
  }
  process.exitCode = failed;
} else if (mode === "test") {
  process.exitCode = runNode(["--test", ...listFiles("tests", { suffix: ".test.js" })]);
} else {
  console.error("Usage: node scripts/run.js <check|test>");
  process.exitCode = 2;
}
