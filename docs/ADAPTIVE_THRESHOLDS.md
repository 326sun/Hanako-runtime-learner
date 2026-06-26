# Adaptive Thresholds (v5.1 M5d — minimal, default-OFF)

> **Experimental, OFF by default, safe-clamped, fully reversible, and consumed by
> nothing.** This is the *minimal* implementation of the M5 adaptive-threshold
> idea, built strictly inside the safety envelope of the M5c design gate
> ([M5_ADAPTIVE_THRESHOLD_GATE.md](M5_ADAPTIVE_THRESHOLD_GATE.md)). It produces a
> **recommendation only** — it never changes a threshold, never auto-applies, and
> no live decision path (search / inject / advisor) reads its output.

## What it is

`lib/adaptive-thresholds.js` exposes a **pure function**,
`proposeThresholdAdjustment(...)`, that looks at recorded feedback outcomes and
proposes — at most — a single small adjustment to **`minInjectScore`** (the only
tuned knob, per the gate). It is:

- **Default OFF.** Gated by config `adaptiveThresholdsEnabled` (default `false`).
  When off, it returns a `disabled` no-op without reading anything.
- **Pure / inert.** Input is a `summarizeFeedback()` result plus prior adjustment
  state; output is a plain object. No file I/O, no network, no config writes.
- **Recommendation only.** Every result has `apply: false`. There is no code path
  that applies the proposal. Nothing imports the module in the runtime.
- **Conservative-aware.** Under `governanceProfile: "conservative"` it is fully
  disabled (returns `conservative-disabled`).

## Why it is safe

| Guardrail | Behavior |
|---|---|
| **Disabled by default** | `adaptiveThresholdsEnabled=false` ⇒ total no-op. |
| **Sample gate** | Fewer than `minFeedbackSamples` (30) injections ⇒ `insufficient-samples` no-op. |
| **Cooldown** | An adjustment within `cooldownDays` (14) of the last ⇒ `cooldown` no-op. |
| **Clamp band** | Proposed value is clamped to `[clampMin, clampMax]` = `[5, 20]`, strictly inside the validation range `[1, 50]`. |
| **Single-step cap** | A raise moves at most `maxStep` (2); a lower at most `floor(maxStep/2)` (1) — never scales with how bad the data is. |
| **No auto-apply** | `apply` is always `false`; no `applied` / `autoApply` field exists. |
| **No mutation** | The passed `config` is never modified (works even if frozen). |
| **Unconsumed** | No search / inject / advisor / governance path reads the result. |

## The signals

```
falseInjectionRate = injectionRevoked / max(memoryInjected, 1)
weakNegativeRate   = memoryClosed     / max(memoryInjected, 1)
```

- **`injectionRevoked`** is the one outcome treated as an actual mistake — a memory
  we injected and then had to pull. It drives the **false-injection rate**.
- **`memoryClosed`** is **weak** negative feedback, **not** equated with an error.
  It never on its own triggers a tightening, but it does **suppress loosening**
  while users are still closing memories.

Both come from `summarizeFeedback()` ([FEEDBACK_SIGNALS.md](FEEDBACK_SIGNALS.md)),
which is observation-only.

## Direction (asymmetric, conservative)

| Condition | Proposal |
|---|---|
| `falseInjectionRate ≥ raiseAtRate` (0.2) | **raise** `minInjectScore` by `maxStep` (tighten the bar) |
| `falseInjectionRate ≤ lowerBelowRate` (0.02) **and** `weakNegativeRate ≤ 0.02` | **lower** by `floor(maxStep/2)` (loosen, slowly) |
| otherwise | `within-tolerance` no-op |

Raising (more conservative) is the cheap, primary move; lowering (more exposure)
is deliberately slower and only happens when there is *no* negative signal at all.

## Output schema

```jsonc
{
  "ok": true,
  "action": "propose" | "noop",
  "reason": "raise" | "lower"            // when proposing
          | "disabled" | "conservative-disabled" | "insufficient-samples"
          | "cooldown" | "within-tolerance" | "at-bound",   // when no-op
  "knob": "minInjectScore",
  "current": 8,            // from config, never mutated
  "proposed": 10,          // clamped, step-limited; == current on a no-op
  "delta": 2,              // proposed - current; 0 on a no-op
  "direction": "raise" | "lower" | "none",
  "apply": false,          // ALWAYS false — recommendation only
  "metrics": {
    "memoryInjected": 100, "injectionRevoked": 50, "memoryClosed": 0,
    "falseInjectionRate": 0.5, "weakNegativeRate": 0, "samples": 100
  },
  "bounds": { "clampMin": 5, "clampMax": 20, "maxStep": 2,
              "minFeedbackSamples": 30, "cooldownDays": 14 },
  "generatedAt": "2026-06-26T00:00:00.000Z"   // null on a no-op
}
```

## Rollback / how to turn it off

There is nothing to roll back at runtime: no threshold is ever changed. To make
the module completely inert, leave `adaptiveThresholdsEnabled` at its default
`false` (or set it back to `false`). The feedback signal stream is unaffected
either way (it is observation-only), so toggling the flag is lossless.

## Explicitly out of scope (unchanged by M5d)

- `tools/search.js` is **not** modified; the BM25 + RRF retrieval path is unchanged.
- No existing threshold **default** is changed (`minInjectScore` stays `8`, etc.).
- No M1 local embedding is revived; no M4 agent real execution is introduced.
- The proposal is never wired into any decision — applying it, if ever desired,
  would be a separate, reviewed change.
