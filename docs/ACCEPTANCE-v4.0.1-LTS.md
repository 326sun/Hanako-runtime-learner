# Acceptance Report: v4.0.1 LTS

## Version

Before:

```text
hanako-runtime-learner@4.0.0-lts
npm test: 538 passed, 0 failed
npm run check: passed
```

After:

```text
hanako-runtime-learner@4.0.1-lts
npm test: 542 passed, 0 failed
npm run check: passed
```

## Goal

Close the remaining LTS hardening gaps after the v4.0.0 implementation:

1. Align package metadata.
2. Expose diff preview as a stable standalone API.
3. Replace benchmark mock steps with real runtime/sandbox execution steps.
4. Harden command denylist matching to prevent false positives while preserving high-risk blocks.

## Added

- `lib/diff-preview.js`
- `tests/command-allowlist-hardening.test.js`
- `tests/diff-preview-api.test.js`
- `docs/ACCEPTANCE-v4.0.1-LTS.md`

## Modified

- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `lib/command-allowlist.js`
- `lib/action-executor.js`
- `lib/evaluation-runner.js`
- `tests/benchmark-suite.test.js`

## Verification

```text
npm run check: passed
npm test: 542 passed, 0 failed
```

## Safety Boundary

This version does not expand R4 automation. It only hardens command filtering, benchmark execution, and diff preview access.

Blocked by default:

```text
rm -rf
git push
git tag
npm publish
release
external mutating curl requests
secret/credential modification
```

## Known Limits

v4.0.1 LTS is a stable engineering baseline, not a guarantee that all future action plugins are safe. New action plugins must still declare riskTier, permissions, verification, and rollback requirements before registration.
