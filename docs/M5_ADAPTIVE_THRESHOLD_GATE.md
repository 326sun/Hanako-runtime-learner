# M5c — Adaptive Threshold DESIGN GATE

> **Status: DESIGN ONLY. Nothing in this document is implemented, and crossing
> this gate does not authorize implementation.** This is a written gate that
> *precedes* any decision to build an adaptive layer. It exists so the design is
> pinned and reviewable *before* code, not after.
>
> Hard constraints in force while this document is the deliverable:
> - No tag, no GitHub Release, no release asset (release freeze).
> - No `adaptiveThresholdsEnabled` flag is added.
> - No threshold value is changed.
> - Feedback signals do **not** participate in any current policy/injection
>   decision. They remain observation-only ([FEEDBACK_SIGNALS.md](FEEDBACK_SIGNALS.md)).
> - M4 stays an experimental read-only agent graph; no real execution.

## 0. Purpose & scope

The M5/M5b feedback layer now records real outcomes for injected memories
without acting on them. M5c asks one narrow question and answers it on paper:

> *If* we ever let those outcomes nudge an injection threshold, exactly what
> would the rules be — and what would make us refuse to ship it?

This document defines those rules. It does **not** turn them on. A separate,
later decision (the "gate verdict" in §10) decides whether implementation is
even attempted. Until then the runtime behaves identically to today.

### What an adaptive layer would and would not touch

The only injection decision surface is `isInjectable` in
[`lib/scoring.js`](../lib/scoring.js) (lines ~95–101):

```js
const meetsConfidence =
     (pattern.count || 0) >= (cfg.minInjectCount || DEFAULT_CONFIG.minInjectCount)
  && ds                   >= (cfg.minInjectScore || DEFAULT_CONFIG.minInjectScore);
```

So the **only** candidate knobs are:

| Knob | Range (validation-gate `NUMERIC_RANGES`) | Default | Role |
|---|---|---|---|
| `minInjectScore` | `[1, 50]` | `8` | min decayed score to auto-inject a non-approved pattern |
| `minInjectCount` | `[1, 20]` | `2` | min repeat count to auto-inject |

`decayHalfLifeDays` (`[1, 365]`, default `30`) is explicitly **out of scope** for
adaptation: it changes the meaning of *every* historical score at once and has no
clean per-decision feedback signal. An adaptive layer, if ever built, tunes
**`minInjectScore` only**, and only upward/downward within its declared range.
`minInjectCount` is a candidate for a *later* phase and is **frozen** for the
first iteration to keep one variable in play.

Everything else — `governanceProfile`, auto-action risk tiers, proposal apply,
durable-memory limits — is **never** adaptive. Approved patterns and durable
memory bypass `meetsConfidence` entirely (`scoring.js` lines 90–94), so
adaptation can only ever affect *non-approved, non-durable* candidate patterns.
It can never auto-inject something a human rejected (`status === "rejected"`
returns `false` first).

## 1. The false-injection rate (the core metric)

**Definition.** Over a look-back window of `W` days:

```
falseInjectionRate = (injectionRevoked + memoryClosed_after_injection)
                     ----------------------------------------------------
                                    memoryInjected
```

where the numerator counts, and the denominator counts, the
[`summarizeFeedback`](../lib/feedback-signals.js) tallies:

- `memoryInjected` — denominator: a memory id was actually written into SKILL.md.
- `injectionRevoked` — a previously-injected memory's injection was pulled.
- `memoryClosed` — a memory was manually closed/rejected by the user.

**Precise inclusion rules (to avoid double-counting and noise):**

1. The denominator counts **injection events**, not ids; `injectedIdTotal` is
   recorded separately and is **not** the denominator (a single inject event can
   carry many ids; mixing the two inflates or deflates the rate). The first
   iteration uses event counts on both sides for a like-for-like ratio. (A future
   refinement may move to per-id accounting; that requires id-level join logic
   that does not exist today and is out of scope here.)
2. `memoryClosed` only counts toward the numerator when the closed id
   `wasRecentlyInjected` — a memory the user closes that was *never* injected is
   not a false **injection**, it is a normal review rejection and belongs to the
   proposal/pattern rejection stream, not this rate.
3. `injectionRevoked` always counts (the hook already only fires for
   previously-injected ids — see `feedback-signals.js` `recordInjectionRevoked`
   call site).
4. Events are filtered to the window by `summarizeFeedback`'s `sinceDays` cutoff.
   Malformed/undated events are dropped (already handled — `Date.parse` guard).

**Interpretation.** A *high* false-injection rate means the bar is too low
(garbage is getting in) → a corrective step would *raise* `minInjectScore`. A
*persistently zero* rate with healthy injection volume *might* argue the bar is
too high, but the design treats lowering the bar as strictly more dangerous than
raising it (see §4 asymmetry).

## 2. Minimum sample size (no acting on noise)

No adjustment is computed unless **all** of these hold in window `W`:

| Gate | Threshold | Why |
|---|---|---|
| `memoryInjected` (denominator) | **≥ 30** events | a rate over <30 samples is statistically meaningless; one revoke would swing it by >3%. |
| numerator (revoked + qualifying closed) | **≥ 5** events | at least a handful of *actual* bad outcomes before reacting at all. |
| distinct calendar days with ≥1 inject | **≥ 7** | guards against a single burst session dominating the signal. |

If any gate fails, the layer emits **no proposal and no change** and records a
`"insufficient-sample"` no-op reason. Silence is the correct behavior on thin
data, by design.

## 3. Cooldown (no thrashing)

- **Adjustment cooldown:** after any threshold change proposal is *applied*, no
  further adaptive change may be proposed for **≥ 14 days**. The window `W` for
  the metric is **14 days** as well, so each decision sees a fresh, non-
  overlapping outcome window rather than re-reacting to outcomes that produced
  the previous change.
- **Evaluation cadence:** the metric may be *computed* as often as desired (it is
  a pure read), but a *proposal* may be emitted at most once per cooldown.
- **Cooldown is persisted** (last-change timestamp in the event-log / state), so a
  restart cannot reset it and double-step.

## 4. Step size cap & direction asymmetry

A single adaptive proposal may move `minInjectScore` by **at most ±2 points**
(absolute, on the `[1,50]` scale). Never a multiplicative or unbounded jump.

**Asymmetry (raising is cheaper than lowering):**

- **Raising** the bar (more conservative; fewer auto-injections) may step up to
  **+2** per cooldown.
- **Lowering** the bar (less conservative; more auto-injections) may step at most
  **+... i.e. −1** per cooldown — half the rate — and only when the false-
  injection rate has been **0** across **two** consecutive non-overlapping
  windows *and* injection volume met the §2 sample gate in both. Lowering the bar
  is the only direction that can *increase* exposure, so it is deliberately slow
  and evidence-heavy.

Rationale: the cost of a missed injection (a useful memory not auto-injected) is
recoverable on the next turn; the cost of a bad auto-injection (wrong guidance
written into SKILL.md) is paid immediately and silently. The loop is biased
toward caution.

## 5. Upper / lower bound clamp

Every adaptive value is clamped to a band that is **strictly inside** the
validation-gate range, never the raw `[1,50]`:

| Knob | Hard schema range | Adaptive clamp band | Reason for the tighter band |
|---|---|---|---|
| `minInjectScore` | `[1, 50]` | **`[5, 20]`** | below 5, auto-injection is effectively ungated; above 20, almost nothing non-approved injects (the layer would silently disable a feature). The loop must never wander to either useless extreme. |

- The clamp is applied **after** the step, every time: `next = clamp(prev ± step, 5, 20)`.
- A proposal that would not move the value after clamping (already at a band edge,
  pushing further in the same direction) is suppressed as a no-op.
- The clamp band is itself a **constant in code**, not adaptive, not user-tunable
  via the normal config panel — changing the band is a code change with review.
- The result must still pass `validateConfig` (validation-gate) before any write;
  the adaptive layer is a *producer of proposed config*, never a bypass of the
  existing gate.

## 6. Rollback strategy

Three independent rollback layers, weakest-to-strongest:

1. **Auto-revert on regression.** If, in the window *after* an adaptive change,
   the false-injection rate is **worse** than the window *before* the change (by
   any margin past noise — concretely: numerator up **and** rate up), the layer
   automatically proposes reverting to the *previous* value and enters an extended
   **28-day** cooldown. A change that makes things worse is undone, not doubled
   down on.
2. **Full history & one-shot reset.** Every adaptive change is journaled
   (old value, new value, metric snapshot, timestamp) in the append-only
   event-log. A single operator action resets `minInjectScore` to its
   **manifest default (`8`)** and clears adaptive state. The journal makes every
   automated move auditable and individually reversible.
3. **Kill switch.** Setting `adaptiveThresholdsEnabled = false` (the flag that
   does **not** exist yet and is **not** added in M5c) freezes the value at
   whatever it currently is and stops all further adaptation. Disabling never
   itself moves a threshold.

Rollback must be possible **without** data loss: disabling adaptation leaves the
feedback signal stream intact (it is observation-only regardless), so re-enabling
later starts from real history, not a cold start.

## 7. Human-review conditions (when the loop must stop and ask)

The adaptive layer **must not** apply a change autonomously — it must instead
surface a **review proposal** (same review-queue path as `pattern_candidate`,
never an auto-apply) when **any** of these hold:

1. **Conservative governance:** `governanceProfile === "conservative"`. In this
   profile adaptation is *fully disabled* — no proposals at all (mirrors how
   conservative already force-disables high-risk enables in
   `CONSERVATIVE_BLOCKS`).
2. **Lowering the bar:** any *downward* `minInjectScore` step is **review-only**,
   always, regardless of profile — only a human may reduce the injection bar.
3. **Clamp-edge contact:** a proposal that would sit at either edge of the `[5,20]`
   band.
4. **Post-rollback:** the first proposal after any auto-revert (§6.1).
5. **Anomalous volume:** injection volume in the window is an order of magnitude
   off the trailing baseline (burst or drought) — the metric is suspect.
6. **Repeated reversal:** the same value has been proposed-and-reverted twice;
   the loop is oscillating and a human must break the cycle.

Outside these conditions, a *raising* step within band, on `balanced`/
`autonomous`, after a clean sample-gated window, is the **only** case that could
ever be considered for autonomous apply — and even that decision is deferred to
§10, not granted here.

## 8. Where this would live (non-binding sketch, not a build order)

For review completeness only — *not* an instruction to build:

- A new pure module (e.g. `lib/adaptive-threshold.js`) consuming
  `summarizeFeedback` output + persisted adaptive state, producing a *proposed*
  next value or a no-op-with-reason. **Pure function, zero side effects, no I/O in
  the decision core** (mirrors `scoring.js` / `feedback-signals.js` discipline).
- Application path reuses the existing review queue + `validateConfig`; it never
  writes config directly.
- A flag `adaptiveThresholdsEnabled` (default **false**) would gate the whole
  thing. **Not added in M5c.**
- New tests would lock: sample-gate no-op, step cap, clamp band, asymmetry,
  cooldown persistence, auto-revert, conservative-disable, review-on-lower. Test
  count baseline and README badges would bump per the maintenance convention.

## 9. What M5c explicitly does NOT do

- Does not add `adaptiveThresholdsEnabled`.
- Does not add `lib/adaptive-threshold.js` or any decision code.
- Does not change `minInjectScore`, `minInjectCount`, `decayHalfLifeDays`, or any
  other value.
- Does not let `summarizeFeedback` output flow into `isInjectable`, governance,
  proposal-apply, or any live path.
- Does not modify M4 (stays experimental read-only).
- Does not tag, release, or upload an asset.

The runtime after M5c is **byte-for-byte behavior-identical** to before it,
except for this added document.

## 10. Gate verdict (to be decided after review of this document)

Implementation of the adaptive layer is authorized **only if** a reviewer signs
off that:

- [ ] the false-injection rate definition (§1) is sound and not double-counting;
- [ ] the sample gates (§2) are conservative enough to never act on noise;
- [ ] cooldown + step cap + clamp (§3–§5) make runaway/thrashing impossible;
- [ ] rollback (§6) is complete and lossless;
- [ ] human-review conditions (§7) keep every bar-lowering and every edge case in
      human hands;
- [ ] the asymmetry (raising cheap, lowering slow + review-only) is acceptable.

Until every box is checked **and** the release freeze is lifted, the verdict is:
**do not implement.** This document standing alone — with no code, no flag, no
value change — is the complete and intended deliverable of M5c.
