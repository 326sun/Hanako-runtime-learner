# Code Audit / Optimization Round 6

Date: 2026-06-11
Version: 4.0.21-lts

## Audit conclusion

The project was already close to the LTS target, but two concrete issues still affected trustworthiness:

1. the release-readiness benchmark failed because the current acceptance report was missing;
2. `Scope Gate` underestimated `oldText/newText` patch size, so a large text replacement could appear as `0 insertion, 0 deletion` unless the replacement text happened to contain unified-diff markers.

A third issue was lower severity but still important: the repository-boundary file list existed but was not enforced in `evaluateScopeGate()`, which made `.github/workflows/*` behave like normal source files.

## Code changes

### 1. Accurate patch-size accounting

`buildDiffPreview()` now counts lines from `oldText` and `newText` directly for text patches.

Previous behavior:

```text
oldText: 2 lines
newText: 3 lines
reported: 0 insertions, 0 deletions
```

Current behavior:

```text
oldText: 2 lines
newText: 3 lines
reported: 3 insertions, 2 deletions
```

This makes `maxAddedLines` and `maxRemovedLines` meaningful for real action-plan patches.

### 2. Early path traversal rejection

Patch targets using absolute paths or `..` segments are now marked unsafe in the diff preview and rejected by the scope gate.

This duplicates the lower-level transaction protection intentionally. Defense-in-depth is correct here because the user-facing decision should explain the rejection before a write transaction is even created.

### 3. Repository-boundary escalation

The existing boundary list now has behavior:

```text
.git
.github/workflows
Dockerfile
docker-compose
```

These changes require manual confirmation and are escalated to R3. They are not auto-applied as ordinary code changes.

### 4. Release-readiness evidence restored

Added the missing current-version acceptance report so `quality.release_readiness_gate` can pass.

## Performance / maintainability effect

1. `Scope Gate` no longer performs misleading diff-marker scans on non-diff patch payloads.
2. Shared path normalization and line-count helpers reduce repeated string handling branches inside `scope-gate.js`.
3. Previously dead boundary constants now feed an actual gate rule.
4. The release-readiness benchmark no longer fails for documentation drift.

## Validation performed

```text
node --test tests/scope-gate-new.test.js
npm run check
npm test
npm run benchmark
npm run release:check
```

## Remaining unfinished work

No blocker remains for this uploaded package after this round. Optional future work:

1. add more adversarial scope-gate benchmark scenarios;
2. extract scope-gate path utilities into a shared safety helper if more modules need them;
3. add OS/container-level sandbox adapters as v4.1+ hardening.
