import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import { detectActionTriggers } from "../lib/action-triggers.js";
import { buildActionPlans } from "../lib/action-planner.js";
import { verifyProposal, previewProposalDiff } from "../lib/proposals.js";
import { validateProposal } from "../lib/validation-gate.js";
import { classifyActionRisk } from "../lib/action-risk.js";
import { evaluateActionPolicy } from "../lib/pipeline.js";
import { executeActionPlan, isAllowedCommand } from "../lib/action-executor.js";
import { ACTION_TYPES } from "../lib/action-types.js";
import { DEFAULT_CONFIG } from "../lib/common.js";

const tmpDir = path.join(os.tmpdir(), "learner-action-runtime-test-" + Date.now());

describe("runtime action triggers and plans", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("creates valid split_context action_plan for large context", () => {
    const triggers = detectActionTriggers({ usage: { estimatedTokens: 130000 }, config: DEFAULT_CONFIG });
    assert.ok(triggers.some((t) => t.type === "large_context_risk"));
    const plans = buildActionPlans(triggers, { config: DEFAULT_CONFIG, input: "x".repeat(1000) });
    const split = plans.find((p) => p.plan.actionType === ACTION_TYPES.SPLIT_CONTEXT);
    assert.ok(split);
    assert.equal(verifyProposal(split).ok, true);
    assert.equal(validateProposal(split, { config: DEFAULT_CONFIG }).ok, true);
    assert.equal(previewProposalDiff(split).ok, true);
  });

  it("maps retryable and non-retryable errors to safe action types", () => {
    const retry = buildActionPlans(detectActionTriggers({ errors: [{ errorType: "network_error" }] }), { config: DEFAULT_CONFIG });
    assert.equal(retry[0].plan.actionType, ACTION_TYPES.RETRY_WITH_BACKOFF);

    const missing = buildActionPlans(detectActionTriggers({ errors: [{ errorType: "file_not_found" }] }), { config: DEFAULT_CONFIG });
    assert.equal(missing[0].plan.actionType, ACTION_TYPES.LOCATE_MISSING_FILE);

    const auth = buildActionPlans(detectActionTriggers({ errors: [{ errorType: "auth_error" }] }), { config: DEFAULT_CONFIG });
    assert.equal(auth[0].plan.actionType, ACTION_TYPES.ASK_USER_CONFIRMATION);
    assert.equal(evaluateActionPolicy(auth[0], { config: DEFAULT_CONFIG }).decision, "manual_confirm");
  });
});

describe("runtime action policy and executor", () => {
  it("auto-approves low-risk actions but rejects destructive plans", () => {
    const low = {
      id: "action_plan:test",
      type: "action_plan",
      riskTier: "R1",
      trigger: { confidence: 0.9 },
      plan: { actionType: ACTION_TYPES.NO_RETRY_DIAGNOSE, steps: ["diagnose"] },
      verification: { metrics: ["diagnosisGenerated"] },
    };
    assert.equal(classifyActionRisk(low).riskTier, "R1");
    assert.equal(evaluateActionPolicy(low, { config: DEFAULT_CONFIG }).decision, "auto_execute");

    const destructive = {
      ...low,
      id: "action_plan:bad",
      plan: { actionType: ACTION_TYPES.NO_RETRY_DIAGNOSE, steps: ["rm -rf the project"] },
    };
    assert.equal(classifyActionRisk(destructive).riskTier, "R4");
    assert.equal(evaluateActionPolicy(destructive, { config: DEFAULT_CONFIG }).decision, "reject");
  });

  it("detects destructive intent even when steps are objects, not strings", () => {
    // The destructive-intent scan is a safety net that forces R4. If a step is a
    // structured object (e.g. { command: "rm -rf …" }) its content must still be
    // scanned — otherwise String(object) = "[object Object]" hides the command
    // and the plan is wrongly classified auto-eligible.
    const plan = {
      id: "action_plan:obj",
      type: "action_plan",
      plan: {
        actionType: ACTION_TYPES.APPLY_PATCH_SANDBOXED,
        steps: [{ type: "command", command: "rm -rf the project" }],
      },
    };
    const result = classifyActionRisk(plan);
    assert.equal(result.destructive, true);
    assert.equal(result.riskTier, "R4");
    assert.equal(result.autoEligible, false);
  });

  it("requires rollback for R2 auto actions", () => {
    const r2 = {
      id: "action_plan:r2",
      type: "action_plan",
      riskTier: "R2",
      trigger: { confidence: 0.9 },
      plan: { actionType: ACTION_TYPES.SPLIT_CONTEXT, steps: ["split"] },
      verification: { metrics: ["success"] },
    };
    const deferred = evaluateActionPolicy(r2, { config: DEFAULT_CONFIG });
    assert.equal(deferred.decision, "defer");
    const ok = evaluateActionPolicy({ ...r2, rollbackPlan: ["keep original input"] }, { config: DEFAULT_CONFIG });
    assert.equal(ok.decision, "auto_execute");
  });

  it("executes no_retry_diagnose and blocks disallowed commands", async () => {
    const plan = {
      id: "action_plan:diagnose",
      type: "action_plan",
      riskTier: "R1",
      reason: "syntax_error requires command correction",
      plan: { actionType: ACTION_TYPES.NO_RETRY_DIAGNOSE, steps: ["diagnose"] },
      verification: { metrics: ["diagnosisGenerated"] },
    };
    const result = await executeActionPlan(plan, { config: DEFAULT_CONFIG, workspaceRoot: tmpDir });
    assert.equal(result.status, "succeeded");
    assert.equal(result.verification.verified, true);

    assert.equal(isAllowedCommand("npm test", DEFAULT_CONFIG), false);
    assert.equal(isAllowedCommand("npm run check", DEFAULT_CONFIG), false);
    assert.equal(isAllowedCommand("npm run lint", DEFAULT_CONFIG), false);
    assert.equal(isAllowedCommand("git push origin main", DEFAULT_CONFIG), false);
  });

  it("surfaces implicit workspaceRoot fallback for filesystem actions", async () => {
    const result = await executeActionPlan({
      id: "locate:implicit-workspace",
      plan: { actionType: ACTION_TYPES.LOCATE_MISSING_FILE, target: "missing-file.js" },
      verification: { metrics: ["success"] },
    }, { config: DEFAULT_CONFIG });

    assert.equal(result.status, "succeeded");
    assert.match(result.warnings?.[0] || "", /workspaceRoot not supplied/);
  });
});
