/**
 * Unit tests for lib/console-session.js — the self-learning console's
 * plugin_private session lifecycle and snapshot assembly.
 * Run: node --test tests/console-session.test.js
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { ensureConsoleSession, buildSnapshot, CONSOLE_STATE_FILENAME } from "../lib/console-session.js";

function tempDir() {
  return path.join(os.tmpdir(), `console-session-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function makeBus({ canCreate = true, createResult, onCreate, getResult } = {}) {
  const calls = [];
  return {
    calls,
    getCapability(name) {
      if (name === "session:create") return canCreate ? { available: true } : { available: false };
      if (name === "session:get") return getResult === undefined ? null : { available: true };
      return null;
    },
    hasHandler(name) {
      if (name === "session:create") return canCreate;
      if (name === "session:get") return getResult !== undefined;
      return false;
    },
    async request(name, payload) {
      calls.push({ name, payload });
      if (name === "session:create") {
        if (onCreate) onCreate(payload);
        return createResult ?? { sessionId: "console-1", sessionRef: { sessionId: "console-1" }, sessionPath: "/data/console.jsonl" };
      }
      if (name === "session:get") {
        if (getResult === "throw") throw new Error("session not found");
        return getResult;
      }
      throw new Error(`unexpected bus request: ${name}`);
    },
  };
}

function makeCtx(dataDir, bus) {
  return { pluginId: "hanako-runtime-learner", dataDir, bus, log: { info() {}, warn() {}, error() {} } };
}

describe("ensureConsoleSession", () => {
  const dirs = [];
  function dir() { const d = tempDir(); fs.mkdirSync(d, { recursive: true }); dirs.push(d); return d; }
  after(() => { for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });

  it("creates a plugin_private session, persists state, returns the target", async () => {
    const d = dir();
    const bus = makeBus();
    const session = await ensureConsoleSession(makeCtx(d, bus));
    assert.equal(session.sessionId, "console-1");
    const createCall = bus.calls.find((c) => c.name === "session:create");
    assert.ok(createCall);
    assert.equal(createCall.payload.ownerPluginId, "hanako-runtime-learner");
    assert.equal(createCall.payload.visibility, "plugin_private");
    assert.equal(createCall.payload.cwd, d);
    const state = JSON.parse(fs.readFileSync(path.join(d, CONSOLE_STATE_FILENAME), "utf-8"));
    assert.equal(state.sessionId, "console-1");
  });

  it("reuses the persisted session without creating a second one", async () => {
    const d = dir();
    fs.writeFileSync(path.join(d, CONSOLE_STATE_FILENAME), JSON.stringify({ sessionId: "existing-1", sessionRef: { sessionId: "existing-1" }, sessionPath: "/data/x.jsonl" }));
    const bus = makeBus();
    const session = await ensureConsoleSession(makeCtx(d, bus));
    assert.equal(session.sessionId, "existing-1");
    assert.equal(bus.calls.filter((c) => c.name === "session:create").length, 0);
  });

  it("returns null and writes no state when session:create is unavailable", async () => {
    const d = dir();
    const bus = makeBus({ canCreate: false });
    const session = await ensureConsoleSession(makeCtx(d, bus));
    assert.equal(session, null);
    assert.equal(fs.existsSync(path.join(d, CONSOLE_STATE_FILENAME)), false);
  });

  it("returns null when session:create throws, leaving no state", async () => {
    const d = dir();
    const bus = makeBus();
    bus.request = async (name) => { if (name === "session:create") throw new Error("boom"); return null; };
    const session = await ensureConsoleSession(makeCtx(d, bus));
    assert.equal(session, null);
    assert.equal(fs.existsSync(path.join(d, CONSOLE_STATE_FILENAME)), false);
  });

  it("rebuilds when the persisted session is gone and session:get reports it missing", async () => {
    const d = dir();
    fs.writeFileSync(path.join(d, CONSOLE_STATE_FILENAME), JSON.stringify({ sessionId: "dead-1" }));
    const bus = makeBus({ getResult: "throw" });
    const session = await ensureConsoleSession(makeCtx(d, bus));
    assert.equal(session.sessionId, "console-1");
    assert.equal(bus.calls.filter((c) => c.name === "session:create").length, 1);
    const state = JSON.parse(fs.readFileSync(path.join(d, CONSOLE_STATE_FILENAME), "utf-8"));
    assert.equal(state.sessionId, "console-1");
  });
});

describe("buildSnapshot", () => {
  const dirs = [];
  function dir() { const d = tempDir(); fs.mkdirSync(d, { recursive: true }); dirs.push(d); return d; }
  after(() => { for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });

  it("produces a non-empty snapshot even with no data", () => {
    const text = buildSnapshot(dir(), {}, {});
    assert.equal(typeof text, "string");
    assert.ok(text.length > 0);
  });

  it("includes recent activity summaries when present", () => {
    const d = dir();
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(d, "activity_log.jsonl"),
      `${JSON.stringify({ date: now, type: "usage_pattern_discovered", summary: "New usage pattern: foo" })}\n`);
    const text = buildSnapshot(d, {}, {});
    assert.match(text, /usage_pattern_discovered|New usage pattern/);
  });

  it("bounds snapshot length", () => {
    const d = dir();
    const lines = Array.from({ length: 500 }, (_, i) => JSON.stringify({ date: new Date().toISOString(), type: "x", summary: "S".repeat(200) + i })).join("\n");
    fs.writeFileSync(path.join(d, "activity_log.jsonl"), lines + "\n");
    const text = buildSnapshot(d, {}, {});
    assert.ok(text.length <= 8000, `snapshot too long: ${text.length}`);
  });
});
