import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import { atomicWriteFileSync } from "./atomic-file.js";

const DEFAULT_KEEP = 20;

let lastTimestampMs = 0;

function timestamp() {
  // Monotonic: bump by 1ms on same-millisecond calls so snapshot names never collide.
  lastTimestampMs = Math.max(Date.now(), lastTimestampMs + 1);
  return new Date(lastTimestampMs).toISOString().replace(/[:.]/g, "-");
}

function pruneSkillHistory(historyDir, { keep = DEFAULT_KEEP } = {}) {
  try {
    const entries = fs.readdirSync(historyDir)
      .filter((name) => name.endsWith("-SKILL.md"))
      .sort();
    for (const old of entries.slice(0, Math.max(0, entries.length - keep))) {
      fs.rmSync(path.join(historyDir, old), { force: true });
    }
  } catch {}
}

export function snapshotSkill(skillPath, historyDir, { keep = DEFAULT_KEEP } = {}) {
  fs.mkdirSync(historyDir, { recursive: true });
  if (!fs.existsSync(skillPath)) return null;
  const target = path.join(historyDir, `${timestamp()}-SKILL.md`);
  fs.copyFileSync(skillPath, target);
  pruneSkillHistory(historyDir, { keep });
  return target;
}

export function pruneSkillBackups(skillDir, { keep = DEFAULT_KEEP } = {}) {
  try {
    const baks = fs.readdirSync(skillDir)
      .filter((name) => name.startsWith("SKILL.md.") && name.endsWith(".bak"))
      .sort();
    for (const old of baks.slice(0, Math.max(0, baks.length - keep))) {
      fs.rmSync(path.join(skillDir, old), { force: true });
    }
  } catch {}
}

export const skipObservedLine = (s) => (s || "").replace(/^Observed \d+ turns,.*\n/m, "");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function fileFingerprint(file) {
  try {
    const stat = fs.statSync(file);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

function skillRenderConfigSubset(config = {}) {
  const cfg = config || DEFAULT_CONFIG;
  const pick = (key) => cfg[key] ?? DEFAULT_CONFIG[key];
  return {
    activeSkillsInjectionEnabled: pick("activeSkillsInjectionEnabled"),
    activeSkillsInjectionMaxCount: pick("activeSkillsInjectionMaxCount"),
    activeSkillsInjectionMaxRegression: pick("activeSkillsInjectionMaxRegression"),
    activeSkillsInjectionMinSuccess: pick("activeSkillsInjectionMinSuccess"),
    autoInjectHighConfidence: pick("autoInjectHighConfidence"),
    decayHalfLifeDays: pick("decayHalfLifeDays"),
    includePendingPreferences: pick("includePendingPreferences"),
    maxSkillTokens: pick("maxSkillTokens"),
    minInjectCount: pick("minInjectCount"),
    minInjectScore: pick("minInjectScore"),
  };
}

export function skillRenderFingerprint(patterns = [], config = {}, { turnCount = 0, dataDir = "" } = {}) {
  const activeSkillsFile = config?.activeSkillsInjectionEnabled && dataDir
    ? fileFingerprint(path.join(dataDir, "active_skills.json"))
    : null;
  const payload = {
    turnCount,
    activeSkillsFile,
    config: skillRenderConfigSubset(config),
    patterns: (patterns || []).map((pattern) => ({
      id: pattern?.id,
      type: pattern?.type,
      status: pattern?.status,
      score: pattern?.score,
      count: pattern?.count,
      desc: pattern?.desc,
      fix: pattern?.fix,
      scope: pattern?.scope,
      knowledgeTier: pattern?.knowledgeTier,
      lastSeen: pattern?.lastSeen,
      createdAt: pattern?.createdAt,
      updatedAt: pattern?.updatedAt,
      reviewedAt: pattern?.reviewedAt,
      advisorUpdatedAt: pattern?.advisorUpdatedAt,
      autoApproved: pattern?.autoApproved,
      injectable: pattern?.injectable,
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(payload))).digest("hex");
}

export function writeSkillIfChanged(skillPath, content, historyDir, { keep = DEFAULT_KEEP } = {}) {
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  let current = null;
  try { current = fs.readFileSync(skillPath, "utf-8"); } catch {}
  if (skipObservedLine(current) === skipObservedLine(content)) {
    pruneSkillHistory(historyDir, { keep });
    return { changed: false, snapshotPath: null };
  }
  const snapshotPath = snapshotSkill(skillPath, historyDir, { keep });
  atomicWriteFileSync(skillPath, content, "utf-8");
  return { changed: true, snapshotPath };
}

// ── Skill registry (merged from skill-registry.js) ──

import { readJson, writeJson, learnerDir } from "./common.js";
import { appendEvent } from "./event-log.js";

function skillRegistryPath(baseDir = learnerDir()) {
  return path.join(baseDir, "skill_registry.json");
}

export function loadSkillRegistry(baseDir = learnerDir()) {
  return readJson(skillRegistryPath(baseDir), {}) || {};
}

function saveSkillRegistry(baseDir, registry) {
  writeJson(skillRegistryPath(baseDir), registry);
  return registry;
}

export function updateSkillState(baseDir, skillPath, state = {}) {
  const registry = loadSkillRegistry(baseDir);
  const key = skillPath || "skills/self-learning/SKILL.md";
  const next = {
    status: "active",
    version: null,
    firstSeenAt: new Date().toISOString(),
    ...(registry[key] || {}),
    ...state,
    updatedAt: new Date().toISOString(),
  };
  registry[key] = next;
  saveSkillRegistry(baseDir, registry);
  appendEvent(baseDir, {
    type: `skill.${next.status || "updated"}`,
    entityType: "skill",
    entityId: key,
    summary: `Skill ${next.status || "updated"}: ${key}`,
    data: next,
  });
  return next;
}
