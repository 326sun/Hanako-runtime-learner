// Regression net for the panel→runtime config bridge.
//
// Bug: the Hanako settings panel writes user toggles into the host `ctx.config`
// object, but the plugin runtime only ever read DATA_DIR/config.json. Nothing
// bridged the two, so e.g. enabling `modelAdvisorEnabled` in the panel left the
// model advisor reading the on-disk default `false` and reporting "disabled".
// applyPanelConfig() is the bridge: the panel is authoritative for the settings
// it exposes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, applyPanelConfig } from "../lib/common.js";

describe("applyPanelConfig · panel→runtime bridge", () => {
  it("panel value overrides config.json (the reported bug: enable advisor)", () => {
    const fileConfig = { modelAdvisorEnabled: false };
    const panel = { modelAdvisorEnabled: true };
    const merged = applyPanelConfig(fileConfig, panel);
    assert.equal(merged.modelAdvisorEnabled, true);
  });

  it("panel turning a setting OFF also takes effect (both directions)", () => {
    // autoInjectHighConfidence defaults true; user turns it off in the panel.
    const fileConfig = { autoInjectHighConfidence: true };
    const panel = { autoInjectHighConfidence: false };
    const merged = applyPanelConfig(fileConfig, panel);
    assert.equal(merged.autoInjectHighConfidence, false);
  });

  it("keys the panel does not expose are left to config.json", () => {
    // retrievalCandidateLimit is advanced-only (not in the settings UI).
    const fileConfig = { retrievalCandidateLimit: 42 };
    const panel = { modelAdvisorEnabled: true };
    const merged = applyPanelConfig(fileConfig, panel);
    assert.equal(merged.retrievalCandidateLimit, 42);
    assert.equal(merged.modelAdvisorEnabled, true);
  });

  it("never sources credential keys from the panel (they live in the encrypted store)", () => {
    const fileConfig = { modelAdvisorApiKey: "(stored in credentials.enc)" };
    const panel = { modelAdvisorApiKey: "", semanticEmbeddingApiKey: "" };
    const merged = applyPanelConfig(fileConfig, panel);
    assert.equal(merged.modelAdvisorApiKey, "(stored in credentials.enc)");
  });

  it("ignores the update/set helper functions the compat layer adds to ctx.config", () => {
    const panel = { modelAdvisorEnabled: true, update: () => {}, set: () => {} };
    const merged = applyPanelConfig({}, panel);
    assert.equal(merged.modelAdvisorEnabled, true);
    assert.equal(typeof merged.update, "undefined");
    assert.equal(typeof merged.set, "undefined");
  });

  it("ignores unknown keys the panel might carry", () => {
    const merged = applyPanelConfig({}, { notAConfigKey: 123, modelAdvisorEnabled: true });
    assert.equal(merged.notAConfigKey, undefined);
    assert.equal(merged.modelAdvisorEnabled, true);
  });

  it("skips undefined panel values rather than wiping defaults", () => {
    const merged = applyPanelConfig({}, { minInjectScore: undefined });
    assert.equal(merged.minInjectScore, DEFAULT_CONFIG.minInjectScore);
  });

  it("returns a defaults-merged config when the panel is missing or not an object", () => {
    for (const bad of [null, undefined, "x", 5, []]) {
      const merged = applyPanelConfig({ modelAdvisorEnabled: true }, bad);
      assert.equal(merged.modelAdvisorEnabled, true);
      assert.equal(merged.minInjectScore, DEFAULT_CONFIG.minInjectScore);
    }
  });

  it("merges nested autoActions objects rather than replacing the whole tree", () => {
    const fileConfig = { autoActions: { ...DEFAULT_CONFIG.autoActions, maxAutoActionsPerTurn: 9 } };
    const panel = { autoActions: { minConfidence: 0.5 } };
    const merged = applyPanelConfig(fileConfig, panel);
    assert.equal(merged.autoActions.minConfidence, 0.5);
    assert.equal(merged.autoActions.maxAutoActionsPerTurn, 9); // preserved
  });

  it("ignores a non-object autoActions from the panel", () => {
    const merged = applyPanelConfig({}, { autoActions: "nope" });
    assert.deepEqual(merged.autoActions, DEFAULT_CONFIG.autoActions);
  });
});
