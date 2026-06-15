import crypto from "crypto";
import { mergeConfig } from "./common.js";
import { suggestToolRepair } from "./tool-repair.js";

function stableId(prefix, payload) {
  const hash = crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex").slice(0, 12);
  return `${prefix}:${hash}`;
}

function normalizeErrors(context = {}) {
  const direct = Array.isArray(context.errors) ? context.errors : [];
  const fromPatterns = Array.isArray(context.patterns)
    ? context.patterns.filter((p) => p?.type === "error").map((p) => ({
        errorType: String(p.id || "").replace(/^error:/, "") || p.errorType || "unknown",
        count: p.count,
        patternId: p.id,
        severity: p.severity,
        desc: p.desc,
      }))
    : [];
  return [...direct, ...fromPatterns];
}

function estimateUsageTokens(context = {}) {
  const usage = context.usage || context.turn?.usage || context.summaryEntry || {};
  const candidates = [
    usage.estimatedTokens,
    usage.totalTokens,
    usage.total_tokens,
    usage.inputTokens && usage.outputTokens ? usage.inputTokens + usage.outputTokens : null,
    usage.prompt_tokens && usage.completion_tokens ? usage.prompt_tokens + usage.completion_tokens : null,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (Array.isArray(context.patterns)) {
    const large = context.patterns.find((p) => String(p.id || "").includes("large_context"));
    if (large) return Number(large.tokens || large.totalTokens || 0) || 0;
  }
  return 0;
}

export function detectActionTriggers(context = {}) {
  const config = mergeConfig(context.config);
  const threshold = Number(config.largeUsageTokenThreshold || config.runtimeActions?.largeContextThreshold || 120000);
  const triggers = [];
  const tokens = estimateUsageTokens(context);
  if (tokens > threshold) {
    const evidence = { estimatedTokens: tokens, threshold };
    triggers.push({
      id: stableId("trigger:large_context_risk", evidence),
      type: "large_context_risk",
      risk: "medium",
      reason: "estimated token usage exceeds the configured large-context threshold",
      evidence,
      confidence: Math.min(0.95, 0.7 + Math.min(0.25, (tokens - threshold) / Math.max(threshold, 1))),
      createdAt: new Date().toISOString(),
    });
  }

  for (const error of normalizeErrors(context)) {
    const repair = suggestToolRepair(error, context);
    const type = repair.retry ? "retryable_tool_error" : "non_retryable_tool_error";
    const evidence = {
      errorType: repair.errorType,
      retryable: repair.retry,
      tool: repair.context.tool || error.tool || null,
      patternId: error.patternId || null,
      count: error.count || null,
    };
    triggers.push({
      id: stableId(`trigger:${type}`, evidence),
      type,
      risk: repair.retry ? "low" : "medium",
      reason: repair.reason,
      evidence,
      repairPlan: repair.repairPlan,
      suggestedTools: repair.suggestedTools,
      confidence: repair.retry ? 0.76 : 0.74,
      createdAt: new Date().toISOString(),
    });
  }

  const seen = new Set();
  return triggers.filter((trigger) => {
    if (seen.has(trigger.id)) return false;
    seen.add(trigger.id);
    return true;
  });
}
