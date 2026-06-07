import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { readOfficialMemoryEntries, searchOfficialMemory } from "../lib/official-memory-bridge.js";

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
    const results = searchOfficialMemory("proposal review", { home: tmpDir, limit: 2 });
    assert.equal(results.length, 1);
    assert.equal(results[0].memoryType, "pinned");
  });
});
