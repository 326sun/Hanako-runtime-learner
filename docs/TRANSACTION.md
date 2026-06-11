# Transaction API Freeze

Status: frozen for v4.0.17 LTS.

## Purpose

Transactions protect write-like actions. They snapshot affected files before execution and provide rollback evidence when verification or repair fails.

## Transaction lifecycle

```text
begin
→ snapshot affected files
→ apply bounded change
→ verify
→ commit / rollback
→ write feedback
```

## Frozen transaction envelope

```json
{
  "transactionId": "txn:example",
  "status": "committed",
  "files": ["lib/example.js"],
  "snapshots": [],
  "rollback": {
    "attempted": false,
    "ok": false
  }
}
```

Stable statuses:

| Status | Meaning |
|---|---|
| `open` | Snapshot created, action still executing. |
| `committed` | Verification passed and changes remain. |
| `rolled_back` | Verification failed and snapshots were restored. |
| `failed` | Transaction could not complete safely. |

## R2 write requirements

R2 write-like actions must provide:

1. Declared target files or a narrow workspace scope.
2. Rollback plan or transaction snapshot.
3. Verification command or structured verification check.
4. Diff preview and scope gate before execution.
5. Feedback record after completion or rollback.

## Rollback rule

Rollback must restore the pre-action state for files captured by the transaction. If rollback cannot prove restoration, the action result must not claim success.

## Compatibility promise

v4.0.17 LTS freezes transaction status names and rollback semantics. Future changes may improve snapshot storage or add metadata, but must preserve rollback-first failure handling for R2 writes.
