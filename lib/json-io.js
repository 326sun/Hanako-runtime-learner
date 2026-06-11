import fs from "fs";
import path from "path";
import os from "os";
import { atomicWriteFileSync } from "./atomic-file.js";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import { readJsonlTailLines } from "./jsonl-utils.js";

export function hanakoHome() {
  return process.env.HANA_HOME || path.join(os.homedir(), ".hanako");
}

export function hanakoPreferencesPath() {
  const home = hanakoHome();
  const candidates = [
    process.env.HANAKO_PREFERENCES_FILE,
    path.join(home, "user", "preferences.json"),
    path.join(home, "preferences.json"),
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || path.join(home, "user", "preferences.json");
}

export function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {}
  return fallback;
}

export function writeJson(file, value) {
  atomicWriteFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

export function readHanakoPreferences() {
  return readJson(hanakoPreferencesPath(), {});
}

export function describeOfficialUtilityModel(prefs = readHanakoPreferences()) {
  const raw = prefs?.utility_model;
  const id = typeof raw === "object" ? raw?.id : raw;
  const provider = typeof raw === "object" ? raw?.provider : prefs?.utility_api_provider;
  if (!id) {
    return {
      id: "",
      provider: provider || "",
      source: "Hanako 用户设置",
      display: "跟随 Hanako 用户设置的小模型（当前未读取到具体名称）",
    };
  }
  const providerText = provider ? `${provider} / ` : "";
  return {
    id: String(id),
    provider: provider ? String(provider) : "",
    source: "Hanako 用户设置",
    display: `${providerText}${id}（跟随 Hanako 用户设置）`,
  };
}

export function learnerDir() {
  return path.join(hanakoHome(), "self-learning");
}

export function safeFileSlug(value, fallback = "item", max = 180) {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, max);
}

export function cleanupTempFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".tmp")) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  } catch {}
}

export function loadLearnerConfig(configPath, { persist = false } = {}) {
  const config = { ...DEFAULT_CONFIG, ...readJson(configPath, {}) };
  if (persist) writeJson(configPath, config);
  return config;
}

export function countJsonl(file) {
  try {
    if (!fs.existsSync(file)) return 0;
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let count = 0;
    let lineHasContent = false;
    try {
      for (;;) {
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (bytes === 0) break;
        for (let i = 0; i < bytes; i++) {
          if (buffer[i] === 10) {
            if (lineHasContent) count += 1;
            lineHasContent = false;
          } else if (buffer[i] !== 13) {
            lineHasContent = true;
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    return count + (lineHasContent ? 1 : 0);
  } catch {
    return 0;
  }
}

export function readRecentJsonl(file, cutoff, { maxLines = 5000 } = {}) {
  const rows = [];
  for (const line of readJsonlTailLines(file, { maxLines })) {
    try {
      const row = JSON.parse(line);
      if (new Date(row.date).getTime() >= cutoff) rows.push(row);
    } catch {}
  }
  return rows;
}

export function countValues(values = []) {
  const counts = {};
  for (const value of values) {
    const key = value || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key] || "unknown"] = (counts[row[key] || "unknown"] || 0) + 1;
  return counts;
}
