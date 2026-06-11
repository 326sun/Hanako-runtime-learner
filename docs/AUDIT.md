# Audit API Freeze

Status: frozen for v4.0.17 LTS.

## Purpose

Audit artifacts explain what the system did, why it was allowed, what it changed, how it verified the result, what rolled back, and what learning state changed.

## Audit surfaces

| Surface | Role |
|---|---|
| `audit_trace` | Node-level Agent Controller trace. |
| `audit_bundle` | Export of governance and event state. |
| `audit-dashboard/<name>/dashboard.json` | Machine-readable dashboard. |
| `audit-dashboard/<name>/dashboard.md` | User-readable dashboard. |
| `benchmark-results/` | System-level evaluation reports. |

## Dashboard contents

The dashboard may include:

1. Benchmark metrics and regressions.
2. Failed benchmark scenarios.
3. Agent Controller task state and pending approvals.
4. Audit trace timeline.
5. Transfer candidates and validation readiness.
6. Skill candidates and active skills.
7. Governance boundaries.
8. Recommended actions.

## Frozen dashboard result

```json
{
  "status": "generated",
  "files": {
    "json": ".../dashboard.json",
    "markdown": ".../dashboard.md"
  },
  "dashboard": {
    "benchmark": {},
    "agent": {},
    "transfer": {},
    "skills": {},
    "governance": {}
  }
}
```

## Safety boundary

Audit generation is read-mostly. It may write report artifacts but must not mutate policy, source files, transfer candidates, skill candidates, active skills, or agent task state.

## Compatibility promise

v4.0.17 LTS freezes dashboard output file names and the top-level result envelope. Future reports may add sections, but must preserve JSON and Markdown exports.
