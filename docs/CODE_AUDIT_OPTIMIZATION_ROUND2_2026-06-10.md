# Code Audit Optimization Round 2 — 2026-06-10

Scope: second-pass optimization on top of `4.0.2-lts-audited-optimized`. The intent is to reduce runtime-entry coupling and hot-path I/O without changing the plugin's core governance model, auto-action tiers, proposal review flow, or memory semantics.

## What changed

1. Extracted session messaging from `index.js` into `lib/session-messenger.js`.
   - Centralizes `session:send` capability probing.
   - Keeps proposal notification cooldown pruning bounded.
   - Reuses the same send path for proposal notifications and work-status messages.

2. Extracted usage dedup persistence from `index.js` into `lib/seen-id-store.js`.
   - Keeps the capped set behavior.
   - Preserves throttled flush behavior.
   - Makes the usage bootstrap path easier to audit.

3. Reworked JSONL retention in `lib/log-retention.js`.
   - Old behavior read each full log into memory before pruning.
   - New behavior streams input to a temporary file and atomically renames only when old rows were removed.
   - This reduces peak memory on large `experience_log.jsonl`, `turns.jsonl`, `episodes.jsonl`, `error_log.jsonl`, and `activity_log.jsonl` files.

4. Reused shared tool path construction in `tools/control.js`.
   - `tools/_shared.js` now also exposes `pluginDir` and `skillPath`.
   - Removes a duplicate local `paths(ctx)` implementation.

5. Added focused tests.
   - `tests/seen-id-store.test.js`
   - `tests/session-messenger.test.js`

## Measured cleanup

Compared with the previous optimized package:

- `index.js`: 751 lines → 634 lines.
- `tools/control.js`: 489 lines → 476 lines.
- Test coverage: 410 tests → 416 tests.

The total source line count increases slightly because behavior was moved from an overloaded entry file into separately tested modules. This is intentional: the entrypoint is now smaller and the extracted logic is independently auditable.

## Validation

Commands run:

```bash
npm run check
npm test
npm pack --dry-run
```

Result:

```text
npm run check: passed
npm test: 416 passed, 0 failed
npm pack --dry-run: passed
```

## Remaining debt

The next possible cleanup points are `lib/pattern-detector.js`, `lib/observer.js`, and `tools/control.js`. They are large, but further splitting them would touch more behavior-critical logic. The next round should only proceed with dedicated characterization tests first.
