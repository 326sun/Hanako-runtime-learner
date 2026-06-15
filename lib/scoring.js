import { DEFAULT_CONFIG } from "./config-defaults.js";

const round2 = (value) => Math.round(value * 100) / 100;

// CJK-aware token estimation: Chinese/Japanese/Korean chars ~1.8 tokens,
// ASCII/alphanumeric ~0.25 tokens (≈4 chars per token). `estimateTokensRaw`
// returns the pre-rounding float so callers doing incremental subtraction stay
// precise; `estimateTokens` rounds up.
export function estimateTokensRaw(text) {
  let cjk = 0, other = 0;
  for (const ch of String(text || "")) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified Ideographs
        (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Extension A
        (cp >= 0x20000 && cp <= 0x2A6DF) || // CJK Extension B
        (cp >= 0x3040 && cp <= 0x309F) ||   // Hiragana
        (cp >= 0x30A0 && cp <= 0x30FF) ||   // Katakana
        (cp >= 0xAC00 && cp <= 0xD7AF)) {   // Hangul
      cjk++;
    } else {
      other++;
    }
  }
  return cjk * 1.8 + other * 0.25;
}

export function estimateTokens(text) {
  return Math.ceil(estimateTokensRaw(text));
}

export function ageDays(pattern, now = Date.now()) {
  const lastSeen = Date.parse(pattern?.lastSeen || pattern?.firstSeen || "");
  if (!Number.isFinite(lastSeen)) return 0;
  return Math.max(0, (now - lastSeen) / 86_400_000);
}

export function knowledgeTier(pattern) {
  if (!pattern) return "core";
  if (pattern.knowledgeTier) return pattern.knowledgeTier;
  if (pattern.type === "preference") return "durable";
  if (pattern.type === "capability" || pattern.type === "host_capability") return "ephemeral";
  if (pattern.id?.startsWith?.("usage:large_context")) return "core";
  return "core";
}

export function decayedScore(pattern, config, now = Date.now()) {
  const score = Number(pattern?.score || 0);
  if (knowledgeTier(pattern) === "durable") return score;
  const halfLife = Math.max(1, Number((config || DEFAULT_CONFIG).decayHalfLifeDays || DEFAULT_CONFIG.decayHalfLifeDays));
  return score * Math.pow(0.5, ageDays(pattern, now) / halfLife);
}

export function memoryStrength(pattern, config, now = Date.now()) {
  const score = Number(pattern?.score || 0);
  if (knowledgeTier(pattern) === "durable") return score;
  const count = Math.max(1, pattern?.count || 1);
  const days = ageDays(pattern, now);
  const halfLife = Math.max(1, (config || DEFAULT_CONFIG).decayHalfLifeDays || DEFAULT_CONFIG.decayHalfLifeDays);
  const lambda = Math.log(2) / (halfLife * Math.sqrt(count));
  return score * Math.exp(-lambda * days);
}

export function scoreSignals(pattern, config, now = Date.now(), tier = knowledgeTier(pattern)) {
  const score = Number(pattern?.score || 0);
  if (tier === "durable") {
    return { decayedScore: score, memoryStrength: score };
  }
  const cfg = config || DEFAULT_CONFIG;
  const count = Math.max(1, pattern?.count || 1);
  const days = ageDays(pattern, now);
  const halfLife = Math.max(1, Number(cfg.decayHalfLifeDays || DEFAULT_CONFIG.decayHalfLifeDays));
  return {
    decayedScore: score * Math.pow(0.5, days / halfLife),
    memoryStrength: score * Math.exp(-(Math.log(2) / (halfLife * Math.sqrt(count))) * days),
  };
}

export function patternStatus(pattern) {
  return pattern?.status || "pending";
}

// `precomputedDs` lets a caller that already derived a decayedScore (e.g.
// decoratePatterns, which uses the rounded display value) reuse it instead of
// re-deriving — keeping both call sites on one injectability rule.
export function isInjectable(pattern, config, precomputedDs, precomputedTier, precomputedStatus) {
  const status = precomputedStatus ?? patternStatus(pattern);
  if (!pattern || status === "rejected") return false;
  const cfg = config || DEFAULT_CONFIG;
  const tier = precomputedTier ?? knowledgeTier(pattern);
  if (tier === "durable") {
    if (status === "approved") return true;
    return !!cfg.includePendingPreferences;
  }
  if (status === "approved") return true;
  const ds = precomputedDs ?? decayedScore(pattern, config);
  const meetsConfidence = (pattern.count || 0) >= (cfg.minInjectCount || DEFAULT_CONFIG.minInjectCount)
    && ds >= (cfg.minInjectScore || DEFAULT_CONFIG.minInjectScore);
  if (pattern.type === "preference") {
    return !!cfg.includePendingPreferences && meetsConfidence;
  }
  return !!cfg.autoInjectHighConfidence && meetsConfidence;
}

export function decoratePatterns(patterns, config, { filter = null, mutate = false } = {}) {
  const cfg = config || DEFAULT_CONFIG;
  const results = [];
  const now = Date.now();
  for (const pattern of (patterns || [])) {
    if (filter && !filter(pattern)) continue;
    const tier = knowledgeTier(pattern);
    const status = patternStatus(pattern);
    const ds = round2(decayedScore(pattern, cfg, now));
    // Single source of truth for injectability — pass the rounded ds so this
    // matches the displayed decayedScore exactly (was duplicated inline here).
    const injectable = isInjectable(pattern, cfg, ds, tier, status);
    if (mutate) {
      pattern.knowledgeTier = tier;
      pattern.status = status;
      pattern.decayedScore = ds;
      pattern.injectable = injectable;
      results.push(pattern);
    } else {
      results.push({ ...pattern, knowledgeTier: tier, status, decayedScore: ds, injectable });
    }
  }
  return results.sort((a, b) => (b.decayedScore || 0) - (a.decayedScore || 0));
}
