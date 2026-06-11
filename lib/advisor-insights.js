import { sanitizeAdvice } from "./helpers.js";
import { buildCodePatchProposal, isActionableCodePatchPattern } from "./proposals.js";

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
