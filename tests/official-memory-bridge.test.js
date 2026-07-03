import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  officialMemoryBridgeStats,
  readOfficialMemoryEntries,
  searchOfficialMemory,
  searchOfficialMemoryWithStats,
} from "../lib/official-memory-bridge.js";

const tmpDir = path.join(os.tmpdir(), "official-memory-bridge-test-" + Date.now());

describe("official memory bridge", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const agentDir = path.join(tmpDir, "agents", "hana");
    fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "pinned-memory.json"), JSON.stringify({
      version: 1,
      items: [{ id: "pin_1", content: "User prefers proposal review before code changes.", createdAt: "2026-01-01T00:00:00.000Z" }],
    }), "utf-8");
    fs.writeFileSync(path.join(agentDir, "memory", "memory.md"), "# Project\n\nThe user is building Hanako self-evolution.", "utf-8");
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads pinned and compiled official memory entries", () => {
    const entries = readOfficialMemoryEntries({ home: tmpDir });
    assert.ok(entries.some((entry) => entry.memoryType === "pinned"));
    assert.ok(entries.some((entry) => entry.memoryType === "compiled"));
  });

  it("searches official memory entries", () => {
    const { results, stats } = searchOfficialMemoryWithStats("proposal review", { home: tmpDir, limit: 2 });
    assert.equal(results.length, 1);
    assert.equal(results[0].memoryType, "pinned");
    assert.equal(stats.lastResultCount, 1);
    assert.ok(stats.lastSearchMs >= 0);
  });

  it("reports cache hits after the first read", () => {
    readOfficialMemoryEntries({ home: tmpDir });
    const before = officialMemoryBridgeStats();
    readOfficialMemoryEntries({ home: tmpDir });
    const after = officialMemoryBridgeStats();

    assert.ok(after.cacheHits > before.cacheHits);
  });

  it("redacts sensitive values from official memory snippets", () => {
    const home = path.join(os.tmpdir(), "official-memory-bridge-redact-" + Date.now());
    try {
      const agentDir = path.join(home, "agents", "hana");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "pinned-memory.json"), JSON.stringify({
        version: 1,
        items: [{ id: "pin_secret", content: "Use token sk-abcdef0123456789 for tests." }],
      }), "utf-8");

      const results = searchOfficialMemory("token tests", { home, limit: 2 });

      assert.equal(results.length, 1);
      assert.doesNotMatch(results[0].text, /sk-abcdef/);
      assert.match(results[0].text, /\[redacted-key\]/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("filters official memory by agent project when requested", () => {
    const home = path.join(os.tmpdir(), "official-memory-bridge-scope-" + Date.now());
    try {
      for (const [agent, content] of [
        ["hanako", "Shared review workflow note."],
        ["yolo-paper", "Shared review workflow note."],
      ]) {
        const agentDir = path.join(home, "agents", agent);
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(agentDir, "pinned-memory.json"), JSON.stringify({
          version: 1,
          items: [{ id: "pin", content }],
        }), "utf-8");
      }

      const results = searchOfficialMemory("review workflow", { home, project: "hanako", limit: 5 });

      assert.ok(results.length >= 1);
      assert.deepEqual([...new Set(results.map((entry) => entry.agent))], ["hanako"]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
