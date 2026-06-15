import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeConfig } from "../lib/common.js";
import { validateConfigPatch, validateProposal } from "../lib/validation-gate.js";

function hasCheck(result, name, status) {
  return result.checks.some((check) => check.name === name && check.status === status);
}

describe("config patch validation", () => {
  it("rejects unknown config keys", () => {
    const result = validateConfigPatch({ unknownDangerousKey: "x" }, DEFAULT_CONFIG);
    assert.equal(result.ok, false);
    assert.equal(hasCheck(result, "config_key:unknownDangerousKey", "fail"), true);
  });

  it("rejects config values with the wrong type", () => {
    const result = validateConfigPatch({ maxSkillTokens: "many" }, DEFAULT_CONFIG);
    assert.equal(result.ok, false);
    assert.equal(hasCheck(result, "config_type:maxSkillTokens", "fail"), true);
  });

  it("rejects out-of-range numeric config values", () => {
    const result = validateConfigPatch({ minInjectScore: -100 }, DEFAULT_CONFIG);
    assert.equal(result.ok, false);
    assert.equal(hasCheck(result, "config_range:minInjectScore", "fail"), true);
  });

  it("marks semantic search enablement as high risk", () => {
    const result = validateConfigPatch({ semanticSearchEnabled: true }, { ...DEFAULT_CONFIG, semanticSearchEnabled: false });
    assert.equal(result.ok, true);
    assert.equal(hasCheck(result, "config_high_risk:semanticSearchEnabled", "warn"), true);
  });

  it("blocks external-service enablement in conservative profile", () => {
    const result = validateConfigPatch(
      { semanticSearchEnabled: true },
      { ...DEFAULT_CONFIG, governanceProfile: "conservative", semanticSearchEnabled: false },
    );
    assert.equal(result.ok, false);
    assert.equal(hasCheck(result, "config_conservative:semanticSearchEnabled", "fail"), true);
  });

  it("allows valid config patches through proposal validation", () => {
    const proposal = {
      id: "config_patch:valid",
      type: "config_patch",
      patch: { config: { minInjectScore: 10, maxSkillTokens: 1200 } },
    };
    const result = validateProposal(proposal, { config: DEFAULT_CONFIG });
    assert.equal(result.ok, true);
    assert.equal(hasCheck(result, "config_payload", "pass"), true);
    assert.equal(hasCheck(result, "config_range:minInjectScore", "pass"), true);
  });

  it("mergeConfig deep-merges known nested settings instead of replacing defaults", () => {
    const merged = mergeConfig({ autoActions: { autoRepairEnabled: false } });
    assert.equal(merged.autoActions.autoRepairEnabled, false);
    assert.equal(merged.autoActions.requireVerification, DEFAULT_CONFIG.autoActions.requireVerification);
    assert.deepEqual(merged.autoActionCommands.allowlist, DEFAULT_CONFIG.autoActionCommands.allowlist);
  });

  it("validates nested auto action settings", () => {
    const bad = validateConfigPatch({ autoActions: { maxAutoRiskTier: "R9", maxAutoActionsPerTurn: 0 } }, DEFAULT_CONFIG);
    assert.equal(bad.ok, false);
    assert.equal(hasCheck(bad, "config_enum:autoActions.maxAutoRiskTier", "fail"), true);
    assert.equal(hasCheck(bad, "config_range:autoActions.maxAutoActionsPerTurn", "fail"), true);

    // projectScripts is still allowed but produces a high-risk warn
    const good = validateConfigPatch({ autoActionCommands: { allowProjectScripts: true, projectScripts: { scriptsHash: "abc" } } }, DEFAULT_CONFIG);
    assert.equal(good.ok, true);
    assert.equal(hasCheck(good, "config_nested:autoActionCommands.projectScripts", "pass"), true);
    assert.equal(hasCheck(good, "config_high_risk:autoActionCommands.projectScripts", "warn"), true);
  });

  it("rejects an empty denylist as a defense downgrade", () => {
    const result = validateConfigPatch({ autoActionCommands: { denylist: [] } }, DEFAULT_CONFIG);
    assert.equal(result.ok, false);
    assert.equal(hasCheck(result, "config_nonempty:autoActionCommands.denylist", "fail"), true);
  });

  it("rejects a denylist containing only empty or blank entries", () => {
    const result = validateConfigPatch({ autoActionCommands: { denylist: ["  ", ""] } }, DEFAULT_CONFIG);
    assert.equal(result.ok, false);
    assert.equal(hasCheck(result, "config_nonempty:autoActionCommands.denylist", "fail"), true);
  });

  it("accepts a non-empty denylist with valid entries", () => {
    const result = validateConfigPatch({ autoActionCommands: { denylist: ["rm", "del"] } }, DEFAULT_CONFIG);
    assert.equal(result.ok, true);
  });

  it("accepts an empty allowlist (disabling all auto-commands)", () => {
    const result = validateConfigPatch({ autoActionCommands: { allowlist: [] } }, DEFAULT_CONFIG);
    assert.equal(result.ok, true);
    assert.equal(hasCheck(result, "config_type:autoActionCommands.allowlist", "pass"), true);
  });
});
