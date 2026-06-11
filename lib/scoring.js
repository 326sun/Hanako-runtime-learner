import { DEFAULT_CONFIG } from "./config-defaults.js";

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

export function ageDays(pattern) {
  const lastSeen = Date.parse(pattern?.lastSeen || pattern?.firstSeen || "");
  if (!Number.isFinite(lastSeen)) return 0;
  return Math.max(0, (Date.now() - lastSeen) / 86_400_000);
}

export function knowledgeTier(pattern) {
  if (!pattern) return "core";
  if (pattern.knowledgeTier) return pattern.knowledgeTier;
  if (pattern.type === "preference") return "durable";
  if (pattern.type === "capability" || pattern.type === "host_capability") return "ephemeral";
  if (pattern.id?.startsWith?.("usage:large_context")) return "core";
  return "core";
}

export function decayedScore(pattern, config) {
  const score = Number(pattern?.score || 0);
  if (knowledgeTier(pattern) === "durable") return score;
  const halfLife = Math.max(1, Number((config || DEFAULT_CONFIG).decayHalfLifeDays || DEFAULT_CONFIG.decayHalfLifeDays));
  return score * Math.pow(0.5, ageDays(pattern) / halfLife);
}

export function memoryStrength(pattern, config) {
  const score = Number(pattern?.score || 0);
  if (knowledgeTier(pattern) === "durable") return score;
  const count = Math.max(1, pattern?.count || 1);
  const days = ageDays(pattern);
  const halfLife = Math.max(1, (config || DEFAULT_CONFIG).decayHalfLifeDays || DEFAULT_CONFIG.decayHalfLifeDays);
  const lambda = Math.log(2) / (halfLife * Math.sqrt(count));
  return score * Math.exp(-lambda * days);
}

export function patternStatus(pattern) {
  return pattern?.status || "pending";
}

export function isInjectable(pattern, config) {
  if (!pattern || patternStatus(pattern) === "rejected") return false;
  const cfg = config || DEFAULT_CONFIG;
  if (knowledgeTier(pattern) === "durable") {
    if (patternStatus(pattern) === "approved") return true;
    return !!cfg.includePendingPreferences;
  }
  if (patternStatus(pattern) === "approved") return true;
  const meetsConfidence = (pattern.count || 0) >= (cfg.minInjectCount || DEFAULT_CONFIG.minInjectCount)
    && decayedScore(pattern, config) >= (cfg.minInjectScore || DEFAULT_CONFIG.minInjectScore);
  if (pattern.type === "preference") {
    return !!cfg.includePendingPreferences && meetsConfidence;
  }
  return !!cfg.autoInjectHighConfidence && meetsConfidence;
}

export function decoratePatterns(patterns, config, { filter = null, mutate = false } = {}) {
  const cfg = config || DEFAULT_CONFIG;
  const results = [];
  for (const pattern of (patterns || [])) {
    if (filter && !filter(pattern)) continue;
    const tier = knowledgeTier(pattern);
    const status = patternStatus(pattern);
    const ds = Number(decayedScore(pattern, cfg).toFixed(2));
    let injectable = false;
    if (pattern && status !== "rejected") {
      if (tier === "durable") {
        injectable = status === "approved" || !!cfg.includePendingPreferences;
      } else if (status === "approved") {
        injectable = true;
      } else {
        const meetsConfidence = (pattern.count || 0) >= (cfg.minInjectCount || DEFAULT_CONFIG.minInjectCount)
          && ds >= (cfg.minInjectScore || DEFAULT_CONFIG.minInjectScore);
        if (pattern.type === "preference") {
          injectable = !!cfg.includePendingPreferences && meetsConfidence;
        } else {
          injectable = !!cfg.autoInjectHighConfidence && meetsConfidence;
        }
      }
    }
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
