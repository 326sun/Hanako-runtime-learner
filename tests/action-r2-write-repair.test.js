import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import { executeActionPlan } from "../lib/action-executor.js";
import { evaluateActionPolicy } from "../lib/pipeline.js";
import { ACTION_TYPES } from "../lib/action-types.js";
import { DEFAULT_CONFIG } from "../lib/common.js";

const tmpDir = path.join(os.tmpdir(), "learner-action-r2-write-test-" + Date.now());
const workspace = path.join(tmpDir, "workspace");

function plan(overrides = {}) {
  return {
    id: "action_plan:r2_patch",
    type: "action_plan",
    riskTier: "R2",
    trigger: { confidence: 0.9 },
    rollbackPlan: ["transaction_snapshot"],
    plan: {
      actionType: ACTION_TYPES.APPLY_PATCH_SANDBOXED,
      steps: ["apply exact text patch inside a transaction", "run verification command", "rollback if verification fails"],
      filePatches: [],
      verifyCommands: [],
    },
    verification: { metrics: ["success", "patch_applied", "verification_commands_pass", "diff_scope"] },
    ...overrides,
    plan: { ...overrides.plan, actionType: overrides.plan?.actionType || ACTION_TYPES.APPLY_PATCH_SANDBOXED, steps: overrides.plan?.steps || ["apply exact text patch inside a transaction"], filePatches: overrides.plan?.filePatches || [], verifyCommands: overrides.plan?.verifyCommands || [] },
  };
}

describe("R2 sandboxed writes and repair", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(workspace, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("auto-executes an exact text patch only when rollback and verification are present", async () => {
    fs.writeFileSync(path.join(workspace, "ok.js"), "const value = 1;\n", "utf-8");
    const action = plan({
      plan: {
        filePatches: [{ path: "ok.js", oldText: "const value = 1;", newText: "const value = 2;" }],
        verifyCommands: ["node --check ok.js"],
      },
    });
    assert.equal(evaluateActionPolicy(action, { config: DEFAULT_CONFIG }).decision, "auto_execute");
    const result = await executeActionPlan(action, { config: DEFAULT_CONFIG, workspaceRoot: workspace, learnerDir: tmpDir });
    assert.equal(result.status, "succeeded");
    assert.equal(result.verification.verified, true);
    assert.equal(fs.readFileSync(path.join(workspace, "ok.js"), "utf-8"), "const value = 2;\n");
  });

  it("rolls back when verification commands fail", async () => {
    fs.writeFileSync(path.join(workspace, "bad.js"), "const value = 1;\n", "utf-8");
    const action = plan({
      plan: {
        filePatches: [{ path: "bad.js", oldText: "const value = 1;", newText: "const value = ;" }],
        verifyCommands: ["node --check bad.js"],
      },
    });
    const result = await executeActionPlan(action, { config: { ...DEFAULT_CONFIG, autoActions: { ...DEFAULT_CONFIG.autoActions, autoRepairEnabled: false } }, workspaceRoot: workspace, learnerDir: tmpDir });
    assert.equal(result.status, "reverted");
    assert.equal(result.rollback.ok, true);
    assert.equal(fs.readFileSync(path.join(workspace, "bad.js"), "utf-8"), "const value = 1;\n");
  });

  it("applies one repair patch after failed verification, then keeps the fixed result", async () => {
    fs.writeFileSync(path.join(workspace, "repair.js"), "const value = 1;\n", "utf-8");
    const action = plan({
      plan: {
        filePatches: [{ path: "repair.js", oldText: "const value = 1;", newText: "const value = ;" }],
        verifyCommands: ["node --check repair.js"],
      },
      repairPlan: {
        filePatches: [{ path: "repair.js", oldText: "const value = ;", newText: "const value = 3;" }],
      },
    });
    const result = await executeActionPlan(action, { config: DEFAULT_CONFIG, workspaceRoot: workspace, learnerDir: tmpDir });
    assert.equal(result.status, "succeeded");
    assert.equal(result.repair.attempted, true);
    assert.equal(result.repair.ok, true);
    assert.equal(result.verification.verified, true);
    assert.equal(fs.readFileSync(path.join(workspace, "repair.js"), "utf-8"), "const value = 3;\n");
  });

  it("does not let a repair expand beyond the files approved for the main action", async () => {
    fs.writeFileSync(path.join(workspace, "safe.js"), "export const safe = 1;\n", "utf-8");
    const action = plan({
      plan: {
        filePatches: [{ path: "safe.js", oldText: "safe = 1", newText: "safe = 2" }],
        verifyCommands: ["node -e \"require('fs').existsSync('.env') ? process.exit(0) : process.exit(1)\""],
      },
      repairPlan: {
        fileWrites: [{ path: ".env", content: "SECRET=repair-bypass\n" }],
      },
    });
    const config = {
      ...DEFAULT_CONFIG,
      autoActionCommands: {
        allowlist: ["node -e"],
        denylist: DEFAULT_CONFIG.autoActionCommands.denylist,
      },
    };
    const result = await executeActionPlan(action, {
      config,
      workspaceRoot: workspace,
      learnerDir: tmpDir,
      taskScope: { allowedFiles: ["safe.js"], maxChangedFiles: 1 },
    });

    assert.equal(result.status, "reverted");
    assert.match(result.repair.error, /repair scope expands/);
    assert.equal(fs.existsSync(path.join(workspace, ".env")), false);
    assert.equal(fs.readFileSync(path.join(workspace, "safe.js"), "utf-8"), "export const safe = 1;\n");
  });

  it("writes replacement text containing dollar patterns literally", async () => {
    fs.writeFileSync(path.join(workspace, "dollar.js"), "const re = 1;\n", "utf-8");
    const action = plan({
      plan: {
        filePatches: [{ path: "dollar.js", oldText: "const re = 1;", newText: "const re = \"$&-$'-$$\";" }],
        verifyCommands: ["node --check dollar.js"],
      },
    });
    const result = await executeActionPlan(action, { config: DEFAULT_CONFIG, workspaceRoot: workspace, learnerDir: tmpDir });
    assert.equal(result.status, "succeeded");
    assert.equal(fs.readFileSync(path.join(workspace, "dollar.js"), "utf-8"), "const re = \"$&-$'-$$\";\n");
  });

  it("rejects ambiguous oldText matches and leaves the file untouched", async () => {
    fs.writeFileSync(path.join(workspace, "ambiguous.txt"), "x\nx\n", "utf-8");
    const action = plan({
      plan: {
        filePatches: [{ path: "ambiguous.txt", oldText: "x", newText: "y" }],
        verifyCommands: [],
      },
      verification: { metrics: ["success"] },
    });
    const result = await executeActionPlan(action, { config: DEFAULT_CONFIG, workspaceRoot: workspace, learnerDir: tmpDir });
    assert.equal(result.status, "reverted");
    assert.match(result.error, /must match exactly once/);
    assert.equal(fs.readFileSync(path.join(workspace, "ambiguous.txt"), "utf-8"), "x\nx\n");
  });
});
