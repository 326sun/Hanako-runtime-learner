import fs from "node:fs";
import path from "node:path";

export const JOBS = [
  { key: "advisor-maintenance", callback: "runAdvisor", minutes: 360 },
  { key: "log-retention", callback: "runRetention", minutes: 1440 },
  { key: "llm-extraction-worker", callback: "runLlmExtraction", minutes: 30 },
];

export function createBackground(sdk, syncConfig, retain, taskScope) {
  const running = new Map();
  let callbacks;
  let closed = false;
  const enabledFile = path.join(sdk.dataDir, "v2-background-enabled.json");
  const isEnabled = () => { try { return JSON.parse(fs.readFileSync(enabledFile, "utf8")).enabled === true; } catch { return false; } };
  async function setup(options) {
    callbacks = options;
    for (const job of JOBS) {
      retain(await sdk.tasks.registerHandler(job.key, {
        async run({ taskId, input }) {
          if (closed || !isEnabled()) return { ok: false, skipped: "background_disabled" };
          if (running.has(job.key)) return { ok: false, skipped: "in_flight" };
          const controller = new AbortController();
          running.set(job.key, { taskId, controller });
          try {
            await syncConfig();
            return await taskScope.run({ taskId, signal: controller.signal }, () => callbacks[job.callback]?.({ taskId, input })) || { ok: true };
          } finally { running.delete(job.key); }
        },
        async abort(taskId) {
          for (const entry of running.values()) if (entry.taskId === taskId) entry.controller.abort();
          await sdk.logger.info(`Background cancellation requested: ${taskId}`);
        },
      }));
    }
    return { ok: true, useLegacyPath: false, shutdown: async () => {
      closed = true;
      for (const entry of running.values()) entry.controller.abort();
      return { drained: running.size === 0 };
    } };
  }
  async function control(action) {
    const schedules = await sdk.tasks.listSchedules();
    const own = schedules.filter((s) => JOBS.some((job) => job.key === s.handlerKey));
    if (action === "status") return { enabled: isEnabled(), schedules: own };
    if (action === "disable") {
      fs.writeFileSync(enabledFile, JSON.stringify({ enabled: false }));
      for (const schedule of own) await sdk.tasks.pauseSchedule(schedule.scheduleId);
      return { ok: true, enabled: false };
    }
    if (action !== "enable") throw new Error(`Unknown background action: ${action}`);
    // Scheduling is explicit; apply() only rebinds handlers. Persisted schedules
    // are owned, restored and deduplicated by the host.
    for (const job of JOBS) {
      const existing = own.find((s) => s.handlerKey === job.key);
      if (existing) await sdk.tasks.resumeSchedule(existing.scheduleId);
      else await sdk.tasks.schedule({ handlerKey: job.key, scope: "app", label: job.key, intervalMs: job.minutes * 60_000, payload: {} });
    }
    fs.writeFileSync(enabledFile, JSON.stringify({ enabled: true }));
    return { ok: true, enabled: true, schedules: await sdk.tasks.listSchedules() };
  }
  return { setup, control };
}
