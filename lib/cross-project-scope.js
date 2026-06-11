const UNSAFE_RULE_PATTERNS = [
  /\bunsafe\b/i,
  /\bbypass(?:es|ing)?\b/i,
  /\bskip(?:s|ping)?\s+(?:verifier|verification|policy|safety)\b/i,
  /\bdisable(?:s|d)?\s+(?:verifier|verification|policy|safety)\b/i,
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function hasRequiredTransferGuards(candidate = {}) {
  const transfer = candidate.transfer || {};
  return transfer.requiresRevalidation === true && transfer.cannotWriteSkillDirectly === true && transfer.cannotAutoPromote === true;
}

function hasValidationCommands(candidate = {}) {
  return asArray(candidate.validation?.commands).some((command) => String(command || "").trim());
}

export function validateCrossProjectCandidate(candidate = {}, options = {}) {
  const violations = [];
  const rule = String(candidate.rule || "");
  const targetProfile = options.targetProfile || {};

  if (!candidate.id) violations.push("candidate id missing");
  if (!candidate.targetProjectId && !targetProfile.projectId) violations.push("target project missing");
  if (!candidate.riskTier) violations.push("risk tier missing");
  if (!hasRequiredTransferGuards(candidate)) {
    violations.push("cross-project transfer must require revalidation, block direct skill writes, and block auto-promotion");
  }
  if (candidate.validation?.required === false || !hasValidationCommands(candidate)) {
    violations.push("target-project validation commands are required before promotion");
  }

  if (UNSAFE_RULE_PATTERNS.some((pattern) => pattern.test(rule))) {
    violations.push("unsafe transfer rule attempts to weaken verifier or safety policy");
  }

  const highRisk = ["R3", "R4"].includes(String(candidate.riskTier || "").toUpperCase());
  const decision = violations.length > 0 ? "reject" : highRisk ? "manual_confirm" : "allow";
  return {
    ok: violations.length === 0,
    allowed: decision === "allow",
    decision,
    risk: highRisk ? "high" : "bounded",
    reason: violations.length ? violations.join("; ") : highRisk ? "high-risk transfer requires manual confirmation" : "cross-project transfer guards satisfied",
    violations: unique(violations),
  };
}
