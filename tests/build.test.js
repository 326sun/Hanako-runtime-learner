import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifyDistStructure, verifyZipRoot, REQUIRED_TOOL_FILES, scanUnresolvedSourceImports } from "../lib/dist-verify.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
// Build into a PRIVATE temp dir, never the shared <root>/dist: parallel test
// files (install-smoke.test.js) import/fork from <root>/dist, and a concurrent
// rm+rebuild there races on Windows file locks → build exits non-zero → these
// subtests get cancelled. Isolation removes the shared mutable state.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "learner-build-"));
const dist = path.join(work, "dist");
const release = path.join(work, "release");
const zipPath = path.join(release, "hanako-runtime-learner-dist.zip");

async function esbuildAvailable() {
  try { await import("esbuild"); return true; } catch { return false; }
}

// Parse a zip's central directory to recover entry names (root verification).
function readZipEntryNames(buf) {
  const names = [];
  const eocd = buf.lastIndexOf(0x06054b50 & 0xff); // cheap scan fallback below
  // Proper EOCD scan from the end.
  let p = buf.length - 22;
  while (p >= 0 && buf.readUInt32LE(p) !== 0x06054b50) p--;
  if (p < 0) return names;
  const count = buf.readUInt16LE(p + 10);
  let off = buf.readUInt32LE(p + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.toString("utf8", off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  void eocd;
  return names;
}

describe("esbuild build → dist package", () => {
  let available = false;
  before(async () => {
    available = await esbuildAvailable();
    if (!available) return;
    const res = spawnSync(process.execPath, [path.join(root, "scripts", "build.js")], {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, LEARNER_BUILD_DIST_DIR: dist, LEARNER_BUILD_RELEASE_DIR: release },
    });
    assert.equal(res.status, 0, `build failed: ${res.stderr || res.stdout}`);
  });

  after(() => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ } });

  it("produces a clean, self-contained dist that passes structure verification", (t) => {
    if (!available) return t.skip("esbuild not installed");
    const check = verifyDistStructure(dist);
    assert.equal(check.ok, true, check.problems.join("; "));
  });

  it("inlines the lib/** sources into the bundle (no separate lib/ dir shipped)", (t) => {
    if (!available) return t.skip("esbuild not installed");
    assert.equal(fs.existsSync(path.join(dist, "lib")), false);
    const bundle = fs.readFileSync(path.join(dist, "index.js"), "utf-8");
    // a symbol that only exists inside lib/** must now be present in the bundle
    assert.match(bundle, /PatternDetector/);
    assert.ok(bundle.length > fs.readFileSync(path.join(root, "index.js"), "utf-8").length);
  });

  it("emits all 8 self_learning tool entries under dist/tools as self-contained bundles", (t) => {
    if (!available) return t.skip("esbuild not installed");
    for (const tool of REQUIRED_TOOL_FILES) {
      const full = path.join(dist, tool);
      assert.ok(fs.existsSync(full), `missing ${tool}`);
      const text = fs.readFileSync(full, "utf-8");
      assert.ok(text.length > 0, `${tool} is empty`);
      assert.deepEqual(scanUnresolvedSourceImports(text), [], `${tool} still has unresolved source imports`);
      // each tool bundle inlines its self_learning_* name export
      assert.match(text, /self_learning_/, `${tool} missing tool name`);
    }
  });

  it("copies the child runner verbatim beside the bundle (fork target resolves in dist mode)", (t) => {
    if (!available) return t.skip("esbuild not installed");
    const child = path.join(dist, "plugin-process-runner-child.js");
    assert.ok(fs.existsSync(child));
    assert.equal(
      fs.readFileSync(child, "utf-8"),
      fs.readFileSync(path.join(root, "lib", "plugin-process-runner-child.js"), "utf-8"),
    );
  });

  it("ships no sourcemap, dotfile, or node_modules in dist", (t) => {
    if (!available) return t.skip("esbuild not installed");
    const walk = (d, acc = []) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        acc.push(e.name);
        if (e.isDirectory()) walk(full, acc);
      }
      return acc;
    };
    const names = walk(dist);
    assert.ok(!names.some((n) => n.endsWith(".map")), "no .map");
    assert.ok(!names.some((n) => n.startsWith(".")), "no dotfiles");
    assert.ok(!names.includes("node_modules"), "no node_modules");
  });

  it("emits a release zip whose root is the plugin (index.js + manifest.json), not a nested dist/", (t) => {
    if (!available) return t.skip("esbuild not installed");
    assert.ok(fs.existsSync(zipPath), "release zip exists");
    const names = readZipEntryNames(fs.readFileSync(zipPath));
    assert.ok(names.includes("index.js"), `zip has index.js at root (got ${names.join(", ")})`);
    assert.ok(names.includes("manifest.json"), "zip has manifest.json at root");
    assert.ok(names.includes("skills/self-learning/SKILL.md"), "zip has the baseline self-learning skill");
    for (const tool of REQUIRED_TOOL_FILES) {
      assert.ok(names.includes(tool), `zip has ${tool}`);
    }
    assert.equal(verifyZipRoot(names).ok, true);
    const digestPath = `${zipPath}.sha256`;
    assert.ok(fs.existsSync(digestPath), "release zip SHA-256 sidecar exists");
    const expected = fs.readFileSync(digestPath, "utf-8").trim().split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
    assert.equal(expected, actual);
  });
});
