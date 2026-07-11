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
    const entries = readOfficialMemoryEntries({ home: tmpDir, agentId: "hana" });
    assert.ok(entries.some((entry) => entry.memoryType === "pinned"));
    assert.ok(entries.some((entry) => entry.memoryType === "compiled"));
  });

  it("searches official memory entries", () => {
    const { results, stats } = searchOfficialMemoryWithStats("proposal review", { home: tmpDir, agentId: "hana", limit: 2 });
    assert.equal(results.length, 1);
    assert.equal(results[0].memoryType, "pinned");
    assert.equal(stats.lastResultCount, 1);
    assert.ok(stats.lastSearchMs >= 0);
  });

  it("reports cache hits after the first read", () => {
    readOfficialMemoryEntries({ home: tmpDir, agentId: "hana" });
    const before = officialMemoryBridgeStats();
    readOfficialMemoryEntries({ home: tmpDir, agentId: "hana" });
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

      const results = searchOfficialMemory("token tests", { home, agentId: "hana", limit: 2 });

      assert.equal(results.length, 1);
      assert.doesNotMatch(results[0].text, /sk-abcdef/);
      assert.match(results[0].text, /\[redacted-key\]/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reads only the invoking Agent's official memory", () => {
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

      const results = searchOfficialMemory("review workflow", { home, agentId: "hanako", limit: 5 });

      assert.ok(results.length >= 1);
      assert.deepEqual([...new Set(results.map((entry) => entry.agent))], ["hanako"]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("fails closed without a valid Agent identity", () => {
    assert.deepEqual(searchOfficialMemory("proposal review", { home: tmpDir, limit: 5 }), []);
    assert.deepEqual(searchOfficialMemory("proposal review", { home: tmpDir, agentId: "../hana", limit: 5 }), []);
    assert.equal(officialMemoryBridgeStats().lastSkippedReason, "agent identity unavailable");
  });

  it("deduplicates aggregate memory.md sections already present in component files", () => {
    const home = path.join(os.tmpdir(), "official-memory-bridge-dedupe-" + Date.now());
    try {
      const memoryDir = path.join(home, "agents", "hana", "memory");
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(memoryDir, "facts.md"), "User prefers concise release verdicts.\n", "utf-8");
      fs.writeFileSync(path.join(memoryDir, "memory.md"), "# Facts\n\nUser prefers concise release verdicts.\n", "utf-8");

      const entries = readOfficialMemoryEntries({ home, agentId: "hana" });
      assert.equal(entries.filter((entry) => entry.text.includes("concise release verdicts")).length, 1);
      assert.equal(entries.find((entry) => entry.text.includes("concise release verdicts")).memoryType, "facts");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reads the latest Hanako daily conveyor when week.md is unavailable", () => {
    const home = path.join(os.tmpdir(), "official-memory-bridge-daily-" + Date.now());
    try {
      const dailyDir = path.join(home, "agents", "hana", "memory", "daily");
      fs.mkdirSync(dailyDir, { recursive: true });
      fs.writeFileSync(path.join(dailyDir, "2026-07-08.md"), "Worked on the older task.\n", "utf-8");
      fs.writeFileSync(path.join(dailyDir, "2026-07-09.md"), "Reviewed the latest Hanako contract.\n", "utf-8");

      const entries = readOfficialMemoryEntries({ home, agentId: "hana" });
      const daily = entries.filter((entry) => entry.memoryType === "daily");
      assert.equal(daily.length, 2);
      assert.ok(daily.some((entry) => entry.text.includes("latest Hanako contract")));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
