# Acceptance Report · v4.0.10 LTS

## Version information

Before:

1. package version: `4.0.9-lts`
2. npm test: `473 passed`
3. npm run check: passed
4. npm run benchmark: passed, 5 scenarios

After:

1. package version: `4.0.10-lts`
2. npm test: `477 passed`
3. npm run check: passed
4. npm run benchmark: passed, 5 scenarios

## Version goal

Wire the Action Registry into the Agent Controller and Action Executor runtime paths so registered non-core actions are no longer a side-channel capability. They are now resolved, policy-checked, executed, verified at the result-envelope level, and paused for human approval through the same controller loop used by core actions.

## Added capability

- Runtime action registry resolution via `lib/action-registry-runtime.js`.
- `executeActionPlan()` can route registered non-core actions through the registry instead of returning `unsupported executable action type`.
- `AgentController.PolicyNode` uses registry metadata for registered non-core action policy decisions.
- `AgentController.ExecuteNode` executes registered non-core actions through the registry path.
- File-backed plugin action execution remains blocked unless `allowPluginCodeExecution: true` is explicitly provided in context.
- Non-auto-executable or high-risk registered actions pause as human approvals instead of bypassing policy gates.

## Added files

```text
lib/action-registry-runtime.js
tests/action-registry-runtime.test.js
docs/ACCEPTANCE-v4.0.10-LTS.md
```

## Modified files

```text
lib/action-executor.js
lib/action-registry.js
lib/agent-controller.js
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## Added tests

```text
tests/action-registry-runtime.test.js
```

Covered cases:

```text
executor routes non-core registered actions through runtime registry
executor queues registered actions that are not autoExecutable
agent controller executes registered plugin actions through ExecuteNode
agent controller pauses before executing plugin package code without explicit allow flag
```

## Safety boundary

No high-risk automation boundary was expanded.

Plugin actions still cannot:

```text
override core action names
bypass policy / scope / verifier / rollback / sandbox
request network permission
request external side effects
auto-execute R3/R4 actions
run file-backed plugin code without explicit allowPluginCodeExecution
```

## Automatic execution boundary

Auto-execution is allowed only when all of the following hold:

```text
action is registered
action definition validates
action risk is below R3
action is marked autoExecutable
action requires verification
plugin code execution is either in-memory handler or explicitly allowed
```

Otherwise the action is rejected or paused for human approval.

## Failure rollback verification

This version does not add a new write-capable plugin rollback implementation. Existing R2 core writes still use the existing transaction/rollback path. Registered write-capable plugins are still required to declare rollback and are not allowed to bypass safety gates.

## Known limitations

- Registry verification is still result-envelope level for in-memory handlers; full `verify.js` execution and command-backed plugin verification should be expanded in a later version.
- Registry integration is now present in Controller and Executor, but benchmark coverage still needs plugin-action scenarios.
- File-backed plugin execution remains intentionally conservative.

## Next version recommendation

Add a `Transfer Validation Runner` or expand `Benchmark Corpus` with plugin-action and Agent Controller end-to-end scenarios. The most valuable next validation gap is proving registry-integrated actions through benchmark scenarios, not just unit tests.
