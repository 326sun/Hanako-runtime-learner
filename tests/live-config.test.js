// Unit tests for live config refresh primitives (lib/live-config.js).
//
// The plugin bridges the host settings panel into a single in-memory `config`
// object at onload. Many consumers (PatternDetector, refreshSkill closures,
// advisor/extraction runners via getConfig, observer's configRef) hold a
// reference to THAT object. To apply a panel change live we must update the
// object WITHOUT replacing its identity, or those holders keep reading stale
// values. These helpers encode that contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceConfigInPlace, applyLiveConfig } from "../lib/live-config.js";

describe("live-config · replaceConfigInPlace", () => {
  it("replaces contents while preserving object identity for existing holders", () => {
    const config = { a: 1, b: 2, keep: "old" };
    const holder = config; // simulates detector.this.config / configRef.current
    const result = replaceConfigInPlace(config, { a: 9, c: 3 });

    assert.equal(result, config, "returns the same object");
    assert.equal(holder, config, "identity preserved for reference holders");
    assert.deepEqual(config, { a: 9, c: 3 }, "old keys dropped, new values applied");
    assert.equal("b" in config, false, "removed key is actually gone");
    assert.equal("keep" in config, false, "stale key not retained");
  });
});

describe("live-config · applyLiveConfig", () => {
  it("converges config object, configRef.current and detector onto next", () => {
    const config = { includePendingPreferences: false, threshold: 1 };
    const configRef = { current: config };
    let detectorConfig = null;
    const detector = { setConfig: (c) => { detectorConfig = c; } };

    const next = { includePendingPreferences: true, threshold: 5 };
    applyLiveConfig({ config, configRef, detector }, next);

    assert.equal(config.includePendingPreferences, true, "in-place value updated");
    assert.equal(config.threshold, 5);
    assert.equal(configRef.current, config, "configRef points at the shared object");
    assert.equal(detectorConfig, config, "detector.setConfig receives the shared object");
  });

  it("works without an optional detector or configRef", () => {
    const config = { x: 1 };
    assert.doesNotThrow(() => applyLiveConfig({ config }, { x: 2, y: 3 }));
    assert.deepEqual(config, { x: 2, y: 3 });
  });
});
