import fs from "fs";
import path from "path";
import { hanakoHome, readJson } from "./common.js";
import { redactSensitive } from "./evidence.js";

const MEMORY_COMPONENT_FILES = [
  { file: "facts.md", type: "facts" },
  { file: "today.md", type: "today" },
  { file: "week.md", type: "week" },
  { file: "longterm.md", type: "longterm" },
];

const COMPOSITE_MEMORY_FILE = { file: "memory.md", type: "compiled" };
const DAILY_MEMORY_LIMIT = 6;
const DAILY_MEMORY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

const CACHE_TTL_MS = 30_000;
let entriesCache = null;
const bridgeStats = {
  reads: 0,
  cacheHits: 0,
  cacheMisses: 0,
  lastReadMs: 0,
  lastSearchMs: 0,
  lastResultCount: 0,
  lastSkippedReason: null,
  lastError: null,
  lastSearchAt: null,
};

function tokenize(query) {
  return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
}

function safeText(value, max = 1200) {
  const redacted = redactSensitive(String(value || "")).text;
  return redacted.replace(/\s+/g, " ").trim().slice(0, max);
}

function scoreText(text, tokens) {
  if (!tokens.length) return 0;
  const haystack = String(text || "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function normalizeAgentId(value) {
  const agentId = typeof value === "string" ? value.trim() : "";
  if (!agentId || agentId === "." || agentId === ".." || path.basename(agentId) !== agentId || path.isAbsolute(agentId)) return "";
  return agentId;
}

function officialMemoryScope() {
  // Agent identity is the isolation boundary, not a project name. Once reads
  // are constrained to the invoking Agent, project-scoped searches may safely
  // consider that Agent's official memory as general context.
  return { project: "general", taskType: "general" };
}

function splitMarkdownMemory(text, { maxSections = 16 } = {}) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = [];
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line) && current.length) {
      sections.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) sections.push(current.join("\n").trim());
  return sections.filter(Boolean).slice(0, maxSections);
}

function canonicalMemoryText(text) {
  return String(text || "")
    .replace(/^#{1,3}\s+[^\n]+\n+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function appendMarkdownEntries(entries, seen, filePath, { type, agentName, idPrefix = type } = {}) {
  let added = 0;
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    for (const [index, section] of splitMarkdownMemory(text).entries()) {
      const clean = safeText(section, 1200);
      const canonical = canonicalMemoryText(section);
      if (!clean || !canonical || clean === "（暂无记忆）" || clean === "(No memory yet)" || seen.has(canonical)) continue;
      seen.add(canonical);
      entries.push({
        id: `official:${idPrefix}:${agentName}:${index}`,
        source: "official_memory",
        memoryType: type,
        agent: agentName,
        scope: officialMemoryScope(),
        text: clean,
        filePath,
        createdAt: null,
      });
      added += 1;
    }
  } catch {}
  return added;
}

function readDailyMemoryEntries(entries, seen, memoryDir, agentName) {
  const dailyDir = path.join(memoryDir, "daily");
  let files = [];
  try {
    files = fs.readdirSync(dailyDir)
      .filter((file) => DAILY_MEMORY_FILE_RE.test(file))
      .sort()
      .reverse()
      .slice(0, DAILY_MEMORY_LIMIT);
  } catch {}
  for (const file of files) {
    appendMarkdownEntries(entries, seen, path.join(dailyDir, file), {
      type: "daily",
      agentName,
      idPrefix: `daily:${file.slice(0, -3)}`,
    });
  }
}

function readAgentMemoryEntries(agentDir, agentName) {
  const entries = [];
  const seen = new Set();
  const memoryDir = path.join(agentDir, "memory");
  const pinnedStore = readJson(path.join(agentDir, "pinned-memory.json"), null);
  if (Array.isArray(pinnedStore?.items)) {
    for (const item of pinnedStore.items) {
      if (!item?.content) continue;
      const text = safeText(item.content, 1000);
      const canonical = canonicalMemoryText(item.content);
      if (!text || !canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      entries.push({
        id: `official:pinned:${agentName}:${item.id || entries.length}`,
        source: "official_memory",
        memoryType: "pinned",
        agent: agentName,
        scope: officialMemoryScope(),
        text,
        createdAt: item.createdAt || null,
      });
    }
  } else {
    try {
      const pinnedMd = fs.readFileSync(path.join(agentDir, "pinned.md"), "utf-8");
      for (const [index, section] of splitMarkdownMemory(pinnedMd).entries()) {
        const text = safeText(section, 1000);
        const canonical = canonicalMemoryText(section);
        if (!text || !canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        entries.push({
          id: `official:pinned:${agentName}:md-${index}`,
          source: "official_memory",
          memoryType: "pinned",
          agent: agentName,
          scope: officialMemoryScope(),
          text,
          createdAt: null,
        });
      }
    } catch {}
  }

  let weekEntries = 0;
  for (const item of MEMORY_COMPONENT_FILES) {
    const added = appendMarkdownEntries(entries, seen, path.join(memoryDir, item.file), {
      type: item.type,
      agentName,
    });
    if (item.type === "week") weekEntries = added;
  }

  // Hanako v0.357 uses a daily memory conveyor and normally assembles week.md
  // from it. Read the newest daily files only when week.md is absent/empty, so
  // an interrupted assembly stays searchable without duplicating normal data.
  if (weekEntries === 0) readDailyMemoryEntries(entries, seen, memoryDir, agentName);

  // memory.md is the aggregate compatibility surface. Components are read
  // first, and canonical deduplication makes this a fallback for legacy or
  // partially populated layouts rather than a source of duplicate hits.
  appendMarkdownEntries(entries, seen, path.join(memoryDir, COMPOSITE_MEMORY_FILE.file), {
    type: COMPOSITE_MEMORY_FILE.type,
    agentName,
  });
  return entries;
}

export function readOfficialMemoryEntries({ home = hanakoHome(), agentId, limit = 200 } = {}) {
  const now = Date.now();
  const started = performance.now();
  bridgeStats.reads += 1;
  const safeAgentId = normalizeAgentId(agentId);
  if (!safeAgentId) {
    bridgeStats.lastSkippedReason = "agent identity unavailable";
    bridgeStats.lastReadMs = performance.now() - started;
    return [];
  }
  if (entriesCache && entriesCache.home === home && entriesCache.agentId === safeAgentId && entriesCache.expiresAt > now) {
    bridgeStats.cacheHits += 1;
    bridgeStats.lastReadMs = performance.now() - started;
    return entriesCache.entries.slice(0, limit);
  }
  bridgeStats.cacheMisses += 1;
  const agentDir = path.join(home, "agents", safeAgentId);
  const entries = [];
  try {
    if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) {
      bridgeStats.lastSkippedReason = "agent memory unavailable";
      bridgeStats.lastReadMs = performance.now() - started;
      return entries;
    }
    entries.push(...readAgentMemoryEntries(agentDir, safeAgentId));
    bridgeStats.lastError = null;
    bridgeStats.lastSkippedReason = null;
  } catch (error) {
    bridgeStats.lastError = error?.message || "error";
  }
  entriesCache = { home, agentId: safeAgentId, expiresAt: now + CACHE_TTL_MS, entries };
  bridgeStats.lastReadMs = performance.now() - started;
  return entries.slice(0, limit);
}

export function searchOfficialMemory(query, { limit = 5, home = hanakoHome(), agentId } = {}) {
  return searchOfficialMemoryWithStats(query, { limit, home, agentId }).results;
}

export function searchOfficialMemoryWithStats(query, { limit = 5, home = hanakoHome(), agentId } = {}) {
  const started = performance.now();
  const tokens = tokenize(query);
  bridgeStats.lastSearchAt = new Date().toISOString();
  if (!tokens.length) {
    bridgeStats.lastSkippedReason = "empty query";
    bridgeStats.lastSearchMs = performance.now() - started;
    bridgeStats.lastResultCount = 0;
    return { results: [], stats: officialMemoryBridgeStats() };
  }
  const safeAgentId = normalizeAgentId(agentId);
  if (!safeAgentId) {
    bridgeStats.lastSkippedReason = "agent identity unavailable";
    bridgeStats.lastSearchMs = performance.now() - started;
    bridgeStats.lastResultCount = 0;
    return { results: [], stats: officialMemoryBridgeStats() };
  }
  const results = readOfficialMemoryEntries({ home, agentId: safeAgentId, limit: Math.max(limit, 200) })
    .map((entry) => ({ ...entry, score: scoreText(`${entry.agent} ${entry.memoryType} ${entry.text}`, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  bridgeStats.lastSkippedReason = null;
  bridgeStats.lastSearchMs = performance.now() - started;
  bridgeStats.lastResultCount = results.length;
  return { results, stats: officialMemoryBridgeStats() };
}

export function officialMemoryBridgeStats() {
  return { ...bridgeStats };
}
