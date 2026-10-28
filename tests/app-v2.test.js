import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../v2/runtime.js";
import { migrateLegacyData } from "../v2/migrate-data.js";
import * as memory from "../tools/memory.js";
import { readEffectiveMemories } from "../lib/managed-memory-store.js";

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
    try { app = await startApp(f.sdk); assert.equal(f.tools.size, 9);
      assert.equal(f.tools.get("self_learning_memory").parameters.properties.action.enum.includes("preview_import"), false);
      assert.ok(f.tools.get("self_learning_memory").parameters.properties.action.enum.includes("provenance"));
      assert.equal(f.tools.get("self_learning_memory_manage").parameters.properties.action.enum.includes("preview_import"), true);
      assert.equal(f.metrics.configReads, 0);
      await assert.rejects(f.tools.get("self_learning_memory").execute({ action: "delete", id: "x" }), /only permits read-only actions/);
      await assert.rejects(f.tools.get("self_learning_memory_manage").execute({ action: "episodes" }), /only permits managed-memory actions/);
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
      const episodes = fs.readFileSync(path.join(f.sdk.dataDir, "episodes.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(rows.length, 1); assert.deepEqual(rows[0].toolsUsed, ["read", "edit", "exec_command"]);
      assert.equal(episodes.length, 1); assert.match(episodes[0].id, /^episode:/); assert.match(episodes[0].source.id, /^experience:/); assert.equal(episodes[0].taskRefHash.length, 64);
      assert.equal(episodes[0].sessionKeyHash.includes("fake-session"), false);
      const toolCtx = { dataDir: f.sdk.dataDir, pluginDir: f.sdk.dataDir };
      fs.writeFileSync(path.join(f.sdk.dataDir, "patterns.json"), JSON.stringify([
        { id: "manual:source", type: "preference", desc: "验证来源链", fix: "source link", status: "approved", scope: { project: "general", taskType: "general" }, evidence: [{ id: rows[0].taskId, file: "experience_log.jsonl" }] },
      ]));
      const provenance = await memory.execute({ action: "provenance", id: "manual:source" }, toolCtx);
      assert.equal(provenance.details.sources[0]?.id, episodes[0].id);
      assert.equal(rows[0].userIntent, "修改并验证"); assert.equal(f.metrics.modelCalls, 0);
    } finally { await f.dispose(app); }
  });
  it("keeps read-only memory operations inside the active session project scope", async () => {
    const f = fixture(); let app;
    try {
      app = await startApp(f.sdk);
      fs.writeFileSync(path.join(f.sdk.dataDir, "patterns.json"), JSON.stringify([
        { id: "private", type: "fact", subject: "project", predicate: "token", object: "secret", desc: "database token secret", fix: "secret", status: "approved", scope: { project: "private-project", taskType: "general" } },
        { id: "general", type: "fact", subject: "language", predicate: "preferred", object: "Chinese", desc: "preferred language Chinese", fix: "Chinese", status: "approved", scope: { project: "general", taskType: "general" } },
      ]));
      const ctx = { dataDir: f.sdk.dataDir, pluginDir: f.sdk.dataDir, sessionPath: "sessions/opaque-session.jsonl" };
      const listed = await memory.execute({ action: "list" }, ctx);
      assert.deepEqual(listed.details.memories.map((row) => row.id), ["general"]);
      const searched = await memory.execute({ action: "search", query: "database token secret" }, ctx);
      assert.equal(searched.details.count, 0);
      await assert.rejects(memory.execute({ action: "search", query: "database token secret", project: "private-project" }, ctx), /cannot override/);
      await assert.rejects(memory.execute({ action: "get", id: "private" }, ctx), /not found in the active project scope/);
      await assert.rejects(memory.execute({ action: "list", project: "private-project" }, ctx), /cannot override/);
      const created = await memory.execute({ action: "upsert", memory: { type: "preference", desc: "Scoped addition" } }, ctx);
      assert.equal(created.details.memory.scope.project, "general");
      fs.writeFileSync(path.join(f.sdk.dataDir, "episodes.jsonl"), [
        JSON.stringify({ id: "episode:private", project: "private-project", date: new Date().toISOString() }),
        JSON.stringify({ id: "episode:general", project: "general", date: new Date().toISOString() }),
      ].join("\n") + "\n");
      const episodes = await memory.execute({ action: "episodes", limit: 10 }, ctx);
      assert.deepEqual(episodes.details.episodes.map((row) => row.id), ["episode:general"]);
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
  it("injects approved managed memories and keeps imported candidates out until approval", async () => {
    const f = fixture(); let app;
    try {
      app = await startApp(f.sdk);
      await f.tools.get("self_learning_memory_manage").execute({ action: "upsert", memory: { type: "preference", desc: "表格使用三线表", fix: "使用 booktabs 三线表", aliases: ["booktabs table style"], scope: { project: "general", taskType: "general" } } });
      const hint = await f.hooks.get("agent/before-start")({ prompt: "paper table style", systemPrompt: "base" });
      assert.match(hint.systemPrompt, /booktabs/);
      const imported = { format: "hanako-self-learning-memory", version: 2, memories: [{ id: "candidate", type: "workflow", desc: "sensitive candidate", scope: { project: "general", taskType: "general" } }] };
      const preview = await f.tools.get("self_learning_memory_manage").execute({ action: "preview_import", bundle: imported });
      await f.tools.get("self_learning_memory_manage").execute({ action: "import", bundle: imported, previewId: preview.details.previewId });
      const blocked = await f.hooks.get("agent/before-start")({ prompt: "sensitive candidate", systemPrompt: "base" });
      assert.ok(!blocked || !blocked.systemPrompt.includes("sensitive candidate"));
      assert.equal(readEffectiveMemories(f.sdk.dataDir).find((item) => item.id === "candidate").requiresReview, true);
    } finally { await f.dispose(app); }
  });

  it("injects approved project memories only for the matching host session", async () => {
    const f = fixture(); let app;
    try {
      app = await startApp(f.sdk);
      fs.writeFileSync(path.join(f.sdk.dataDir, "patterns.json"), JSON.stringify([
        { id: "private-pref", type: "preference", desc: "Atlas project uses metric units", fix: "use metric units", status: "approved", scope: { project: "atlas", taskType: "general" } },
        { id: "other-pref", type: "preference", desc: "Boreal project uses imperial units", fix: "use imperial units", status: "approved", scope: { project: "boreal", taskType: "general" } },
      ]));
      const hook = f.hooks.get("agent/before-start");
      const atlas = await hook({ prompt: "units", systemPrompt: "base", session: { sessionPath: "D:/work/atlas/sessions/one.jsonl" } });
      assert.match(atlas.systemPrompt, /metric units/); assert.doesNotMatch(atlas.systemPrompt, /imperial units/);
      const unknown = await hook({ prompt: "units", systemPrompt: "base", session: { sessionPath: "sessions/opaque.jsonl" } });
      assert.equal(unknown, undefined);
      const search = f.tools.get("self_learning_search");
      await assert.rejects(search.execute({ query: "units", project: "boreal", context: { sessionPath: "D:/work/atlas/sessions/one.jsonl" } }), /cannot override/);
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

describe("v6.1 long memory management", () => {
  it("adds typed memories, updates facts with temporal supersession, and deletes explicitly", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "learner-memory-test-"));
    const ctx = { dataDir: root, pluginDir: root };
    try {
      const invoke = (args) => memory.execute(args, ctx);
      const inspect = (args) => memory.execute(args, ctx);
      const first = (await invoke({ action: "upsert", memory: { type: "fact", subject: "robot", predicate: "controller", object: "A" } })).details;
      const second = (await invoke({ action: "upsert", memory: { type: "fact", subject: "robot", predicate: "controller", object: "B" } })).details;
      assert.equal(first.action, "added"); assert.equal(second.action, "added");
      const facts = (await inspect({ action: "list", type: "fact", includeInactive: true })).details.memories;
      assert.equal(facts.length, 2); assert.equal(facts[0].status, "superseded"); assert.equal(facts[0].supersededBy, facts[1].id);
      await invoke({ action: "upsert", memory: { id: facts[1].id, object: "C" } });
      const revised = (await inspect({ action: "list", type: "fact", includeInactive: true })).details.memories;
      assert.equal(revised.length, 3); assert.equal(revised[1].status, "superseded"); assert.equal(revised[1].supersededBy, revised[2].id);
      await invoke({ action: "upsert", memory: { id: "manual:p", type: "preference", desc: "Use concise answers", fix: "Be concise" } });
      const listed = await inspect({ action: "list", type: "preference" });
      assert.equal(listed.details.count, 1); assert.equal(listed.details.memories[0].status, "approved");
      await assert.rejects(invoke({ action: "upsert", memory: { id: "manual:p", desc: "Updated preference", status: "rejected" } }), /not editable/);
      const update = await invoke({ action: "upsert", memory: { id: "manual:p", desc: "Updated preference" } });
      assert.equal(update.details.status, "approved");
      const found = await inspect({ action: "search", query: "updated preference", project: "general" });
      assert.equal(found.details.count, 1); assert.equal(found.details.memories[0].id, "manual:p");
      const deleted = await invoke({ action: "delete", id: "manual:p" });
      assert.equal(deleted.details.deleted, true);
      await assert.rejects(inspect({ action: "get", id: "manual:p" }), /memory not found/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("previews imports and never overwrites conflicting pattern IDs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "learner-memory-import-"));
    const ctx = { dataDir: root, pluginDir: root };
    const bundle = { format: "hanako-self-learning-memory", version: 1, patterns: [
      { id: "existing", type: "preference", desc: "Incoming overwrite", fix: "incoming" },
      { id: "new", type: "workflow", desc: "New workflow", fix: "review first" },
    ], facts: [] };
    try {
      fs.writeFileSync(path.join(root, "patterns.json"), JSON.stringify([{ id: "existing", type: "preference", desc: "Original", fix: "original", status: "approved" }]));
      const preview = (await memory.execute({ action: "preview_import", bundle }, ctx)).details;
      assert.equal(preview.applied, false); assert.equal(preview.counts.add, 1); assert.deepEqual(preview.conflicts, [{ kind: "id", id: "existing", decision: "skip" }]);
      const applied = await memory.execute({ action: "import", bundle, previewId: preview.previewId }, ctx);
      assert.equal(applied.details.imported, 1);
      const patterns = (await memory.execute({ action: "list" }, ctx)).details.memories;
      assert.equal(patterns.find((row) => row.id === "existing").desc, "Original");
      assert.equal(patterns.find((row) => row.id === "new").status, "pending");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects malformed or oversized bundles before writing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "learner-memory-invalid-"));
    try {
      await assert.rejects(memory.execute({ action: "import", bundle: { format: "wrong", version: 1, patterns: [], facts: [] } }, { dataDir: root, pluginDir: root }), /Unsupported memory bundle/);
      assert.equal(fs.existsSync(path.join(root, "patterns.json")), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
