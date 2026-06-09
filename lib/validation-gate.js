import { DEFAULT_CONFIG } from "./common.js";

function estimateTokens(text) {
  let cjk = 0, other = 0;
  for (const ch of String(text || "")) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0x3040 && cp <= 0x309f) ||
        (cp >= 0x30a0 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 1.8 + other * 0.25);
}

function check(name, pass, message = "") {
  return { name, status: pass ? "pass" : "fail", message };
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
    checks.push(check("config_payload", !!proposal.patch?.config && typeof proposal.patch.config === "object", "config patch missing"));
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
