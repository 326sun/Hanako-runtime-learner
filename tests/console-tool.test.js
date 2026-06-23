/**
 * Unit tests for tools/console.js — the self_learning_console tool that surfaces
 * the plugin's private console session as a chat.surface card.
 * Run: node --test tests/console-tool.test.js
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import * as consoleTool from "../tools/console.js";

function tempDir() {
  const d = path.join(os.tmpdir(), `console-tool-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function makeCtx(dataDir, { canCreate = true, createResult } = {}) {
  const calls = [];
  return {
    calls,
    pluginId: "hanako-runtime-learner",
    dataDir,
    log: { info() {}, warn() {}, error() {} },
    bus: {
      getCapability(name) {
        if (name === "session:create") return canCreate ? { available: true } : { available: false };
        if (name === "session:send") return { available: true, inputSchema: { properties: {} } };
        return null;
      },
      hasHandler(name) { return name === "session:send" || (name === "session:create" && canCreate); },
      async request(name, payload) {
        calls.push({ name, payload });
        if (name === "session:create") return createResult ?? { sessionId: "console-9", sessionRef: { sessionId: "console-9" }, sessionPath: "/data/c.jsonl" };
        if (name === "session:send") return { ok: true };
        throw new Error(`unexpected: ${name}`);
      },
    },
  };
}

describe("self_learning_console tool", () => {
  const dirs = [];
  function dir() { const d = tempDir(); dirs.push(d); return d; }
  after(() => { for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });

  it("declares a stable tool name", () => {
    assert.equal(consoleTool.name, "self_learning_console");
  });

  it("returns a chat.surface card and posts a snapshot when the session is available", async () => {
    const d = dir();
    const ctx = makeCtx(d);
    const result = await consoleTool.execute({}, ctx);
    const card = result.details.card;
    assert.equal(card.type, "chat.surface");
    assert.equal(card.pluginId, "hanako-runtime-learner");
    assert.equal(card.sessionId, "console-9");
    assert.equal(card.sessionRef.sessionId, "console-9");
    assert.equal(card.sessionRef.sessionPath, "/data/c.jsonl");
    const sendCall = ctx.calls.find((c) => c.name === "session:send");
    assert.ok(sendCall, "snapshot was sent into the console session");
    assert.equal(sendCall.payload.sessionId, "console-9");
    assert.ok(String(sendCall.payload.text).length > 0);
  });

  it("returns plain text with no card when session:create is unavailable", async () => {
    const d = dir();
    const ctx = makeCtx(d, { canCreate: false });
    const result = await consoleTool.execute({}, ctx);
    assert.equal(result.details.card, undefined);
    assert.ok(result.content?.[0]?.text);
    assert.equal(ctx.calls.filter((c) => c.name === "session:create").length, 0);
  });

  it("omits sessionPath from sessionRef when the host did not provide one", async () => {
    const d = dir();
    const ctx = makeCtx(d, { createResult: { sessionId: "np-1", sessionRef: { sessionId: "np-1" } } });
    const result = await consoleTool.execute({}, ctx);
    assert.equal(result.details.card.sessionId, "np-1");
    assert.equal("sessionPath" in result.details.card.sessionRef, false);
  });
});
