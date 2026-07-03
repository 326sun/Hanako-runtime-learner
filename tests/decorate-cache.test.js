import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  clearDecoratePatternCache,
  decoratePatternCacheStats,
  decoratePatterns,
} from "../lib/common.js";

const NOW = Date.parse("2026-06-30T12:00:00.000Z");

function patterns() {
  return [
    {
      id: "low",
      type: "workflow",
      status: "pending",
      score: 4,
      count: 1,
      lastSeen: new Date(NOW).toISOString(),
    },
    {
      id: "high",
      type: "workflow",
      status: "pending",
      score: 20,
      count: 5,
      lastSeen: new Date(NOW).toISOString(),
    },
  ];
}

describe("decoratePatterns cache", () => {
  beforeEach(() => {
    clearDecoratePatternCache();
  });

  it("reuses default decoration for the same array, config, and time bucket", () => {
    const input = patterns();
    const config = { ...DEFAULT_CONFIG, autoInjectHighConfidence: true };

    const first = decoratePatterns(input, config, { now: NOW });
    const second = decoratePatterns(input, config, { now: NOW + 30_000 });

    assert.deepEqual(second, first);
    assert.deepEqual(decoratePatternCacheStats(), { entries: 1, hits: 1, misses: 1 });
  });

  it("returns isolated shallow copies on cache hits", () => {
    const input = patterns();
    const config = { ...DEFAULT_CONFIG, autoInjectHighConfidence: true };

    const first = decoratePatterns(input, config, { now: NOW });
    first[0].id = "mutated-result";

    const second = decoratePatterns(input, config, { now: NOW });
    assert.equal(second[0].id, "high");
    assert.notEqual(second[0], first[0]);
  });

  it("does not reuse decoration across different pattern arrays", () => {
    const input = patterns();
    const config = { ...DEFAULT_CONFIG, autoInjectHighConfidence: true };

    decoratePatterns(input, config, { now: NOW });
    const changed = patterns();
    changed[0].score = 30;
    const next = decoratePatterns(changed, config, { now: NOW });

    assert.equal(next[0].id, "low");
    assert.equal(decoratePatternCacheStats().misses, 2);
  });

  it("invalidates when scoring config changes", () => {
    const input = patterns();

    const closed = decoratePatterns(input, { ...DEFAULT_CONFIG, autoInjectHighConfidence: false }, { now: NOW });
    const open = decoratePatterns(input, {
      ...DEFAULT_CONFIG,
      autoInjectHighConfidence: true,
      minInjectCount: 1,
      minInjectScore: 1,
    }, { now: NOW });

    assert.equal(closed.find((pattern) => pattern.id === "low")?.injectable, false);
    assert.equal(open.find((pattern) => pattern.id === "low")?.injectable, true);
    assert.equal(decoratePatternCacheStats().misses, 2);
  });

  it("does not cache filtered or mutating calls", () => {
    const input = patterns();
    const config = { ...DEFAULT_CONFIG, autoInjectHighConfidence: true };

    const filtered = decoratePatterns(input, config, {
      now: NOW,
      filter: (pattern) => pattern.id === "high",
    });
    const mutated = decoratePatterns(input, config, { now: NOW, mutate: true });

    assert.equal(filtered.length, 1);
    assert.equal(mutated[0], input[1]);
    assert.deepEqual(decoratePatternCacheStats(), { entries: 0, hits: 0, misses: 0 });
  });
});
