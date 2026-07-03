#!/usr/bin/env node
/**
 * Runtime onload benchmark.
 *
 * Measures plugin onload + unload against synthetic empty/small/large data
 * directories. Advisory only; never touches the user's real runtime data.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

import { DEFAULT_CONFIG } from "../lib/config-defaults.js";
import { createLargeToolCorpus } from "./perf-tools-large.js";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function createEmptyCorpus() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-perf-onload-"));
  const dataDir = path.join(root, "data");
  const pluginDir = path.join(root, "plugin");
  fs.mkdirSync(path.join(pluginDir, "skills", "self-learning"), { recursive: true });
  writeJson(path.join(pluginDir, "manifest.json"), { id: "hanako-runtime-learner", version: "perf" });
  fs.writeFileSync(path.join(pluginDir, "skills", "self-learning", "SKILL.md"), "# Runtime Self-Learning\n", "utf-8");
  writeJson(path.join(dataDir, "runtime-config.json"), {
    ...DEFAULT_CONFIG,
    officialMemoryBridgeEnabled: false,
    semanticSearchEnabled: false,
    modelAdvisorEnabled: false,
    llmExtractionEnabled: false,
  });
  return { root, dataDir, pluginDir, patternCount: 0, logRows: 0 };
}

function createBus() {
  return {
    listCapabilities: () => [],
    getCapability: () => null,
    hasHandler: () => false,
    request: async (name) => { throw new Error(`EventBus request unavailable: ${name}`); },
    subscribe: () => () => {},
  };
}

function createContext(corpus) {
  return {
    dataDir: corpus.dataDir,
    pluginDir: corpus.pluginDir,
    bus: createBus(),
    log: { info() {}, warn() {}, error() {}, debug() {} },
    config: {
      getAll: () => ({}),
      setMany() {},
      getSchema: () => null,
    },
  };
}

function settleAsyncWork(ms = 75) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measureOnload(corpus) {
  const RuntimePlugin = (await import(`${pathToFileURL(path.resolve("index.js")).href}?perf_onload=${Date.now()}_${Math.random()}`)).default;
  const plugin = new RuntimePlugin();
  const disposables = [];
  plugin.ctx = createContext(corpus);
  plugin.register = (disposable) => disposables.push(disposable);
  const started = performance.now();
  await plugin.onload();
  const onload_ms = performance.now() - started;
  const unloadStarted = performance.now();
  await plugin.onunload();
  const unload_ms = performance.now() - unloadStarted;
  await settleAsyncWork();
  for (const disposable of disposables) {
    try {
      if (typeof disposable === "function") disposable();
      else if (typeof disposable?.dispose === "function") disposable.dispose();
    } catch {}
  }
  return { onload_ms, unload_ms };
}

export async function runOnloadBench({
  quick = false,
  smallPatterns = quick ? 25 : 100,
  smallLogRows = quick ? 100 : 500,
  largePatterns = quick ? 100 : 1000,
  largeLogRows = quick ? 500 : 5000,
} = {}) {
  const profiles = [
    { name: "empty", corpus: createEmptyCorpus() },
    { name: "small", corpus: createLargeToolCorpus({ patternCount: smallPatterns, logRows: smallLogRows }) },
    { name: "large", corpus: createLargeToolCorpus({ patternCount: largePatterns, logRows: largeLogRows }) },
  ];
  const results = {};
  try {
    for (const profile of profiles) {
      const measured = await measureOnload(profile.corpus);
      results[profile.name] = {
        ...measured,
        patternCount: profile.corpus.patternCount,
        logRows: profile.corpus.logRows,
      };
    }
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      quick,
      profiles: results,
    };
  } finally {
    for (const profile of profiles) {
      fs.rmSync(profile.corpus.root, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv) {
  const opts = { json: false, quick: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--quick") opts.quick = true;
    else if (arg === "--small-patterns") opts.smallPatterns = Number(argv[++i]);
    else if (arg === "--small-log-rows") opts.smallLogRows = Number(argv[++i]);
    else if (arg === "--large-patterns") opts.largePatterns = Number(argv[++i]);
    else if (arg === "--large-log-rows") opts.largeLogRows = Number(argv[++i]);
  }
  return opts;
}

function fmt(ms) {
  return ms < 0.01 ? ms.toExponential(2) : ms.toFixed(3);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const report = await runOnloadBench(opts);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("# Runtime onload performance\n");
    for (const [name, item] of Object.entries(report.profiles)) {
      console.log(`- ${name}: onload=${fmt(item.onload_ms)} ms, unload=${fmt(item.unload_ms)} ms, patterns=${item.patternCount}, logRows=${item.logRows}`);
    }
  }
}
