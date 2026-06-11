# Code Audit Optimization Round 5 — 2026-06-11

Scope: fifth-pass audit on top of `4.0.20-lts`, focused on the security-critical execution chain (filesystem boundary → command allowlist → scope gate → transaction → executor) plus the proposal apply path and the two largest entry files. Four real correctness bugs and one validation gap were found and fixed; all fixes tighten existing behavior.

## Audit findings (fixed)

1. **Classifier-driven repair never ran** (`lib/action-executor.js`). `attemptOneRepair()` is async but was called without `await`; the code then read `.ok` off the pending Promise (always `undefined`), so the classifier-driven repair branch silently did nothing. Only explicit `repairPlan` repair ever worked — which is also why the test suite never caught it.
2. **`$`-pattern corruption in text patches** (`lib/action-executor.js`). `String.replace(oldText, newText)` expands `$&`, `$'`, `` $` ``, `$$` inside the replacement string. Any patch whose new text contained such sequences (common in real code) was written corrupted. The unique-occurrence path now replaces via a callback; the integer-occurrence path (`replaceNth`) already used slicing and was safe. Regression test added.
3. **Scope gate boundary bypass** (`lib/scope-gate.js`). `allowedFiles` accepted any bare suffix match — `evil-src/a.js` passed an allowlist entry `src/a.js` — and `allowedDirs` accepted any bare prefix — `src-evil/x.js` passed an entry `src`. Matching now requires path-segment boundaries (`===`, `/`-anchored suffix, `dir/` prefix, or `/dir/` segment). Regression tests added; the legitimate suffix semantics (`packages/app/src/a.js` matching `src/a.js`) are preserved and pinned by a test.
4. **Transaction snapshot failure was swallowed** (`lib/action-transaction.js`). If the pre-write snapshot read failed, the `catch {}` left `content: null` with `existed: true`; a later rollback then overwrote the real file with `""`. Snapshot failures now propagate and abort the transaction before any write (fail-closed).
5. **`skill_patch` apply target was unvalidated** (`lib/proposals.js`). Neither `verifyProposal` nor the validation gate checked `target.skillPath`, so a tampered proposal JSON could redirect the apply-write to an arbitrary user-writable path. `verifyProposal` now requires the target file to be literally named `SKILL.md` (all legitimate producers already satisfy this). Regression test added.

## Audit findings (reviewed, intentionally unchanged)

- `lib/filesystem-boundary.js`: symlink-aware containment, fail-safe deny substring matching — sound. TOCTOU between check and write is accepted under the local single-user threat model documented in SANDBOX.md.
- `lib/command-allowlist.js`: compound-shell syntax (`;&|<>$`#\r\n`) is rejected before any allowlist match; builtin deny verbs plus configured deny tokens are segment-aware. Sound.
- `lib/pattern-detector.js`, `lib/observer.js`, `lib/credentials.js`, `lib/evidence.js`: no defects found.

## Cleanup and performance

1. `tools/control.js` `status`: each store (proposals / reviews / agent tasks / transfer candidates) is now scanned once and counted in memory — previously 12 full directory re-scans with JSON parsing per call. Duplicated package-version reader IIFEs consolidated into `readPluginVersion()`.
2. `lib/proposals.js`: three hand-rolled tmp+rename blocks and the non-atomic `config_patch` write now use the shared atomic `writeJson()`.
3. `index.js`: two remaining non-atomic config writes switched to `writeJson()`.

## Validation

```text
npm run check:   passed
npm test:        507 tests, 503 passed, 0 failed, 4 skipped (Windows symlink permission)
npm run benchmark: 17/17 scenarios passed
npm run release:check: ready (run after version bump)
```

## Safety boundary

Every change in this round either fixes a gate that was weaker than specified (scope gate, transaction, skill_patch target) or fixes a repair/patch path to do what the docs already claimed. No automation boundary was widened; R4 remains blocked; code_patch remains manual-review only.

## Remaining debt

1. Classifier-driven repair, now that it actually executes, can still only produce `diagnose`/`locate` strategies for most error classes — `generateRepairPatch` needs `oldContent`/`newContent` context the executor does not yet collect for the `EXPORT_MISSING` patch path. Documented limitation, unchanged behavior risk: none (it degrades to "no repair patches", same observable result as before the fix, except `LOCATE/DIAGNOSE` strategies are now correctly reported).
2. `buildDiffPreview` counts `+ `/`- ` prefixed lines inside `filePatches[].newText`, so raw (non-diff-formatted) patch text contributes 0 to the `maxAddedLines` budget; only `fileWrites` are metered accurately. Tightening this changes gating thresholds for existing users and should be decided deliberately, not slipped into an audit round.
3. `tools/control.js` and `lib/pattern-detector.js` size assessments unchanged from rounds 3–4.
