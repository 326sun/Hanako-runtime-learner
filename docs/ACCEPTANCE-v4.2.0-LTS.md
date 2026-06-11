# Acceptance Report: v4.2.0 LTS

## Version information

Before:

```
package version: 4.1.0-lts
npm run check: passed
npm test: 496 passed
npm run benchmark: passed, 17 scenarios
npm run release:check: Score 100
```

After:

```
package version: 4.2.0-lts
npm run check: passed
npm test: 496 passed
npm run benchmark: passed, 17 scenarios
npm run release:check: Score 100
```

## This version's target

v4.2 性能、内存、可观测性优化。不增加新功能，不扩大自动化边界。

## Performance improvements

1. **`decoratePatterns()` single-pass optimization**: The pattern detector's hot path (`all()`) previously created an intermediate filtered array before decoration (2 full passes over patterns). Now uses a unified filter+decorate loop, eliminating one intermediate array allocation per call. Also added an optional `mutate` mode for callers that don't need cache isolation.

2. **`observer.js` `getTurn()` LRU eviction**: Changed from O(n log n) `Array.sort()` to O(n) linear scan over ≤64 session entries. (Carried from v4.0.21 maintenance.)

3. **`nowIso()` centralized**: Eliminated 3 duplicate `new Date().toISOString()` definitions across the codebase. (Carried from v4.0.21.)

## Code quality (carried from v4.0.21–v4.1.0)

- Merged 6 single-consumer micro-modules (87 → 81 lib files)
- Fixed `install.cjs` JS_FILES list (updated from 38 v2.7-era entries to full 87-module surface)
- Fixed `manifest.json` version consistency
- Added `trust_project_scripts` control action (v4.1.1)
- Added project script trust audit event logging (v4.1.1)

## Safety boundary

No R4 automation boundary was widened. No new auto-execution paths were added.

```
R4: still never auto-executed
external side effects: still never auto-executed
push/tag/release/publish: still not auto-executed
patch writes: still require scope gate + transaction + verification
repair: still one-shot and verification-gated
project scripts: still require explicit hash approval
```

## Benchmark corpus

All 17 built-in scenarios passing.
