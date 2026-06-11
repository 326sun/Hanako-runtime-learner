# Acceptance Report: v4.3.0 LTS

## Version information

Before:

```
package version: 4.2.0-lts
npm run check: passed
npm test: 496 passed
npm run benchmark: passed, 17 scenarios
npm run release:check: Score 100
```

After:

```
package version: 4.3.0-lts
npm run check: passed
npm test: 496 passed
npm run benchmark: passed, 17 scenarios
npm run release:check: Score 100
```

## This version's target

v4.3 长期可维护性治理。冻结公共 API，完善架构文档，为 LTS 长期维护建立基线。

## Changes

1. **API Freeze finalized**: `docs/API_FREEZE.md` updated to v4.3.0, covering all v4.x LTS rules including v4.1 security additions (project script trust, filesystem boundary realpath). Added Self-Learning Control API to frozen contracts. Added version history table.

2. **Architecture document rewritten**: `ARCHITECTURE.md` updated from v2.7-era state (referenced deleted `rank-fusion.js`, mentioned 46 lib files) to current v4.3.0 state (81 modules, 6 subsystem groups, key design decisions).

3. **Code quality (carried from v4.0–v4.2)**:
   - 81 lib modules (down from 87 after merging 6 micro-modules)
   - 496 tests passing
   - 17 benchmark scenarios
   - 9 release readiness checks
   - 40+ control actions via `self_learning_control`

## Safety boundary

No changes to automation, execution, or security boundaries. This is a documentation-only release.

```
R4: still never auto-executed
external side effects: still never auto-executed
push/tag/release/publish: still not auto-executed
patch writes: still require scope gate + transaction + verification
repair: still one-shot and verification-gated
project scripts: still require explicit hash approval
```

## LTS commitment

v4.3.0 marks the completion of the v4.x roadmap. The LTS maintenance policy is:

- Bug fixes and security patches: accepted
- New automation boundaries: rejected
- Documentation and test improvements: accepted
- Architecture changes: require explicit acceptance report
