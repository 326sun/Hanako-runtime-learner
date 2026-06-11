# Benchmark API Freeze

Status: frozen for v4.0.17 LTS.

## Purpose

Benchmarks provide system-level evidence beyond unit tests. They verify that the execution, rollback, repair, plugin, transfer, skill, controller, audit, and safety paths still work together.

## Command

```bash
npm run benchmark
```

## Scenario file shape

```json
{
  "id": "category.example",
  "title": "Example benchmark",
  "category": "category",
  "workspace": {
    "files": []
  },
  "context": {},
  "steps": []
}
```

## Frozen step types

| Step | Purpose |
|---|---|
| `execute_action` | Execute a core or registered action. |
| `run_command` | Run an allowed command in a fixture workspace. |
| `run_agent_controller` | Run an Agent Controller task graph. |
| `transfer_validate` | Validate a transferred memory candidate against a target project. |
| `run_skill_promotion_loop` | Run the skill promotion pipeline. |
| `generate_audit_dashboard` | Generate dashboard JSON/Markdown. |
| `render_skill` | Render `SKILL.md` preview through the normal builder. |
| `assert_file` | Assert fixture file existence/content. |
| `assert_last_result` | Assert fields on the previous non-assertion result. |
| `note` | Non-executing scenario annotation. |

## Metrics

| Metric | Meaning |
|---|---|
| `task_success_rate` | Fraction of benchmark scenarios that succeeded. |
| `auto_execution_success_rate` | Success rate for auto-applied scenarios. |
| `rollback_success_rate` | Rollback success among rollback-attempted cases. |
| `repair_success_rate` | Repair success among repair-attempted cases. |
| `false_auto_apply_rate` | Incorrect automatic execution rate. |
| `manual_escalation_rate` | Fraction requiring human escalation. |
| `token_overhead` | Optional token overhead signal. |
| `latency_overhead` | Scenario duration signal. |
| `skill_effectiveness` | Optional skill benefit signal. |

## v4.0.17 corpus

The built-in corpus covers 16 scenarios across audit, controller, plugin, quality, repair, runtime, safety, skill, and transfer categories.

## Compatibility promise

v4.0.17 LTS freezes scenario loading, step names, and metric names. Future v4.x releases may add optional steps and scenarios, but must keep existing scenario compatibility.
