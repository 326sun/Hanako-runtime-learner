export const DEFAULT_CONFIG = {
  governanceProfile: "balanced",
  autoInjectHighConfidence: true,
  autoApproveHighConfidence: true,
  minInjectScore: 8,
  minInjectCount: 2,
  decayHalfLifeDays: 30,
  // Off by default: unreviewed user corrections (pending preferences) stay
  // searchable but are not injected into SKILL.md until approved or reinforced
  // past the confidence bar. Advanced single-user setups can opt in (see README).
  includePendingPreferences: false,
  learnFromUsage: true,
  includeUsageInAdvisorPrompt: false,
  officialMemoryBridgeEnabled: true,
  officialMemoryBridgeMaxResults: 3,
  durableMemoryMaxCount: 50,
  largeUsageTokenThreshold: 120000,
  officialUtilityModelDisplay: "跟随 Hanako 用户设置的小模型",
  // Off by default: enabling this sends distilled patterns to an external
  // OpenAI-compatible endpoint. Require explicit opt-in (see README · 隐私).
  modelAdvisorEnabled: false,
  modelAdvisorSource: "official",
  modelAdvisorBaseUrl: "",
  modelAdvisorApiKey: "",
  modelAdvisorModel: "",
  modelAdvisorMaxTokens: 500,
  modelAdvisorMinIntervalMinutes: 60,
  // Off by default: these push unsolicited messages into the user's chat. Opt in
  // if you want in-conversation status / proposal notifications.
  workStatusEnabled: false,
  workStatusText: "正在自我整理学习",
  proposalChatNotificationsEnabled: false,
  // Runtime auto-action governance (v2.0). Low-risk actions can run automatically;
  // R2 write-like actions require verification + rollback; R3/R4 stay manual unless
  // explicitly and narrowly enabled.
  autoActions: {
    enabled: true,
    dryRun: false,
    maxAutoRiskTier: "R2",
    allowR3WithStrictGuards: false,
    minConfidence: 0.72,
    maxAutoActionsPerTurn: 5,
    maxAutoActionsPerSession: 20,
    maxRepairAttempts: 1,
    maxRetryPerToolCall: 1,
    maxExecutionMsPerAction: 30000,
    maxExecutionMsPerTurn: 120000,
    requireRollbackForWrites: true,
    requireVerification: true,
    writeActionFeedback: true,
    updatePolicyWeights: true,
    autoRepairEnabled: true,
    maxChangedFilesPerAction: 8,
    maxCompactedChars: 4000,
  },
  autoActionCommands: {
    allowlist: ["node --check"],
    denylist: ["rm", "del", "git push", "git tag", "npm publish", "release"],
    allowProjectScripts: false,
  },
  // Strict governance mode (v1.5). When enabled, low-risk autoApply proposals
  // are queued for review and will not be applied until the review is approved.
  requireReviewForAutoApply: false,
  // Active skills are evidence-backed rules produced by the promotion loop.
  // They are NOT injected by default: enabling this gate lets reviewed single-user
  // setups surface active_skills.json entries in SKILL.md without letting the
  // promotion loop write SKILL.md directly.
  activeSkillsInjectionEnabled: false,
  activeSkillsInjectionMaxCount: 3,
  activeSkillsInjectionMinSuccess: 7,
  activeSkillsInjectionMaxRegression: 0,
  maxSkillTokens: 800,
  minAdvisorNewPatterns: 3,
  // Retrieval tuning (v0.9). Advanced-only — intentionally not surfaced in the
  // settings UI, mirroring maxSkillTokens / minAdvisorNewPatterns.
  retrievalCandidateLimit: 20,   // BM25 top-K fed into the gate
  minRetrievalRelative: 0.15,    // drop candidates below this fraction of the top BM25 score
  crossTaskPenalty: 1.0,         // rerank penalty for cross-taskType (still-admitted) recall
  minRetrievalConfidence: 0,     // hard floor on a candidate's explicit confidence (0 = off)
  // Semantic retrieval (v1.3). Off by default; enabling it sends memory text to
  // your configured embedding endpoint (see README · 隐私). When on, results are
  // ranked by RRF over BM25 + semantic + relation + memoryStrength. When off,
  // retrieval is the same dependency-free weighted BM25 as before.
  semanticSearchEnabled: false,
  semanticEmbeddingBaseUrl: "",
  semanticEmbeddingApiKey: "",
  semanticEmbeddingModel: "",
  semanticTopK: 50,              // advanced-only: candidates to embed/fuse
  rrfK: 60,                      // advanced-only: RRF damping constant
  semanticCacheMaxEntries: 1000,  // cap embeddings_cache.json growth; oldest entries are pruned
  // LLM-driven pattern extraction (v5.0 M2). Off by default: enabling it sends
  // de-identified interaction summaries to the host utility model for candidate
  // distillation. Output is ALWAYS a review-only pattern_candidate proposal —
  // never written directly to patterns/facts. See README · 隐私 and docs.
  llmExtractionEnabled: false,
  llmExtractionMinIntervalMinutes: 30,   // rate-limit background extraction ticks
  llmExtractionMinConfidence: 0.72,      // drop extractions below this confidence
  llmExtractionMaxAttempts: 3,           // discard a job after this many failed attempts
  llmExtractionMaxJobsPerRun: 5,         // jobs consumed per worker tick
  llmExtractionTimeoutMs: 15000,         // per-sample timeout; fail-soft on timeout
  // M3-lite background scheduling. Enabled by default but auto-downgrades to
  // the legacy opportunistic path when the Hanako task:* bus protocol is absent.
  backgroundTasksEnabled: true,
  backgroundAdvisorIntervalMinutes: 360,
  backgroundRetentionIntervalMinutes: 1440,
  backgroundLlmExtractionIntervalMinutes: 30,
  // Feedback signals (v5.1 M5). Records memory injected/revoked/closed events to
  // the local append-only event-log so a future adaptive layer (v5.2+) could
  // learn from real outcomes. Instrumentation ONLY: no thresholds change, no
  // current decision consumes it. Purely local, no external send — on by default
  // so the signal data accumulates; can be disabled.
  feedbackSignalsEnabled: true,
  // Adaptive thresholds (v5.1 M5d). EXPERIMENTAL, OFF by default. When enabled,
  // lib/adaptive-thresholds.js may compute a single, clamped, recommendation-only
  // adjustment to minInjectScore from feedback outcomes. It NEVER auto-applies and
  // is consumed by no current runtime decision (no search/inject/advisor hot path
  // reads it). Conservative governance disables it entirely. See docs.
  adaptiveThresholdsEnabled: false,
};

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const DEEP_MERGE_CONFIG_KEYS = new Set(["autoActions", "autoActionCommands"]);

export function mergeConfig(...configs) {
  const merged = { ...DEFAULT_CONFIG };
  for (const config of configs) {
    if (!isPlainObject(config)) continue;
    for (const [key, value] of Object.entries(config)) {
      if (DEEP_MERGE_CONFIG_KEYS.has(key) && isPlainObject(value)) {
        const base = isPlainObject(merged[key]) ? merged[key] : {};
        merged[key] = { ...base, ...value };
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}

// Credential keys are sourced from the encrypted credentials store, never from
// the host settings panel (which only ever holds a blank or placeholder for
// them). They are excluded from the panel→runtime bridge below.
const CREDENTIAL_CONFIG_KEYS = new Set(["modelAdvisorApiKey", "semanticEmbeddingApiKey"]);

/**
 * Bridge the host settings panel (Hanako `ctx.config`) into the runtime config.
 *
 * The plugin persists its runtime config in DATA_DIR/config.json, but the
 * settings panel writes user toggles into the host's own config object
 * (`ctx.config`). Without this bridge those panel changes never reach the
 * runtime — e.g. enabling `modelAdvisorEnabled` in the panel left the model
 * advisor reading the on-disk default `false` and silently staying "disabled".
 *
 * Semantics: the panel is the source of truth for every setting it exposes.
 * For each key the panel provides that the runtime knows about (present in
 * DEFAULT_CONFIG), the panel value overrides whatever is in config.json — in
 * both directions, so toggling a setting off takes effect too. Keys the panel
 * does not expose (advanced retrieval tuning, nested autoActions, etc.) are
 * left to config.json / `self_learning_control set_config`. Credential keys are
 * never sourced from the panel.
 *
 * @param {object} fileConfig  config already loaded+merged from config.json
 * @param {object|null} panelConfig  host `ctx.config` (may carry update/set fns)
 * @returns {object} a new merged config
 */
export function applyPanelConfig(fileConfig = {}, panelConfig = null) {
  if (!panelConfig) return mergeConfig(fileConfig);
  // v0.341+: ctx.config is a method-based store; extract values via getAll().
  // Older hosts pass a plain object; iterate its keys directly.
  const panelValues = typeof panelConfig.getAll === "function"
    ? panelConfig.getAll() || {}
    : panelConfig;
  if (!isPlainObject(panelValues)) return mergeConfig(fileConfig);
  const overrides = {};
  for (const key of Object.keys(panelValues)) {
    if (CREDENTIAL_CONFIG_KEYS.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) continue;
    const value = panelValues[key];
    if (value === undefined || typeof value === "function") continue;
    if (DEEP_MERGE_CONFIG_KEYS.has(key) && !isPlainObject(value)) continue;
    overrides[key] = value;
  }
  return mergeConfig(fileConfig, overrides);
}
