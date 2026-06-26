# Feedback Signals (v5.1 M5 / M5b)

Runtime-learner records a small set of **feedback signals** about how learned
memories fare in practice, so a *future* adaptive layer (v5.2+) could learn from
real outcomes. Today these signals are **observation only**.

> **Not adaptive.** No threshold is ever changed by these signals. Nothing in the
> current injection, proposal, governance, or auto-action decision path reads
> them. There is no `adaptiveThresholdsEnabled`. They are a local audit trail and
> a diagnostic, nothing more.

## Signals

All three are appended to the local, hash-chained, append-only event-log
(`event_log.jsonl`). The already-existing `proposal.applied` /
`proposal.rejected` / `pattern.approved` / `pattern.rejected` events are reused —
they are **not** re-instrumented.

| Event | When | Hook |
|---|---|---|
| `feedback.memory_injected` | SKILL.md was actually (re)written with a set of memory ids | `index.js` refreshSkill, after a successful apply |
| `feedback.injection_revoked` | a previously-injected memory's injection is pulled | `tools/control.js` reject, when the memory had been injected |
| `feedback.memory_closed` | the user manually closes/rejects a memory | `tools/control.js` reject |

`feedbackSignalsEnabled` (default **true**) gates all three hooks. When `false`,
no feedback event is written. Every hook is **fail-soft**: a logging failure
never affects the caller's main flow.

### Privacy

Events carry only ids, counts, and short reason codes — **never** user verbatim
text, memory bodies, source snippets, or absolute paths. `skillRef` is reduced to
a relative path or basename.

## Reading the signals

Use the read-only `feedback_summary` action of `self_learning_control`:

```jsonc
// self_learning_control { "action": "feedback_summary", "sinceDays": 30 }
{
  "ok": true,
  "sinceDays": 30,
  "memoryInjected": 0,
  "injectionRevoked": 0,
  "memoryClosed": 0,
  "proposalApplied": 0,
  "proposalRejected": 0,
  "patternApproved": 0,
  "patternRejected": 0,
  "injectedIdTotal": 0
}
```

- `sinceDays` — look-back window in days (default 30).
- It is a **pure read**: it modifies no files, returns counts only, and returns
  **no** threshold, suggestion, recommendation, or adaptive field.

Backed by `summarizeFeedback(baseDir, { sinceDays })` in `lib/feedback-signals.js`.
