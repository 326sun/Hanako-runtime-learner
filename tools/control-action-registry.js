import { normalizeSessionTarget } from "../lib/helpers.js";

const READ_ONLY_ACTIONS = [
  "status", "list", "list_proposals", "show_proposal", "review_panel", "list_reviews",
  "list_events", "event_summary", "verify_event_log", "list_agent_tasks", "show_agent_task",
  "list_transfer_candidates", "show_transfer_candidate", "list_skill_candidates", "list_active_skills",
  "doctor", "list_policy_profiles", "diagnose_bus", "feedback_summary",
  "agent_graph_preview",
];

const FILE_OUTPUT_ACTIONS = [
  "run_benchmarks",
  "export_audit_bundle",
  "generate_audit_dashboard",
  "release_readiness",
];

const REVIEW_QUEUE_ACTIONS = [
  "preview_proposal",
  "validate_proposal",
];

const EXTERNAL_MODEL_ACTIONS = [
  "run_model_advisor",
];

const LOCAL_STATE_MUTATION_ACTIONS = [
  "approve", "reject", "set_config", "rollback", "regenerate_skill", "regenerate_memfs",
  "apply_proposal", "reject_proposal", "approve_review", "reject_review", "apply_review",
  "approve_agent_task", "reject_agent_task", "cancel_agent_task", "resume_agent_task",
  "register_transfer_candidate", "record_transfer_validation", "expire_transfer_candidate",
  "run_skill_promotion_loop", "set_policy_profile", "trust_project_scripts",
];

const CONFIG_REQUIRED_ACTIONS = [
  "list", "approve", "reject", "set_config", "regenerate_skill", "regenerate_memfs",
  "run_model_advisor", "apply_proposal", "preview_proposal", "validate_proposal",
  "resume_agent_task", "run_benchmarks", "export_audit_bundle", "list_policy_profiles",
  "run_skill_promotion_loop", "set_policy_profile", "trust_project_scripts",
];

const PATTERNS_REQUIRED_ACTIONS = [
  "list", "approve", "reject", "set_config", "regenerate_skill", "regenerate_memfs",
  "run_model_advisor", "export_audit_bundle", "set_policy_profile",
];

function register(actions, spec) {
  return actions.map((action) => [action, { ...spec }]);
}

export const CONTROL_ACTIONS = Object.freeze(Object.fromEntries([
  ...register(READ_ONLY_ACTIONS, { sideEffect: "read", needsConfig: false, needsPatterns: false }),
  ...register(FILE_OUTPUT_ACTIONS, { sideEffect: "plugin_output", needsConfig: false, needsPatterns: false }),
  ...register(REVIEW_QUEUE_ACTIONS, { sideEffect: "plugin_state_mutation", needsConfig: false, needsPatterns: false, reviewQueuePreparation: true }),
  ...register(EXTERNAL_MODEL_ACTIONS, { sideEffect: "external_model_or_benchmark_run", needsConfig: false, needsPatterns: false }),
  ...register(LOCAL_STATE_MUTATION_ACTIONS, { sideEffect: "plugin_state_mutation", needsConfig: false, needsPatterns: false }),
].map(([action, spec]) => [
  action,
  {
    ...spec,
    needsConfig: CONFIG_REQUIRED_ACTIONS.includes(action),
    needsPatterns: PATTERNS_REQUIRED_ACTIONS.includes(action),
  },
])));

export function controlNeedsConfig(action) {
  return CONTROL_ACTIONS[action]?.needsConfig === true;
}

export function controlNeedsPatterns(action) {
  return CONTROL_ACTIONS[action]?.needsPatterns === true;
}

export function describeControlSideEffect(input = {}) {
  const action = typeof input.action === "string" ? input.action : "unknown";
  if (action === "diagnose_bus") {
    const target = normalizeSessionTarget(input);
    if (target.sessionId || target.sessionRef || target.sessionPath) {
      return {
        kind: "external_side_effect",
        summary: "Send a diagnostic session:send test message to the target session.",
        ruleId: "runtime-learner-control-diagnose_bus",
      };
    }
  }
  const spec = CONTROL_ACTIONS[action];
  if (spec?.sideEffect === "read") {
    return {
      kind: "read",
      summary: `Read runtime learner state for control action: ${action}.`,
      ruleId: `runtime-learner-control-${action}`,
    };
  }
  if (spec?.sideEffect === "plugin_output") {
    return {
      kind: "plugin_output",
      summary: `Generate runtime learner audit, benchmark, or release-readiness output for action: ${action}.`,
      ruleId: `runtime-learner-control-${action}`,
    };
  }
  if (spec?.reviewQueuePreparation) {
    return {
      kind: "plugin_state_mutation",
      summary: `Update runtime learner review queue or event log while preparing proposal review action: ${action}.`,
      ruleId: `runtime-learner-control-${action}`,
    };
  }
  if (spec?.sideEffect === "external_model_or_benchmark_run") {
    return {
      kind: "external_model_or_benchmark_run",
      summary: `Run runtime learner analysis that may call configured model/network providers: ${action}.`,
      ruleId: `runtime-learner-control-${action}`,
    };
  }
  return {
    kind: spec?.sideEffect === "plugin_state_mutation" ? "plugin_state_mutation" : "external_side_effect",
    summary: `Mutate runtime learner governance, memory, proposals, skills, approvals, configuration, or external state: ${action}.`,
    ruleId: `runtime-learner-control-${action}`,
  };
}
