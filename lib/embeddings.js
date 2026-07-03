/**
 * embeddings — optional semantic vectors for retrieval (v1.3).
 *
 * OFF by default and dependency-free at rest. When the user enables semantic
 * search AND configures an OpenAI-compatible /embeddings endpoint, this fetches
 * vectors for query + candidate texts, caches them on disk by content hash, and
 * exposes cosine similarity. With it off (or no endpoint, or a network failure)
 * every entry point degrades gracefully to "no semantic signal" so retrieval
 * keeps working on BM25 alone.
 *
 * Privacy: enabling this sends memory text to your endpoint — disclosed in
 * README · 隐私, same posture as the model advisor.
 */

import path from "path";
import { readJson, writeJson, learnerDir } from "./common.js";
import { shortHash } from "./helpers.js";

export function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function normalizeEmbeddingUrl(baseUrl) {
  const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (raw.endsWith("/embeddings")) return raw;
  if (raw.endsWith("/v1")) return `${raw}/embeddings`;
  return `${raw}/v1/embeddings`;
}

export function resolveSemanticConfig(config = {}) {
  if (!config.semanticSearchEnabled) return { ok: false, reason: "disabled" };
  const url = normalizeEmbeddingUrl(config.semanticEmbeddingBaseUrl);
  const model = String(config.semanticEmbeddingModel || "").trim();
  if (!url) return { ok: false, reason: "no endpoint" };
  if (!model) return { ok: false, reason: "no model" };
  return { ok: true, url, model, apiKey: String(config.semanticEmbeddingApiKey || "") };
}

export const embeddingCachePath = (baseDir = learnerDir()) => path.join(baseDir, "embeddings_cache.json");
const defaultCacheFile = () => embeddingCachePath();
function loadEmbedCache(file = defaultCacheFile()) { return readJson(file, {}) || {}; }

function pruneEmbedCache(cache = {}, { maxEntries = 1000 } = {}) {
  const max = Math.max(1, Number(maxEntries || 1000));
  const entries = Object.entries(cache || {});
  if (entries.length <= max) return cache || {};
  const kept = entries
    .sort((a, b) => Number(b[1]?.lastUsedAt || 0) - Number(a[1]?.lastUsedAt || 0))
    .slice(0, max);
  return Object.fromEntries(kept);
}

function saveEmbedCache(cache, file = defaultCacheFile(), opts = {}) {
  const before = Object.keys(cache || {}).length;
  const pruned = pruneEmbedCache(cache, opts);
  const after = Object.keys(pruned || {}).length;
  writeJson(file, pruned);
  return { entries: after, evicted: Math.max(0, before - after) };
}
function cacheKey(model, text) { return `${model}:${shortHash(text)}`; }

function unwrapVector(entry) {
  if (Array.isArray(entry)) return entry;
  if (Array.isArray(entry?.vector)) return entry.vector;
  return null;
}

export function inspectEmbeddingCache(file = defaultCacheFile(), { maxEntries = null } = {}) {
  const store = loadEmbedCache(file);
  const entries = Object.values(store || {});
  let oldestUsedAt = null;
  let newestUsedAt = null;
  for (const entry of entries) {
    const used = Number(entry?.lastUsedAt || entry?.createdAt || 0);
    if (!Number.isFinite(used) || used <= 0) continue;
    oldestUsedAt = oldestUsedAt == null ? used : Math.min(oldestUsedAt, used);
    newestUsedAt = newestUsedAt == null ? used : Math.max(newestUsedAt, used);
  }
  const cap = maxEntries == null ? null : Math.max(0, Number(maxEntries) || 0);
  return {
    entries: entries.length,
    maxEntries: cap,
    overLimit: cap != null && cap > 0 ? Math.max(0, entries.length - cap) : 0,
    oldestUsedAt: oldestUsedAt ? new Date(oldestUsedAt).toISOString() : null,
    newestUsedAt: newestUsedAt ? new Date(newestUsedAt).toISOString() : null,
  };
}

/**
 * Embed `texts`, using the disk cache for hits and one batched request for
 * misses. Returns { ok, vectors, reason } where vectors[i] aligns with texts[i]
 * (a miss left undefined on failure). Never throws.
 *
 * Injectable deps (`fetchImpl`, `cache`, `cacheFile`) keep this unit-testable
 * without network or touching the real cache file.
 */
export async function embedTexts(texts, config, { fetchImpl, cache, cacheFile, timeoutMs = 15000 } = {}) {
  const resolved = resolveSemanticConfig(config);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, vectors: [] };
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return { ok: false, reason: "no fetch", vectors: [] };

  const store = cache || loadEmbedCache(cacheFile || defaultCacheFile());
  const vectors = new Array(texts.length);
  const missIdx = [];
  const missText = [];
  const cacheStats = {
    requested: texts.length,
    hits: 0,
    misses: 0,
    fetched: 0,
    stored: 0,
    evicted: 0,
    entriesBefore: Object.keys(store || {}).length,
    entriesAfter: null,
  };
  texts.forEach((t, i) => {
    const key = cacheKey(resolved.model, t);
    const hit = unwrapVector(store[key]);
    if (hit) {
      cacheStats.hits += 1;
      vectors[i] = hit;
      if (!Array.isArray(store[key])) store[key].lastUsedAt = Date.now();
    } else {
      cacheStats.misses += 1;
      missIdx.push(i);
      missText.push(t);
    }
  });

  if (missText.length) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(resolved.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(resolved.apiKey ? { Authorization: `Bearer ${resolved.apiKey}` } : {}) },
        body: JSON.stringify({ model: resolved.model, input: missText }),
        signal: controller.signal,
      });
      if (!res.ok) {
        cacheStats.entriesAfter = Object.keys(store || {}).length;
        return { ok: false, reason: `http ${res.status}`, vectors, cacheStats };
      }
      const json = await res.json();
      const data = json?.data || [];
      missIdx.forEach((orig, j) => {
        const vec = data[j]?.embedding;
        if (Array.isArray(vec)) {
          vectors[orig] = vec;
          store[cacheKey(resolved.model, texts[orig])] = { vector: vec, createdAt: Date.now(), lastUsedAt: Date.now() };
          cacheStats.stored += 1;
        }
      });
      cacheStats.fetched = missText.length;
      if (!cache) {
        const saved = saveEmbedCache(store, cacheFile || defaultCacheFile(), { maxEntries: config.semanticCacheMaxEntries });
        cacheStats.evicted = saved.evicted;
        cacheStats.entriesAfter = saved.entries;
      }
    } catch (e) {
      cacheStats.entriesAfter = Object.keys(store || {}).length;
      return { ok: false, reason: e?.name === "AbortError" ? "timeout" : (e?.message || "error"), vectors, cacheStats };
    } finally {
      clearTimeout(timer);
    }
  }
  if (cacheStats.entriesAfter == null) cacheStats.entriesAfter = Object.keys(store || {}).length;
  return { ok: true, vectors, cacheStats };
}

// ── Reciprocal Rank Fusion (was rank-fusion.js) ───────────────────────────

export function rrfScores(rankedLists, { k = 60 } = {}) {
  const scores = new Map();
  for (const list of rankedLists) {
    if (!Array.isArray(list)) continue;
    list.forEach((id, idx) => { if (id != null) scores.set(id, (scores.get(id) || 0) + 1 / (k + idx + 1)); });
  }
  return scores;
}

export function rankByScore(items, scoreFn) {
  return [...items]
    .map((it) => ({ id: it.id ?? it, s: scoreFn(it) }))
    .filter((x) => Number.isFinite(x.s) && x.id != null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.id);
}

export function fuse(rankedLists, opts = {}) {
  return [...rrfScores(rankedLists, opts).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}
