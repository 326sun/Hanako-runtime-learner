// M5d — adaptive threshold minimal implementation (default OFF, safe-clamped,
// recommendation-only). These tests pin the safety envelope from the M5c design
// gate (docs/M5_ADAPTIVE_THRESHOLD_GATE.md): disabled => total no-op, sample
// gate, cooldown, clamp band, single-step cap, asymmetric conservative steps,
// false-injection rate definition, and the hard rule that the module NEVER
// auto-applies and NEVER mutates runtime config.

import { describe, it } from "node:test";
import assert from "node:assert";
import { DEFAULT_CONFIG } from "../lib/common.js";
import {
  ADAPTIVE_DEFAULTS,
  falseInjectionRate,
  proposeThresholdAdjustment,
} from "../lib/adaptive-thresholds.js";

// A feedback summary in the shape summarizeFeedback() returns.
function makeSummary({ injected = 0, revoked = 0, closed = 0 } = {}) {
  return {
    sinceDays: 30,
    counts: {
      memoryInjected: injected,
      injectionRevoked: revoked,
      memoryClosed: closed,
      proposalApplied: 0,
      proposalRejected: 0,
      patternApproved: 0,
      patternRejected: 0,
    },
    injectedIdTotal: injected,
  };
}

function makeConfig(overrides = {}) {
  return {
    adaptiveThresholdsEnabled: true,
    governanceProfile: "balanced",
    minInjectScore: 8,
    ...overrides,
  };
}

const OLD = new Date("2020-01-01T00:00:00Z").getTime();
const NOW = new Date("2026-06-26T00:00:00Z").getTime();

describe("adaptive-thresholds · false-injection rate", () => {
  it("is injectionRevoked / max(memoryInjected, 1)", () => {
    assert.strictEqual(falseInjectionRate(makeSummary({ injected: 100, revoked: 25 })), 0.25);
  });

  it("never divides by zero when nothing was injected", () => {
    assert.strictEqual(falseInjectionRate(makeSummary({ injected: 0, revoked: 3 })), 3);
  });
});

describe("adaptive-thresholds · disabled => total no-op", () => {
  it("returns a no-op even with extreme negative feedback when disabled", () => {
    const config = makeConfig({ adaptiveThresholdsEnabled: false });
    const res = proposeThresholdAdjustment({
      config,
      summary: makeSummary({ injected: 100, revoked: 90 }),
      now: NOW,
    });
    assert.strictEqual(res.action, "noop");
    assert.strictEqual(res.reason, "disabled");
    assert.strictEqual(res.direction, "none");
    assert.strictEqual(res.proposed, 8);
    assert.strictEqual(res.delta, 0);
    assert.strictEqual(res.apply, false);
  });

  it("with real DEFAULT_CONFIG (adaptiveThresholdsEnabled defaults false) it is a disabled no-op", () => {
    const res = proposeThresholdAdjustment({
      config: DEFAULT_CONFIG,
      summary: makeSummary({ injected: 100, revoked: 90 }),
      now: NOW,
    });
    assert.strictEqual(res.action, "noop");
    assert.strictEqual(res.reason, "disabled");
    assert.strictEqual(res.apply, false);
  });
});

describe("adaptive-thresholds · conservative profile disables adaptation", () => {
  it("no-ops under conservative governance even with high negative feedback", () => {
    const res = proposeThresholdAdjustment({
      config: makeConfig({ governanceProfile: "conservative" }),
      summary: makeSummary({ injected: 100, revoked: 90 }),
      now: NOW,
    });
    assert.strictEqual(res.action, "noop");
    assert.strictEqual(res.reason, "conservative-disabled");
    assert.strictEqual(res.apply, false);
  });
});

describe("adaptive-thresholds · sample gate", () => {
  it("no-ops when memoryInjected is below minFeedbackSamples", () => {
    const res = proposeThresholdAdjustment({
      config: makeConfig(),
      summary: makeSummary({ injected: ADAPTIVE_DEFAULTS.minFeedbackSamples - 1, revoked: 10 }),
      now: NOW,
    });
    assert.strictEqual(res.action, "noop");
    assert.strictEqual(res.reason, "insufficient-samples");
    assert.strictEqual(res.proposed, 8);
    assert.strictEqual(res.apply, false);
  });
});

describe("adaptive-thresholds · cooldown", () => {
  it("no-ops inside the cooldown window even when an adjustment is warranted", () => {
    const recently = NOW - 3 * 86_400_000; // 3 days ago, inside 14d cooldown
    const res = proposeThresholdAdjustment({
      config: makeConfig(),
      summary: makeSummary({ injected: 100, revoked: 90 }),
      state: { lastAdjustedAt: new Date(recently).toISOString() },
      now: NOW,
    });
    assert.strictEqual(res.action, "noop");
    assert.strictEqual(res.reason, "cooldown");
    assert.strictEqual(res.proposed, 8);
    assert.strictEqual(res.apply, false);
  });
});

describe("adaptive-thresholds · high negative feedback => conservative raise", () => {
  it("proposes raising minInjectScore by one conservative step", () => {
    const res = proposeThresholdAdjustment({
      config: makeConfig({ minInjectScore: 8 }),
      summary: makeSummary({ injected: 100, revoked: 50 }), // rate 0.5
      state: { lastAdjustedAt: new Date(OLD).toISOString() },
      now: NOW,
    });
    assert.strictEqual(res.action, "propose");
    assert.strictEqual(res.direction, "raise");
    assert.strictEqual(res.current, 8);
    assert.strictEqual(res.proposed, 10); // 8 + maxStep(2)
    assert.strictEqual(res.delta, 2);
    assert.strictEqual(res.apply, false);
    assert.strictEqual(res.metrics.falseInjectionRate, 0.5);
  });
});

describe("adaptive-thresholds · high positive feedback => conservative lower", () => {
  it("proposes lowering minInjectScore by a small conservative step", () => {
    const res = proposeThresholdAdjustment({
      config: makeConfig({ minInjectScore: 8 }),
      summary: makeSummary({ injected: 100, revoked: 0, closed: 0 }), // clean outcomes
      state: { lastAdjustedAt: new Date(OLD).toISOString() },
      now: NOW,
    });
    assert.strictEqual(res.action, "propose");
    assert.strictEqual(res.direction, "lower");
    assert.strictEqual(res.proposed, 7); // 8 - lowerStep(1); lowering is slower than raising
    assert.strictEqual(res.delta, -1);
    assert.ok(Math.abs(res.delta) <= ADAPTIVE_DEFAULTS.maxStep);
    assert.strictEqual(res.apply, false);
  });
});

describe("adaptive-thresholds · memoryClosed is weak negative, not an error", () => {
  it("does not lower while users keep closing memories, and does not raise on closes alone", () => {
    const res = proposeThresholdAdjustment({
      config: makeConfig({ minInjectScore: 8 }),
      summary: makeSummary({ injected: 100, revoked: 0, closed: 50 }), // no revokes, many closes
      state: { lastAdjustedAt: new Date(OLD).toISOString() },
      now: NOW,
    });
    assert.strictEqual(res.action, "noop");
    assert.strictEqual(res.reason, "within-tolerance");
    assert.strictEqual(res.proposed, 8);
    assert.strictEqual(res.apply, false);
  });
});

describe("adaptive-thresholds · clamp band", () => {
  it("clamps a raise to clampMax instead of exceeding the band", () => {
    const res = proposeThresholdAdjustment({
      config: makeConfig({ minInjectScore: ADAPTIVE_DEFAULTS.clampMax - 1 }), // 19
      summary: makeSummary({ injected: 100, revoked: 90 }),
      state: { lastAdjustedAt: new Date(OLD).toISOString() },
      now: NOW,
    });
    assert.strictEqual(res.proposed, ADAPTIVE_DEFAULTS.clampMax); // 20, not 21
    assert.strictEqual(res.delta, 1); // clamp shrank the step
    assert.strictEqual(res.apply, false);
  });

  it("no-ops at the lower bound instead of dropping below clampMin", () => {
    const res = proposeThresholdAdjustment({
      config: makeConfig({ minInjectScore: ADAPTIVE_DEFAULTS.clampMin }), // 5
      summary: makeSummary({ injected: 100, revoked: 0, closed: 0 }),
      state: { lastAdjustedAt: new Date(OLD).toISOString() },
      now: NOW,
    });
    assert.strictEqual(res.action, "noop");
    assert.strictEqual(res.reason, "at-bound");
    assert.strictEqual(res.proposed, ADAPTIVE_DEFAULTS.clampMin); // stays at 5
    assert.strictEqual(res.delta, 0);
  });
});

describe("adaptive-thresholds · single-step cap", () => {
  it("never moves more than maxStep no matter how bad the rate is", () => {
    const res = proposeThresholdAdjustment({
      config: makeConfig({ minInjectScore: 8 }),
      summary: makeSummary({ injected: 100, revoked: 100 }), // rate 1.0, as bad as possible
      state: { lastAdjustedAt: new Date(OLD).toISOString() },
      now: NOW,
    });
    assert.strictEqual(res.delta, ADAPTIVE_DEFAULTS.maxStep); // exactly the cap, not scaled
    assert.strictEqual(res.proposed, 8 + ADAPTIVE_DEFAULTS.maxStep);
  });
});

describe("adaptive-thresholds · never mutates runtime config", () => {
  it("does not modify the passed config object (works even when frozen)", () => {
    const config = Object.freeze(makeConfig({ minInjectScore: 8 }));
    const res = proposeThresholdAdjustment({
      config,
      summary: makeSummary({ injected: 100, revoked: 50 }),
      state: { lastAdjustedAt: new Date(OLD).toISOString() },
      now: NOW,
    });
    assert.strictEqual(config.minInjectScore, 8); // unchanged
    assert.notStrictEqual(res, config);
    assert.strictEqual(res.proposed, 10); // proposal carries the new value, config does not
  });
});

describe("adaptive-thresholds · recommendation only, never auto-apply", () => {
  it("every outcome carries apply:false and no auto-apply flag", () => {
    const cases = [
      proposeThresholdAdjustment({ config: makeConfig({ adaptiveThresholdsEnabled: false }), summary: makeSummary({ injected: 100, revoked: 90 }), now: NOW }),
      proposeThresholdAdjustment({ config: makeConfig(), summary: makeSummary({ injected: 100, revoked: 50 }), state: { lastAdjustedAt: new Date(OLD).toISOString() }, now: NOW }),
      proposeThresholdAdjustment({ config: makeConfig(), summary: makeSummary({ injected: 100, revoked: 0 }), state: { lastAdjustedAt: new Date(OLD).toISOString() }, now: NOW }),
    ];
    for (const res of cases) {
      assert.strictEqual(res.apply, false);
      assert.ok(!("applied" in res), "must not report applied");
      assert.ok(!("autoApply" in res), "must not expose autoApply");
    }
  });
});
