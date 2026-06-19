import { buildSkillMdFromPatterns as buildSkillMdFromPatternsUnsafe } from "./skill-renderer.js";

function safeOneLine(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitizePattern(pattern = {}) {
  if (!pattern || typeof pattern !== "object") return pattern;
  return {
    ...pattern,
    desc: safeOneLine(pattern.desc),
    fix: safeOneLine(pattern.fix),
  };
}

export function buildSkillMdFromPatterns(patterns, config, options = {}) {
  const sanitized = Array.from(patterns || [], sanitizePattern);
  return buildSkillMdFromPatternsUnsafe(sanitized, config, options);
}
