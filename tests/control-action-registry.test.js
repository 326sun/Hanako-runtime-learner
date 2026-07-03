import test from "node:test";
import assert from "node:assert/strict";
import { parameters, sessionPermission } from "../tools/control.js";
import { CONTROL_ACTIONS, controlNeedsConfig, controlNeedsPatterns, describeControlSideEffect } from "../tools/control-action-registry.js";

const allActions = parameters.properties.action.enum;

test("control action registry covers every declared control action", () => {
  assert.deepEqual(Object.keys(CONTROL_ACTIONS).sort(), [...allActions].sort());
});

test("control action registry keeps current config and pattern loading classifications", () => {
  const configActions = [
    "list", "approve", "reject", "set_config", "regenerate_skill", "regenerate_memfs",
    "run_model_advisor", "apply_proposal", "preview_proposal", "validate_proposal",
    "resume_agent_task", "run_benchmarks", "export_audit_bundle", "list_policy_profiles",
    "run_skill_promotion_loop", "set_policy_profile", "trust_project_scripts",
  ];
  const patternActions = [
    "list", "approve", "reject", "set_config", "regenerate_skill", "regenerate_memfs",
    "run_model_advisor", "export_audit_bundle", "set_policy_profile",
  ];

  for (const action of allActions) {
    assert.equal(controlNeedsConfig(action), configActions.includes(action), `${action} config loading changed`);
    assert.equal(controlNeedsPatterns(action), patternActions.includes(action), `${action} pattern loading changed`);
  }
});

test("control action registry preserves side-effect classification", () => {
  const expectedKinds = {
    status: "read",
    list: "read",
    feedback_summary: "read",
    agent_graph_preview: "read",
    run_benchmarks: "plugin_output",
    export_audit_bundle: "plugin_output",
    generate_audit_dashboard: "plugin_output",
    release_readiness: "plugin_output",
    preview_proposal: "plugin_state_mutation",
    validate_proposal: "plugin_state_mutation",
    run_model_advisor: "external_model_or_benchmark_run",
    approve: "plugin_state_mutation",
    set_config: "plugin_state_mutation",
    trust_project_scripts: "plugin_state_mutation",
  };

  for (const [action, kind] of Object.entries(expectedKinds)) {
    assert.equal(describeControlSideEffect({ action }).kind, kind, `${action} side-effect kind changed`);
    assert.equal(sessionPermission.describeSideEffect({ action }).kind, kind, `${action} session permission kind changed`);
  }
});

test("diagnose_bus keeps precise dynamic side-effect classification", () => {
  assert.equal(describeControlSideEffect({ action: "diagnose_bus" }).kind, "read");
  assert.equal(describeControlSideEffect({ action: "diagnose_bus", sessionId: "s1" }).kind, "external_side_effect");
  assert.equal(describeControlSideEffect({ action: "diagnose_bus", sessionRef: { id: "r1" } }).kind, "external_side_effect");
  assert.equal(describeControlSideEffect({ action: "diagnose_bus", sessionPath: "/tmp/session.json" }).kind, "external_side_effect");
});
