import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  REQUIRED_DIST_FILES,
  REQUIRED_TOOL_FILES,
  scanUnresolvedSourceImports,
  verifyDistStructure,
  verifyZipRoot,
} from "../lib/dist-verify.js";

const tmpDir = path.join(os.tmpdir(), "learner-distverify-test-" + Date.now());

// A minimal well-formed dist directory, including the bundled tool entries.
function makeGoodDist(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.js"), "export default class {}\nimport fs from 'node:fs';\n");
  fs.writeFileSync(path.join(dir, "manifest.json"), '{"id":"hanako-runtime-learner"}');
  fs.writeFileSync(path.join(dir, "README.md"), "# readme");
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT");
  fs.writeFileSync(path.join(dir, "plugin-process-runner-child.js"), "import { pathToFileURL } from 'node:url';\n");
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  for (const rel of REQUIRED_TOOL_FILES) {
    fs.writeFileSync(path.join(dir, rel), "export const name='self_learning_x';\nexport async function execute(){}\nimport fs from 'node:fs';\n");
  }
}

describe("dist-verify · characterization of the source entry contract", () => {
  it("the runtime files the bundle must reproduce are index.js, manifest.json, README.md, LICENSE, child runner", () => {
    assert.deepEqual(
      REQUIRED_DIST_FILES,
      ["index.js", "manifest.json", "README.md", "LICENSE", "plugin-process-runner-child.js"],
    );
  });

  it("the real source child runner is self-contained (only node: imports) so it can be copied, not bundled", () => {
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const child = fs.readFileSync(path.join(here, "..", "lib", "plugin-process-runner-child.js"), "utf-8");
    const offenders = scanUnresolvedSourceImports(child);
    assert.deepEqual(offenders, []);
  });
});

describe("dist-verify · scanUnresolvedSourceImports", () => {
  it("returns nothing for a bundle that only references node builtins", () => {
    assert.deepEqual(scanUnresolvedSourceImports("import fs from 'node:fs';\nimport path from 'path';\n"), []);
  });
  it("flags leftover relative lib/tools imports", () => {
    assert.deepEqual(scanUnresolvedSourceImports('import x from "./lib/common.js";'), ["./lib/common.js"]);
    assert.deepEqual(scanUnresolvedSourceImports('export { y } from "../lib/scoring.js";'), ["../lib/scoring.js"]);
    assert.deepEqual(scanUnresolvedSourceImports('const m = await import("./tools/search.js");'), ["./tools/search.js"]);
  });
  it("flags a tool bundle that still reaches back to ../index", () => {
    assert.deepEqual(scanUnresolvedSourceImports('import d from "../index.js";'), ["../index.js"]);
  });
  it("does not flag a bare 'lib' substring inside an unrelated string", () => {
    assert.deepEqual(scanUnresolvedSourceImports('const s = "calibration library";'), []);
  });
});

describe("dist-verify · verifyDistStructure", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("passes a clean dist", () => {
    const dist = path.join(tmpDir, "dist");
    makeGoodDist(dist);
    const r = verifyDistStructure(dist);
    assert.equal(r.ok, true, r.problems.join("; "));
  });

  it("fails when a required file is missing", () => {
    const dist = path.join(tmpDir, "dist");
    makeGoodDist(dist);
    fs.rmSync(path.join(dist, "plugin-process-runner-child.js"));
    const r = verifyDistStructure(dist);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /plugin-process-runner-child\.js/.test(p)));
  });

  it("fails on a sourcemap, a dotfile, node_modules, or a shipped lib/ dir", () => {
    const dist = path.join(tmpDir, "dist");

    makeGoodDist(dist);
    fs.writeFileSync(path.join(dist, "index.js.map"), "{}");
    assert.equal(verifyDistStructure(dist).ok, false);

    makeGoodDist(dist);
    fs.writeFileSync(path.join(dist, ".env"), "SECRET=1");
    assert.equal(verifyDistStructure(dist).ok, false);

    makeGoodDist(dist);
    fs.mkdirSync(path.join(dist, "node_modules"));
    assert.equal(verifyDistStructure(dist).ok, false);

    makeGoodDist(dist);
    fs.mkdirSync(path.join(dist, "lib"));
    fs.writeFileSync(path.join(dist, "lib", "common.js"), "x");
    assert.equal(verifyDistStructure(dist).ok, false);
  });

  it("fails when the bundle still has unresolved source imports", () => {
    const dist = path.join(tmpDir, "dist");
    makeGoodDist(dist);
    fs.writeFileSync(path.join(dist, "index.js"), 'import x from "../lib/common.js";\n');
    const r = verifyDistStructure(dist);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /unresolved/i.test(p)));
  });

  it("requires the 8 self_learning tool entries under dist/tools", () => {
    assert.equal(REQUIRED_TOOL_FILES.length, 8);
    assert.ok(REQUIRED_TOOL_FILES.every((p) => p.startsWith("tools/") && p.endsWith(".js")));
  });

  it("fails when a required tool entry is missing", () => {
    const dist = path.join(tmpDir, "dist");
    makeGoodDist(dist);
    fs.rmSync(path.join(dist, "tools", "control.js"));
    const r = verifyDistStructure(dist);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /control\.js/.test(p)));
  });

  it("fails when a tool bundle still imports ../lib (not self-contained)", () => {
    const dist = path.join(tmpDir, "dist");
    makeGoodDist(dist);
    fs.writeFileSync(path.join(dist, "tools", "stats.js"), 'import { readJson } from "../lib/common.js";\n');
    const r = verifyDistStructure(dist);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /unresolved/i.test(p) && /stats\.js/.test(p)));
  });
});

describe("dist-verify · verifyZipRoot", () => {
  it("accepts a zip whose root has index.js, manifest.json, and the tools/ entries", () => {
    const r = verifyZipRoot([
      "index.js",
      "manifest.json",
      "README.md",
      "plugin-process-runner-child.js",
      ...REQUIRED_TOOL_FILES,
    ]);
    assert.equal(r.ok, true, r.problems.join("; "));
  });

  it("rejects a zip missing the tool entries at tools/", () => {
    const r = verifyZipRoot(["index.js", "manifest.json"]);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /tools\//.test(p)));
  });
  it("rejects a zip that wraps everything under a nested dist/ folder", () => {
    const r = verifyZipRoot(["dist/index.js", "dist/manifest.json"]);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /dist\//.test(p)));
  });
  it("rejects a zip missing the manifest at root", () => {
    const r = verifyZipRoot(["index.js", "README.md"]);
    assert.equal(r.ok, false);
  });
});
