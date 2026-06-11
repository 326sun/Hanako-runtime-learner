# Migration Guide: v3.x to v4.0 LTS

Status: frozen for v4.0.17 LTS.

## Who needs this

Use this guide when upgrading an earlier Hanako-runtime-learner installation to the v4.0 LTS line.

## Upgrade path

```bash
git pull
npm run install-plugin
npm run check
npm test
npm run benchmark
```

If installing from a zip, replace the plugin directory, then run the same validation commands from the project root.

## Data compatibility

The v4.0 line keeps existing local data files and adds new files under the same learner data directory:

| File / directory | Added purpose |
|---|---|
| `action_feedback.jsonl` | Runtime execution feedback. |
| `agent_tasks/` | Persistent Agent Controller task state. |
| `transfer_registry.json` | Cross-project transfer candidates and evidence. |
| `skill_candidates.json` | Skill promotion candidate lifecycle. |
| `active_skills.json` | Evidence-backed active skill registry. |
| `audit-dashboard/` | Exported dashboard reports. |

## Behavior changes

1. R2 write-like actions require transaction, verification, rollback, and scope gate.
2. Approved proposals no longer bypass the unified executor chain.
3. Plugin action code requires explicit opt-in and runs in a child process.
4. Cross-project memory transfer requires target validation and still does not auto-promote.
5. Skill promotion writes active skills to `active_skills.json`, not directly to `SKILL.md`.
6. Active skill injection into rendered `SKILL.md` is off by default and must be explicitly enabled.

## Recommended validation checklist

```bash
npm run check
npm test
npm run benchmark
```

Then inspect:

```text
benchmark-results/
audit-dashboard/
.hanako/self-learning/
```

## Rollback plan

If the upgrade fails:

1. Restore the previous plugin directory from backup.
2. Keep the learner data directory intact unless corruption is confirmed.
3. Disable advanced automation by setting `governanceProfile` to `conservative`.
4. Re-run `npm run check` and `npm test` before reinstalling.

## Compatibility promise

v4.0.17 LTS preserves existing v3.x pattern and preference data. New automation layers are conservative by default and should not require destructive data migration.
