# Skill Promotion API Freeze

Status: frozen for v4.0.17 LTS.

## Purpose

Skill promotion converts repeated execution feedback into controlled reusable rules without polluting `SKILL.md` by default.

## Promotion path

```text
reflexion
→ failure cluster
→ skill candidate
→ feedback evidence
→ staged
→ active registry
→ optional injection gate
```

## Files

| File | Role |
|---|---|
| `reflexion_memory.jsonl` | Failure reflections and future strategies. |
| `action_feedback.jsonl` | Success, failure, repair, rollback, and regression evidence. |
| `skill_candidates.json` | Candidate lifecycle state. |
| `active_skills.json` | Evidence-backed active skills. |
| `SKILL.md` | Runtime prompt skill. Not directly written by the promotion loop. |

## Candidate envelope

```json
{
  "id": "skill_candidate:example",
  "rule": "When adding a new action module, check exports before tests.",
  "status": "candidate",
  "scope": {
    "taskTypes": ["code_patch"]
  },
  "evidence": {
    "failureCount": 3,
    "successCount": 5,
    "regressionCount": 0,
    "reflexionIds": [],
    "feedbackIds": []
  }
}
```

Stable statuses:

| Status | Meaning |
|---|---|
| `candidate` | Pattern observed but not yet strong enough. |
| `staged` | Enough evidence for trial injection registry. |
| `active` | Evidence-backed active skill. |
| `decayed` | Confidence fell or regressions occurred. |
| `removed` | Candidate is no longer retained. |

## Active skill injection gate

v4.0.17 adds an explicit opt-in gate for surfacing active skills inside rendered `SKILL.md`.

Default config:

```json
{
  "activeSkillsInjectionEnabled": false,
  "activeSkillsInjectionMaxCount": 3,
  "activeSkillsInjectionMinSuccess": 7,
  "activeSkillsInjectionMaxRegression": 0
}
```

Rules:

1. Default is off.
2. Only `status: active` skills can be injected.
3. Minimum success evidence is required.
4. Regressed skills are excluded by default.
5. The promotion loop still does not write `SKILL.md` directly.
6. Final rendering still respects `maxSkillTokens`.

## Compatibility promise

v4.0.17 LTS freezes candidate status names, active registry semantics, and the default no-direct-SKILL-write boundary. Future releases may improve scoring but must preserve evidence requirements and explicit injection gating.
