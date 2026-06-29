// Governance policy profiles for Runtime Self-Learning.
//
// A profile governs ONLY the review/apply posture — how aggressively the runtime
// auto-injects / auto-approves and whether it requires review — plus the
// proposalChatNotifications flavour that distinguishes autonomous from balanced.
//
// Deliberately NOT in any profile: the safety gate (includePendingPreferences)
// and every capability / privacy toggle (modelAdvisorEnabled, semanticSearchEnabled,
// llmExtractionEnabled, includeUsageInAdvisorPrompt, workStatusEnabled). Those are
// user-owned, set only via the settings panel / set_config, and orthogonal to the
// governance posture. If a profile dictated them, switching to "autonomous" would
// silently re-enable an opt-in the user turned off, and doctor's policy_inconsistent
// check (which derives its expectations from profile.values) would nag to flip a
// user's explicit capability/privacy choice back. Do not add them here.

export const POLICY_PROFILES = {
  conservative: {
    name: "conservative",
    label: "Conservative / review-first",
    description: "Prefer explicit review. Pending memories stay local; low-risk auto-apply proposals must be reviewed before apply.",
    values: {
      governanceProfile: "conservative",
      autoInjectHighConfidence: false,
      autoApproveHighConfidence: false,
      requireReviewForAutoApply: true,
      proposalChatNotificationsEnabled: false,
    },
  },
  balanced: {
    name: "balanced",
    label: "Balanced / default",
    description: "Keep the original low-friction local workflow: high-confidence non-preference patterns can auto-approve and low-risk skill refreshes can auto-apply.",
    values: {
      governanceProfile: "balanced",
      autoInjectHighConfidence: true,
      autoApproveHighConfidence: true,
      requireReviewForAutoApply: false,
      proposalChatNotificationsEnabled: false,
    },
  },
  autonomous: {
    name: "autonomous",
    label: "Autonomous / single-user fast path",
    description: "More aggressive local learning for trusted single-user setups. External model/embedding features still remain off unless explicitly configured.",
    values: {
      governanceProfile: "autonomous",
      autoInjectHighConfidence: true,
      autoApproveHighConfidence: true,
      requireReviewForAutoApply: false,
      proposalChatNotificationsEnabled: true,
    },
  },
};

export function listPolicyProfiles() {
  return Object.values(POLICY_PROFILES).map((profile) => ({
    name: profile.name,
    label: profile.label,
    description: profile.description,
    values: profile.values,
  }));
}

export function applyPolicyProfile(config = {}, profileName = "balanced") {
  const key = String(profileName || "balanced").trim().toLowerCase();
  const profile = POLICY_PROFILES[key];
  if (!profile) {
    return {
      ok: false,
      error: `unknown governance profile: ${profileName}`,
      available: Object.keys(POLICY_PROFILES),
    };
  }

  const before = { ...config };
  const next = { ...config, ...profile.values };
  const changed = {};
  for (const [k, v] of Object.entries(profile.values)) {
    if (before[k] !== v) changed[k] = { from: before[k], to: v };
  }
  return { ok: true, profile: profile.name, label: profile.label, config: next, changed };
}
