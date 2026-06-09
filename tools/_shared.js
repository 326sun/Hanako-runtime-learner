/**
 * Shared tool context — eliminates repeated path construction across tools.
 * Every tool needs learnerDir + config/patterns paths; this produces them once.
 */

import path from "path";
import { learnerDir, loadLearnerConfig, readJson } from "../lib/common.js";

export function toolPaths() {
  const dir = learnerDir();
  return {
    learnerDir: dir,
    configPath: path.join(dir, "config.json"),
    patternsPath: path.join(dir, "patterns.json"),
    historyDir: path.join(dir, "skill_history"),
    proposalsDir: path.join(dir, "proposals"),
    usageSummaryPath: path.join(dir, "usage_summary.json"),
    capabilitiesPath: path.join(dir, "host_capabilities.json"),
    experiencePath: path.join(dir, "experience_log.jsonl"),
    errorPath: path.join(dir, "error_log.jsonl"),
    turnsPath: path.join(dir, "turns.jsonl"),
  };
}

/** Load config with an optional persist flag. */
export function loadConfig(configPath, { persist = false } = {}) {
  return loadLearnerConfig(configPath, { persist });
}

/** Load raw patterns from disk. */
export function loadPatterns(patternsPath) {
  return readJson(patternsPath, []);
}
