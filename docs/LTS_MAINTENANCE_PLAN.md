# LTS Maintenance Plan

Status: v4.3.0-lts final baseline. Effective 2026-06-11.

## What v4.3.0-lts is

v4.3.0 is the final v4.x LTS baseline for Hanako Runtime Self-Learning. It completes the bounded self-learning loop:

```text
Observe → Learn → Plan → Policy Gate → Execute → Verify → Rollback / Repair → Feedback → Audit
```

Core architecture and automation boundaries are frozen. Future v4.x releases are limited to stability, security, documentation, and compatibility work.

## What is allowed in maintenance releases

| Category | Allowed | Example |
|---|---|---|
| Bug fix | Yes | Fix a null-pointer crash in pattern decoration |
| Security patch | Yes (mandatory) | Patch a filesystem boundary bypass |
| Documentation | Yes | Correct inaccurate API doc, add missing install step |
| Tests | Yes | Add regression test for a discovered edge case |
| Benchmark cases | Yes | Add scenario for a newly observed failure mode |
| Hanako version compat | Yes | Adapt to breaking changes in Hanako plugin API |
| Provider adapter | Optional | Add support for a new embedding model endpoint |
| Dashboard UI | Optional | Add a minimal settings viewer page |
| Container sandbox | Optional (adapter-level only) | OS-level sandbox as an independent adapter |

## What is forbidden in maintenance releases

| Category | Handling |
|---|---|
| Relax R4 auto-execution | Reject |
| Auto-execute git push / git tag | Reject |
| Auto-execute npm publish | Reject |
| Auto-delete user files | Reject |
| Auto-modify credentials or secrets | Reject |
| Bypass verification on writes | Reject |
| Bypass rollback on failed patches | Reject |
| Default-inject active skills into SKILL.md | Reject (requires explicit opt-in per governance) |
| Widen automation permission boundary | Reject |
| Change core architecture | Reject |
| Break existing API freeze contracts | Reject |

## Version rules

| Type | Allowed content | Example |
|---|---|---|
| patch (`4.3.x-lts`) | Bug fix, docs, tests, benchmark | `4.3.1-lts` |
| minor (`4.x.0-lts`) | Adapters, non-core enhancements | `4.4.0-lts` (not recommended short-term) |
| major (`5.0.0`) | Architecture change or permission boundary change | Not planned |

## API freeze

The frozen public contracts are documented in `docs/API_FREEZE.md`. They cover:

- Action Plugin API (`docs/ACTION_API.md`)
- Policy Decision API (`docs/POLICY.md`)
- Transaction API (`docs/TRANSACTION.md`)
- Sandbox API (`docs/SANDBOX.md`)
- Skill Promotion API (`docs/SKILL_PROMOTION.md`)
- Audit API (`docs/AUDIT.md`)
- Benchmark API (`docs/BENCHMARKS.md`)
- Migration Guide (`docs/MIGRATION_v3_to_v4.md`)
- Self-Learning Control API (`tools/control.js`, 40+ actions)

Any change that would break these contracts requires a new major version and a full design review.

## Release process for maintenance versions

Every maintenance release must pass the following before tagging:

1. `npm run check` — all source files pass syntax check
2. `npm test` — all tests pass
3. `npm run benchmark` — all scenarios pass, no regressions
4. `npm run release:check` — Score 100, all consistency checks pass

Additionally, each release must include:

- Updated `CHANGELOG.md` with an entry under the new version
- An acceptance report under `docs/ACCEPTANCE-vX.Y.Z-LTS.md`
- No changes to frozen API contracts (unless documented in a migration guide)

## Acceptance report template

```markdown
# Acceptance Report: vX.Y.Z LTS

## Version
package version: vX.Y.Z-lts

## Validation
- npm run check: passed
- npm test: N passed
- npm run benchmark: N scenarios passed
- npm run release:check: Score 100

## Changes
- [List changes]

## Safety boundary audit
- R4 auto-execution: unchanged (forbidden)
- External side effects: unchanged (forbidden)
- R2 write gate: unchanged (transaction + verification + rollback)
- API freeze: unchanged

## Decision
Ready / Not ready
```

## Judgment rule

When considering whether to implement a request:

```text
Improves stability → do it.
Improves verifiability → do it.
Improves documentation consistency → do it.
Improves real Hanako compatibility → do it.
Just makes it "more automatic" → don't.
Just makes it "more agent-like" → don't.
Widens permission boundary → don't.
Breaks API freeze → don't.
```
