# Read-only Agent Graph (v5.1 M4a — experimental skeleton)

> **Experimental, inert, and consumed by nothing.** This is a *read-only* agent
> graph skeleton for observing, planning, policy-checking, verifying, and
> summarizing — and producing a **read-only report**. It **never executes**:
> no command runs, no file is written, no config is changed, no memory is
> written, nothing is auto-applied. It is a pure module wired into no runtime
> path. Built within the M4 constraint that M4 stays an experimental read-only
> graph (see [M5_ADAPTIVE_THRESHOLD_GATE.md](M5_ADAPTIVE_THRESHOLD_GATE.md)).

## Module

`lib/agent-graph-readonly.js` exports a pure function
`runReadonlyAgentGraph(input)` plus the node constants. The file imports
**nothing** — no `fs`, no `child_process` — which is asserted by a test, so it is
structurally incapable of writing files or running processes.

## Nodes (the only six allowed)

The graph walks exactly these, in order:

| # | Node | Does | Never does |
|---|---|---|---|
| 1 | **Observe** | snapshots the read-only context (deep clone) | mutate the input |
| 2 | **Plan** | turns declared plan nodes into inspected action descriptors, each stamped `readonly:true` | execute anything |
| 3 | **Policy** | rejects side-effecting / forbidden nodes | apply or bypass |
| 4 | **Verify** | checks plan *structure* and collects risk flags | run the plan |
| 5 | **Learn** | produces a learning *summary* (text + facts) | write memory |
| 6 | **Finalize** | assembles the read-only report | perform side effects |

`READONLY_NODE_ORDER` is exactly `[Observe, Plan, Policy, Verify, Learn,
Finalize]`.

### Forbidden node types

`FORBIDDEN_NODE_TYPES` = `execute`, `repair`, `rollback`, `humanapproval`,
`scope`, `apply` (compared after lowercasing and stripping a trailing `Node`).
The Policy node rejects any planned node whose type normalizes to one of these.

## Rejection rules (Policy node)

A planned node is **rejected** (and the whole run is `status: "rejected"`,
`humanReviewRequired: true`) if any holds:

| Reason code | Trigger |
|---|---|
| `forbidden-node-type:<type>` | node type is Execute / Repair / Rollback / HumanApproval / Scope / Apply |
| `side-effect-forbidden` | node declares `sideEffect: true` |
| `non-readonly` | node declares `readonly: false` |

Rejection is the **only** consequence — nothing is executed either way.
`sideEffects` in the output is **always** `[]`.

## Input / output schema

**Input** (a read-only context summary + a plan to inspect):

```jsonc
{
  "context": { "summary": "…", "config": { … }, "observations": [ … ] },
  "plan": { "nodes": [ { "type": "Plan", "title": "…", "riskTier": "R1",
                          "sideEffect": false, "readonly": true }, … ] }
}
```

**Output** (a plan/report — recommendation/diagnostic only):

```jsonc
{
  "ok": true,
  "status": "completed" | "rejected" | "failed-soft",
  "readonly": true,                       // ALWAYS true
  "nodes": [ { "name": "Observe", "status": "ok" }, … ],  // 6-node trace
  "observations": { … },                  // deep clone of context, never mutated
  "plan": { "nodes": [ { "index", "type", "title",
                         "readonly": true,            // ALWAYS true per action
                         "declaredSideEffect", "declaredReadonly",
                         "riskTier" }, … ] },
  "policy": { "ok": true, "rejected": [ … ], "reasons": [ … ] },
  "verify": { "ok": true, "structureValid": true, "riskFlags": [ … ] },
  "learn":  { "summary": "…", "facts": [ … ] },          // not written anywhere
  "risk":   { "tiers": { "R1": 2 }, "maxTier": "R1", "summary": "…" },
  "humanReviewRequired": false,           // true on any rejection / R3+ risk
  "report": { "readonly": true, "status", "plannedNodeCount",
              "rejectedNodeCount", "risk", "humanReviewRequired",
              "learningSummary", "note" },
  "sideEffects": [],                      // ALWAYS empty
  "errors": []
}
```

## Fail-soft behavior

The graph never throws on bad input:

- **Empty input** (`null`, `undefined`, `{}`, missing `context`) ⇒
  `status: "failed-soft"`, `errors: ["empty-input"]`, `humanReviewRequired: true`.
- **Malformed plan** (`plan` not an object, `plan.nodes` not an array, or items
  that aren't objects) ⇒ `status: "failed-soft"`, `errors: ["malformed-plan"]`,
  `verify.structureValid: false`.

In both cases `readonly: true` and `sideEffects: []` still hold.

## Explicitly NOT done (hard constraints)

- No Execute / Repair / Rollback node ever runs — they are rejected.
- No auto-apply after human approval; `HumanApproval` is a forbidden type.
- No file write, no config change, no shell/process call (structurally — no
  `fs` / `child_process` import).
- No memory write (Learn returns a summary only).
- Not wired into any runtime path; importable pure module / read-only diagnostic.
- No M5 adaptive auto-tuning is consumed; no M1 local embedding is revived.
