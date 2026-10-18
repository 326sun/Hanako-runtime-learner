// Deterministic author demonstration. SDK services are fixtures, not a live Hana session.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "learner-public-demo-"));
const previousHome = process.env.HANA_HOME;
process.env.HANA_HOME = root;
const { startApp } = await import("../v2/runtime.js");
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir);
const tools = new Map(), subscriptions = [], schedules = new Map();
let modelCalls = 0;
const receipt = (dispose = () => {}) => ({ disposeAsync: async () => dispose() });
const sdk = {
  dataDir,
  logger: Object.fromEntries(["info", "warn", "error", "debug"].map((level) => [level, async () => {}])),
  capabilities: { get: async () => ({ capabilities: ["app/hooks.agent-before-start", "app/usage.read", "app/models.infer", "app/tasks.manage", "app/tools.expose-to-model"].map((capability) => ({ capability, status: "always" })) }) },
  config: { getAll: async () => ({}), setMany: async () => {} },
  bus: { subscribe: async (callback, filter) => { const sub = { callback, filter }; subscriptions.push(sub); return receipt(() => subscriptions.splice(subscriptions.indexOf(sub), 1)); } },
  hooks: { onDecision: async () => receipt() },
  tools: { register: async (tool) => { tools.set(tool.name, tool); return receipt(() => tools.delete(tool.name)); } },
  usage: { list: async () => ({ entries: [], nextCursor: null }) },
  models: { utility: async () => { modelCalls += 1; throw new Error("Demo must not call a model"); }, cancel: async () => {} },
  tasks: {
    registerHandler: async () => receipt(),
    listSchedules: async () => [...schedules.values()],
    schedule: async (input) => { const item = { ...input, scheduleId: `demo-${schedules.size}`, enabled: true }; schedules.set(item.scheduleId, item); return item; },
    pauseSchedule: async (id) => { schedules.get(id).enabled = false; },
    resumeSchedule: async (id) => { schedules.get(id).enabled = true; },
  },
};
const emit = (event) => { for (const sub of subscriptions) if (sub.filter.types.includes(event.type)) sub.callback(event, "demo/session.jsonl"); };
let app;
try {
  app = await startApp(sdk);
  assert.equal(tools.size, 7);
  const invoke = async (name, args = {}) => (await tools.get(name).execute({ ...args, context: {} })).details;
  const initial = await invoke("self_learning_stats");
  assert.equal(initial.totalTurns, 0);
  const initialBackground = await invoke("self_learning_background", { action: "status" });
  assert.deepEqual(initialBackground, { enabled: false, schedules: [] });
  emit({ type: "session_user_message", message: { text: "修改并验证演示文件" } });
  for (const toolName of ["read", "edit", "exec_command"]) {
    emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse" } });
    emit({ type: "tool_execution_start", toolName });
    emit({ type: "tool_execution_end", toolName });
  }
  emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: "验证通过" } });
  const experienceFile = path.join(dataDir, "experience_log.jsonl");
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(experienceFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  const turns = fs.readFileSync(experienceFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].toolsUsed, ["read", "edit", "exec_command"]);
  const after = await invoke("self_learning_stats");
  assert.equal(after.totalTurns, 1);
  await invoke("self_learning_background", { action: "enable" });
  await invoke("self_learning_background", { action: "enable" });
  assert.equal(schedules.size, 3);
  await invoke("self_learning_background", { action: "disable" });
  assert.ok([...schedules.values()].every((item) => !item.enabled));
  assert.equal(modelCalls, 0);
  console.log(JSON.stringify({
    environment: "Automated SDK fixture; no production data, external command execution or model inference",
    registeredTools: [...tools.keys()],
    initialStats: { input: {}, result: { totalTurns: initial.totalTurns, patternCount: initial.patternCount, version: initial.app.version, format: initial.app.format } },
    initialBackground: { input: { action: "status" }, result: initialBackground },
    observedFixture: { userMessage: "修改并验证演示文件", toolEvents: turns[0].toolsUsed, intermediateStopReason: "toolUse", finalStopReason: "stop" },
    afterStats: { input: {}, result: { totalTurns: after.totalTurns, patternCount: after.patternCount } },
    backgroundDeduplication: { inputs: [{ action: "enable" }, { action: "enable" }], resultingScheduleCount: schedules.size },
    backgroundDisable: { input: { action: "disable" }, allSchedulesPaused: [...schedules.values()].every((item) => !item.enabled) },
    modelCalls,
  }, null, 2));
} finally {
  await app?.stop();
  if (previousHome === undefined) delete process.env.HANA_HOME; else process.env.HANA_HOME = previousHome;
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
}
