# Code Audit Optimization Round 4 — 2026-06-11

Scope: fourth-pass audit on top of `4.0.19-lts`. This round prioritized a real data-loss bug found on Windows, then removed dead code and deduplicated persistence helpers. No governance model, risk tier, promotion boundary, or release contract change.

## Audit findings

1. **Critical (win32): persisted state silently lost.** The filename sanitizer `/[^a-zA-Z0-9._:-]+/g` used by `audit-trace.js`, `agent-task-store.js`, `task-state.js`, `transfer-registry.js`, and `audit-dashboard.js` allowed `:`. Task ids are formatted `task:<hex>`, and on NTFS `:` opens an alternate data stream — the tmp-file write landed in a stream and the rename failed with `EINVAL`. Because callers wrapped saves in `try {} catch {}`, audit traces, agent task states, and transfer records were silently never persisted on Windows. 7 tests failed on win32 because of this.
2. **Windows test bugs.** `tests/benchmark-corpus.test.js` derived the project root from `URL.pathname` (`/D:/...` on win32), so the corpus directory was never found. Symlink-denial tests in `tests/filesystem-boundary-final-audit.test.js` hard-failed where symlink creation requires elevation.
3. **Five hand-rolled copies of atomic JSON write** (tmp + rename), one of which (`audit-dashboard.js`) was not atomic at all; plus duplicated local `readJson`/`safeName` helpers.
4. **21 dead exports** across 15 lib modules, confirmed unreferenced by code, tests, docs, and benchmarks — including `checkUniqueCandidate` (a placeholder returning fake data), `verifyRepair` (reads a `status` field `promisify(exec)` never returns, so it always reported failure), `shouldAcceptRepair`, and the entire unused persistence half of `task-state.js`.
5. **Corpus robustness**: one malformed scenario JSON crashed `loadBenchmarkCorpus` instead of being rejected.
6. **Two O(n²)/wasteful hot paths**: `appendAuditEvent` deep-cloned the whole event history per append; `message_update` re-normalized capped assistant text on every streaming delta.

## What changed

1. Added `safeFileSlug()` to `lib/common.js` (excludes `:`; single source of truth) and switched all five sanitizer copies plus `review-queue.js`/`proposals.js` to it.
2. Replaced the five local atomic-write implementations with the shared `writeJson()` from `lib/common.js` (which also cleans up orphan tmp files on failure).
3. Fixed the benchmark test project-root resolution (`fileURLToPath`) and made symlink tests skip with a reason when the platform denies symlink creation.
4. Removed the 21 dead exports and the imports they orphaned. The `hana-runtime-compat.js` surface (synchronized with hanako-ui-beautify) was deliberately left untouched.
5. `loadBenchmarkScenario` now catches JSON parse errors and routes the file into `rejected`.
6. `appendAuditEvent` now shallow-copies the trace and appends (events are append-only and never mutated); per-delta text accumulation short-circuits at the 1000-char cap.

## Performance impact

```text
appendAuditEvent: O(total event content) per append → O(1) amortized per append
                  (controller run: O(events²) → O(events))
message_update:   regex normalization per streaming delta → no-op once cap reached
```

## Measured cleanup

```text
net source reduction:  ~240 lines across 20 files
dead exports removed:  21 (none documented in the frozen API surface)
tests on Windows:      before: 502 tests, 7 failed / 2 skipped
                       after:  502 tests, 0 failed / 4 skipped (symlink permission)
npm run check:         passed
npm run benchmark:     17/17 scenarios passed
npm run release:check: ready, score 100
```

## Safety boundary

No safety boundary was relaxed:

```text
R4 automatic execution: unchanged, blocked
External side effects: unchanged, blocked unless explicitly allowed by existing gates
Code patch proposals: still manual-review only
Skill promotion: still does not directly write SKILL.md
Release readiness: unchanged contract, passes at 4.0.20-lts
Policy / scope / rollback / verifier gates: unchanged
```

## Data migration note

POSIX installs that previously persisted files with a literal `:` in the name (e.g. `audit/task:abc.json`) will not find those records under the new sanitized name (`task_abc.json`); new writes use the sanitized name. On Windows no such files could ever have been written (the save always failed), so there is nothing to migrate on the platform that motivated the fix.

## Remaining debt

1. `tools/control.js` remains a large action dispatcher (unchanged from round 3's assessment — needs handler-level characterization tests first).
2. `lib/pattern-detector.js` remains large with intentionally coupled cache/retention behavior.
3. Many modules keep a local one-line `clone()`/`now()`; deduplicating them is churn without behavioral benefit and was deliberately skipped.
