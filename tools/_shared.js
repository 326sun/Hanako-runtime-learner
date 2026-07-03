/**
 * Shared tool context — eliminates repeated path construction across tools.
 * Every tool needs learnerDir + config/patterns paths; this produces them once.
 *
 * v0.341+: tools receive (input, ctx) where ctx.dataDir is the official
 * plugin data directory. We prefer ctx.dataDir when available, falling back
 * to the legacy learnerDir() for older hosts.
 */

import fs from "fs";
import path from "path";
import { hanakoHome, learnerDir, loadLearnerConfig } from "../lib/common.js";
import { runtimeConfigPath, migrateRuntimeConfigFile } from "../lib/runtime-config-path.js";
import { readJsonCached } from "../lib/file-cache.js";

/** Read a plugin's version from its package.json, or "unknown" on any error. */
export function readPluginVersion(pluginDir) {
  try { return JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8")).version; } catch { return "unknown"; }
}

export function toolPaths(ctx = null) {
  const dir = ctx?.dataDir || learnerDir();
  const pluginDir = ctx?.pluginDir || path.join(hanakoHome(), "plugins", "hanako-runtime-learner");
  // Reserve <dataDir>/config.json for the host's plugin config store; our flat
  // runtime config lives in runtime-config.json. Migrate transparently in case a
  // tool is the activation trigger before onload runs (idempotent, never throws).
  try { migrateRuntimeConfigFile(dir); } catch { /* best-effort */ }
  return {
    learnerDir: dir,
    pluginDir,
    configPath: runtimeConfigPath(dir),
    patternsPath: path.join(dir, "patterns.json"),
    historyDir: path.join(dir, "skill_history"),
    proposalsDir: path.join(dir, "proposals"),
    skillPath: path.join(pluginDir, "skills", "self-learning", "SKILL.md"),
    usageSummaryPath: path.join(dir, "usage_summary.json"),
    capabilitiesPath: path.join(dir, "host_capabilities.json"),
    experiencePath: path.join(dir, "experience_log.jsonl"),
    errorPath: path.join(dir, "error_log.jsonl"),
    turnsPath: path.join(dir, "turns.jsonl"),
    activityPath: path.join(dir, "activity_log.jsonl"),
  };
}

/** Load config with an optional persist flag. */
export function loadConfig(configPath, { persist = false } = {}) {
  return loadLearnerConfig(configPath, { persist });
}

/** Load raw patterns from disk. */
export function loadPatterns(patternsPath) {
  return readJsonCached(patternsPath, []);
}
