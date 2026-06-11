# Acceptance Report · v4.0.7 LTS

## Version information

Before:

1. package version: `4.0.6-lts`
2. npm test: `458 passed`
3. npm run check: passed

After:

1. package version: `4.0.7-lts`
2. npm test: `462 passed`
3. npm run check: passed

## Goal

Add guarded Agent Controller resume tooling so a task paused for human approval can be inspected, approved, rejected, cancelled, and resumed through stable APIs and the `self_learning_control` tool.

This version does not expand automatic execution. It only makes the existing human-in-the-loop boundary operational.

## New capabilities

- Agent Controller runs persist task state under `agent_tasks/`.
- Agent task summaries can be listed and filtered by state.
- Full agent task bundles can be inspected with state, summary, and audit trace.
- Pending approval requests can be approved, rejected, or cancelled.
- Approved tasks resume from the graph node after the approved interruption point.
- Rejected tasks transition to `failed`.
- Cancelled tasks transition to `cancelled`.
- Approval, rejection, cancellation, and resumed completion are recorded in the audit trace.
- `self_learning_control` exposes list/show/approve/reject/cancel/resume actions for agent tasks.

## New files

```text
lib/agent-task-store.js
lib/agent-resume.js
tests/agent-resume.test.js
docs/ACCEPTANCE-v4.0.7-LTS.md
```

## Modified files

```text
lib/agent-controller.js
tools/control.js
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## Safety boundaries

This version keeps the existing LTS boundary:

```text
R4 never auto-executes.
Approval does not bypass scope, executor, verifier, rollback, or audit trace.
A paused task cannot resume while a pending approval remains unresolved.
Rejected tasks become failed.
Cancelled tasks become terminal.
Resume tooling does not grant plugin code execution.
```

## Verification

Validated commands:

```bash
npm run check
npm test
npm pack --dry-run
```

Expected result:

```text
npm run check: passed
npm test: 462 passed, 0 failed
npm pack --dry-run: passed
```

## Known limitations

- Resume tooling is functional, but repair/rollback branches are still minimal in the Agent Controller graph.
- The control tool can operate persisted agent tasks, but there is no dedicated dashboard UI yet.
- Action Registry integration into Agent Controller execution remains shallow.
- Cross-project transfer candidates still need a persistent registry.

## Next recommendation

Prioritize a persistent Cross-project Transfer Registry or Benchmark Scenario Corpus. Both would make the current runtime learner more measurable and safer to evolve.
