import fs from "fs";
import path from "path";
import { hanakoHome, readJson } from "./common.js";
import { redactSensitive } from "./evidence.js";
import { scopeMatches, slugifyProject } from "./scope.js";

const MEMORY_FILES = [
  { file: "memory.md", type: "compiled" },
  { file: "longterm.md", type: "longterm" },
  { file: "facts.md", type: "facts" },
  { file: "week.md", type: "week" },
  { file: "today.md", type: "today" },
];

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

function officialScopeForAgent(agentName) {
  return { project: slugifyProject(agentName) || "general", taskType: "general" };
}

function officialMemoryMatchesProject(entry, project) {
  const projectSlug = slugifyProject(project || "");
  if (!projectSlug || projectSlug === "general") return true;
  return scopeMatches(entry.scope || officialScopeForAgent(entry.agent), { project: projectSlug, taskType: "general" });
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

function readAgentMemoryEntries(agentDir, agentName) {
  const entries = [];
  const memoryDir = path.join(agentDir, "memory");
  const pinnedStore = readJson(path.join(agentDir, "pinned-memory.json"), null);
  if (Array.isArray(pinnedStore?.items)) {
    for (const item of pinnedStore.items) {
      if (!item?.content) continue;
      entries.push({
        id: `official:pinned:${agentName}:${item.id || entries.length}`,
        source: "official_memory",
        memoryType: "pinned",
        agent: agentName,
        scope: officialScopeForAgent(agentName),
        text: safeText(item.content, 1000),
        createdAt: item.createdAt || null,
      });
    }
  } else {
    try {
      const pinnedMd = fs.readFileSync(path.join(agentDir, "pinned.md"), "utf-8");
      for (const [index, section] of splitMarkdownMemory(pinnedMd).entries()) {
        entries.push({
          id: `official:pinned:${agentName}:md-${index}`,
          source: "official_memory",
          memoryType: "pinned",
          agent: agentName,
          scope: officialScopeForAgent(agentName),
          text: safeText(section, 1000),
          createdAt: null,
        });
      }
    } catch {}
  }

  for (const item of MEMORY_FILES) {
    try {
      const filePath = path.join(memoryDir, item.file);
      const text = fs.readFileSync(filePath, "utf-8");
      for (const [index, section] of splitMarkdownMemory(text).entries()) {
        const clean = safeText(section, 1200);
        if (!clean || clean === "（暂无记忆）" || clean === "(No memory yet)") continue;
        entries.push({
          id: `official:${item.type}:${agentName}:${index}`,
          source: "official_memory",
          memoryType: item.type,
          agent: agentName,
          scope: officialScopeForAgent(agentName),
          text: clean,
          filePath,
          createdAt: null,
        });
      }
    } catch {}
  }
  return entries;
}

export function readOfficialMemoryEntries({ home = hanakoHome(), limit = 200 } = {}) {
  const now = Date.now();
  const started = performance.now();
  bridgeStats.reads += 1;
  if (entriesCache && entriesCache.home === home && entriesCache.expiresAt > now) {
    bridgeStats.cacheHits += 1;
    bridgeStats.lastReadMs = performance.now() - started;
    return entriesCache.entries.slice(0, limit);
  }
  bridgeStats.cacheMisses += 1;
  const agentsDir = path.join(home, "agents");
  const entries = [];
  const scanLimit = Math.max(limit, 200);
  try {
    if (!fs.existsSync(agentsDir)) {
      bridgeStats.lastReadMs = performance.now() - started;
      return entries;
    }
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      entries.push(...readAgentMemoryEntries(path.join(agentsDir, entry.name), entry.name));
      if (entries.length >= scanLimit) break;
    }
    bridgeStats.lastError = null;
  } catch (error) {
    bridgeStats.lastError = error?.message || "error";
  }
  entriesCache = { home, expiresAt: now + CACHE_TTL_MS, entries };
  bridgeStats.lastReadMs = performance.now() - started;
  return entries.slice(0, limit);
}

export function searchOfficialMemory(query, { limit = 5, home = hanakoHome(), project = null } = {}) {
  return searchOfficialMemoryWithStats(query, { limit, home, project }).results;
}

export function searchOfficialMemoryWithStats(query, { limit = 5, home = hanakoHome(), project = null } = {}) {
  const started = performance.now();
  const tokens = tokenize(query);
  bridgeStats.lastSearchAt = new Date().toISOString();
  if (!tokens.length) {
    bridgeStats.lastSkippedReason = "empty query";
    bridgeStats.lastSearchMs = performance.now() - started;
    bridgeStats.lastResultCount = 0;
    return { results: [], stats: officialMemoryBridgeStats() };
  }
  const results = readOfficialMemoryEntries({ home, limit: Math.max(limit, 200) })
    .filter((entry) => officialMemoryMatchesProject(entry, project))
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
