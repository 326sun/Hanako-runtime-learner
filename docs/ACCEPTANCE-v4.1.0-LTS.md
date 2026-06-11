# Acceptance Report: v4.1.0 LTS

## Version information

Before:

```
package version: 4.0.21-lts
npm run check: passed
npm test: 496 passed
npm run benchmark: passed, 17 scenarios
npm run release:check: Score 100
```

After:

```
package version: 4.1.0-lts
npm run check: passed
npm test: 496 passed
npm run benchmark: passed, 17 scenarios
npm run release:check: Score 100
```

## This version's target

v4.1 安全一致性加固：消除剩余安全分叉，确保自动化执行路径被统一验证逻辑覆盖。

Three v4.1 roadmap items completed:

1. **v4.1.1 Project Script Trust Gate** — package.json scripts hash now recorded in audit trace on every execution/rejection; `trust_project_scripts` control action lets users approve hashes through the control tool without manual config editing.

2. **v4.1.2 Filesystem Boundary Ancestor Realpath** — already implemented during v4.0.x hardening; workspace root symlink resolution, nearest-existing-parent realpath checks, and symlink escape prevention confirmed with dedicated test suite.

3. **v4.1.3 URL Redaction and HTTP Warning** — already implemented during v4.0.x; `audit-bundle.js` `redactUrl()` strips to origin; `model-advisor.js` `advisorEndpointWarning()` warns on non-local HTTP endpoints.

## Code quality improvements (carried from v4.0.21 maintenance)

- Merged 6 single-consumer micro-modules (87 → 81 lib files)
- Centralized `nowIso()` — eliminated 3 duplicate definitions
- `observer.js` getTurn() LRU eviction: O(n log n) → O(n)
- Fixed `install.cjs` JS_FILES list (was referencing deleted `rank-fusion.js`, missing 40+ new modules)
- Fixed `manifest.json` version consistency with `package.json`

## New control surface

```
trust_project_scripts — approve current package.json scripts hash for automatic execution
```

## Safety boundary

No R4 automation boundary was widened. No new auto-execution paths were added.

```
R4: still never auto-executed
external side effects: still never auto-executed
push/tag/release/publish: still not auto-executed
credentials/secrets: still rejected
patch writes: still require scope gate + transaction + verification
repair: still one-shot and verification-gated
project scripts: still require explicit hash approval before auto-execution
```

## Benchmark corpus

All 17 built-in scenarios passing, including:
- `quality.release_readiness_gate` — release contract verified
- `safety.rollback_failed_verification` — rollback on verify failure
- `plugin.process_isolation` — plugin child-process isolation
- `controller.repair_branch` / `controller.rollback_branch` — recovery routing
- `transfer.validation_pass` — cross-project transfer validation
