# Acceptance Report · v4.0.12 LTS

## Version information

Before:

1. package version: `4.0.11-lts`
2. npm test: `479 passed`
3. npm run check: passed
4. npm run benchmark: passed, 5 scenarios

After:

1. package version: `4.0.12-lts`
2. npm test: `481 passed`
3. npm run check: passed
4. npm run benchmark: passed, 10 scenarios

## Version goal

Expand the system-level benchmark corpus so the runtime is no longer proven only by unit tests. v4.0.12 adds benchmark coverage for repair-once, plugin verification, plugin rollback, transfer validation, and Agent Controller human-interrupt behavior.

## Added capability

- Added `lib/transfer-validation-runner.js` to execute transferred-memory validation commands inside the target project workspace.
- Transfer validation now records pass/fail evidence through the existing transfer registry and keeps cross-project auto-promotion blocked.
- Benchmark scenarios can now run Agent Controller tasks through `run_agent_controller` steps.
- Benchmark scenarios can now validate transferred memory candidates through `transfer_validate` steps.
- Benchmark contexts support `$WORKSPACE` / `${WORKSPACE}` placeholders for fixture-local action packages and registry paths.
- `assert_last_result` now keeps referring to the most recent non-assertion step, allowing several assertions against one action result.
- Registry-routed plugin action results now preserve `rollback` details when returned through `executeActionPlan()`.

## Added files

```text
lib/transfer-validation-runner.js
tests/transfer-validation-runner.test.js
benchmarks/scenarios/repair/repair-once-explicit-patch.json
benchmarks/scenarios/plugin/plugin-verify-command-success.json
benchmarks/scenarios/plugin/plugin-rollback-on-verify-failure.json
benchmarks/scenarios/transfer/transfer-validation-pass.json
benchmarks/scenarios/controller/controller-verification-human-interrupt.json
docs/ACCEPTANCE-v4.0.12-LTS.md
```

## Modified files

```text
lib/action-executor.js
lib/benchmark-corpus.js
lib/evaluation-runner.js
package.json
package-lock.json
manifest.json
CHANGELOG.md
```

## Added tests

Added two tests to `tests/transfer-validation-runner.test.js`:

```text
transfer validation runner executes target commands and records promotion readiness
transfer validation runner fails closed when candidate weakens safety policy
```

The built-in benchmark corpus now covers 10 scenarios:

```text
controller.verification_human_interrupt
plugin.rollback_on_verify_failure
plugin.verify_command_success
quality.node_check_ok
repair.repair_once_explicit_patch
runtime.diagnose_no_retry
runtime.split_context_task
safety.manual_scope_escalation
safety.rollback_failed_verification
transfer.validation_pass
```

## Safety boundary

No high-risk automation boundary was expanded.

Transfer validation follows these constraints:

```text
transferred memory must require revalidation
transferred memory cannot write SKILL directly
transferred memory cannot auto-promote across projects
unsafe safety-policy weakening text is rejected
validation commands still run through the command allowlist and denylist
```

Plugin benchmark scenarios still require explicit:

```text
allowPluginCodeExecution: true
```

## Automatic execution boundary

Automatic execution remains limited to low/medium-risk actions that pass existing policy, scope, verifier, rollback, and registry validation gates.

Benchmark support does not add a new runtime permission. It only provides system-level evaluation coverage for capabilities that already exist.

## Failure rollback verification

v4.0.12 adds benchmark-level evidence for:

```text
R2 write repaired once after verification failure
R2 write rolled back after failed verification
plugin verify.js failure triggers plugin rollback.js
Agent Controller pauses at waiting_for_human after failed verification rather than continuing silently
```

## Benchmark result

```text
npm run benchmark: passed
Scenarios: 10
Benchmark status: passed

task_success_rate: 1.0
auto_execution_success_rate: 1.0
rollback_success_rate: 1.0
repair_success_rate: 1.0
false_auto_apply_rate: 0.0
manual_escalation_rate: 0.2
```

## Known limitations

- Plugin module code is still trusted once explicitly allowed; process isolation is still the next hardening step.
- Transfer validation now has a runner, but it is still command-based and does not yet generate validation plans automatically from arbitrary target repositories.
- Agent Controller benchmark coverage now includes human interrupt behavior, but repair/rollback branches inside the controller can still be made more explicit.
- Benchmark corpus is stronger than v4.0.11, but still not a full stress-test suite.

## Next version recommendation

Implement Plugin Process Isolation. The next high-value gap is moving explicitly allowed plugin code out of the host Node process into a controlled child process with timeout, cwd, env, stdout/stderr, and result-envelope boundaries.
