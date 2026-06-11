# v4.3.0 LTS API Freeze

Status: final. Covers v4.0 through v4.3 LTS.

## Frozen public contracts

| Contract | Document |
|---|---|
| Action Plugin API | `docs/ACTION_API.md` |
| Policy Decision API | `docs/POLICY.md` |
| Transaction API | `docs/TRANSACTION.md` |
| Sandbox API | `docs/SANDBOX.md` |
| Skill Promotion API | `docs/SKILL_PROMOTION.md` |
| Audit API | `docs/AUDIT.md` |
| Benchmark API | `docs/BENCHMARKS.md` |
| Migration Guide | `docs/MIGRATION_v3_to_v4.md` |
| Self-Learning Control API | `tools/control.js` (40+ actions via `self_learning_control`) |

## LTS rules

1. R4 automation remains forbidden.
2. External side effects remain forbidden.
3. R2 writes require transaction, verification, rollback, and scope gate.
4. Plugin code execution remains explicit opt-in and process-isolated.
5. Cross-project transfer remains validation-required and no-auto-promotion.
6. Skill promotion remains evidence-gated and does not directly write `SKILL.md`.
7. Active skill injection remains off by default.
8. Project scripts require explicit hash approval before auto-execution (v4.1).
9. Workspace boundary checks are realpath-aware and symlink-safe (v4.1).
10. Benchmarks must pass before release.

## Maintenance policy

Future v4.x releases should focus on bug fixes, tests, documentation, adapters, and benchmark cases. They should not change the core architecture or weaken frozen safety boundaries.

## Version history

| Version | Focus | Key addition |
|---|---|---|
| v4.0 LTS | Stable baseline | Observe/Learn/Inject + basic action pipeline |
| v4.1 LTS | Security consistency | Project script trust gate + filesystem boundary realpath |
| v4.2 LTS | Performance | Single-pass pattern decoration + code simplification |
| v4.3 LTS | Maintainability | Documentation governance + API freeze finalization |
