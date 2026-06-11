# Acceptance Report · v4.0.11 LTS

## Version information

Before:

1. package version: `4.0.10-lts`
2. npm test: `477 passed`
3. npm run check: passed
4. npm run benchmark: passed, 5 scenarios

After:

1. package version: `4.0.11-lts`
2. npm test: `479 passed`
3. npm run check: passed
4. npm run benchmark: passed, 5 scenarios

## Version goal

Close the most important `Action Marketplace` execution gap left in v4.0.10: package-backed plugin actions no longer stop at result-envelope verification. When explicitly permitted, they can now execute `verify.js`, declared verification commands, and `rollback.js` through guarded registry runtime paths.

## Added capability

- `executeRegisteredAction()` now runs package `verify.js` after `execute.js` when plugin code execution is explicitly allowed.
- Declared `verification.commands` now run through `runSandboxedCommand()` with a command allowlist built from the action definition.
- Verification results are merged into a structured check list that includes output status, verify-module status, and verification-command status.
- Failed verification on rollback-required plugin actions now calls package `rollback.js` and returns `reverted` only when rollback succeeds.
- Execution exceptions on rollback-required plugin actions also attempt rollback.
- File-backed plugin execution, verification, and rollback still require explicit `allowPluginCodeExecution`.

## Added files

```text
docs/ACCEPTANCE-v4.0.11-LTS.md
```

## Modified files

```text
lib/action-registry.js
tests/action-registry.test.js
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## Added tests

Added two regression cases to `tests/action-registry.test.js`:

```text
package actions execute verify.js and declared verification commands
package verification failure triggers guarded rollback.js
```

## Safety boundary

No high-risk automation boundary was expanded.

Plugin package code still cannot run unless the caller explicitly sets:

```text
allowPluginCodeExecution: true
```

Plugin actions still cannot:

```text
override core action names
request network permission
request external side effects
bypass policy / scope / verifier / rollback / sandbox
mark R3/R4 actions as autoExecutable
declare unsafe commands such as rm, git push, git tag, npm publish, curl, or wget
```

## Automatic execution boundary

Automatic execution remains limited to registered actions that satisfy all of the following:

```text
action definition validates
action risk is below R3
action is marked autoExecutable
verification.required is true
file-backed plugin code execution is explicitly allowed when module code is involved
```

Verification commands are allowed only when declared by the plugin action definition and accepted by the command allowlist.

## Failure rollback verification

Rollback behavior is now covered for plugin actions:

```text
execute.js writes a workspace file
verify.js returns failed
rollback.js is invoked
the final action status becomes reverted
the workspace file reflects the rollback result
```

This closes the v4.0.10 limitation where registry verification was only result-envelope level.

## Known limitations

- Plugin module code is still trusted once explicitly allowed; this version does not add process isolation for arbitrary plugin JavaScript.
- Rollback commands are not yet modeled separately from `rollback.js`.
- Benchmark corpus still lacks plugin-action scenarios; plugin verify/rollback is currently covered by unit tests.
- Controller repair/rollback branches can still be richer for multi-node failure recovery.

## Next version recommendation

Expand the benchmark corpus with plugin-action scenarios and false-auto-apply cases. The next highest-value gap is proving registry-integrated plugin actions under benchmark/evaluation, not just unit tests.
