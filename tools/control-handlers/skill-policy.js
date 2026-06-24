// Skill-promotion & policy read-only control handlers (C-001 HANDLERS split pilot).
//
// Extracted verbatim from tools/control.js. These are pure read handlers: they
// take (input, p, config), read from p.learnerDir, and return a JSON string.
// They own NO permission/side-effect decisions — control.js keeps the action
// dispatch, the *_ACTIONS classification sets, describeControlSideEffect and
// sessionPermission. This module only implements the handler bodies and is
// spread back into the control HANDLERS table under the same action names.

import { loadActiveSkills, loadSkillCandidates } from "../../lib/skill-promotion-loop.js";
import { listPolicyProfiles } from "../../lib/policy-profiles.js";

export const skillPolicyHandlers = {
  list_skill_candidates(input, p) {
    const store = loadSkillCandidates(p.learnerDir);
    const candidates = store.candidates.slice(0, input.limit || 50).map((c) => ({ id: c.id, status: c.status, rule: c.rule, evidence: c.evidence, scope: c.scope, updatedAt: c.updatedAt }));
    return JSON.stringify({ ok: true, candidates, nextAction: "run_skill_promotion_loop or list_active_skills" }, null, 2);
  },

  list_active_skills(input, p) {
    const registry = loadActiveSkills(p.learnerDir);
    return JSON.stringify({ ok: true, skills: registry.skills.slice(0, input.limit || 50), nextAction: "export_audit_bundle" }, null, 2);
  },

  list_policy_profiles(input, p, config) {
    return JSON.stringify({ ok: true, profiles: listPolicyProfiles(), current: config.governanceProfile || "balanced" }, null, 2);
  },
};
