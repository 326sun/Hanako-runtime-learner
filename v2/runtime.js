import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import LegacyCore from "../index.js";
import { mergeConfig, readJson, writeJson } from "../lib/common.js";
import { createBackground } from "./background.js";
import { buildSkillMdFromPatterns } from "../lib/skill-renderer-safe.js";
import { runSearch } from "../tools/search.js";
import * as stats from "../tools/stats.js";
import * as search from "../tools/search.js";
import * as report from "../tools/report.js";
import * as activity from "../tools/activity.js";
import * as doctor from "../tools/doctor.js";
import * as control from "../tools/control.js";

export const APP_ID = "hanako-runtime-learner";
const V2_LIMITS = { officialMemoryBridgeEnabled: false, workStatusEnabled: false,
  proposalChatNotificationsEnabled: false, autoActions: { enabled: false } };
const UNSUPPORTED = new Set(["run_benchmarks", "release_readiness", "trust_project_scripts"]);
const jsonResult = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: data });

export async function startApp(sdk) {
  let capabilities = [];
  let capabilityProbe = "available";
  try { ({ capabilities = [] } = await sdk.capabilities.get()); }
  catch (error) {
    if (!/No handler registered for "app:capabilities"/.test(error.message)) throw error;
    capabilityProbe = "host service unavailable; protected startup features disabled";
    await sdk.logger.warn(capabilityProbe);
  }
  const grants = new Map(capabilities.map((row) => [row.capability, row.status]));
  const granted = (word) => ["always", "session"].includes(grants.get(word));
  const status = { version: "6.0.0", format: 2, capabilityProbe, grants: Object.fromEntries(grants),
    hintInjection: granted("app/hooks.agent-before-start"), usage: granted("app/usage.read"),
    officialMemoryBridge: "unavailable in isolated App; legacy data preserved",
    autoActions: "disabled; workspace execution needs a separate managed-runtime implementation" };
  const receipts = [];
  const retain = (receipt) => { receipts.push(receipt); return receipt; };
  const localSubscribers = new Set();
  const configFile = path.join(sdk.dataDir, "runtime-config.json");
  const generatedRoot = path.join(sdk.dataDir, "generated");
  const taskScope = new AsyncLocalStorage();
  fs.mkdirSync(generatedRoot, { recursive: true });
  let panel = {};
  let active = true;
  let closing = false;
  let lastConfigSync = 0;
  const log = Object.fromEntries(["info", "warn", "error", "debug"].map((level) => [level,
    (message) => { void sdk.logger[level](message).catch(() => {}); }]));
  const deliver = (event, target) => {
    for (const sub of localSubscribers) {
      if (!sub.types || sub.types.includes(event.type)) sub.callback(event, target);
    }
  };
  const currentConfig = () => mergeConfig(readJson(configFile, {}), panel, V2_LIMITS);
  async function syncConfig(force = false) {
    if (!force && Date.now() - lastConfigSync < 1000) return;
    panel = await sdk.config.getAll();
    writeJson(configFile, currentConfig());
    deliver({ type: "plugin_config_changed", pluginId: APP_ID });
    lastConfigSync = Date.now();
  }
  // No settings read during apply: schema contributions register afterwards.
  writeJson(configFile, currentConfig());
  const ctx = {
    pluginId: APP_ID, dataDir: sdk.dataDir, pluginDir: generatedRoot, generatedSkillRoot: generatedRoot,
    log, config: { getAll: () => ({ ...panel, ...V2_LIMITS }), setMany: (values) => sdk.config.setMany(values) },
    async sampleText({ messages, maxTokens, timeout }) {
      const requestId = randomUUID();
      const task = taskScope.getStore();
      task?.signal.throwIfAborted();
      const cancel = () => { void sdk.models.cancel(requestId).catch(() => {}); };
      task?.signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(cancel, timeout);
      try { return { ...await sdk.models.utility({ requestId, ...(task ? { taskId: task.taskId } : { scope: "app" }), messages, maxTokens }), model: "host-utility" }; }
      finally { clearTimeout(timer); task?.signal.removeEventListener("abort", cancel); }
    },
    fetch: (url, init = {}) => sdk.network.fetch(String(url), {
      method: init.method, headers: init.headers, body: init.body, timeoutMs: 30_000,
    }),
    bus: {
      subscribe(callback, options = {}) { const sub = { callback, types: options.types }; localSubscribers.add(sub); return () => localSubscribers.delete(sub); },
      getCapability: (type) => type === "usage:list" ? { available: status.usage } : null,
      hasHandler: (type) => type === "usage:list" && status.usage,
      listCapabilities: () => [{ type: "v2/sdk", available: true }],
      request: async (type, payload) => {
        if (type === "usage:list") return sdk.usage.list(payload);
        // Internal core compatibility only. Never forward frozen v1 verbs.
        throw new Error(`V2_UNSUPPORTED_OPERATION: ${type}`);
      },
    },
  };
  const background = createBackground(sdk, syncConfig, retain, taskScope);
  ctx.setupBackgroundTasks = background.setup;
  const core = new LegacyCore();
  core.ctx = ctx;
  const cleanup = [];
  core.register = (fn) => cleanup.push(fn);
  let queue = Promise.resolve();
  const stop = async () => {
    if (!active || closing) return;
    closing = true;
    await queue;
    active = false;
    await core.onunload();
    for (const dispose of cleanup.reverse()) await dispose();
    for (const receipt of receipts.reverse()) await receipt.disposeAsync();
  };
  try {
    await core.onload();
    const observe = (event, sessionPath) => {
      if (closing) return;
      queue = queue.then(async () => {
        if (!active) return;
        await syncConfig();
        deliver(event, event.sessionId ? { sessionId: event.sessionId, sessionPath } : sessionPath);
      }).catch((err) => sdk.logger.error(`Observation failed: ${err.message}`));
    };
    retain(await sdk.bus.subscribe(observe, { types: ["session_user_message", "message_start", "message_update", "message_end", "tool_execution_start", "tool_execution_end"] }));
    if (status.usage) retain(await sdk.bus.subscribe(observe, { types: ["llm_usage"] }));
    if (status.hintInjection) retain(await sdk.hooks.onDecision("agent/before-start", async ({ prompt, systemPrompt }) => {
      await syncConfig(true);
      const config = currentConfig();
      if (!config.autoInjectHighConfidence) return;
      // Only global memories are eligible without an authoritative project scope.
      // Query scope filtering is reused rather than injecting every learned rule.
      const patterns = readJson(path.join(sdk.dataDir, "patterns.json"), []);
      const results = runSearch(patterns, prompt, { config, project: "general", limit: 8 }).results;
      const allowed = new Set(results.map((item) => item.id));
      const eligible = patterns.filter((p) => allowed.has(p.id) && ["general", "global"].includes(p.scope?.project || "general"));
      if (!eligible.length) return;
      const skill = buildSkillMdFromPatterns(eligible, config, { dataDir: sdk.dataDir });
      return { systemPrompt: `${systemPrompt}\n\n<runtime-self-learning>\n${skill}\n</runtime-self-learning>` };
    }));
    for (const tool of [stats, search, report, activity, doctor, control]) {
      const parameters = structuredClone(tool.parameters);
      if (tool === control) parameters.properties.action.enum = parameters.properties.action.enum?.filter((action) => !UNSUPPORTED.has(action));
      retain(await sdk.tools.register({
        name: tool.name, description: tool.description, parameters, sessionPermission: tool.sessionPermission,
        async execute(args) {
          const { context, ...input } = args;
          await syncConfig(true);
          if (tool === control && UNSUPPORTED.has(input.action)) throw new Error(`V2_UNSUPPORTED_ACTION: ${input.action} is a source/developer operation; use the repository CLI.`);
          const invocation = { ...ctx, sessionPath: context?.sessionPath || null,
            stageFile: ({ filePath, label }) => sdk.resources.stage({ path: filePath, name: label }) };
          const result = await tool.execute(input, invocation);
          if (tool === stats && result.details) {
            result.details.app = { ...status, generatedRoot };
            result.content = [{ type: "text", text: JSON.stringify(result.details, null, 2) }];
          }
          return result;
        },
      }));
    }
    retain(await sdk.tools.register({ name: "self_learning_background", description: "查看、显式启用或暂停本 App 的三项后台整理计划。enable 创建或恢复计划；不会开启默认关闭的模型功能。",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["status", "enable", "disable"] } }, required: ["action"] },
      sessionPermission: { kind: "external_side_effect" },
      execute: async ({ action }) => { await syncConfig(true); return jsonResult(await background.control(action)); },
    }));
    await sdk.logger.info("Runtime Self-Learning v6.0.0 App loaded; background schedules require explicit enable.");
    if (!status.usage || !status.hintInjection) await sdk.logger.warn("Some optional App grants are off; self_learning_stats.app lists them. Enable permissions and reload to activate usage/hint injection.");
    return { stop, ctx, syncConfig, background };
  } catch (error) { await stop(); throw error; }
}
