// Shared facade for runtime self-learning utilities.
// Keep this module as the stable public import surface while implementation
// lives in smaller focused modules.

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export { DEFAULT_CONFIG } from "./config-defaults.js";
export {
  cleanupTempFiles,
  countBy,
  countJsonl,
  countValues,
  describeOfficialUtilityModel,
  hanakoHome,
  hanakoPreferencesPath,
  learnerDir,
  loadLearnerConfig,
  readHanakoPreferences,
  readJson,
  readRecentJsonl,
  safeFileSlug,
  writeJson,
} from "./json-io.js";
export {
  ageDays,
  decayedScore,
  decoratePatterns,
  estimateTokens,
  estimateTokensRaw,
  isInjectable,
  knowledgeTier,
  memoryStrength,
  patternStatus,
} from "./scoring.js";
export {
  buildSkillMdFromPatterns,
  isActiveSkillInjectable,
  loadActiveSkillRegistry,
  selectInjectableActiveSkills,
} from "./skill-renderer.js";
