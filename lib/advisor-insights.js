import { sanitizeAdvice } from "./helpers.js";
import { knowledgeTier } from "./common.js";
import { buildCodePatchProposal, isActionableCodePatchPattern } from "./proposals.js";
import { extractFirstJson } from "./sample-text.js";

function compactPattern(pattern) {
  return {
    id: pattern.id,
    type: pattern.type,
    status: pattern.status,
    count: pattern.count,
    score: pattern.decayedScore ?? pattern.score,
    desc: pattern.desc,
    fix: pattern.fix || "",
  };
}

export function selectAdvisorCandidates(patterns = []) {
  return patterns
    // Privacy: never send preference / durable patterns to the external model.
    // These carry the rawest user text — user corrections and pin_memory
    // content — so they stay local. Only workflow/error/usage patterns, which
    // are tool-shaped and non-sensitive, are eligible for distillation.
    .filter((pattern) => pattern.status !== "rejected"
      && pattern.type !== "preference"
      && knowledgeTier(pattern) !== "durable")
    .sort((a, b) => (b.decayedScore || b.score || 0) - (a.decayedScore || a.score || 0))
    .slice(0, 12)
    .map(compactPattern);
}

export function buildAdvisorPrompt({ reason, candidates, usage, capabilities, runtimeConfig }) {
  return [
    "You are a low-cost background advisor for a self-learning plugin.",
    "Summarize candidate improvements conservatively. Do not invent facts. Do not request private prompts or paths.",
    "Return JSON only with shape: {\"suggestions\":[{\"patternId\":\"...\",\"title\":\"...\",\"advice\":\"...\",\"risk\":\"low|medium|high\"}]}",
    "",
    JSON.stringify({
      reason,
      patterns: candidates,
      usage: runtimeConfig.includeUsageInAdvisorPrompt === true && usage ? {
        totalRequests: usage.totalRequests,
        totalTokens: usage.totalTokens,
        status: usage.status,
        topModels: Object.entries(usage.byModel || {}).slice(0, 5),
      } : null,
      capabilities: capabilities ? {
        count: capabilities.count,
        availableCount: capabilities.availableCount,
      } : null,
    }),
  ].join("\n");
}

export function buildAdvice({ runtimeConfig, config, sampled, reason }) {
  const parsed = extractFirstJson(sampled.text) || { suggestions: [] };
  return {
    updatedAt: new Date().toISOString(),
    reason,
    source: runtimeConfig.modelAdvisorResolvedSource || config.modelAdvisorSource || "official",
    provider: runtimeConfig.modelAdvisorResolvedProvider || null,
    model: sampled.model || runtimeConfig.modelAdvisorModel || null,
    warning: runtimeConfig.modelAdvisorEndpointWarning || null,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 12) : [],
  };
}

function suggestionsOf(adviceOrSuggestions) {
  if (Array.isArray(adviceOrSuggestions)) return adviceOrSuggestions;
  if (Array.isArray(adviceOrSuggestions?.suggestions)) return adviceOrSuggestions.suggestions;
  return [];
}

function buildPatternLookup(patterns) {
  if (patterns instanceof Map) return (id) => patterns.get(id);
  if (!Array.isArray(patterns)) return () => null;
  const byId = new Map();
  for (const pattern of patterns) {
    if (pattern?.id && !byId.has(pattern.id)) byId.set(pattern.id, pattern);
  }
  return (id) => byId.get(id);
}

export function mergeAdvisorSuggestions(patterns, adviceOrSuggestions, options = {}) {
  const suggestions = suggestionsOf(adviceOrSuggestions);
  const getPattern = options.getPattern || buildPatternLookup(patterns);
  const sanitize = options.sanitize || sanitizeAdvice;
  let merged = 0;
  const mergedPatternIds = [];

  for (const suggestion of suggestions) {
    const stored = getPattern(suggestion?.patternId);
    if (!stored || stored.status === "approved") continue;
    const advice = sanitize(suggestion.advice);
    if (advice && advice !== stored.fix) {
      stored.fix = advice;
      stored.advisorUpdatedAt = new Date().toISOString();
      merged += 1;
      mergedPatternIds.push(stored.id);
    }
  }

  return { merged, mergedPatternIds };
}

export function buildRepeatedCodePatchProposals({ learnerDir, patterns, minCount = 3 }) {
  const proposals = [];
  let created = 0;

  for (const pattern of patterns || []) {
    if (!pattern || !["error", "usage"].includes(pattern.type)) continue;
    if ((pattern.count || 0) < minCount) continue;
    if (!isActionableCodePatchPattern(pattern)) continue;
    if (pattern.status === "approved" && !pattern.autoApproved) continue;

    const proposal = buildCodePatchProposal({ learnerDir, pattern });
    if (proposal.status === "pending") {
      if (proposal.createdAt === proposal.updatedAt) created += 1;
      proposals.push(proposal);
    }
  }

  return { proposals, created };
}

export function buildHighRiskAdvisorCodePatchProposals({ learnerDir, patterns, adviceOrSuggestions }) {
  const suggestions = suggestionsOf(adviceOrSuggestions);
  const getPattern = buildPatternLookup(patterns);
  const proposals = [];
  let created = 0;

  for (const suggestion of suggestions) {
    if (suggestion?.risk !== "high") continue;
    const pattern = getPattern(suggestion.patternId);
    if (!isActionableCodePatchPattern(pattern)) continue;

    const proposal = buildCodePatchProposal({
      learnerDir,
      pattern: {
        ...pattern,
        fix: sanitizeAdvice(suggestion.advice),
      },
    });
    if (proposal.status === "pending") {
      if (proposal.createdAt === proposal.updatedAt) created += 1;
      proposals.push(proposal);
    }
  }

  return { proposals, created };
}
