import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import fs from "fs";

import {
  generateRepairPatch,
  getVerificationCommands,
  attemptOneRepair,
  REPAIR_STRATEGIES,
  REPAIR_STATUS,
} from "../lib/repair-strategies.js";
import { ERROR_TYPES } from "../lib/repair-classifier.js";

const tmpDir = path.join(os.tmpdir(), "learner-repair-strategies-test-" + Date.now());

describe("repair-strategies: getVerificationCommands", () => {
  it("returns default js commands", () => {
    const commands = getVerificationCommands();
    assert.ok(commands.includes("node --check"));
  });

  it("includes test commands when requested", () => {
    const commands = getVerificationCommands({ includeTests: true });
    assert.ok(commands.includes("npm test"));
  });

  it("deduplicates commands", () => {
    const commands = getVerificationCommands({ language: "js", includeTests: true });
    const unique = new Set(commands);
    assert.equal(commands.length, unique.size);
  });
});

describe("repair-strategies: generateRepairPatch", () => {
  it("generates lint format repair strategy", () => {
    const result = generateRepairPatch(ERROR_TYPES.LINT_FORMAT);
    assert.equal(result.ok, true);
    assert.equal(result.strategyId, "repair:lint_format");
    assert.equal(result.patch.type, "diagnose");
  });

  it("generates import missing repair strategy", () => {
    const result = generateRepairPatch(ERROR_TYPES.IMPORT_MISSING, { target: "./utils" });
    assert.equal(result.ok, true);
    assert.equal(result.strategyId, "repair:import_missing");
    assert.equal(result.patch.type, "locate");
  });

  it("generates export missing repair strategy", () => {
    const result = generateRepairPatch(ERROR_TYPES.EXPORT_MISSING, {
      targetFile: "lib/test.js",
      oldContent: "export const a = 1;",
      newContent: "export const a = 1;\nexport const b = 2;",
    });
    assert.equal(result.ok, true);
    assert.equal(result.strategyId, "repair:export_missing");
    assert.equal(result.patch.type, "patch");
  });

  it("rejects unsupported error types", () => {
    const result = generateRepairPatch("unsupported_type");
    assert.equal(result.ok, false);
  });

  it("includes verification commands in result", () => {
    const result = generateRepairPatch(ERROR_TYPES.LINT_FORMAT);
    assert.ok(result.verification);
    assert.ok(result.verification.commands);
    assert.ok(result.verification.commands.length > 0);
  });
});

describe("repair-strategies: REPAIR_STRATEGIES", () => {
  it("has strategies for auto-repairable errors", () => {
    assert.ok(REPAIR_STRATEGIES[ERROR_TYPES.LINT_FORMAT]);
    assert.ok(REPAIR_STRATEGIES[ERROR_TYPES.IMPORT_MISSING]);
  });

  it("sets maxAttempts to 1", () => {
    assert.equal(REPAIR_STRATEGIES[ERROR_TYPES.LINT_FORMAT].maxAttempts, 1);
    assert.equal(REPAIR_STRATEGIES[ERROR_TYPES.IMPORT_MISSING].maxAttempts, 1);
  });

  it("import missing requires unique candidate", () => {
    assert.equal(REPAIR_STRATEGIES[ERROR_TYPES.IMPORT_MISSING].requiresUniqueCandidate, true);
  });
});

describe("repair-strategies: attemptOneRepair", () => {
  it("returns error for non-repairable error type", async () => {
    const errorClassification = {
      errorType: ERROR_TYPES.PERMISSION_ERROR,
      canAutoRepair: false,
    };
    
    const result = await attemptOneRepair(errorClassification, { workspaceRoot: tmpDir });
    assert.equal(result.ok, false);
    assert.equal(result.attempted, false);
    assert.equal(result.shouldEscalate, true);
  });

  it("returns patch for repairable error", async () => {
    const errorClassification = {
      errorType: ERROR_TYPES.LINT_FORMAT,
      canAutoRepair: true,
      confidence: 0.9,
    };
    
    const result = await attemptOneRepair(errorClassification, { workspaceRoot: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(result.attempted, true);
    assert.ok(result.patch);
    assert.equal(result.strategyId, "repair:lint_format");
  });

  it("checks attempt limit", async () => {
    const errorClassification = {
      errorType: ERROR_TYPES.LINT_FORMAT,
      canAutoRepair: true,
    };
    
    const result = await attemptOneRepair(errorClassification, {
      workspaceRoot: tmpDir,
      attempt: 1,
      maxAttempts: 1,
    });
    
    assert.equal(result.ok, false);
    assert.equal(result.attempted, true);
    assert.equal(result.reason, "repair attempt limit reached");
    assert.equal(result.shouldRollback, true);
  });

  it("generates correct patch for import missing", async () => {
    const errorClassification = {
      errorType: ERROR_TYPES.IMPORT_MISSING,
      canAutoRepair: true,
      fixTarget: "./my-module",
    };
    
    const result = await attemptOneRepair(errorClassification, {
      workspaceRoot: tmpDir,
      target: "./my-module",
    });
    
    assert.equal(result.ok, true);
    assert.equal(result.patch.actionType, "LOCATE_MISSING_FILE");
    assert.equal(result.patch.target, "./my-module");
  });
});

describe("repair-strategies: REPAIR_STATUS", () => {
  it("exports all repair statuses", () => {
    assert.equal(REPAIR_STATUS.NOT_ATTEMPTED, "not_attempted");
    assert.equal(REPAIR_STATUS.ATTEMPTED, "attempted");
    assert.equal(REPAIR_STATUS.SUCCEEDED, "succeeded");
    assert.equal(REPAIR_STATUS.FAILED, "failed");
    assert.equal(REPAIR_STATUS.ROLLED_BACK, "rolled_back");
    assert.equal(REPAIR_STATUS.ESCALATED, "escalated");
  });
});

describe("repair-strategies: repair workflow", () => {
  it("completes full repair workflow for lint error", async () => {
    // Step 1: Classify error (from repair-classifier)
    const errorClassification = {
      errorType: ERROR_TYPES.LINT_FORMAT,
      canAutoRepair: true,
      confidence: 0.9,
    };
    
    // Step 2: Generate patch
    const patch = await attemptOneRepair(errorClassification, { workspaceRoot: tmpDir });
    assert.equal(patch.ok, true);
    
    // Step 3: Verify patch has verification commands
    assert.ok(patch.verification);
  });

  it("handles import missing with locate action", async () => {
    const errorClassification = {
      errorType: ERROR_TYPES.IMPORT_MISSING,
      canAutoRepair: true,
      fixTarget: "./utils",
    };
    
    const result = await attemptOneRepair(errorClassification, {
      workspaceRoot: tmpDir,
      target: "./utils",
    });
    
    assert.equal(result.ok, true);
    assert.equal(result.patch.type, "locate");
    assert.equal(result.patch.actionType, "LOCATE_MISSING_FILE");
  });

  it("prevents repair of test assertion errors", async () => {
    const errorClassification = {
      errorType: ERROR_TYPES.TEST_ASSERTION,
      canAutoRepair: false,
    };
    
    const result = await attemptOneRepair(errorClassification, { workspaceRoot: tmpDir });
    assert.equal(result.ok, false);
    assert.equal(result.shouldEscalate, true);
  });
});