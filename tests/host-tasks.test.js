import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  hostTaskSupport,
  registerTaskHandler,
  scheduleTask,
  runHostTask,
  setupBackgroundTasks,
  TASK_OPERATIONS,
} from "../lib/host-tasks.js";
import { DEFAULT_CONFIG } from "../lib/common.js";
import { readEvents } from "../lib/event-log.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "host-tasks-test-"));

class FakeTaskBus {
  constructor({ unavailable = [] } = {}) {
    this.handlers = new Map();
    this.schedules = new Map();
    this.tasks = [];
    this.requests = [];
    this.unavailable = new Set(unavailable);
  }

  getCapability(name) {
    if (this.unavailable.has(name)) return { available: false };
    if (TASK_OPERATIONS.includes(name)) return { available: true };
    return null;
  }

  hasHandler(name) {
    return TASK_OPERATIONS.includes(name) && !this.unavailable.has(name);
  }

  async request(name, payload = {}) {
    this.requests.push({ name, payload });
    if (this.unavailable.has(name)) throw new Error(`unavailable: ${name}`);
    if (name === "task:register-handler") {
      this.handlers.set(payload.type, payload.handler);
      return { ok: true, handlerId: payload.handlerId };
    }
    if (name === "task:unregister-handler") {
      this.handlers.delete(payload.type);
      return { ok: true };
    }
    if (name === "task:schedule") {
      this.schedules.set(payload.scheduleId, payload);
      return { ok: true, scheduleId: payload.scheduleId };
    }
    if (name === "task:list-schedules") {
      return { schedules: [...this.schedules.values()] };
    }
    if (name === "task:list") {
      return { tasks: this.tasks };
    }
    if (name === "task:complete" || name === "task:fail" || name === "task:cancel" || name === "task:update" || name === "task:register" || name === "task:remove") {
      return { ok: true };
    }
    throw new Error(`unexpected request: ${name}`);
  }
}

function ctxFor(bus) {
  const logs = [];
  return {
    bus,
    logs,
    log: {
      info: (message) => logs.push({ level: "info", message }),
      warn: (message) => logs.push({ level: "warn", message }),
      debug: (message) => logs.push({ level: "debug", message }),
    },
  };
}

describe("host task adapter", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("reports task:* unavailable without throwing on legacy hosts", async () => {
    const ctx = ctxFor({ getCapability: () => null, hasHandler: () => false, request: () => { throw new Error("should not request"); } });
    const support = hostTaskSupport(ctx);
    assert.equal(support.ok, false);
    assert.ok(support.missing.includes("task:schedule"));

    const registered = await registerTaskHandler(ctx, { pluginId: "p", type: "job", handler: async () => ({ ok: true }) });
    assert.equal(registered.ok, false);
    assert.equal(registered.skipped, "unavailable");
  });

  it("uses fake bus capabilities to register handlers and schedules jobs", async () => {
    const bus = new FakeTaskBus();
    const ctx = ctxFor(bus);
    const handler = async () => ({ ok: true });

    const registered = await registerTaskHandler(ctx, { pluginId: "p", type: "job", handler });
    assert.equal(registered.ok, true);
    assert.equal(bus.handlers.get("job"), handler);

    const scheduled = await scheduleTask(ctx, {
      pluginId: "p",
      type: "job",
      scheduleId: "job.schedule",
      intervalMinutes: 60,
    });
    assert.equal(scheduled.ok, true);
    assert.equal(bus.schedules.get("job.schedule").intervalMinutes, 60);
  });

  it("returns skipped/unavailable when a requested task operation is missing", async () => {
    const bus = new FakeTaskBus({ unavailable: ["task:schedule"] });
    const result = await scheduleTask(ctxFor(bus), {
      pluginId: "p",
      type: "job",
      scheduleId: "job.schedule",
      intervalMinutes: 60,
    });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, "unavailable");
  });

  it("single-flights concurrent triggers for the same job", async () => {
    const bus = new FakeTaskBus();
    const ctx = ctxFor(bus);
    let calls = 0;
    let release;
    const firstStarted = new Promise((resolve) => {
      release = resolve;
    });
    const run = () => runHostTask(ctx, {
      pluginId: "p",
      dataDir: tmpDir,
      taskId: "task-1",
      type: "job",
      job: async () => {
        calls += 1;
        await firstStarted;
        return { ok: true };
      },
    });

    const first = run();
    const second = run();
    await Promise.resolve();
    release();
    const results = await Promise.all([first, second]);

    assert.equal(calls, 1);
    assert.equal(results.some((r) => r.skipped === "in_flight"), true);
  });

  it("writes audit events for complete, fail, and cancel outcomes", async () => {
    const ctx = ctxFor(new FakeTaskBus());
    await runHostTask(ctx, { pluginId: "p", dataDir: tmpDir, taskId: "ok", type: "ok-job", job: async () => ({ ok: true }) });
    await runHostTask(ctx, { pluginId: "p", dataDir: tmpDir, taskId: "bad", type: "bad-job", job: async () => { throw new Error("boom"); } });
    await runHostTask(ctx, { pluginId: "p", dataDir: tmpDir, taskId: "cancel", type: "cancel-job", task: { cancelled: true }, job: async () => ({ ok: true }) });

    const eventTypes = readEvents(tmpDir, { limit: 10 }).map((event) => event.type);
    assert.ok(eventTypes.includes("background_task.completed"));
    assert.ok(eventTypes.includes("background_task.failed"));
    assert.ok(eventTypes.includes("background_task.cancelled"));
  });
});

describe("M3-lite background task setup", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it("does not duplicate schedules on repeated onload setup", async () => {
    const bus = new FakeTaskBus();
    const ctx = ctxFor(bus);
    const base = {
      ctx,
      dataDir: tmpDir,
      config: DEFAULT_CONFIG,
      getPatterns: () => [],
      runAdvisor: async () => ({ ok: true }),
      runRetention: async () => ({ ok: true }),
      runLlmExtraction: async () => ({ ok: false, skipped: "disabled" }),
    };

    const first = await setupBackgroundTasks(base);
    const second = await setupBackgroundTasks(base);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal([...bus.schedules.keys()].length, 3);
  });

  it("audits and keeps legacy behavior when task:* is unavailable", async () => {
    const ctx = ctxFor({ getCapability: () => null, hasHandler: () => false, request: () => { throw new Error("should not request"); } });
    const result = await setupBackgroundTasks({
      ctx,
      dataDir: tmpDir,
      config: DEFAULT_CONFIG,
      getPatterns: () => [],
      runAdvisor: async () => ({ ok: true }),
      runRetention: async () => ({ ok: true }),
      runLlmExtraction: async () => ({ ok: false, skipped: "disabled" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, "unavailable");
    assert.equal(result.useLegacyPath, true);
    assert.equal(readEvents(tmpDir, { limit: 1 })[0].type, "background_tasks_unavailable");
  });

  it("marks recovering/running tasks failed during setup so they do not hang forever", async () => {
    const bus = new FakeTaskBus();
    bus.tasks = [{ id: "recover-1", type: "hanako-runtime-learner.advisor-maintenance", status: "recovering" }];
    const result = await setupBackgroundTasks({
      ctx: ctxFor(bus),
      dataDir: tmpDir,
      config: DEFAULT_CONFIG,
      getPatterns: () => [],
      runAdvisor: async () => ({ ok: true }),
      runRetention: async () => ({ ok: true }),
      runLlmExtraction: async () => ({ ok: false, skipped: "disabled" }),
    });

    assert.equal(result.recovered, 1);
    assert.ok(bus.requests.some((request) => request.name === "task:fail" && request.payload.taskId === "recover-1"));
    assert.equal(readEvents(tmpDir, { limit: 1 })[0].type, "background_task.recovered_failed");
  });

  it("scheduled LLM extraction handler runs but default disabled config skips sampling", async () => {
    const bus = new FakeTaskBus();
    let sampled = 0;
    const ctx = ctxFor(bus);
    ctx.bus.request = async (name, payload) => {
      if (name === "model:sample-text") sampled += 1;
      return FakeTaskBus.prototype.request.call(bus, name, payload);
    };
    await setupBackgroundTasks({
      ctx,
      dataDir: tmpDir,
      config: DEFAULT_CONFIG,
      getPatterns: () => [{ id: "workflow:a", type: "workflow", desc: "a" }],
      runAdvisor: async () => ({ ok: true }),
      runRetention: async () => ({ ok: true }),
      runLlmExtraction: async () => ({ ok: false, skipped: "disabled" }),
    });

    const handler = bus.handlers.get("hanako-runtime-learner.llm-extraction-worker");
    const result = await handler({ id: "llm-task-1", type: "hanako-runtime-learner.llm-extraction-worker" });
    assert.equal(result.result.skipped, "disabled");
    assert.equal(sampled, 0);
  });
});
