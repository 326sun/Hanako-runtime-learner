# Policy API Freeze

Status: frozen for v4.0.17 LTS.

## Purpose

Policy decides whether an action may run automatically, must be escalated to human review, or must be rejected. Policy is the first hard boundary before scope, transaction, execution, verification, repair, rollback, feedback, and learning.

## Risk tiers

| Tier | Meaning | Default automation |
|---|---|---|
| R0 | Pure read / local classification / no side effect | Automatic |
| R1 | Low-risk local action, such as diagnosis or allowed checks | Automatic |
| R2 | Bounded write or repair with transaction, verification, rollback | Conditional automatic |
| R3 | Broad write, dependency/config change, ambiguous impact | Human confirmation |
| R4 | External side effect, secret, publish, destructive or irreversible action | Reject / never automatic |

## Frozen decision envelope

```json
{
  "decision": "auto_execute",
  "riskTier": "R1",
  "reason": ["low risk", "verification available"],
  "requiresHuman": false,
  "blocked": false
}
```

Stable decisions:

| Decision | Meaning |
|---|---|
| `auto_execute` | May proceed to scope and execution. |
| `manual_confirm` | Must enter Review Queue or Agent Controller human interrupt. |
| `reject` | Must not execute. |

## Non-negotiable rules

1. R4 never auto-executes.
2. External side effects never auto-execute.
3. Delete, publish, push, tag, release, email/message sending, credentials, payment, and secret modifications never auto-execute.
4. R2 writes require transaction, rollback, verification, and scope gate.
5. Repair is at most once.
6. Retry is at most once unless a future policy explicitly narrows the condition.
7. Learning weights and active skills cannot bypass policy.
8. User-specified stricter governance overrides learned preferences.

## Governance profiles

| Profile | Behavior |
|---|---|
| `conservative` | Prefer review and low automation. Useful when trust is still being established. |
| `balanced` | Default. Allows low-risk automation and guarded R2 actions. |
| `autonomous` | More permissive inside R0-R2 boundaries, still blocks R4 and external side effects. |

## Compatibility promise

v4.0.17 LTS freezes tier semantics, decision names, and non-negotiable rules. Future v4.x changes may tune thresholds, but must not permit R4 automation or policy bypass through learning.
