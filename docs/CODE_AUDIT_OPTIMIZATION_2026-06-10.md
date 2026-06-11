# Code Audit and Optimization Report

Date: 2026-06-10
Target: hanako-runtime-learner / self-evolve 4.0.2-lts
Constraint: no core architecture changes; only audit, simplification, and performance hardening.

## Audit conclusion

The existing baseline is functionally healthy: syntax check and test suite pass before and after the changes. The main issues were not broken behavior, but maintainability and runtime overhead:

1. `index.js` had become the largest coordination file and still contained local utilities that were duplicated in tool code.
2. `package.json` scripts manually enumerated every checked/tested file, which is noisy and easy to let drift when files are added.
3. Activity logging pruned the full log after each activity append, causing unnecessary repeated read/write work during busy sessions.
4. `countJsonl()` loaded whole JSONL files into memory only to count lines.
5. Several imports were stale, and `knowledgeTier()` contained a duplicated branch.

No high-risk security regression was found in the existing hardening boundaries. The prior LTS constraints remain intact: command allowlist, symlink-aware filesystem boundary, rollback/verification gates, and high-risk automation blocking are preserved.

## Changes made

### Simplification

- Extracted shared JSONL activity utilities into `lib/activity-log.js`.
- Reused the same activity tail reader from `tools/activity.js`, removing duplicated tail-scan logic.
- Extracted log retention pruning into `lib/log-retention.js`.
- Reduced `index.js` by 87 lines, from 838 to 751 lines.
- Removed stale imports from `index.js`, `lib/event-log.js`, `tools/doctor.js`, `tools/report.js`, and `tools/stats.js`.
- Replaced long hand-maintained `package.json` `check` and `test` commands with `scripts/run.js` auto-discovery.

### Performance

- Activity pruning is now throttled rather than performed after every append.
- `countJsonl()` now counts with a 64 KiB buffer instead of reading the entire file into memory.
- Test discovery now runs only `*.test.js`, so helper fixtures are not loaded as empty test files.

### Safety and compatibility

- No default governance setting was relaxed.
- No automatic high-risk action was enabled.
- No core runtime flow was changed: Observe -> Learn -> Inject / Propose remains unchanged.
- `npm pack --dry-run` confirms `scripts/run.js` is included in the package.

## Validation

Commands run:

```bash
npm run check
npm test
npm pack --dry-run
```

Result:

- `npm run check`: passed
- `npm test`: 410 passed, 0 failed
- `npm pack --dry-run`: package created successfully in dry-run metadata, 65 packaged files

## Remaining non-blocking debt

The code is now cleaner, but there are still two structural bloat sources worth handling later only if you decide to continue maintenance:

1. `index.js` is still a coordination-heavy file. The next safe extraction would be advisor/proposal notification wiring, but that would touch more lifecycle logic and is not necessary for the current stable baseline.
2. `tools/control.js`, `lib/pattern-detector.js`, and `lib/observer.js` remain large. They are acceptable for LTS, but future feature work should be forced into separate modules rather than added to these files.
