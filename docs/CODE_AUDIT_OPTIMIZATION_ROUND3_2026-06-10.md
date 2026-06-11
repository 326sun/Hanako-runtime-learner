# Code Audit Optimization Round 3 — 2026-06-10

Scope: third-pass audit on top of `4.0.18-lts`. The intent is to reduce duplicated runtime/control-tool logic and improve the advisor suggestion hot path without changing the LTS governance model, action risk tiers, skill promotion boundary, or release contract.

## Audit findings

1. `index.js` and `tools/control.js` still duplicated advisor suggestion merge logic.
2. The manual `run_model_advisor` path used `patterns.find(...)` for each suggestion, making the merge path O(patterns × suggestions).
3. Runtime high-risk advisor proposal generation mixed filtering, sanitization, proposal creation, and notification accounting inside the plugin lifecycle.
4. `tools/control.js` contained a duplicated `candidate object is required` guard.

## What changed

1. Added `lib/advisor-insights.js`.
   - `mergeAdvisorSuggestions()` centralizes safe advisor advice merging.
   - `buildRepeatedCodePatchProposals()` centralizes repeated error/usage proposal creation.
   - `buildHighRiskAdvisorCodePatchProposals()` centralizes high-risk advisor proposal creation.

2. Simplified `index.js`.
   - Removed local repeated code-patch proposal loop.
   - Removed local advisor-suggestion merge loop.
   - Removed local high-risk advisor proposal loop.
   - The lifecycle code now handles orchestration and notification only.

3. Simplified `tools/control.js`.
   - Reused `mergeAdvisorSuggestions()` in manual `run_model_advisor`.
   - Removed stale `sanitizeAdvice` import.
   - Removed duplicated candidate validation guard.

4. Added characterization tests.
   - `tests/advisor-insights.test.js` covers array-based and Map-based pattern sources, approved-pattern skip behavior, repeated proposal filtering, and high-risk advisor proposal generation.

## Performance impact

The manual advisor merge path changed from repeated linear scans to a single id lookup index:

```text
before: O(pattern_count × suggestion_count)
after:  O(pattern_count + suggestion_count)
```

This matters when `patterns.json` has grown large and a manual advisor run returns many suggestions. The runtime Map-based path remains O(suggestions), but now uses the same tested helper.

## Measured cleanup

Compared with `4.0.18-lts`:

```text
index.js:        622 lines → 597 lines
new helper:      lib/advisor-insights.js, 87 lines
new tests:       tests/advisor-insights.test.js
npm test:        498 passed → 502 passed
```

Total file count increases by one helper and one test, but duplicate behavior was removed from high-risk runtime/control paths and the new behavior is independently testable.

## Safety boundary

No safety boundary was relaxed:

```text
R4 automatic execution: unchanged, blocked
External side effects: unchanged, blocked unless explicitly allowed by existing gates
Code patch proposals: still manual-review only
Skill promotion: still does not directly write SKILL.md
Release readiness: unchanged
Policy / scope / rollback / verifier gates: unchanged
```

## Validation

Commands run:

```bash
npm run check
npm test
npm run benchmark
npm run release:check
```

Expected result for this package:

```text
npm run check: passed
npm test: 502 passed
npm run benchmark: 17 scenarios passed
npm run release:check: ready
```

## Remaining debt

1. `tools/control.js` is still large because it is an action dispatcher. The next safe cleanup would be grouping action handlers by domain, but that touches more user-facing command paths and should be done with handler-level characterization tests first.
2. `lib/pattern-detector.js` remains large but currently has important cache and retention behavior. Further splitting should wait until there are more behavioral fixtures around pruning, workflow scoring, and relation cleanup.
