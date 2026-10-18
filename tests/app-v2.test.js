import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../v2/runtime.js";
import { migrateLegacyData } from "../v2/migrate-data.js";

function fixture({ grants = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learner-v2-test-"));
  const dataDir = path.join(root, "data"); fs.mkdirSync(dataDir);
  const tools = new Map(), hooks = new Map(), handlers = new Map(), schedules = new Map(), subscriptions = [];
  const metrics = { configReads: 0, modelCalls: 0, usageCalls: 0 };
  const receipt = (fn) => Object.assign(fn, { disposeAsync: async () => fn() });
  const sdk = {
    dataDir,
    capabilities: { get: async () => ({ capabilities: ["app/hooks.agent-before-start", "app/usage.read", "app/models.infer"].map((capability) => ({ capability, status: grants ? "always" : "denied" })) }) },
    logger: Object.fromEntries(["info", "warn", "error", "debug"].map((key) => [key, async () => {}])),
    config: { getAll: async () => { metrics.configReads += 1; return {}; }, setMany: async () => {} },
    bus: { subscribe: async (callback, filter) => { const sub = { callback, filter }; subscriptions.push(sub); return receipt(() => subscriptions.splice(subscriptions.indexOf(sub), 1)); } },
    hooks: { onDecision: async (word, callback) => { hooks.set(word, callback); return receipt(() => hooks.delete(word)); } },
    tools: { register: async (tool) => { tools.set(tool.name, tool); return receipt(() => tools.delete(tool.name)); } },
    usage: { list: async () => { metrics.usageCalls += 1; return { entries: [], nextCursor: null }; } },
    models: { utility: async (input) => { metrics.modelCalls += 1; metrics.lastModelInput = input; return { requestId: input.requestId, text: '{"ok":true}' }; }, cancel: async () => {} },
    network: { fetch: async () => { throw new Error("PLUGIN_NETWORK_NOT_DECLARED"); } },
    resources: { stage: async ({ path: filePath, name }) => ({ file: { filePath, label: name }, mediaItem: { type: "session_file", label: name } }) },
    tasks: {
      registerHandler: async (key, callback) => { handlers.set(key, callback); return receipt(() => handlers.delete(key)); },
      listSchedules: async () => [...schedules.values()],
      schedule: async (input) => { const item = { ...input, scheduleId: `s-${schedules.size}`, enabled: true }; schedules.set(item.scheduleId, item); return item; },
      pauseSchedule: async (id) => { schedules.get(id).enabled = false; },
      resumeSchedule: async (id) => { schedules.get(id).enabled = true; },
    },
  };
  const emit = (event, target = "sessions/v2.jsonl") => { for (const sub of subscriptions) if (sub.filter.types.includes(event.type)) sub.callback(event, target); };
  return { sdk, root, tools, hooks, handlers, schedules, metrics, emit, subscriptions,
    async dispose(app) { await app?.stop(); await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }); } };
}

describe("v2 App migration", { concurrency: false }, () => {
  it("starts with public SDK registrations, no schedules or startup config reads", async () => {
    const f = fixture(); let app;
    try { app = await startApp(f.sdk); assert.equal(f.tools.size, 7); assert.equal(f.metrics.configReads, 0);
      assert.equal(f.schedules.size, 0); assert.equal(f.handlers.size, 3);
      assert.ok(fs.existsSync(path.join(f.sdk.dataDir, "generated", "skills", "self-learning")));
      assert.equal(f.metrics.modelCalls, 0);
    } finally { await f.dispose(app); }
  });
  it("observes asynchronous Pi events as one complete learning turn", async () => {
    const f = fixture(); let app;
    try {
      app = await startApp(f.sdk);
      f.emit({ type: "session_user_message", message: { text: "修改并验证" } });
      for (const toolName of ["read", "edit", "exec_command"]) {
        f.emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse" } });
        f.emit({ type: "tool_execution_start", toolName }); f.emit({ type: "tool_execution_end", toolName });
      }
      f.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: "验证通过" } });
      await app.stop();
      const rows = fs.readFileSync(path.join(f.sdk.dataDir, "experience_log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(rows.length, 1); assert.deepEqual(rows[0].toolsUsed, ["read", "edit", "exec_command"]);
      assert.equal(rows[0].userIntent, "修改并验证"); assert.equal(f.metrics.modelCalls, 0);
    } finally { await f.dispose(app); }
  });
  it("uses host utility models without forwarding v1 sampling verbs or credentials", async () => {
    const f = fixture(); let app;
    try { app = await startApp(f.sdk); const result = await app.ctx.sampleText({ messages: [{role:"user",content:"summary"}], maxTokens: 100, timeout: 1000 });
      assert.equal(result.text, '{"ok":true}'); assert.equal(f.metrics.lastModelInput.scope, "app");
      assert.equal(f.metrics.lastModelInput.maxTokens, 100); assert.equal(f.metrics.lastModelInput.apiKey, undefined);
      await assert.rejects(app.ctx.bus.request("model:sample-text", {}), /V2_UNSUPPORTED_OPERATION/);
    } finally { await f.dispose(app); }
  });
  it("keeps denied optional grants off and reports the limitation", async () => {
    const f = fixture({ grants: false }); let app;
    try { app = await startApp(f.sdk); assert.equal(f.hooks.size, 0); assert.equal(f.metrics.usageCalls, 0);
      const result = await f.tools.get("self_learning_stats").execute({ context: {} });
      assert.equal(result.details.app.hintInjection, false); assert.equal(result.details.config.autoActions.enabled, false);
      assert.equal(result.details.config.officialMemoryBridgeEnabled, false);
    } finally { await f.dispose(app); }
  });
  it("only schedules background jobs after explicit enable and avoids duplicates", async () => {
    const f = fixture(); let app;
    try { app = await startApp(f.sdk);
      const tool = f.tools.get("self_learning_background");
      await tool.execute({ action: "enable" }); await tool.execute({ action: "enable" });
      assert.equal(f.schedules.size, 3); await tool.execute({ action: "disable" });
      assert.ok([...f.schedules.values()].every((s) => !s.enabled));
      assert.equal((await f.handlers.get("advisor-maintenance").run({ taskId:"t" })).skipped, "background_disabled");
    } finally { await f.dispose(app); }
  });
  it("does not inject project-private or pending rules into unrelated sessions", async () => {
    const f = fixture(); let app;
    try { app = await startApp(f.sdk);
      const now = new Date().toISOString();
      const pattern = {id:"pref:scope",type:"preference",desc:"使用专属项目密语",fix:"使用专属项目密语",knowledgeTier:"durable",status:"approved",score:30,count:8,firstSeen:now,lastSeen:now,scope:{project:"private-project",taskType:"general"}};
      fs.writeFileSync(path.join(f.sdk.dataDir, "patterns.json"),JSON.stringify([pattern]));
      assert.equal(await f.hooks.get("agent/before-start")({prompt:"专属项目密语",systemPrompt:"base",session:{sessionId:"a"}}), undefined);
      pattern.scope.project = "general";
      fs.writeFileSync(path.join(f.sdk.dataDir, "patterns.json"),JSON.stringify([pattern]));
      const injected = await f.hooks.get("agent/before-start")({prompt:"专属项目密语",systemPrompt:"base",session:{sessionId:"a"}});
      assert.ok(injected?.systemPrompt.startsWith("base\n"));
      assert.match(injected.systemPrompt, /专属项目密语/);
      pattern.status = "pending";
      pattern.type = "preference";
      fs.writeFileSync(path.join(f.sdk.dataDir, "patterns.json"),JSON.stringify([pattern]));
      const pending = await f.hooks.get("agent/before-start")({prompt:"专属项目密语",systemPrompt:"base",session:{sessionId:"a"}});
      assert.ok(!pending || !pending.systemPrompt.includes("专属项目密语"), "pending preferences cannot inject");
    } finally { await f.dispose(app); }
  });
  it("removes all SDK registrations on stop", async () => {
    const f = fixture(); let app;
    try { app = await startApp(f.sdk); await app.stop(); assert.equal(f.tools.size,0); assert.equal(f.subscriptions.length,0); assert.equal(f.handlers.size,0); }
    finally { await f.dispose(app); }
  });
});

describe("v1 to v2 data migration", () => {
  it("previews without writing, then copies memories without changing the source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),"learner-migrate-"));
    try { const source=path.join(root,"old"),target=path.join(root,"new"); fs.mkdirSync(source);
      const patterns='[{"id":"kept"}]'; fs.writeFileSync(path.join(source,"patterns.json"),patterns);
      fs.writeFileSync(path.join(source,".lock"),"ignored");
      assert.equal(migrateLegacyData({source,target}).applied,false); assert.equal(fs.existsSync(target),false);
      assert.equal(migrateLegacyData({source,target,apply:true}).applied,true);
      assert.equal(fs.readFileSync(path.join(target,"patterns.json"),"utf8"),patterns);
      assert.equal(fs.readFileSync(path.join(source,"patterns.json"),"utf8"),patterns);
      assert.throws(()=>migrateLegacyData({source,target,apply:true}),/never be overwritten/);
      assert.throws(()=>migrateLegacyData({source,target:path.join(source,"nested")}),/separate directories/);
      fs.writeFileSync(path.join(source,"patterns.json"),"[");
      const invalidTarget=path.join(root,"invalid");
      assert.throws(()=>migrateLegacyData({source,target:invalidTarget,apply:true}),SyntaxError);
      assert.equal(fs.existsSync(invalidTarget),false,"invalid input must not leave a partial migration");
    } finally { fs.rmSync(root,{recursive:true,force:true}); }
  });
});
