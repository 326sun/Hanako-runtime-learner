import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collect(relativeDir) {
  const dir = path.join(root, relativeDir);
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...collect(relative));
    else if (entry.isFile() && [".js", ".cjs", ".mjs"].includes(path.extname(entry.name))) files.push(relative.replace(/\\/g, "/"));
  }
  return files;
}

it("installer preflight covers every JavaScript file it copies", () => {
  const source = fs.readFileSync(path.join(root, "install.cjs"), "utf-8");
  assert.match(source, /execFileSync\(process\.execPath, \["--check", fullPath\]/);
  assert.doesNotMatch(source, /execSync\(`node --check/);
  const result = spawnSync(process.execPath, [path.join(root, "install.cjs"), "--list-js"], { cwd: root, encoding: "utf-8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const listed = new Set(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)));
  const expected = ["index.js", ...collect("lib"), ...collect("tools")];
  assert.deepEqual(expected.filter((file) => !listed.has(file)), []);
});
