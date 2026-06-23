import https from "https";
import { readJson, memoryStrength, DEFAULT_CONFIG, knowledgeTier, mergeConfig } from "../lib/common.js";
import { searchOfficialMemory } from "../lib/official-memory-bridge.js";
import { MemoryIndex, tokenizeText } from "../lib/memory-index.js";
import { admitMemory } from "../lib/memory-gate.js";
import { inferScope, normalizeScope } from "../lib/scope.js";
import { previewEvidence } from "../lib/evidence.js";
import { factMemoryItems } from "../lib/facts.js";
import { resolveSemanticConfig, embedTexts, cosineSim, rrfScores } from "../lib/embeddings.js";
import { mergeCredentials } from "../lib/credentials.js";
import { toolPaths, loadConfig } from "./_shared.js";

const hasOwn = Object.prototype.hasOwnProperty;

// Cross-language synonym table for mixed CN/EN search expansion. Applied on top
// of the index's CJK bigram tokenization to bridge terms that share no
// characters (e.g. "coding" ↔ "代码").
const SYNONYMS = {
  coding: ["代码", "编写", "code", "编程"],
  code: ["代码", "编写", "coding", "编程"],
  "代码": ["coding", "code", "编写", "编程"],
  "编写": ["coding", "code", "代码"],
  preference: ["偏好", "设定", "pref", "设置"],
  "偏好": ["preference", "pref", "设定", "设置"],
  workflow: ["工作流", "流程"],
  "工作流": ["workflow", "流程"],
  error: ["错误", "报错", "异常"],
  "错误": ["error", "报错", "异常"],
  research: ["研究", "搜索", "调研"],
  "研究": ["research", "搜索", "调研"],
  search: ["搜索", "查找", "检索"],
  "搜索": ["search", "查找", "检索"],
  file: ["文件", "文档"],
  "文件": ["file", "文档"],
  memory: ["记忆", "记住"],
  "记忆": ["memory", "记住"],
  usage: ["用量", "消耗", "token"],
  "用量": ["usage", "消耗", "token"],
};

const SYNONYM_TOKEN_CACHE = new Map();

function synonymTokensFor(key) {
  const syns = SYNONYMS[key];
  if (!syns) return null;
  let cached = SYNONYM_TOKEN_CACHE.get(key);
  if (cached) return cached;
  cached = [];
  for (const synonym of syns) {
    for (const token of tokenizeText(synonym)) cached.push(token);
  }
  SYNONYM_TOKEN_CACHE.set(key, cached);
  return cached;
}

function addSynonymTokens(expanded, key) {
  const tokens = synonymTokensFor(key);
  if (!tokens) return;
  for (const token of tokens) expanded.add(token);
}

// Tokenize the query (CJK-aware) and fold in cross-language synonyms. We expand
// on whitespace-split words first so multi-word EN phrases still hit the table.
export function expandQueryTokens(query) {
  const raw = String(query || "").toLowerCase();
  const base = tokenizeText(raw);
  const expanded = new Set(base);
  for (const word of raw.split(/\s+/)) {
    if (word) addSynonymTokens(expanded, word);
  }
  for (const token of base) addSynonymTokens(expanded, token);
  return [...expanded];
}

const round1 = (value) => Math.round(value * 10) / 10;
const round3 = (value) => Math.round(value * 1000) / 1000;
const round4 = (value) => Math.round(value * 10000) / 10000;

function buildStrongTokenSet(tokens) {
  const strong = new Set();
  for (const token of tokens) {
    if (token.length >= 2) strong.add(token);
  }
  return strong;
}

function buildIdMap(items) {
  const byId = new Map();
  for (const item of items) {
    if (item?.id) byId.set(item.id, item);
  }
  return byId;
}

function filterPatterns(source, type, taskType) {
  if (!type && !taskType) return source;
  const out = [];
  for (const pattern of source) {
    if (type && pattern.type !== type) continue;
    if (!matchesTaskFilter(pattern, taskType)) continue;
    out.push(pattern);
  }
  return out;
}

function semanticMapFrom(semantic) {
  if (semantic instanceof Map) return semantic;
  if (!semantic || typeof semantic !== "object") return null;
  const map = new Map();
  for (const id in semantic) {
    if (hasOwn.call(semantic, id)) map.set(id, semantic[id]);
  }
  return map;
}

function matchesTaskFilter(pattern, taskFilter) {
  if (!taskFilter) return true;
  const raw = pattern.scope?.taskType || pattern.context?.taskType || "";
  for (const item of String(raw).split(",")) {
    if (item.trim() === taskFilter) return true;
  }
  return false;
}

function relationBoost(pattern, byId) {
  const rels = pattern.context?.relations || [];
  if (!rels.length) return 0;
  let boost = 0;
  for (const rel of rels) {
    const target = byId.get(rel.targetId);
    if (target && target.status !== "rejected") {
      boost += (rel.weight || 0.2) * Math.min(1, (target.score || 0) / 15);
    }
  }
  return Math.min(boost, 5);
}

export function prepareSearch(allPatterns, { type = null, taskType = null } = {}) {
  const source = Array.isArray(allPatterns) ? allPatterns : [];
  const prefiltered = filterPatterns(source, type, taskType);
  return {
    source,
    prefiltered,
    index: new MemoryIndex().rebuild(prefiltered),
  };
}

/**
 * Core retrieval pipeline, separated from the tool wrapper so tests (and the
 * retrieval eval) can drive it directly with in-memory patterns:
 *   tokens → BM25 top-K → memory-gate → relation+strength rerank → low-conf reject
 */
/**
 * Core retrieval pipeline. Stateless and testable without disk I/O.
 *
 * Pipeline: CJK tokenize + synonym expand → BM25 Top-K → memory-gate
 * (hard reject + soft penalty) → relation + memoryStrength + scope rerank
 * → low-confidence tail reject → optional RRF semantic fusion.
 *
 * @param {Array} allPatterns — decorated patterns + fact memory items
 * @param {string} query — search keywords
 * @param {object} opts — { config, type, taskType, project, limit, semantic }
 * @returns {{ results: Array, queryScope: object }}
 */
export function runSearch(allPatterns, query, { config = DEFAULT_CONFIG, type = null, taskType = null, project = null, limit = 5, semantic = null, prepared = null } = {}) {
  const cfg = mergeConfig(config);
  const usePrepared = prepared?.index && prepared.source === allPatterns;
  const source = usePrepared ? prepared.source : (Array.isArray(allPatterns) ? allPatterns : []);
  const tokens = expandQueryTokens(query);
  const queryScope = inferScope({ taskType, userText: query, project });

  // Pre-filter only on the user's explicit, hard filters (type / taskType).
  const prefiltered = usePrepared ? prepared.prefiltered : filterPatterns(source, type, taskType);

  if (!tokens.length) return { results: [], queryScope };

  // 1) BM25 candidate generation. Strong-token filtering happens inside the
  // index so incidental single-CJK-character matches are dropped before rerank.
  const strongQ = buildStrongTokenSet(tokens);
  const candidateLimit = Math.max(limit, Number(cfg.retrievalCandidateLimit || 20));
  const index = usePrepared ? prepared.index : new MemoryIndex().rebuild(prefiltered);
  const bm25Hits = index.search(tokens, { limit: candidateLimit, requireAnyToken: strongQ });
  if (!bm25Hits.length) return { results: [], queryScope };

  const topBm25 = bm25Hits[0].bm25 || 0;
  const relFloor = topBm25 * Number(cfg.minRetrievalRelative ?? 0.15);
  const byId = buildIdMap(source);

  // 2) Gate + 3) rerank.
  const scored = [];
  for (const hit of bm25Hits) {
    // Low-confidence reject: weak textual tail relative to the best match.
    if (hit.bm25 < relFloor) continue;
    const p = hit.item;
    const gate = admitMemory(p, { scope: queryScope }, cfg);
    if (!gate.admitted) continue;

    const relation = relationBoost(p, byId);
    const memStr = memoryStrength(p, cfg);
    const pScope = normalizeScope(p.scope || p.context);
    // Bonus for a concrete same-project match (general scopes get nothing extra).
    const scopeBonus = pScope.project !== "general" && pScope.project === queryScope.project ? 0.5 : 0;
    const breakdown = {
      bm25: round3(hit.bm25),
      relation: round3(relation),
      memoryStrength: round3(Math.log1p(memStr) * 0.5),
      scope: round3(scopeBonus - (gate.penalty || 0)),
    };
    const composite = breakdown.bm25 + breakdown.relation + breakdown.memoryStrength + breakdown.scope;
    scored.push({ p, gate, breakdown, composite: round3(composite), memStr });
  }

  // Optional semantic fusion (v1.3): when a semantic similarity map is supplied
  // (id → cosine), fuse BM25 / semantic / relation / memoryStrength rankings via
  // RRF. Without it, ranking stays the dependency-free weighted composite above,
  // so default behavior — and the retrieval eval — is unchanged.
  const semMap = semanticMapFrom(semantic);
  if (semMap && semMap.size > 0) {
    const rankBy = (scoreOf, positiveOnly = false) => {
      const ranked = [];
      for (const s of scored) {
        const v = scoreOf(s);
        if (Number.isFinite(v) && (!positiveOnly || v > 0)) ranked.push({ id: s.p.id, v });
      }
      ranked.sort((a, b) => b.v - a.v);
      const ids = new Array(ranked.length);
      for (let i = 0; i < ranked.length; i++) ids[i] = ranked[i].id;
      return ids;
    };
    const lists = [
      rankBy((s) => s.breakdown.bm25),
      rankBy((s) => (semMap.has(s.p.id) ? semMap.get(s.p.id) : NaN)),
      rankBy((s) => s.breakdown.relation, true),
      rankBy((s) => s.memStr),
    ];
    const fused = rrfScores(lists, { k: Number(cfg.rrfK) || 60 });
    for (const s of scored) {
      s.breakdown.semantic = semMap.has(s.p.id) ? round3(semMap.get(s.p.id)) : 0;
      s.breakdown.fused = round4(fused.get(s.p.id) || 0);
      // scope term as a tiny tie-break so same-project / cross-task ordering holds.
      s.composite = round4(s.breakdown.fused + s.breakdown.scope * 0.0001);
    }
  }

  scored.sort((a, b) => b.composite - a.composite);

  const resultLimit = Math.min(limit, scored.length);
  const results = new Array(resultLimit);
  for (let i = 0; i < resultLimit; i++) {
    const { p, gate, breakdown, composite, memStr } = scored[i];
    results[i] = {
      id: p.id,
      type: p.type,
      knowledgeTier: knowledgeTier(p),
      scope: normalizeScope(p.scope || p.context),
      desc: p.desc,
      fix: p.fix || null,
      repairPlan: p.repairPlan || null,
      context: p.context ? { taskType: p.context.taskType, categories: p.context.categories } : null,
      evidencePreview: previewEvidence(p),
      gateReason: gate.reason,
      count: p.count,
      score: p.score,
      memoryStrength: round1(memStr),
      status: p.status,
      scoreBreakdown: breakdown,
      _score: composite,
    };
  }

  return { results, queryScope };
}

export const name = "self_learning_search";

export const description = "Search learned patterns by keyword, type, context, or task category. Scope-aware retrieval: CJK-aware BM25 + memory gate (rejects cross-project / expired / superseded / low-confidence) + relation & memory-strength rerank.";

export const sessionPermission = { readOnly: true };

export const parameters = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search keywords (e.g. 'coding', 'preference', 'web search workflow', 'paper writing')" },
    type: { type: "string", description: "Filter by pattern type: workflow, preference, error, or all (default)" },
    taskType: { type: "string", description: "Filter by task context: file_management, coding, research, planning, or general" },
    project: { type: "string", description: "Scope the search to a project. Cross-project memories are blocked unless global." },
    limit: { type: "number", description: "Maximum results, default 5" },
  },
  required: ["query"],
};

export async function execute(input = {}, ctx) {
  const p = toolPaths(ctx);
  const dataDir = p.learnerDir;
  const patternsFile = p.patternsPath;
  const query = input.query || "";
  const typeFilter = input.type || null;
  const taskFilter = input.taskType || null;
  const projectFilter = input.project || null;
  const limit = Math.min(input.limit || 5, 10);

  const patterns = (readJson(patternsFile, []) || []).filter((p) => p && p.id);
  const factItems = factMemoryItems(dataDir);
  const allPatterns = [...patterns, ...factItems];
  const prepared = prepareSearch(allPatterns, { type: typeFilter, taskType: taskFilter });
  const config = mergeCredentials(loadConfig(p.configPath));
  const officialMemory = config.officialMemoryBridgeEnabled
    ? searchOfficialMemory(query, {
      limit: Math.max(0, Math.min(Number(config.officialMemoryBridgeMaxResults || 3), 10)),
      project: projectFilter,
    })
    : [];

  // Use a direct Node.js HTTPS request for the user-configured embedding
  // endpoint. The host's declarative ctx.network.fetch channel needs a static
  // manifest allowedHosts allowlist and cannot express the arbitrary OpenAI-
  // compatible base URL a user supplies, so it would reject every request on
  // v0.341+ hosts. Direct outbound requests stay compatible for this case.
  const nodeFetch = (url, init = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: init.method || "GET",
      headers: init.headers || {},
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: () => JSON.parse(data), text: () => data });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (init.body) req.write(init.body);
    req.end();
  });
  const fetchImpl = nodeFetch;

  let semantic = null;
  let semanticUsed = false;
  if (resolveSemanticConfig(config).ok) {
    try {
      const probe = runSearch(allPatterns, query, {
        config, type: typeFilter, taskType: taskFilter, project: projectFilter,
        limit: Math.max(limit, Number(config.semanticTopK) || 50),
        prepared,
      }).results;
      if (probe.length) {
        const emb = await embedTexts([query, ...probe.map((r) => `${r.desc} ${r.fix || ""}`)], config, { fetchImpl });
        if (emb.ok && Array.isArray(emb.vectors[0])) {
          const qv = emb.vectors[0];
          semantic = new Map();
          probe.forEach((r, i) => {
            const v = emb.vectors[i + 1];
            if (Array.isArray(v)) semantic.set(r.id, cosineSim(qv, v));
          });
          semanticUsed = semantic.size > 0;
        }
      }
    } catch { /* degrade to weighted */ }
  }

  const { results, queryScope } = runSearch(allPatterns, query, {
    config,
    type: typeFilter,
    taskType: taskFilter,
    project: projectFilter,
    limit,
    semantic,
    prepared,
  });

  const result = {
    ok: true,
    query,
    queryScope,
    count: results.length,
    strategy: semanticUsed
      ? "rrf(bm25 + semantic + relation + memoryStrength) + gate"
      : "bm25(cjk) + gate + relation + memoryStrength",
    results,
    officialMemory,
  };
  if (!results.length) {
    result.hint = "No matching patterns admitted. Try broader keywords, a different taskType/project filter, or check self_learning_stats for an overview.";
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}
