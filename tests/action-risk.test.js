import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyActionRisk } from "../lib/action-risk.js";
import { ACTION_TYPES } from "../lib/action-types.js";

describe("action risk classification", () => {
  it("does not let declared risk lower the action type baseline", () => {
    const topLevel = classifyActionRisk({
      type: "action_plan",
      riskTier: "R1",
      plan: { actionType: ACTION_TYPES.APPLY_PATCH_SANDBOXED },
    });
    assert.equal(topLevel.riskTier, "R2");
    assert.match(topLevel.checks.find((check) => check.name === "risk_tier")?.message || "", /base=R2/);

    const nested = classifyActionRisk({
      type: "action_plan",
      plan: { actionType: ACTION_TYPES.EXECUTE_REPAIR_ONCE, riskTier: "R0" },
    });
    assert.equal(nested.riskTier, "R2");
  });

  it("allows declared risk to raise the action type baseline", () => {
    const result = classifyActionRisk({
      type: "action_plan",
      riskTier: "R3",
      plan: { actionType: ACTION_TYPES.NO_RETRY_DIAGNOSE },
    });
    assert.equal(result.riskTier, "R3");
  });
});
