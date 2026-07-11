import fs from "fs";
import path from "path";
import os from "os";
import { atomicWriteFileSync } from "./atomic-file.js";
import { mergeConfig } from "./config-defaults.js";
import { clearFileCache } from "./file-cache.js";
import { readJsonlTailSample } from "./jsonl-utils.js";
import { normalizeSessionTarget, sessionIdentityKey, stableKey } from "./helpers.js";
import { withDataLock } from "./state-lock.js";

function sessionTargetDisplay(target = {}) {
  const normalized = normalizeSessionTarget(target);
  return normalized.sessionPath || normalized.sessionId || (normalized.sessionRef ? stableKey(JSON.stringify(normalized.sessionRef)) : "unknown");
}

export function hanakoHome() {
  return process.env.HANA_HOME || path.join(os.homedir(), ".hanako");
}

// Internal-only: resolves the Hanako preferences file. Used by readHanakoPreferences
// below; not part of the public facade (no external consumers).
function hanakoPreferencesPath() {
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
  return writeJsonIfChanged(file, value);
}

export function writeJsonIfChanged(file, value) {
  const content = JSON.stringify(value, null, 2);
  try {
    if (fs.existsSync(file)) {
      const current = fs.readFileSync(file, "utf-8");
      if (current === content) return false;
    }
  } catch {}
  atomicWriteFileSync(file, content, "utf-8");
  clearFileCache(file);
  return true;
}

/**
 * Atomic rename prevents torn JSON, but not lost updates: two processes can
 * read the same snapshot and each successfully rename a different successor.
 * Use this for whole-file read-modify-write state. The callback is synchronous
 * by contract so it cannot hold the inter-process lock across host I/O.
 */
export function updateJsonLocked(file, fallback, update, { lockName = null } = {}) {
  const baseDir = path.dirname(file);
  const name = lockName || `json-${path.basename(file)}`;
  return withDataLock(baseDir, name, () => {
    const current = readJson(file, fallback);
    const next = update(current);
    const changed = writeJsonIfChanged(file, next);
    return { value: next, changed };
  });
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

/**
 * Load the plugin config from disk, merging with DEFAULT_CONFIG.
 *
 * IMPORTANT: This does NOT call mergeCredentials(). Sensitive keys (API keys)
 * are stored encrypted in credentials.enc, not in config.json. If your code
 * path needs decrypted API keys (e.g. modelAdvisorApiKey, semanticEmbeddingApiKey),
 * you MUST call mergeCredentials() on the returned config object afterwards.
 *
 * See tools/search.js for the canonical pattern:
 *   let config = loadLearnerConfig(configPath);
 *   config = mergeCredentials(config);
 */
export function loadLearnerConfig(configPath, { persist = false } = {}) {
  const config = mergeConfig(readJson(configPath, {}));
  if (persist) writeJson(configPath, config);
  return config;
}

const JSONL_COUNT_CACHE_MAX = 128;
const jsonlCountCache = new Map();

export function clearJsonlCountCache() {
  jsonlCountCache.clear();
}

function segmentHasJsonlContent(buffer, start, end) {
  if (start >= end) return false;
  if (buffer[start] !== 13) return true;
  for (let i = start + 1; i < end; i++) {
    if (buffer[i] !== 13) return true;
  }
  return false;
}

export function countJsonl(file) {
  try {
    const cacheKey = path.resolve(file);
    if (!fs.existsSync(file)) {
      jsonlCountCache.delete(cacheKey);
      return 0;
    }
    const stat = fs.statSync(file);
    const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const cached = jsonlCountCache.get(cacheKey);
    if (cached?.signature === signature) return cached.count;
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let count = 0;
    let lineHasContent = false;
    try {
      for (;;) {
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (bytes === 0) break;
        let start = 0;
        for (;;) {
          const newline = buffer.indexOf(10, start);
          if (newline < 0 || newline >= bytes) break;
          if (!lineHasContent) lineHasContent = segmentHasJsonlContent(buffer, start, newline);
          if (lineHasContent) count += 1;
          lineHasContent = false;
          start = newline + 1;
        }
        if (!lineHasContent) lineHasContent = segmentHasJsonlContent(buffer, start, bytes);
      }
    } finally {
      fs.closeSync(fd);
    }
    const result = count + (lineHasContent ? 1 : 0);
    if (jsonlCountCache.size >= JSONL_COUNT_CACHE_MAX && !jsonlCountCache.has(cacheKey)) {
      jsonlCountCache.delete(jsonlCountCache.keys().next().value);
    }
    jsonlCountCache.delete(cacheKey);
    jsonlCountCache.set(cacheKey, { signature, count: result });
    return result;
  } catch {
    return 0;
  }
}

export function readRecentJsonl(file, cutoff, { maxLines = 5000 } = {}) {
  return readJsonlSample(file, { cutoff, maxLines }).rows;
}

// Internal-only: normalizes a raw JSONL log row's session identity. Used by the
// readers/summarizers in this module; not part of the public facade.
function normalizeLogSessionRow(row = {}) {
  const session = normalizeSessionTarget(row, row.session, row.sessionTarget, row.attribution);
  const sessionKey = sessionIdentityKey(session);
  return {
    ...row,
    sessionId: session.sessionId,
    sessionRef: session.sessionRef,
    sessionPath: session.sessionPath,
    sessionKey,
    sessionLabel: sessionTargetDisplay(session),
  };
}

export function summarizeSessionRows(rows = [], { normalized = false } = {}) {
  const groups = new Map();
  for (const raw of rows) {
    const row = normalized ? raw : normalizeLogSessionRow(raw);
    const key = row.sessionKey || "unknown";
    const current = groups.get(key) || {
      sessionKey: key,
      sessionId: row.sessionId || null,
      sessionRef: row.sessionRef || null,
      sessionPath: row.sessionPath || null,
      sessionLabel: row.sessionLabel || "unknown",
      count: 0,
      firstSeenAt: row.date || null,
      lastSeenAt: row.date || null,
    };
    current.count += 1;
    if (!current.sessionId && row.sessionId) current.sessionId = row.sessionId;
    if (!current.sessionRef && row.sessionRef) current.sessionRef = row.sessionRef;
    if (!current.sessionPath && row.sessionPath) current.sessionPath = row.sessionPath;
    if (row.date && (!current.firstSeenAt || row.date < current.firstSeenAt)) current.firstSeenAt = row.date;
    if (row.date && (!current.lastSeenAt || row.date > current.lastSeenAt)) current.lastSeenAt = row.date;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
}

export function inspectSessionIdentityCoverage(file, { maxLines = 5000 } = {}) {
  return readJsonlSample(file, { maxLines }).coverage;
}

export function readJsonlSample(file, { cutoff = null, maxLines = 5000 } = {}) {
  const rows = [];
  const coverage = {
    total: 0,
    withStableIdentity: 0,
    legacyPathOnly: 0,
    unknown: 0,
  };
  const tail = readJsonlTailSample(file, { maxLines });
  for (const line of tail.lines) {
    try {
      const row = normalizeLogSessionRow(JSON.parse(line));
      coverage.total += 1;
      if (row.sessionId || row.sessionRef) coverage.withStableIdentity += 1;
      else if (row.sessionPath) coverage.legacyPathOnly += 1;
      else coverage.unknown += 1;
      if (cutoff == null || new Date(row.date).getTime() >= cutoff) rows.push(row);
    } catch {}
  }
  coverage.coverageRatio = coverage.total > 0 ? coverage.withStableIdentity / coverage.total : 1;
  return { rows, coverage, complete: tail.complete, lineCount: tail.lineCount };
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
