import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../lib/common.js";
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
});
