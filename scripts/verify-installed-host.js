// Optional, offline compatibility probe for the exact installed 1.1.24-beta
// bundle. Runs its TaskRegistry and task bus bindings in an isolated VM, never
// starts the server and never reads production configuration or learning data.
// This is test instrumentation, not a plugin dependency on internal symbols.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { setupBackgroundTasks, shutdownHostTasks } from "../lib/host-tasks.js";

const hostRoot = process.argv[2];
if (!hostRoot) throw new Error("Usage: node scripts/verify-installed-host.js <installed-server-root>");
const version = JSON.parse(fs.readFileSync(path.join(hostRoot, "package.json"), "utf8")).version;
assert.equal(version, "1.1.24-beta", "probe extraction must be reviewed for a different host version");
const source = fs.readFileSync(path.join(hostRoot, "bundle", "index.js"), "utf8");
const start = source.indexOf('const Fm = ut("task-registry")');
const end = source.indexOf("const Nce =", start);
const bindingsStart = source.indexOf("function Dvn(t, e) {");
const bindingsEnd = source.indexOf("function Dk(t)", bindingsStart);
assert.ok(start >= 0 && end > start && bindingsStart >= 0 && bindingsEnd > bindingsStart, "host bundle layout changed");
const logger = { info() {}, warn() {}, error() {} };
const { Registry, bindTasks } = vm.runInNewContext(
  `${source.slice(start, end)}\n${source.slice(bindingsStart, bindingsEnd)}\n({ Registry: Bmr, bindTasks: Dvn });`,
  { ut: () => logger, pp: (value, fallback) => typeof value === "function" ? value : fallback,
    TB: () => null, hu: (value, fallback = "system") => value || fallback,
    P: fs, S: path, Buffer, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval },
  { timeout: 5000, filename: "installed-host-task-probe.js" },
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learner-host-probe-"));
const registry = new Registry({ persistencePath: path.join(tempRoot, "tasks.json") });
const handlers = new Map();
const bus = {
  handle: (name, handler) => handlers.set(name, handler),
  getCapability: (name) => ({ available: handlers.has(name) }),
  hasHandler: (name) => handlers.has(name),
  request: async (name, payload) => {
    assert.ok(handlers.has(name), `host task handler missing: ${name}`);
    return handlers.get(name)(payload);
  },
};
bindTasks(bus, registry);
const pluginId = "hanako-runtime-learner";
const releases = [];
let runs = 0;
try {
  const options = { ctx: { bus, log: logger }, dataDir: tempRoot, pluginId,
    registerDispose: (dispose) => releases.push(dispose),
    runAdvisor: async () => { runs += 1; return { ok: true }; },
    runRetention: async () => ({ ok: true }),
    runLlmExtraction: async () => ({ ok: false, skipped: "disabled" }),
  };
  assert.equal((await setupBackgroundTasks(options)).ok, true);
  const first = registry.listSchedules({ pluginId });
  assert.equal(first.length, 3);
  assert.equal(first.find((s) => s.type.endsWith("advisor-maintenance")).intervalMs, 360 * 60_000);
  await setupBackgroundTasks(options);
  assert.deepEqual(registry.listSchedules({ pluginId }).map((s) => s.nextRunAt), first.map((s) => s.nextRunAt));
  // Run the actual host scheduling path immediately, without waiting six hours.
  const scheduleId = first.find((s) => s.type.endsWith("advisor-maintenance")).scheduleId;
  await registry._runSchedule(scheduleId);
  assert.equal(runs, 1);
  assert.equal(registry.querySchedule(scheduleId).runCount, 1);
  const tasks = registry.listAll({ pluginId });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "completed");
  assert.equal(tasks[0].result.ok, true);
  registry.register("interrupted", { type: first[0].type, pluginId });
  registry.update("interrupted", { status: "recovering" });
  assert.equal((await setupBackgroundTasks(options)).recovered, 1);
  assert.equal(registry.query("interrupted").status, "failed");
  console.log(JSON.stringify({ ok: true, hostVersion: version, schedules: 3, scheduledRuns: runs,
    completedTask: tasks[0].status, recovery: "failed safely", productionDataAccessed: false }, null, 2));
} finally {
  await shutdownHostTasks(pluginId);
  for (const release of releases) await release();
  for (const schedule of registry.listSchedules({ pluginId })) registry.unschedule(schedule.scheduleId);
  clearInterval(registry._cleanupTimer);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
