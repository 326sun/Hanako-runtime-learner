import { DEFAULT_CONFIG, estimateTokens, mergeConfig } from "./common.js";
import { isAllowedActionType, containsDestructiveIntent } from "./action-types.js";
import { classifyActionRisk, requiresTransaction } from "./action-risk.js";
import { ALLOWED_KINDS } from "./llm-extraction-schema.js";

function check(name, pass, message = "") {
  return { name, status: pass ? "pass" : "fail", message };
}

function warn(name, message = "") {
  return { name, status: "warn", message };
}

const NUMERIC_RANGES = {
  minInjectScore: [1, 50],
  minInjectCount: [1, 20],
  decayHalfLifeDays: [1, 365],
  durableMemoryMaxCount: [1, 500],
  largeUsageTokenThreshold: [1000, 1000000],
  modelAdvisorMaxTokens: [100, 4000],
  modelAdvisorMinIntervalMinutes: [1, 1440],
  maxSkillTokens: [200, 4000],
  retrievalCandidateLimit: [1, 200],
  minRetrievalRelative: [0, 1],
  crossTaskPenalty: [0, 10],
  minRetrievalConfidence: [0, 1],
  semanticTopK: [1, 200],
  rrfK: [1, 200],
  semanticCacheMaxEntries: [0, 10000],
  llmExtractionMinIntervalMinutes: [1, 1440],
  llmExtractionMinConfidence: [0, 1],
  llmExtractionMaxAttempts: [1, 10],
  llmExtractionMaxJobsPerRun: [1, 100],
  llmExtractionTimeoutMs: [1000, 120000],
};

const NESTED_NUMERIC_RANGES = {
  autoActions: {
    minConfidence: [0, 1],
    maxAutoActionsPerTurn: [1, 100],
    maxAutoActionsPerSession: [1, 1000],
    maxRepairAttempts: [0, 10],
    maxRetryPerToolCall: [0, 10],
    maxExecutionMsPerAction: [100, 600000],
    maxExecutionMsPerTurn: [100, 1800000],
    maxChangedFilesPerAction: [1, 200],
    maxCompactedChars: [100, 50000],
  },
};

const ENUM_VALUES = {
  governanceProfile: ["conservative", "balanced", "autonomous"],
  modelAdvisorSource: ["official", "private", "off"],
};

const NESTED_ENUM_VALUES = {
  autoActions: {
    maxAutoRiskTier: ["R1", "R2", "R3", "R4"],
  },
};

const HIGH_RISK_ENABLES = [
  "modelAdvisorEnabled",
  "semanticSearchEnabled",
  "includePendingPreferences",
  "includeUsageInAdvisorPrompt",
  "autoApproveHighConfidence",
  "llmExtractionEnabled",
];

const CONSERVATIVE_BLOCKS = {
  modelAdvisorEnabled: true,
  semanticSearchEnabled: true,
  includePendingPreferences: true,
  includeUsageInAdvisorPrompt: true,
  requireReviewForAutoApply: false,
  llmExtractionEnabled: true,
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateNestedConfigObject(checks, key, value) {
  if (!isPlainObject(value)) {
    checks.push(check(`config_object:${key}`, false, `${key} must be an object`));
    return;
  }
  checks.push(check(`config_object:${key}`, true));

  const defaults = DEFAULT_CONFIG[key] || {};
  const allowedExtra = key === "autoActionCommands" ? new Set(["projectScripts"]) : new Set();
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    const fullKey = `${key}.${nestedKey}`;
    if (!hasOwn(defaults, nestedKey)) {
      if (allowedExtra.has(nestedKey) && isPlainObject(nestedValue)) {
        checks.push(check(`config_nested:${fullKey}`, true));
        // projectScripts trust entries should be set via the dedicated
        // trust_project_scripts control action, not a generic config_patch.
        // A config_patch that injects a scriptsHash could bypass audit.
        if (nestedKey === "projectScripts") {
          checks.push(warn(`config_high_risk:${fullKey}`, `projectScripts should be set via trust_project_scripts, not config_patch`));
        }
      } else {
        checks.push(check(`config_nested:${fullKey}`, false, `unknown nested config key: ${fullKey}`));
      }
      continue;
    }

    const defaultValue = defaults[nestedKey];
    if (Array.isArray(defaultValue)) {
      const isArray = Array.isArray(nestedValue);
      const hasValidItems = isArray && nestedValue.every((item) => typeof item === "string" && item.trim());
      // denylist must not be empty — an empty array silently drops all default
      // and user-configured deny patterns, which is a defense downgrade even
      // though deniedByBuiltinPattern still provides a hard floor.
      if (fullKey === "autoActionCommands.denylist") {
        const ok = isArray && hasValidItems && nestedValue.length > 0;
        checks.push(check(`config_nonempty:${fullKey}`, ok, `${fullKey} must be a non-empty array of non-empty strings`));
      } else {
        const ok = isArray && hasValidItems;
        checks.push(check(`config_type:${fullKey}`, ok, `${fullKey} must be an array of non-empty strings`));
      }
      continue;
    }

    const expectedType = typeof defaultValue;
    const actualType = typeof nestedValue;
    checks.push(check(`config_type:${fullKey}`, actualType === expectedType, `expected ${expectedType}, got ${actualType}`));
    if (actualType !== expectedType) continue;

    if (expectedType === "number") {
      const finite = Number.isFinite(nestedValue);
      checks.push(check(`config_number:${fullKey}`, finite, `number must be finite: ${fullKey}`));
      if (!finite) continue;
      const range = NESTED_NUMERIC_RANGES[key]?.[nestedKey];
      if (range) {
        const [min, max] = range;
        checks.push(check(`config_range:${fullKey}`, nestedValue >= min && nestedValue <= max, `${fullKey} must be between ${min} and ${max}`));
      }
    }

    const enumValues = NESTED_ENUM_VALUES[key]?.[nestedKey];
    if (enumValues) {
      checks.push(check(`config_enum:${fullKey}`, enumValues.includes(nestedValue), `${fullKey} must be one of: ${enumValues.join(", ")}`));
    }
  }
}

export function validateConfigPatch(configPatch, currentConfig = DEFAULT_CONFIG) {
  const checks = [];
  if (!isPlainObject(configPatch)) {
    checks.push(check("config_payload", false, "config patch missing"));
    return {
      ok: false,
      blocking: true,
      checks,
    };
  }

  checks.push(check("config_payload", true));
  const current = mergeConfig(currentConfig);
  const next = mergeConfig(current, configPatch);

  for (const [key, value] of Object.entries(configPatch)) {
    if (!hasOwn(DEFAULT_CONFIG, key)) {
      checks.push(check(`config_key:${key}`, false, `unknown config key: ${key}`));
      continue;
    }

    const expectedType = typeof DEFAULT_CONFIG[key];
    const actualType = typeof value;
    checks.push(check(`config_type:${key}`, actualType === expectedType, `expected ${expectedType}, got ${actualType}`));
    if (actualType !== expectedType) continue;

    if (expectedType === "number") {
      const finite = Number.isFinite(value);
      checks.push(check(`config_number:${key}`, finite, `number must be finite: ${key}`));
      if (!finite) continue;
      if (NUMERIC_RANGES[key]) {
        const [min, max] = NUMERIC_RANGES[key];
        checks.push(check(`config_range:${key}`, value >= min && value <= max, `${key} must be between ${min} and ${max}`));
      }
    }

    if (ENUM_VALUES[key]) {
      checks.push(check(`config_enum:${key}`, ENUM_VALUES[key].includes(value), `${key} must be one of: ${ENUM_VALUES[key].join(", ")}`));
    }

    if (expectedType === "object" && (key === "autoActions" || key === "autoActionCommands")) {
      validateNestedConfigObject(checks, key, value);
    }
  }

  for (const key of HIGH_RISK_ENABLES) {
    if (hasOwn(configPatch, key) && current[key] === false && next[key] === true) {
      checks.push(warn(`config_high_risk:${key}`, `${key} changes from false to true`));
    }
  }
  if (hasOwn(configPatch, "requireReviewForAutoApply") && current.requireReviewForAutoApply === true && next.requireReviewForAutoApply === false) {
    checks.push(warn("config_high_risk:requireReviewForAutoApply", "requireReviewForAutoApply changes from true to false"));
  }

  if (next.governanceProfile === "conservative") {
    for (const [key, blockedValue] of Object.entries(CONSERVATIVE_BLOCKS)) {
      if ((hasOwn(configPatch, key) || hasOwn(configPatch, "governanceProfile")) && next[key] === blockedValue) {
        checks.push(check(`config_conservative:${key}`, false, `conservative profile forbids ${key}=${JSON.stringify(blockedValue)}`));
      }
    }
  }

  const failed = checks.filter((c) => c.status === "fail");
  return {
    ok: failed.length === 0,
    blocking: failed.length > 0,
    checks,
  };
}

function validateActionPlan(proposal = {}, { config = DEFAULT_CONFIG } = {}) {
  const checks = [];
  const actionType = proposal.plan?.actionType || proposal.actionType || "";
  checks.push(check("action_plan_type", proposal.type === "action_plan", "proposal must be action_plan"));
  checks.push(check("action_type_known", isAllowedActionType(actionType), `unsupported actionType: ${actionType}`));
  const steps = proposal.plan?.steps || [];
  checks.push(check("action_steps", Array.isArray(steps) && steps.length > 0, "action_plan requires non-empty plan.steps"));
  const verification = proposal.verification || proposal.plan?.verification;
  checks.push(check("action_verification", !!verification, "action_plan requires verification"));
  const risk = classifyActionRisk(proposal);
  checks.push(...risk.checks.map((c) => ({ name: `action_${c.name}`, status: c.status, message: c.message || "" })));
  if (proposal.autoApply === true && (proposal.risk === "high" || risk.riskTier === "R3" || risk.riskTier === "R4")) {
    checks.push(check("action_high_risk_auto_apply", false, "high/R3/R4 action_plan cannot autoApply"));
  } else {
    checks.push(check("action_high_risk_auto_apply", true));
  }
  if (containsDestructiveIntent(proposal)) checks.push(check("action_destructive_block", false, "destructive action plans are rejected"));
  else checks.push(check("action_destructive_block", true));
  if (requiresTransaction(risk.riskTier, proposal) && config.autoActions?.requireRollbackForWrites !== false) {
    const rollback = proposal.rollbackPlan || proposal.plan?.rollbackPlan || [];
    checks.push(check("action_rollback_plan", Array.isArray(rollback) ? rollback.length > 0 : !!rollback, "R2+ action_plan requires rollback plan"));
  }
  if (actionType === "retry_with_backoff" && proposal.trigger?.type === "non_retryable_tool_error") {
    checks.push(check("action_retryable_source", false, "retry_with_backoff cannot be generated from a non-retryable trigger"));
  }
  const failed = checks.filter((c) => c.status === "fail");
  return { ok: failed.length === 0, blocking: failed.length > 0, checks };
}

// A pattern_candidate is an LLM-distilled review item (v5.0 M2). It validates
// structurally so it queues cleanly for human review, but it is review-only:
// proposals.applyProposal/verifyProposal refuse to auto-apply it, so it can
// never materialize a pattern or memory without explicit human action.
function validatePatternCandidate(proposal = {}) {
  const ev = proposal.evidenceIds;
  return [
    check("candidate_source_llm", proposal.source === "llm", "pattern_candidate must be tagged source:llm"),
    check("candidate_kind", ALLOWED_KINDS.includes(proposal.kind), `unsupported candidate kind: ${proposal.kind}`),
    check(
      "candidate_evidence",
      Array.isArray(ev) && ev.length > 0 && ev.every((id) => typeof id === "string" && id.trim()),
      "pattern_candidate requires non-empty evidenceIds",
    ),
    check("candidate_confidence", Number.isFinite(Number(proposal.confidence)), "pattern_candidate requires a numeric confidence"),
    check("candidate_risk_tier", /^R[0-4]$/.test(String(proposal.suggestedRiskTier || "")), "pattern_candidate requires a valid suggestedRiskTier"),
    check("candidate_review_only", proposal.autoApply !== true, "pattern_candidate must not auto-apply (review-only)"),
  ];
}

export function validateProposal(proposal, { config = DEFAULT_CONFIG, doctorReport = null } = {}) {
  const checks = [];
  if (!proposal?.id) checks.push(check("proposal_id", false, "proposal id missing"));
  else checks.push(check("proposal_id", true));

  if (proposal?.type === "skill_patch") {
    const content = proposal.patch?.content || "";
    checks.push(check("skill_header", content.includes("# Runtime Self-Learning"), "skill content does not look like Runtime Self-Learning SKILL.md"));
    const tokens = estimateTokens(content);
    const budget = Math.max(200, Number(config.maxSkillTokens || DEFAULT_CONFIG.maxSkillTokens) + 300);
    checks.push(check("skill_token_budget", tokens <= budget, `estimated ${tokens} token(s), budget ${budget}`));
    if (proposal.patch?.contentHash) {
      // Hash verification stays in proposals.verifyProposal; this gate only records
      // that a content-hash protected proposal is being validated.
      checks.push(check("content_hash_present", true));
    }
  } else if (proposal?.type === "config_patch") {
    checks.push(...validateConfigPatch(proposal.patch?.config, config).checks);
  } else if (proposal?.type === "code_patch") {
    checks.push(check("manual_code_patch", false, "code_patch requires manual implementation; automatic apply is blocked"));
  } else if (proposal?.type === "action_plan") {
    checks.push(...validateActionPlan(proposal, { config }).checks);
  } else if (proposal?.type === "pattern_candidate") {
    checks.push(...validatePatternCandidate(proposal));
  } else {
    checks.push(check("supported_type", false, `unsupported proposal type: ${proposal?.type}`));
  }

  if (doctorReport?.status === "critical") {
    checks.push(check("doctor_critical", false, "doctor reports Critical; resolve health issues before applying proposals"));
  } else if (doctorReport) {
    checks.push(check("doctor_critical", true));
  }

  const failed = checks.filter((c) => c.status === "fail");
  return {
    ok: failed.length === 0,
    blocking: failed.length > 0,
    proposalId: proposal?.id || null,
    proposalType: proposal?.type || null,
    checks,
  };
}
