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
