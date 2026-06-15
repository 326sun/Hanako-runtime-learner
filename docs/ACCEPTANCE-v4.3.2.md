# Acceptance Report: v4.3.2 LTS

## Version Information

Final v4.3.2 release candidate:

```text
package version: 4.3.2
npm run check: passed
npm test: 519 tests, 519 passed, 0 skipped
npm run benchmark: passed, 17 scenarios
npm run perf: passed, no threshold breaches
npm run release:check: Score 100
```

## Release Target

v4.3.2 is a maintenance and release-hardening patch on the v4.x LTS line.

The goal is not to widen automation. The goal is to keep the existing architecture stable while improving hot-path performance, reducing redundant code, and strengthening release evidence.

## Final Changes

1. **Retrieval and indexing performance**
   - BM25 search now avoids repeated string rounding and avoidable intermediate arrays.
   - Large stores use postings to narrow candidates before scoring.
   - Strong query-token filtering moved inside `MemoryIndex.search()`.

2. **Pattern detector performance**
   - Pattern eviction removes category-index entries by known categories instead of scanning the full category index for every id.
   - `scoreSignals()` computes `decayedScore` and `memoryStrength` from one date/half-life pass.
   - Tool-category normalization is centralized in `uniqueSortedToolCategories()`.

3. **Configuration correctness**
   - `mergeConfig()` deep-merges known nested config blocks.
   - `autoActions` and `autoActionCommands` validation covers nested ranges and enums.
   - Project script trust writes to `autoActionCommands.projectScripts`, preserving defaults.

4. **Skill rendering and feedback cleanup**
   - `buildSkillMdFromPatterns()` classifies injectable patterns in one pass.
   - Action feedback policy updates read feedback once and group by action type.
   - Unjudged recent feedback is ignored when evaluating auto-suspension streaks.

5. **Release guardrails**
   - `npm run perf` now measures `skill_render_ms` in addition to search, decoration, prune, `all()`, and cold import.
   - README release evidence has been rewritten and synchronized with package version, fixed clone branch, and test count.

## Measured Hot Path

Typical local result at the bounded operating size (`N=100 = MAX_PATTERN_COUNT * 2`):

| Metric | Result |
|---|---:|
| `search_ms` | ~0.03 ms |
| `decorate_ms` | ~0.02 ms |
| `skill_render_ms` | ~0.03 ms |
| `prune_ms` | ~0.05 ms |
| `all_cold_ms` | ~0.03 ms |
| `all_cached_ms` | ~0.00004 ms |
| cold import | ~27 ms |

All metrics are well below advisory thresholds.

## Safety Boundary

No release change weakens v4.x LTS boundaries:

```text
R4 actions: still never auto-executed
external side effects: still never auto-executed
push/tag/release/publish: still not auto-executed
patch writes: still require scope gate + transaction + verification
repair: still one-shot and verification-gated
project scripts: still require explicit hash approval
active skill injection: still off by default
API freeze: unchanged
architecture: unchanged
```

## LTS Commitment

Accepted in v4.x LTS:

- Bug fixes
- Security hardening
- Behavior-preserving performance improvements
- Tests and benchmark coverage
- Documentation and release evidence

Rejected in v4.x LTS:

- New high-risk automation paths
- Any weakening of policy, scope, transaction, rollback, or review gates
- Frozen API changes without a new major line

## Decision

Ready.
