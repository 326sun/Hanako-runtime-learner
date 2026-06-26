/**
 * adaptive-thresholds — v5.1 M5d minimal, default-OFF, recommendation-only.
 *
 * Computes a SINGLE proposed adjustment to `minInjectScore` from feedback
 * outcomes, inside the safety envelope defined by the M5c design gate
 * (docs/M5_ADAPTIVE_THRESHOLD_GATE.md). It is deliberately inert:
 *   - it is a PURE function — input is a summarizeFeedback() result + prior
 *     adjustment state; output is a plain proposal object; it performs no I/O;
 *   - it NEVER mutates runtime config and NEVER auto-applies (apply is always
 *     false) — the only output is a recommendation a human/review path may use;
 *   - when `adaptiveThresholdsEnabled` is false (the default) it is a total
 *     no-op, and nothing in the runtime imports or consumes it today.
 *
 * The tuned knob is `minInjectScore` only (per the gate). Direction is
 * asymmetric and conservative: a high false-injection rate proposes a small
 * RAISE (tighten the bar); sustained clean outcomes propose an even smaller
 * LOWER (loosen the bar). `memoryClosed` is treated as WEAK negative feedback —
 * it never on its own triggers a raise and is never equated with an error, but
 * it does suppress lowering while users keep closing memories.
 */

export const ADAPTIVE_DEFAULTS = Object.freeze({
  knob: "minInjectScore",
  minFeedbackSamples: 30, // need at least this many injections before reacting
  cooldownDays: 14,       // no second adjustment proposal within this window
  clampMin: 5,            // band strictly inside the [1,50] validation range
  clampMax: 20,
  maxStep: 2,             // hard cap on a single adjustment (raise)
  raiseAtRate: 0.2,       // false-injection rate at/above which we tighten
  lowerBelowRate: 0.02,   // negative rates at/below which we may loosen
});

// false-injection rate = injectionRevoked / max(memoryInjected, 1).
// A revoked injection is the one signal we treat as an actual mistake.
export function falseInjectionRate(summary) {
  const c = summary?.counts || {};
  const injected = Number(c.memoryInjected || 0);
  const revoked = Number(c.injectionRevoked || 0);
  return revoked / Math.max(injected, 1);
}

function noop(reason, current, metrics) {
  return {
    ok: true,
    action: "noop",
    reason,
    knob: ADAPTIVE_DEFAULTS.knob,
    current,
    proposed: current,
    delta: 0,
    direction: "none",
    apply: false,
    metrics: metrics || null,
    bounds: bounds(),
    generatedAt: null,
  };
}

function bounds() {
  const d = ADAPTIVE_DEFAULTS;
  return {
    clampMin: d.clampMin,
    clampMax: d.clampMax,
    maxStep: d.maxStep,
    minFeedbackSamples: d.minFeedbackSamples,
    cooldownDays: d.cooldownDays,
  };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @param {object} args
 * @param {object} args.config   runtime config (read-only; supplies the flag,
 *                               governanceProfile, and current minInjectScore)
 * @param {object} args.summary  a summarizeFeedback() result (counts only)
 * @param {object} [args.state]  { lastAdjustedAt?: ISO } prior adjustment journal
 * @param {number} [args.now]    epoch ms (injectable for tests)
 * @returns {object} proposal — recommendation only, apply is always false
 */
export function proposeThresholdAdjustment({ config = {}, summary = {}, state = {}, now = Date.now() } = {}) {
  const d = ADAPTIVE_DEFAULTS;
  const current = Number(config.minInjectScore);
  const cur = Number.isFinite(current) ? current : 8;

  // 1. Default OFF => total no-op. Read nothing further.
  if (config.adaptiveThresholdsEnabled !== true) return noop("disabled", cur, null);

  // 2. Conservative governance disables adaptation entirely (gate §7.1).
  if (config.governanceProfile === "conservative") return noop("conservative-disabled", cur, null);

  const c = summary?.counts || {};
  const injected = Number(c.memoryInjected || 0);
  const revoked = Number(c.injectionRevoked || 0);
  const closed = Number(c.memoryClosed || 0);
  const fRate = revoked / Math.max(injected, 1);
  const wRate = closed / Math.max(injected, 1);
  const metrics = {
    memoryInjected: injected,
    injectionRevoked: revoked,
    memoryClosed: closed,
    falseInjectionRate: fRate,
    weakNegativeRate: wRate,
    samples: injected,
  };

  // 3. Sample gate — never act on thin data.
  if (injected < d.minFeedbackSamples) return noop("insufficient-samples", cur, metrics);

  // 4. Cooldown — one adjustment per window.
  const last = Date.parse(state?.lastAdjustedAt || "");
  if (Number.isFinite(last) && now - last < d.cooldownDays * 86_400_000) {
    return noop("cooldown", cur, metrics);
  }

  // 5. Direction. Raising (tightening) is the cheap, primary move; lowering
  // (loosening) is slower and only when there is no negative signal at all.
  let direction = "none";
  let step = 0;
  if (fRate >= d.raiseAtRate) {
    direction = "raise";
    step = d.maxStep;
  } else if (fRate <= d.lowerBelowRate && wRate <= d.lowerBelowRate) {
    direction = "lower";
    step = -Math.max(1, Math.floor(d.maxStep / 2)); // asymmetric: lower is slower
  } else {
    return noop("within-tolerance", cur, metrics);
  }

  // 6. Clamp into the safe band; a step that cannot move is a no-op.
  const proposed = clamp(cur + step, d.clampMin, d.clampMax);
  const delta = proposed - cur;
  if (delta === 0) return noop("at-bound", cur, metrics);

  // 7. Recommendation only — never auto-apply, never mutate config.
  return {
    ok: true,
    action: "propose",
    reason: direction,
    knob: d.knob,
    current: cur,
    proposed,
    delta,
    direction,
    apply: false,
    metrics,
    bounds: bounds(),
    generatedAt: new Date(now).toISOString(),
  };
}
