# Acceptance Report: v4.0.2 LTS

## Scope

Final audit hardening release. No core architecture changes.

## Fixed

1. Unified manifest/package/package-lock version to `4.0.2-lts`.
2. Added `lib/diff-preview.js` and `install.cjs` to `npm run check`.
3. Hardened command allowlist against shell metacharacters, command substitution, redirection, and compound commands.
4. Hardened filesystem boundary checks against symlink escape.
5. Cleaned release packaging by removing the stale nested `self-evolve/` source tree.

## Validation

- `npm run check`: passed.
- `npm test`: passed.

## Safety Boundary

No R4 automation boundary was expanded. This release only tightens metadata and safety checks.
