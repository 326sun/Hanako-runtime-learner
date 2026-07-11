import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRuntimeContext, requestBus } from "../lib/hana-runtime-compat.js";

describe("hana-runtime-compat", () => {
  it("preserves official SDK context fields while normalizing legacy helpers", async () => {
    const staged = [];
    const resources = {
      read: async () => ({ ok: true }),
      search: async () => ({ items: [] }),
    };
    const stageFile = (entry) => {
      staged.push(entry);
      return { file: entry, mediaItem: { type: "session_file", label: entry.label } };
    };
    const ctx = normalizeRuntimeContext({
      pluginDir: "/plugin",
      dataDir: "/data",
      sessionId: "sid-1",
      sessionRef: { sessionId: "sid-1" },
      sessionPath: "sessions/sid-1.jsonl",
      stageFile,
      resources,
      config: {
        getAll: () => ({ minInjectCount: 7 }),
        setMany: () => {},
      },
      bus: {
        request: async (name, payload) => ({ name, payload }),
      },
    });

    assert.equal(ctx.sessionId, "sid-1");
    assert.deepEqual(ctx.sessionRef, { sessionId: "sid-1" });
    assert.equal(ctx.sessionPath, "sessions/sid-1.jsonl");
    assert.equal(ctx.stageFile, stageFile);
    assert.equal(ctx.resources, resources);
    assert.deepEqual(ctx.config.getAll(), { minInjectCount: 7 });
    const stagedFile = ctx.stageFile({ filePath: "/tmp/report.md", label: "report.md" });
    assert.equal(stagedFile.mediaItem.label, "report.md");
    assert.deepEqual(staged, [{ filePath: "/tmp/report.md", label: "report.md" }]);
    assert.deepEqual(await requestBus(ctx, "task:test", { ok: true }), { name: "task:test", payload: { ok: true } });
  });

  it("preserves the v0.374.3 execution-boundary and capability context fields", async () => {
    const executionBoundary = { kind: "local", trusted: true };
    const fetch = async () => new Response("ok");
    const ctx = normalizeRuntimeContext({
      pluginId: "hanako-runtime-learner",
      dataDir: "/data",
      executionBoundary,
      capabilities: ["usage.read"],
      sensitiveCapabilities: ["usage.read"],
      network: { fetch },
    });

    assert.equal(ctx.executionBoundary, executionBoundary);
    assert.deepEqual(ctx.capabilities, ["usage.read"]);
    assert.deepEqual(ctx.sensitiveCapabilities, ["usage.read"]);
    assert.equal(typeof ctx.network.fetch, "function");
    assert.equal(await (await ctx.network.fetch()).text(), "ok");
  });
});
