// Parameter schema properties extracted from tools/control.js (C-001 phase 3b).
//
// Pure declarative data: the JSON-schema property definitions for the
// self_learning_control tool's input, minus the `action` property. `action`
// stays in control.js because its enum is `Object.keys(HANDLERS)` and must not
// depend on the handler table from here. control.js composes the final schema as:
//   properties: { action: { ... }, ...CONTROL_PARAM_PROPERTIES }
// which preserves the original key order (action first, then these in order).
//
// Field names, descriptions, types, items, enums and defaults are unchanged from
// control.js. No behavior change.

export const CONTROL_PARAM_PROPERTIES = {
  id: { type: "string", description: "Pattern id for approve/reject." },
  proposalId: { type: "string", description: "Proposal id for show/apply/reject proposal actions." },
  taskId: { type: "string", description: "Agent task id for agent task show/approve/reject/resume actions." },
  candidateId: { type: "string", description: "Cross-project transfer candidate id for transfer registry actions." },
  benchmarkId: { type: "string", description: "Optional benchmark scenario id for run_benchmarks." },
  benchmarkOutputDir: { type: "string", description: "Optional output directory for benchmark reports." },
  benchmarkRunsDir: { type: "string", description: "Optional benchmark-runs directory for audit dashboard lookup." },
  benchmarkReportPath: { type: "string", description: "Optional explicit benchmark-report.json path for audit dashboard lookup." },
  releaseOutputDir: { type: "string", description: "Optional output directory for release readiness reports." },
  projectRoot: { type: "string", description: "Optional source checkout root for release/benchmark actions." },
  sourceRoot: { type: "string", description: "Alias of projectRoot for runtime package source checkout resolution." },
  candidate: { type: "object", description: "Cross-project transfer candidate object for register_transfer_candidate." },
  validationStatus: { type: "string", enum: ["passed", "failed"], description: "Target validation status for record_transfer_validation." },
  evidence: { type: "array", items: { type: "string" }, description: "Validation evidence lines for transfer registry actions." },
  requestId: { type: "string", description: "Approval request id for agent task approval actions." },
  reason: { type: "string", description: "Optional reason for proposal rejection." },
  status: { type: "string", description: "Optional proposal status filter: pending, applied, or rejected." },
  format: { type: "string", enum: ["text", "json"], description: "Output format for the doctor action. Default text." },
  governanceProfile: { type: "string", enum: ["conservative", "balanced", "autonomous"], description: "Governance policy profile to apply." },
  limit: { type: "number", description: "Maximum number of events/reviews to return for list actions." },
  sinceDays: { type: "number", description: "Look-back window in days for feedback_summary (read-only). Default 30." },
  autoInjectHighConfidence: { type: "boolean" },
  autoApproveHighConfidence: { type: "boolean" },
  minInjectScore: { type: "number" },
  minInjectCount: { type: "number" },
  decayHalfLifeDays: { type: "number" },
  includePendingPreferences: { type: "boolean" },
  learnFromUsage: { type: "boolean" },
  includeUsageInAdvisorPrompt: { type: "boolean" },
  officialMemoryBridgeEnabled: { type: "boolean" },
  officialMemoryBridgeMaxResults: { type: "number" },
  durableMemoryMaxCount: { type: "number" },
  largeUsageTokenThreshold: { type: "number" },
  officialUtilityModelDisplay: { type: "string" },
  modelAdvisorEnabled: { type: "boolean" },
  modelAdvisorSource: { type: "string", enum: ["official", "private", "off"] },
  modelAdvisorBaseUrl: { type: "string" },
  modelAdvisorApiKey: { type: "string" },
  modelAdvisorModel: { type: "string" },
  modelAdvisorMaxTokens: { type: "number" },
  modelAdvisorMinIntervalMinutes: { type: "number" },
  workStatusEnabled: { type: "boolean" },
  workStatusText: { type: "string" },
  proposalChatNotificationsEnabled: { type: "boolean" },
  requireReviewForAutoApply: { type: "boolean" },
  semanticSearchEnabled: { type: "boolean" },
  semanticEmbeddingBaseUrl: { type: "string" },
  semanticEmbeddingApiKey: { type: "string" },
  semanticEmbeddingModel: { type: "string" },
  semanticCacheMaxEntries: { type: "number" },
};
