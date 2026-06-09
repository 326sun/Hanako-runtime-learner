import { DEFAULT_CONFIG, estimateTokens } from "./common.js";

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
};

const ENUM_VALUES = {
  governanceProfile: ["conservative", "balanced", "autonomous"],
  modelAdvisorSource: ["official", "private", "off"],
};

const HIGH_RISK_ENABLES = [
  "modelAdvisorEnabled",
  "semanticSearchEnabled",
  "includePendingPreferences",
  "autoApproveHighConfidence",
];

const CONSERVATIVE_BLOCKS = {
  modelAdvisorEnabled: true,
  semanticSearchEnabled: true,
  includePendingPreferences: true,
  requireReviewForAutoApply: false,
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
  const current = { ...DEFAULT_CONFIG, ...(isPlainObject(currentConfig) ? currentConfig : {}) };
  const next = { ...current, ...configPatch };

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
