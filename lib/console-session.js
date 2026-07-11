// Self-learning console: a lazily-created, plugin-owned `plugin_private` session
// whose transcript is surfaced as a native `chat.surface` card (Hanako v0.344+).
// This module owns the session lifecycle and the snapshot text assembly; the tool
// shell (tools/console.js) only wires them together. All host interaction is
// best-effort: on any failure the console degrades to no card.

import path from "path";
import { normalizeSessionTarget, safeText } from "./helpers.js";
import { readJson, writeJson } from "./json-io.js";
import { readRecentJsonlTail } from "./activity-log.js";
import { listProposals } from "./proposals.js";

export const CONSOLE_STATE_FILENAME = "console-state.json";
const SNAPSHOT_MAX = 8000;
const consoleSessionFlights = new Map();

// Mirror the capability-probing pattern used by session-messenger / model-advisor:
// an explicit `available === false` blocks; otherwise fall back to hasHandler.
function capabilityUsable(bus, type) {
  if (!bus || typeof bus.request !== "function") return false;
  const cap = bus.getCapability?.(type);
  if (cap && cap.available === false) return false;
  if (!cap && !bus.hasHandler?.(type)) return false;
  return true;
}

function statePath(dataDir) {
  return path.join(dataDir, CONSOLE_STATE_FILENAME);
}

function readState(dataDir) {
  const raw = readJson(statePath(dataDir), null);
  if (raw && typeof raw === "object" && raw.sessionId) return raw;
  return null;
}

function writeState(dataDir, target) {
  writeJson(statePath(dataDir), {
    sessionId: target.sessionId,
    sessionRef: target.sessionRef || null,
    sessionPath: target.sessionPath || null,
    createdAt: new Date().toISOString(),
  });
}

// When the host exposes session:get, verify the persisted session still exists so
// a host-side eviction triggers a rebuild. When it does not, stay optimistic — a
// stale id at worst yields a one-time unavailable card the next call repairs.
async function sessionStillExists(bus, target) {
  if (!capabilityUsable(bus, "session:get")) return true;
  try {
    const result = await bus.request("session:get", normalizeSessionTarget(target));
    return !!result;
  } catch {
    return false;
  }
}

// Ensure a plugin_private console session exists and return its normalized target,
// or null when the host cannot provide one (old host without session:create, or
// any error). Never throws.
async function createOrReuseConsoleSession(ctx) {
  try {
    const bus = ctx?.bus;
    const dataDir = ctx?.dataDir;
    if (!dataDir || !capabilityUsable(bus, "session:create")) return null;

    const existing = readState(dataDir);
    if (existing) {
      const target = normalizeSessionTarget(existing);
      if (await sessionStillExists(bus, target)) return target;
    }

    const result = await bus.request("session:create", {
      ownerPluginId: ctx.pluginId,
      visibility: "plugin_private",
      sessionKind: "runtime-learner-console",
      cwd: dataDir,
    });
    const target = normalizeSessionTarget(result);
    if (!target.sessionId) return null;
    writeState(dataDir, target);
    return target;
  } catch (err) {
    ctx?.log?.warn?.(`runtime-learner: console session unavailable: ${err.message}`);
    return null;
  }
}

export async function ensureConsoleSession(ctx) {
  const dataDir = ctx?.dataDir;
  if (!dataDir) return createOrReuseConsoleSession(ctx);
  const key = path.resolve(dataDir);
  const existing = consoleSessionFlights.get(key);
  if (existing) return existing;
  const flight = createOrReuseConsoleSession(ctx);
  consoleSessionFlights.set(key, flight);
  try {
    return await flight;
  } finally {
    if (consoleSessionFlights.get(key) === flight) consoleSessionFlights.delete(key);
  }
}

// Build a plain-text snapshot of current self-learning state for the console
// transcript: recent activity tail + pending proposals. Bounded length; tolerant
// of missing/corrupt data files.
export function buildSnapshot(dataDir, config = {}, input = {}) {
  const days = input.days || 1;
  const limit = input.limit || 20;
  const lines = [];
  lines.push("# Runtime Self-Learning 控制台");
  lines.push(`更新时间：${new Date().toISOString()}`);
  lines.push("");

  let activities = [];
  try {
    activities = readRecentJsonlTail(path.join(dataDir, "activity_log.jsonl"), { days }).slice(0, limit);
  } catch {}
  lines.push(`## 最近活动（${days} 天内，${activities.length} 条）`);
  if (activities.length === 0) {
    lines.push("- 暂无活动记录");
  } else {
    for (const a of activities) {
      lines.push(`- [${safeText(a.type, 40)}] ${safeText(a.summary, 160)}`);
    }
  }
  lines.push("");

  let proposals = [];
  try {
    proposals = listProposals(dataDir, { status: "pending", limit: 10 });
  } catch {}
  lines.push(`## 待处理提案（${proposals.length}）`);
  if (proposals.length === 0) {
    lines.push("- 无");
  } else {
    for (const p of proposals) {
      lines.push(`- ${safeText(p.id, 60)} · ${safeText(p.risk || "?", 12)} · ${safeText(p.title || p.reason || "", 120)}`);
    }
  }

  const text = lines.join("\n");
  return text.length > SNAPSHOT_MAX ? text.slice(0, SNAPSHOT_MAX) : text;
}
