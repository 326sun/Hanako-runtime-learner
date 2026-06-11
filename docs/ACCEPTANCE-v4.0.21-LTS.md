# Acceptance Report: v4.0.21 LTS

## Version information

Before this audit round:

1. package version: `4.0.21-lts`
2. `npm run check`: passed
3. `npm test`: intermittently blocked by the release-readiness benchmark because the current-version acceptance report was missing
4. `npm run benchmark`: failed at `quality.release_readiness_gate`

After this audit round:

1. package version: `4.0.21-lts`
2. `npm run check`: passed
3. `npm test`: passed
4. `npm run benchmark`: passed, 17 scenarios

## This round's target

This maintenance round keeps the v4.0.21 LTS API and automation boundary unchanged while tightening the pre-execution safety checks and restoring release-readiness evidence.

## Added capability

1. `Scope Gate` now estimates patch size from `oldText/newText` payloads instead of counting only unified-diff marker lines.
2. `Scope Gate` rejects path traversal and absolute patch targets before the transaction layer is reached.
3. Repository-boundary files such as `.github/workflows/*` now require manual confirmation instead of being silently handled as ordinary source files.
4. The current LTS acceptance report is present, so the release-readiness benchmark can verify the package contract.

## Changed files

```text
lib/scope-gate.js
tests/scope-gate-new.test.js
docs/ACCEPTANCE-v4.0.21-LTS.md
docs/CODE_AUDIT_OPTIMIZATION_ROUND6_2026-06-11.md
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## New or expanded tests

```text
scope-gate counts oldText/newText patch lines
scope-gate rejects path traversal patch targets
scope-gate requires manual confirmation for repository-boundary workflow files
```

## Safety boundary

No R4 automation boundary was widened.

```text
R4: still never auto-executed
external side effects: still never auto-executed
push/tag/release/publish: still not auto-executed
credentials/secrets: still rejected
patch writes: still require scope gate + transaction + verification
repair: still one-shot and verification-gated
```

## Rollback / failure behavior

This round does not alter transaction commit or rollback semantics. It moves three classes of unsafe or high-impact patches earlier in the pipeline:

1. oversized text patches are now counted correctly;
2. path traversal targets are rejected before execution;
3. workflow and repository-boundary files are escalated to manual confirmation.

## Known limits

1. This is still a filesystem/command-policy sandbox, not an OS container sandbox.
2. The audit dashboard remains Markdown/JSON rather than a full frontend UI.
3. Repository-boundary file changes are escalated, not permanently forbidden, because legitimate CI maintenance still exists but must be explicit.

## Final validation checklist

```text
npm run check
npm test
npm run benchmark
npm run release:check
```

## Next version suggestion

Keep v4.0.21 as a maintenance hardening patch. Future v4.1 work should focus on additional benchmark cases and optional OS/container-level sandbox adapters, not on widening automation permissions.
