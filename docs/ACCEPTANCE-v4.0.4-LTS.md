# Acceptance Report · v4.0.4 LTS

## Version information

Before:

1. package version: `4.0.3-lts`
2. npm test: `434 passed, 0 failed`
3. npm run check: passed

After:

1. package version: `4.0.4-lts`
2. npm test: `439 passed, 0 failed`
3. npm run check: passed

## Version goal

Add a functional Agent Controller baseline without changing the core safety boundary.

This version turns the existing task-decomposition modules into a more explicit runtime control skeleton:

```text
ObserveNode
→ PlanNode
→ PolicyNode
→ ScopeNode
→ ExecuteNode
→ VerifyNode
→ FeedbackNode
→ LearnNode
→ FinalizeNode
```

## New capabilities

1. Explicit task graph creation and validation.
2. Serializable agent state machine.
3. Guarded state transitions.
4. Controller runner that can step through task graph nodes.
5. Structured human-interrupt requests.
6. Node-level audit trace recording.
7. Audit trace persistence under the learner directory.

## New files

```text
lib/task-graph.js
lib/agent-state-machine.js
lib/agent-controller.js
lib/human-interrupt.js
lib/audit-trace.js
tests/agent-controller.test.js
docs/ACCEPTANCE-v4.0.4-LTS.md
```

## Modified files

```text
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## New tests

```text
task graph validates linear runtime controller nodes
agent state machine serializes and rejects illegal transitions
agent controller runs a safe graph to completion and writes audit trace
agent controller pauses for human approval on R4 action plan
custom handler pauses on verification failure
```

## Safety boundary

No high-risk boundary was relaxed.

The new controller is conservative:

```text
R3/R4 risk → human approval
manual scope decision → human approval
verification failure → human approval
conflicting results → human approval
external side effect → human approval
budget overflow → human approval
```

## Automatic execution boundary

This version does not introduce unbounded autonomous execution.

The controller only delegates executable work through existing governed primitives:

```text
classifyActionRisk
previewAndGate
executeActionPlan
```

## Rollback verification

This version does not replace the existing transaction/rollback layer. R2 write actions still rely on the existing action executor and action transaction modules.

## Known limitations

1. Agent Controller is a functional baseline, not a full production-grade controller.
2. Repair and rollback are still primarily handled inside `executeActionPlan`, not as rich graph branches.
3. Resuming a human-approved task is supported at state/request level, but not yet exposed through CLI/tooling.
4. Cross-project memory transfer and action registry are still missing.
5. Dashboard remains audit JSON/report level, not a UI.

## Next version suggestion

The next high-value version should implement one of these two gaps:

1. `Cross-project Memory Transfer`: project profile, confidence reduction, revalidation.
2. `Action Registry`: plugin-like action registration without weakening core policy.
