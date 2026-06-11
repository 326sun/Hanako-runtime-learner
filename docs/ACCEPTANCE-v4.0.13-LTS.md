# Acceptance Report · v4.0.13 LTS

## Version information

Before:

1. package version: `4.0.12-lts`
2. npm test: `481 passed`
3. npm run check: passed
4. npm run benchmark: passed, 10 scenarios

After:

1. package version: `4.0.13-lts`
2. npm test: `483 passed`
3. npm run check: passed
4. npm run benchmark: passed, 11 scenarios

## Version goal

Harden plugin action execution by moving explicitly approved package-backed plugin JavaScript out of the host Node process and into a controlled child process envelope.

v4.0.13 does not expand the automation boundary. It only changes where already-approved plugin `execute.js`, `verify.js`, and `rollback.js` run.

## Added capability

- Added `lib/plugin-process-runner.js` as the parent-side isolation runner.
- Added `lib/plugin-process-runner-child.js` as the child-process module invoker.
- Package-backed plugin `execute.js` now runs in a child Node process when `allowPluginCodeExecution: true` is explicitly present.
- Package-backed plugin `verify.js` now runs in a child Node process.
- Package-backed plugin `rollback.js` now runs in a child Node process.
- Child plugin processes use the declared workspace root as `cwd`.
- Child plugin processes receive a sanitized environment rather than the full host environment.
- Child plugin processes are killed on timeout.
- Child plugin stdout/stderr are captured with byte limits and truncation detection.
- Plugin process metadata is propagated through registry execution and `executeActionPlan()`.
- Benchmark corpus now includes `plugin.process_isolation`.

## Added files

```text
lib/plugin-process-runner.js
lib/plugin-process-runner-child.js
benchmarks/scenarios/plugin/plugin-process-isolation.json
docs/ACCEPTANCE-v4.0.13-LTS.md
```

## Modified files

```text
lib/action-registry.js
lib/action-executor.js
tests/action-registry.test.js
benchmarks/scenarios/plugin/plugin-process-isolation.json
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## Added tests

Added two tests to `tests/action-registry.test.js`:

```text
isolates package action modules in child processes with sanitized env and workspace cwd
kills package action modules that exceed the plugin isolation timeout
```

The built-in benchmark corpus now covers 11 scenarios:

```text
controller.verification_human_interrupt
plugin.process_isolation
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

Plugin JavaScript still requires explicit:

```text
allowPluginCodeExecution: true
```

The new child-process envelope enforces:

```text
separate Node process
workspace cwd
sanitized env
timeout kill
stdout/stderr byte caps
structured result envelope
```

It still does not claim full OS/container isolation. A plugin that is explicitly allowed to run JavaScript remains trusted code, but it no longer executes inside the host runtime process.

## Automatic execution boundary

Automatic execution remains limited to low/medium-risk actions that pass registry validation, risk gates, verification requirements, rollback requirements, and explicit plugin-code approval.

R3/R4 plugin actions still cannot be auto-executed.

## Failure rollback verification

v4.0.13 keeps the v4.0.12 plugin rollback behavior and moves rollback execution into the child-process boundary:

```text
execute.js succeeds
verify.js fails
rollback.js runs in child process
result returns reverted only when rollback succeeds
```

## Benchmark result

```text
npm run benchmark: passed
Scenarios: 11
Benchmark status: passed

task_success_rate: 1.0
auto_execution_success_rate: 1.0
rollback_success_rate: 1.0
repair_success_rate: 1.0
false_auto_apply_rate: 0.0
manual_escalation_rate: 0.1818
```

## Known limitations

- This is process isolation, not container isolation.
- JavaScript filesystem access cannot be fully restricted by Node child-process `cwd` alone.
- Plugin validation still relies on explicit approval and registry policy before code execution.
- Controller repair/rollback branches are still mostly executor-backed rather than fully explicit graph branches.
- Skill promotion is still a functional baseline, not a complete end-to-end autonomous learning loop.

## Next version recommendation

Implement Agent Controller Repair/Rollback Branches. Now that plugin JavaScript is isolated from the host process, the next highest-value gap is making controller failure recovery explicit in the task graph rather than depending mainly on executor-level repair/rollback behavior.
