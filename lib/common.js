// Shared facade for runtime self-learning utilities.
// Keep this module as the stable public import surface while implementation
// lives in smaller focused modules.

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export { DEFAULT_CONFIG, mergeConfig, applyPanelConfig } from "./config-defaults.js";
export {
  cleanupTempFiles,
  countBy,
  countJsonl,
  countValues,
  describeOfficialUtilityModel,
  hanakoHome,
  inspectSessionIdentityCoverage,
  learnerDir,
  loadLearnerConfig,
  readHanakoPreferences,
  readJson,
  readJsonlSample,
  readRecentJsonl,
  safeFileSlug,
  summarizeSessionRows,
  writeJson,
  writeJsonIfChanged,
} from "./json-io.js";
export {
  ageDays,
  clearDecoratePatternCache,
  decayedScore,
  decoratePatternCacheStats,
  decoratePatterns,
  estimateTokens,
  estimateTokensRaw,
  isInjectable,
  knowledgeTier,
  memoryStrength,
  patternStatus,
  scoreSignals,
} from "./scoring.js";
export {
  isActiveSkillInjectable,
  loadActiveSkillRegistry,
  selectInjectableActiveSkills,
} from "./skill-renderer.js";
export { buildSkillMdFromPatterns } from "./skill-renderer-safe.js";
