import { appendEvent } from "./event-log.js";

export const TASK_OPERATIONS = Object.freeze([
  "task:register-handler",
  "task:unregister-handler",
  "task:register",
  "task:update",
  "task:complete",
  "task:fail",
  "task:cancel",
  "task:remove",
  "task:schedule",
  "task:list-schedules",
  "task:list",
]);

const DEFAULT_PLUGIN_ID = "hanako-runtime-learner";
const inFlight = new Set();

function bus(ctx) {
  return ctx?.bus || null;
}

function operationAvailable(ctx, op) {
  const b = bus(ctx);
  if (!b || typeof b.request !== "function") return false;
  try {
    const cap = b.getCapability?.(op);
    if (cap && typeof cap === "object") return cap.available !== false;
    if (cap === true) return true;
  } catch {}
  try {
    return b.hasHandler?.(op) === true;
  } catch {
    return false;
  }
}

export function hostTaskSupport(ctx, operations = TASK_OPERATIONS) {
  const missing = operations.filter((op) => !operationAvailable(ctx, op));
  return { ok: missing.length === 0, missing };
}

async function requestTask(ctx, op, payload = {}) {
  if (!operationAvailable(ctx, op)) {
    return { ok: false, skipped: "unavailable", operation: op };
  }
  try {
    const result = await bus(ctx).request(op, payload);
    return { ok: result?.ok !== false, result };
  } catch (err) {
    ctx?.log?.debug?.(`runtime-learner: ${op} unavailable: ${err?.message || err}`);
    return { ok: false, skipped: "unavailable", operation: op, error: String(err?.message || err) };
  }
}

export async function registerTaskHandler(ctx, { pluginId = DEFAULT_PLUGIN_ID, type, handler, handlerId = type } = {}) {
  if (!type || typeof handler !== "function") return { ok: false, skipped: "invalid" };
  return requestTask(ctx, "task:register-handler", { pluginId, type, handlerId, handler });
}

export async function unregisterTaskHandler(ctx, { pluginId = DEFAULT_PLUGIN_ID, type, handlerId = type } = {}) {
  return requestTask(ctx, "task:unregister-handler", { pluginId, type, handlerId });
}

export async function registerTask(ctx, payload = {}) {
  return requestTask(ctx, "task:register", payload);
}

export async function updateTask(ctx, payload = {}) {
  return requestTask(ctx, "task:update", payload);
}

export async function completeTask(ctx, payload = {}) {
  return requestTask(ctx, "task:complete", payload);
}

export async function failTask(ctx, payload = {}) {
  return requestTask(ctx, "task:fail", payload);
}

export async function cancelTask(ctx, payload = {}) {
  return requestTask(ctx, "task:cancel", payload);
}

export async function removeTask(ctx, payload = {}) {
  return requestTask(ctx, "task:remove", payload);
}

export async function listSchedules(ctx, payload = {}) {
  return requestTask(ctx, "task:list-schedules", payload);
}

export async function listTasks(ctx, payload = {}) {
  return requestTask(ctx, "task:list", payload);
}

// P9.D: `knownSchedules`, when supplied, skips the per-call task:list-schedules
// round trip — setupBackgroundTasks() lists once for the whole job batch
// instead of once per job (previously 1 list request per registered job).
export async function scheduleTask(ctx, { pluginId = DEFAULT_PLUGIN_ID, type, scheduleId, intervalMinutes, payload = {}, knownSchedules = null } = {}) {
  if (!operationAvailable(ctx, "task:schedule")) {
    return { ok: false, skipped: "unavailable", operation: "task:schedule" };
  }
  let schedules = knownSchedules;
  if (!Array.isArray(schedules)) {
    const listed = await listSchedules(ctx, { pluginId });
    schedules = listed.result?.schedules || listed.result?.items || [];
  }
  if (Array.isArray(schedules) && schedules.some((schedule) => schedule?.scheduleId === scheduleId || schedule?.id === scheduleId)) {
    return { ok: true, skipped: "already_scheduled", scheduleId };
  }
  return requestTask(ctx, "task:schedule", { pluginId, type, scheduleId, intervalMinutes, payload });
}

function audit(dataDir, event) {
  if (!dataDir) return null;
  try {
    return appendEvent(dataDir, {
      actor: "runtime",
      entityType: "background_task",
      ...event,
    });
  } catch {
    return null;
  }
}

export async function runHostTask(ctx, {
  pluginId = DEFAULT_PLUGIN_ID,
  dataDir,
  task = {},
  taskId = task.id || task.taskId || `${Date.now()}`,
  type = task.type,
  job,
} = {}) {
  const key = `${pluginId}:${type || taskId}`;
  if (inFlight.has(key)) return { ok: false, skipped: "in_flight", taskId, type };
  inFlight.add(key);
  try {
    if (task.cancelled || task.status === "cancelled") {
      await cancelTask(ctx, { pluginId, taskId, type, reason: "cancelled_before_start" });
      audit(dataDir, {
        type: "background_task.cancelled",
        entityId: taskId,
        summary: `Cancelled background task: ${type}`,
        data: { taskId, type, reason: "cancelled_before_start" },
      });
      return { ok: false, skipped: "cancelled", taskId, type };
    }
    await updateTask(ctx, { pluginId, taskId, type, status: "running" });
    const result = typeof job === "function" ? await job(task) : { ok: true };
    if (result?.cancelled || result?.skipped === "cancelled") {
      await cancelTask(ctx, { pluginId, taskId, type, result });
      audit(dataDir, {
        type: "background_task.cancelled",
        entityId: taskId,
        summary: `Cancelled background task: ${type}`,
        data: { taskId, type, result },
      });
      return { ok: false, skipped: "cancelled", taskId, type, result };
    }
    await completeTask(ctx, { pluginId, taskId, type, result });
    audit(dataDir, {
      type: "background_task.completed",
      entityId: taskId,
      summary: `Completed background task: ${type}`,
      data: { taskId, type, result },
    });
    return { ok: true, taskId, type, result };
  } catch (err) {
    const error = String(err?.message || err);
    await failTask(ctx, { pluginId, taskId, type, error });
    audit(dataDir, {
      type: "background_task.failed",
      entityId: taskId,
      summary: `Failed background task: ${type}`,
      data: { taskId, type, error },
    });
    return { ok: false, taskId, type, error };
  } finally {
    inFlight.delete(key);
  }
}

function backgroundJobs({ runAdvisor, runRetention, runLlmExtraction }) {
  return [
    {
      key: "advisor-maintenance",
      type: "hanako-runtime-learner.advisor-maintenance",
      intervalKey: "backgroundAdvisorIntervalMinutes",
      defaultIntervalMinutes: 360,
      run: runAdvisor,
    },
    {
      key: "log-retention",
      type: "hanako-runtime-learner.log-retention",
      intervalKey: "backgroundRetentionIntervalMinutes",
      defaultIntervalMinutes: 1440,
      run: runRetention,
    },
    {
      key: "llm-extraction-worker",
      type: "hanako-runtime-learner.llm-extraction-worker",
      intervalKey: "backgroundLlmExtractionIntervalMinutes",
      defaultIntervalMinutes: 30,
      run: runLlmExtraction,
    },
  ];
}

async function failRecoveringTasks(ctx, { pluginId, dataDir }) {
  const listed = await listTasks(ctx, { pluginId, statuses: ["recovering", "running"] });
  if (!listed.ok) return 0;
  const tasks = listed.result?.tasks || listed.result?.items || [];
  let recovered = 0;
  for (const task of tasks) {
    if (!["recovering", "running"].includes(task?.status)) continue;
    const taskId = task.id || task.taskId;
    if (!taskId) continue;
    await failTask(ctx, {
      pluginId,
      taskId,
      type: task.type,
      error: "plugin restarted before task completed; task marked failed for safe recovery",
    });
    audit(dataDir, {
      type: "background_task.recovered_failed",
      entityId: taskId,
      summary: `Marked recovering background task failed: ${task.type || taskId}`,
      data: { taskId, type: task.type, previousStatus: task.status },
    });
    recovered += 1;
  }
  return recovered;
}

export async function setupBackgroundTasks({
  ctx,
  dataDir,
  config = {},
  pluginId = DEFAULT_PLUGIN_ID,
  runAdvisor,
  runRetention,
  runLlmExtraction,
  registerDispose,
} = {}) {
  if (config.backgroundTasksEnabled === false) {
    return { ok: false, skipped: "disabled", useLegacyPath: true };
  }
  const support = hostTaskSupport(ctx);
  if (!support.ok) {
    audit(dataDir, {
      type: "background_tasks_unavailable",
      entityId: pluginId,
      summary: "Host task:* bus protocol unavailable; using legacy opportunistic background path",
      data: { missing: support.missing },
    });
    return { ok: false, skipped: "unavailable", missing: support.missing, useLegacyPath: true };
  }

  const jobs = backgroundJobs({ runAdvisor, runRetention, runLlmExtraction });
  // P9.D: one shared task:list-schedules lookup for the whole batch, instead
  // of scheduleTask() independently re-listing per job (3 jobs -> 3 requests
  // -> 1 request on every onload). Falls back to scheduleTask()'s own list
  // call if this fails, so a transient bus error can't skip scheduling.
  let knownSchedules = null;
  try {
    const listed = await listSchedules(ctx, { pluginId });
    knownSchedules = listed.ok ? (listed.result?.schedules || listed.result?.items || []) : null;
  } catch { knownSchedules = null; }
  for (const job of jobs) {
    const handler = (task) => runHostTask(ctx, {
      pluginId,
      dataDir,
      task,
      taskId: task?.id || task?.taskId || `${job.type}:${Date.now()}`,
      type: job.type,
      job: () => job.run?.(task) || { ok: true },
    });
    await registerTaskHandler(ctx, { pluginId, type: job.type, handlerId: job.type, handler });
    await scheduleTask(ctx, {
      pluginId,
      type: job.type,
      scheduleId: `${job.type}.schedule`,
      intervalMinutes: Math.max(1, Number(config[job.intervalKey] || job.defaultIntervalMinutes)),
      knownSchedules,
    });
    if (typeof registerDispose === "function") {
      registerDispose(() => {
        unregisterTaskHandler(ctx, { pluginId, type: job.type, handlerId: job.type }).catch(() => {});
      });
    }
  }

  const recovered = await failRecoveringTasks(ctx, { pluginId, dataDir });
  return { ok: true, jobs: jobs.length, recovered, useLegacyPath: false };
}
