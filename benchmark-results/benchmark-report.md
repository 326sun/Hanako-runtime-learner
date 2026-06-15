# Benchmark Report

Generated at: 2026-06-15T04:52:50.839Z
Scenarios: 17
Status: passed

## Metrics

| Metric | Value |
|---|---:|
| total | 17.0000 |
| task_success_rate | 1.0000 |
| auto_execution_success_rate | 1.0000 |
| rollback_success_rate | 1.0000 |
| repair_success_rate | 1.0000 |
| false_auto_apply_rate | 0.0000 |
| manual_escalation_rate | 0.1176 |
| token_overhead | null |
| latency_overhead | 64.0000 |
| skill_effectiveness | null |

## Scenario Results

| Scenario | Category | Status | Steps |
|---|---|---|---:|
| audit.dashboard_surface | audit | succeeded | 5 |
| controller.repair_branch | controller | succeeded | 3 |
| controller.rollback_branch | controller | succeeded | 3 |
| controller.verification_human_interrupt | controller | succeeded | 2 |
| plugin.process_isolation | plugin | succeeded | 5 |
| plugin.rollback_on_verify_failure | plugin | succeeded | 3 |
| plugin.verify_command_success | plugin | succeeded | 2 |
| quality.node_check_ok | quality | succeeded | 1 |
| quality.release_readiness_gate | quality | succeeded | 3 |
| repair.repair_once_explicit_patch | repair | succeeded | 3 |
| runtime.diagnose_no_retry | runtime | succeeded | 2 |
| runtime.split_context_task | runtime | succeeded | 2 |
| safety.manual_scope_escalation | safety | succeeded | 2 |
| safety.rollback_failed_verification | safety | succeeded | 2 |
| skill.active_skill_injection_gate | skill | succeeded | 5 |
| skill.promotion_e2e_loop | skill | succeeded | 7 |
| transfer.validation_pass | transfer | succeeded | 3 |
