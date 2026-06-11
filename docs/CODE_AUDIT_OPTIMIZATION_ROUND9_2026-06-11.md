# Code Audit / Optimization Round 9

Date: 2026-06-11
Version: 4.0.21-lts
Guidance: `Hanako-runtime-learner_终局版详细路线图_v4.0_LTS.md`

## Audit conclusion

Round 9 moved into low-risk v4.2-style performance and code-size cleanup. The rule for this round was strict: optimize only recent/read-summary paths and helper duplication, not security-critical full verification paths.

## Code changes

### 1. Shared JSONL tail-reader helper

Added:

```text
lib/jsonl-utils.js
```

Exports:

```js
readJsonlTailLines(file, { maxLines, initialBytes, maxBytes })
readJsonlTail(file, options)
```

Behavior:

- reads from the file tail rather than full file;
- expands the read window until enough lines are collected or `maxBytes` is reached;
- drops a partial first line when reading from the middle of the file;
- returns an empty array on missing/corrupt/inaccessible files.

### 2. Reused tail reader in recent JSONL paths

Updated:

```text
lib/event-log.js
lib/common.js
lib/activity-log.js
```

Details:

- `event-log.readEvents()` now uses `readJsonlTailLines()`.
- `common.readRecentJsonl()` now uses a bounded tail by default (`maxLines = 5000`).
- `activity-log.readRecentJsonlTail()` now reuses the shared tail reader instead of duplicating file-tail logic.

Not changed by design:

```text
event-log.verifyEventLog()
```

`verifyEventLog()` must remain a full scan because hash-chain verification requires every row.

### 3. Shared value counter helper

Added to `lib/common.js`:

```js
countValues(values = [])
```

Replaced duplicate local implementations in:

```text
lib/audit-bundle.js
lib/audit-dashboard.js
```

The older `countBy(rows, key)` remains because it has different semantics and existing callers.

### 4. `safeFileSlug` reuse in skill candidate IDs

Updated:

```text
lib/skill-candidate-factory.js
```

The local `slug()` now delegates to `safeFileSlug(value, "unknown", 80)` and keeps the existing trim/fallback behavior for candidate IDs.

## Deliberately deferred

The following full reads were not blindly converted to tail reads because their semantics are not purely "recent rows":

```text
lib/action-runtime.js readActionFeedback()
lib/skill-reflexion-cluster.js readReflexions()
```

Reason:

- `readActionFeedback(..., { actionType, limit })` currently means latest N rows after filtering across all feedback. A naive tail read can miss rare older action types.
- `readReflexions()` feeds clustering/promotion logic and may need full historical evidence.

These require either an index or API-level semantics change before safe optimization.

## Tests added / updated

### `tests/common.test.js`

Added coverage for:

- `countValues()` unknown bucket behavior;
- `readRecentJsonl()` bounded-tail parsing and invalid-line tolerance.

### Existing coverage reused

- `tests/event-log.test.js` already covers `readEvents()` tail-read behavior from Round 8.
- `tests/audit-dashboard.test.js` covers `countValues()` integration through dashboard summaries.
- `tests/policy-audit.test.js` covers audit bundle summaries.
- `tests/runtime-e2e.test.js` covers activity-log/runtime integration.

## Validation performed

Targeted:

```text
node --test tests/common.test.js tests/event-log.test.js tests/audit-dashboard.test.js tests/policy-audit.test.js tests/skill-lifecycle.test.js tests/runtime-e2e.test.js
node --test tests/common.test.js tests/event-log.test.js tests/runtime-e2e.test.js
```

Project-level:

```text
npm run check
npm test
```

Results:

```text
npm run check: exit 0
npm test: 493/493 passing
```

## Remaining work

### P3 performance

1. `action-runtime.js` feedback reads still need either an index or per-action tail index to avoid changing semantics.
2. `skill-reflexion-cluster.js` still reads all reflexions; safe optimization needs a promotion-evidence retention policy.
3. Proposal listing and doctor scans still use directory-wide reads/sorts.

### P3 maintainability

1. `common.js` is still oversized. Next high-value round should split it behind a facade.
2. `proposals.js` remains the largest governance lifecycle module.
3. `audit-dashboard.js` and `tools/report.js` still mix payload assembly and Markdown rendering.

## Risk assessment

- No governance gate was loosened.
- Hash-chain verification remains full scan.
- Recent/read-summary paths now use bounded tail IO.
- Duplicate count and slug helpers were reduced without changing public APIs.
- Full test suite remains green.
