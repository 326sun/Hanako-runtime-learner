import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_CONFIG, writeJson } from "../lib/common.js";
import { recordFact } from "../lib/facts.js";
import { parseToolResult } from "./_test-utils.js";
import {
  clearPreparedSearchCache,
  execute as executeSearch,
  preparedSearchCacheStats,
} from "../tools/search.js";

function makeCtx(dataDir) {
  return {
    dataDir,
    pluginDir: path.join(dataDir, "plugin"),
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
}

function writeStore(dataDir, patterns) {
  fs.mkdirSync(dataDir, { recursive: true });
  writeJson(path.join(dataDir, "runtime-config.json"), {
    ...DEFAULT_CONFIG,
    officialMemoryBridgeEnabled: false,
    semanticSearchEnabled: false,
  });
  writeJson(path.join(dataDir, "patterns.json"), patterns);
}

async function search(dataDir, query) {
  return parseToolResult(await executeSearch({ query, limit: 5 }, makeCtx(dataDir)));
}

describe("self_learning_search prepared index cache", () => {
  beforeEach(() => clearPreparedSearchCache());

  it("reuses prepared search state while patterns and facts are unchanged", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-cache-"));
    writeStore(dataDir, [
      { id: "wf:a", type: "workflow", status: "approved", desc: "run lint then test", score: 10, count: 2 },
    ]);

    const first = await search(dataDir, "lint test");
    const second = await search(dataDir, "lint test");
    const stats = preparedSearchCacheStats();

    assert.equal(first.count, 1);
    assert.equal(second.count, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hits, 1);
    assert.equal(stats.active, true);
  });

  it("invalidates when patterns.json changes", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-cache-"));
    writeStore(dataDir, [
      { id: "wf:a", type: "workflow", status: "approved", desc: "run lint then test", score: 10, count: 2 },
    ]);

    await search(dataDir, "deploy workflow");
    writeJson(path.join(dataDir, "patterns.json"), [
      { id: "wf:b", type: "workflow", status: "approved", desc: "deploy release workflow", score: 12, count: 3 },
    ]);
    const result = await search(dataDir, "deploy workflow");
    const stats = preparedSearchCacheStats();

    assert.equal(result.results[0]?.id, "wf:b");
    assert.equal(stats.misses, 2);
    assert.equal(stats.hits, 0);
  });

  it("invalidates when facts.json changes", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-cache-"));
    writeStore(dataDir, []);

    await search(dataDir, "module owner");
    recordFact(dataDir, {
      subject: "module",
      predicate: "owner",
      object: "runtime team",
      scope: { project: "general", taskType: "general" },
      confidence: 0.9,
    });
    const result = await search(dataDir, "module owner");
    const stats = preparedSearchCacheStats();

    assert.equal(result.results[0]?.type, "fact");
    assert.equal(stats.misses, 2);
    assert.equal(stats.hits, 0);
  });
});
