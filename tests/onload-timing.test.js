import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createOnloadTimer } from "../lib/onload-timing.js";

describe("onload timing instrumentation", () => {
  it("records marks without requiring a debug logger", () => {
    let t = 10;
    const timer = createOnloadTimer({}, { now: () => t });
    t = 15;
    const first = timer.mark("config");
    t = 22;
    const second = timer.mark("patterns");

    assert.equal(first.name, "config");
    assert.equal(first.ms, 5);
    assert.equal(first.totalMs, 5);
    assert.equal(second.ms, 7);
    assert.equal(second.totalMs, 12);
    assert.deepEqual(timer.summary(), {
      totalMs: 12,
      marks: [
        { name: "config", ms: 5, totalMs: 5 },
        { name: "patterns", ms: 7, totalMs: 12 },
      ],
    });
  });

  it("logs only through debug when available", () => {
    const lines = [];
    let t = 0;
    const timer = createOnloadTimer({
      log: {
        debug(line) { lines.push(line); },
      },
    }, { now: () => t });

    t = 1.234;
    timer.mark("paths");

    assert.equal(lines.length, 1);
    assert.match(lines[0], /runtime-learner: onload timing paths 1\.23ms total=1\.23ms/);
  });
});
