# Acceptance Report · v4.0.9 LTS

## Version information

Before:

```text
package version: 4.0.8-lts
npm test: 469 passed
npm run check: passed
```

After:

```text
package version: 4.0.9-lts
npm test: 473 passed
npm run check: passed
npm run benchmark: passed
npm pack --dry-run: passed
```

## Version goal

This release closes the largest remaining evaluation gap: the project no longer only has a metrics calculator and runner, but also has a built-in benchmark scenario corpus with fixture isolation, expected safety outcomes, regression thresholds, and report generation.

## New capabilities

1. Built-in benchmark scenarios under `benchmarks/scenarios/`.
2. Scenario validation and corpus loading through `lib/benchmark-corpus.js`.
3. Isolated fixture workspaces for benchmark runs.
4. Expected outcome support for safety scenarios such as rollback and rejection.
5. Baseline and threshold comparison.
6. Markdown and JSON benchmark reports.
7. `npm run benchmark` CLI entrypoint.
8. `self_learning_control` action `run_benchmarks`.

## New files

```text
lib/benchmark-corpus.js
scripts/run-benchmarks.js
benchmarks/baseline-v4.0.9.json
benchmarks/thresholds.json
benchmarks/scenarios/runtime/diagnose-no-retry.json
benchmarks/scenarios/runtime/split-context-task.json
benchmarks/scenarios/quality/node-check-ok.json
benchmarks/scenarios/safety/rollback-failed-verification.json
benchmarks/scenarios/safety/manual-scope-escalation.json
tests/benchmark-corpus.test.js
docs/ACCEPTANCE-v4.0.9-LTS.md
```

## Modified files

```text
lib/evaluation-runner.js
tools/control.js
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## New tests

```text
loads and validates the built-in scenario corpus
rejects malformed scenarios
runs the built-in corpus with thresholds and no regressions
materializes isolated fixture workspaces and removes them by default
```

## Safety boundary

This release does not expand automatic write permissions. Benchmark scenarios run inside temporary fixture workspaces by default. R2 write scenarios still pass through the existing diff preview, scope gate, transaction, verifier, and rollback chain.

## Automatic execution boundary

The benchmark runner can execute only the scenario steps declared in the corpus. Commands are still checked by the existing allowlist and denylist. Dangerous shell syntax, publishing, git push/tag, network mutation, and destructive commands remain blocked.

## Rollback validation

The built-in safety corpus includes `safety.rollback_failed_verification`, which writes invalid JavaScript to a scoped file, fails `node --check`, triggers rollback, and verifies that the original file content is restored.

## Regression validation

The built-in corpus compares current metrics against `benchmarks/baseline-v4.0.9.json` using tolerances from `benchmarks/thresholds.json`. A benchmark run fails if a tracked metric regresses beyond the configured threshold.

## Known limits

1. The corpus is still small and intentionally conservative.
2. It does not yet cover cross-project transfer validation end-to-end.
3. It does not yet benchmark action plugin execution through the Agent Controller.
4. It does not yet produce a dashboard UI; reports are Markdown and JSON.

## Next version recommendation

The next high-value step is deeper Action Registry integration with Agent Controller / Executor paths, so registered actions can participate in the same policy, scope, verification, rollback, and audit flow without bypassing core safety gates.
