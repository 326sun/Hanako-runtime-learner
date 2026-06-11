# ACTION API Freeze

Status: frozen for v4.0.17 LTS.

## Purpose

The Action API is the boundary between planning and execution. An action may be proposed by a planner, approved by policy, checked by scope, executed by the executor or registry, verified, repaired once, rolled back, and written to feedback.

The frozen contract is intentionally narrow: action packages can add behavior, but cannot bypass risk policy, command allowlists, transaction requirements, verification, rollback requirements, or human escalation.

## Action plan envelope

```json
{
  "actionId": "action:example",
  "actionType": "diagnose_error",
  "riskTier": "R1",
  "confidence": 0.9,
  "reason": "why this action is proposed",
  "input": {},
  "rollbackPlan": null,
  "verification": {
    "required": true,
    "commands": []
  },
  "scope": {
    "allowedFiles": [],
    "allowedDirs": [],
    "forbiddenFiles": []
  }
}
```

Required fields:

| Field | Meaning |
|---|---|
| `actionType` | Dispatch key for core or registered action. |
| `riskTier` | R0-R4 risk classification. Missing values are treated conservatively. |
| `input` | Structured input for the action implementation. |
| `verification` | Verification declaration. R2 writes require verification. |
| `rollbackPlan` | Required for write-like R2 actions. |

## Result envelope

```json
{
  "status": "succeeded",
  "actionType": "diagnose_error",
  "riskTier": "R1",
  "output": {},
  "verification": {
    "ok": true,
    "checks": []
  },
  "repair": {
    "attempted": false,
    "ok": false
  },
  "rollback": {
    "attempted": false,
    "ok": false
  },
  "feedback": {}
}
```

Stable terminal statuses:

| Status | Meaning |
|---|---|
| `succeeded` | Action completed and required verification passed. |
| `reverted` | Action failed but rollback restored the workspace. |
| `queued` | Human approval is required. |
| `rejected` | Policy, scope, or safety gate rejected execution. |
| `failed` | Execution failed and could not be repaired or rolled back safely. |

## Plugin action package

```text
actions/<name>/
  action.json
  execute.js
  verify.js
  rollback.js
```

`action.json` minimum contract:

```json
{
  "name": "example_action",
  "riskTier": "R2",
  "inputSchema": {},
  "outputSchema": {},
  "permissions": {
    "commands": ["node --check src/file.js"],
    "filesystem": "workspace"
  },
  "verification": {
    "required": true,
    "commands": ["node --check src/file.js"]
  },
  "rollback": {
    "required": true
  }
}
```

Frozen rules:

1. Plugin actions cannot override core actions.
2. File-backed plugin JS requires `allowPluginCodeExecution: true`.
3. Plugin `execute.js`, `verify.js`, and `rollback.js` run in a controlled child process.
4. R3/R4 plugin actions do not auto-execute.
5. Declared verification commands still pass through the global command allowlist and sandbox runner.
6. R2 write-like plugin actions require rollback evidence.

## Compatibility promise

v4.0.17 LTS treats the action plan envelope, result envelope, plugin package shape, and terminal status names as stable. Future v4.x maintenance releases may add optional fields, but must not remove these fields or weaken the safety gates.
