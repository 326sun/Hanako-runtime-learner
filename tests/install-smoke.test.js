import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { fork, spawnSync } from "node:child_process";
import { runtimeConfigPath } from "../lib/runtime-config-path.js";

// Simulated install smoke test (plan §6.9): instead of dragging the zip into a
// real Hanako GUI, we load the BUNDLED dist artifacts directly with a mock host
// context and assert the install-critical behaviours.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
// Build into a PRIVATE temp dist, never the shared <root>/dist: build.test.js
// rm+rebuilds <root>/dist in parallel, and importing/forking from a directory
// being deleted races on Windows file locks. Isolation removes the shared state.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "learner-smoke-"));
const dist = path.join(work, "dist");
const release = path.join(work, "release");
const tmp = path.join(work, "scratch");

async function esbuildAvailable() {
  try { await import("esbuild"); return true; } catch { return false; }
}
const distUrl = (rel) => pathToFileURL(path.join(dist, rel)).href + `?t=${Date.now()}`;

function mockCtx(dataDir, pluginDir, sampleCalls) {
  return {
    pluginDir,
    dataDir,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    bus: {
      getCapability: () => null,
      hasHandler: () => false,
      request: (type) => { if (type === "model:sample-text") sampleCalls.push(type); return {}; },
      subscribe: () => () => {},
    },
    config: {},
  };
}

describe("install smoke · bundled dist", () => {
  let available = false;
  before(async () => {
    available = await esbuildAvailable();
    if (!available) return;
    const res = spawnSync(process.execPath, [path.join(root, "scripts", "build.js")], {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, LEARNER_BUILD_DIST_DIR: dist, LEARNER_BUILD_RELEASE_DIR: release },
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    fs.mkdirSync(tmp, { recursive: true });
  });
  after(() => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ } });

  it("loads onload from the bundle, writes dataDir, and stays default-off for LLM extraction", async (t) => {
    if (!available) return t.skip("esbuild not installed");
    const dataDir = path.join(tmp, "data");
    const pluginDir = path.join(tmp, "plugin");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });
    const sampleCalls = [];

    const mod = await import(distUrl("index.js"));
    const Plugin = mod.default;
    assert.equal(typeof Plugin, "function", "bundle default-exports a plugin");
    const plugin = new Plugin();
    plugin.ctx = mockCtx(dataDir, pluginDir, sampleCalls);

    await plugin.onload();

    // dataDir read/write: runtime config persisted with safe defaults
    const cfgPath = runtimeConfigPath(dataDir);
    assert.ok(fs.existsSync(cfgPath), "runtime-config.json written to dataDir");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    assert.equal(cfg.llmExtractionEnabled, false, "llmExtractionEnabled defaults to false");

    // pluginDir path resolution in dist mode: SKILL.md written under pluginDir
    assert.ok(
      fs.existsSync(path.join(pluginDir, "skills", "self-learning", "SKILL.md")),
      "SKILL.md written under the host-provided pluginDir",
    );

    // default-off => no sampleText call, no LLM queue file
    assert.deepEqual(sampleCalls, [], "model:sample-text must not be called when disabled");
    assert.equal(fs.existsSync(path.join(dataDir, "llm-extraction-queue.json")), false, "no LLM queue written when disabled");

    await plugin.onunload();
  });

  it("a bundled self_learning tool loads and runs from dist/tools (self-contained)", async (t) => {
    if (!available) return t.skip("esbuild not installed");
    const dataDir = path.join(tmp, "tool-data");
    fs.mkdirSync(dataDir, { recursive: true });
    const stats = await import(distUrl("tools/stats.js"));
    assert.equal(stats.name, "self_learning_stats");
    const result = await stats.execute({}, { dataDir, pluginDir: path.join(tmp, "tool-plugin") });
    assert.equal(typeof result, "object");
  });

  it("the copied child runner forks and returns a result at its dist path", async (t) => {
    if (!available) return t.skip("esbuild not installed");
    const childPath = path.join(dist, "plugin-process-runner-child.js");
    assert.ok(fs.existsSync(childPath), "dist/plugin-process-runner-child.js exists");

    const modPath = path.join(tmp, "trivial.mjs");
    fs.writeFileSync(modPath, "export async function run(){ return { ok: 1 }; }\n");

    const result = await new Promise((resolve, reject) => {
      const child = fork(childPath, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      const timer = setTimeout(() => { child.kill(); reject(new Error("child timed out")); }, 10000);
      child.on("message", (msg) => { clearTimeout(timer); resolve(msg); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.send({ modulePath: modPath, exportName: "run", actionPlan: {}, context: {}, definition: {} });
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, { ok: 1 });
  });
});
