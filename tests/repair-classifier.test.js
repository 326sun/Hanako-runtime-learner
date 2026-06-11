import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyError,
  classifyErrors,
  summarizeErrors,
  getErrorDescription,
  shouldEscalateToHuman,
  ERROR_TYPES,
} from "../lib/repair-classifier.js";

describe("repair-classifier: classifyError", () => {
  it("classifies lint/format errors", () => {
    const result = classifyError({ stderr: "Expected semicolon but found '}' at line 10" });
    assert.equal(result.errorType, ERROR_TYPES.LINT_FORMAT);
    assert.equal(result.canAutoRepair, true);
  });

  it("classifies import missing errors", () => {
    const result = classifyError({ stderr: "Cannot find module './utils' or corresponding declaration files" });
    assert.equal(result.errorType, ERROR_TYPES.IMPORT_MISSING);
    assert.equal(result.canAutoRepair, true);
  });

  it("classifies export missing errors", () => {
    const result = classifyError({ stderr: "The requested module './foo' does not provide an export named 'Bar'" });
    assert.equal(result.errorType, ERROR_TYPES.EXPORT_MISSING);
    assert.equal(result.canAutoRepair, true);
  });

  it("classifies schema invalid errors", () => {
    const result = classifyError({ stderr: "Validation error: 'name' is required but was not provided" });
    assert.equal(result.errorType, ERROR_TYPES.SCHEMA_INVALID);
    assert.equal(result.canAutoRepair, true);
  });

  it("classifies duplicate definition errors", () => {
    const result = classifyError({ stderr: "Identifier 'foo' has already been declared" });
    assert.equal(result.errorType, ERROR_TYPES.DUPLICATE_DEFINITION);
    assert.equal(result.canAutoRepair, false);
  });

  it("classifies test assertion errors", () => {
    const result = classifyError({ stderr: "expect(received).toBe(expected)" });
    assert.equal(result.errorType, ERROR_TYPES.TEST_ASSERTION);
    assert.equal(result.canAutoRepair, false);
  });

  it("classifies snapshot mismatch", () => {
    const result = classifyError({ stderr: "received value does not match stored snapshot" });
    assert.equal(result.errorType, ERROR_TYPES.SNAPSHOT_MISMATCH);
    assert.equal(result.canAutoRepair, false);
  });

  it("classifies permission errors", () => {
    const result = classifyError({ stderr: "EACCES: permission denied, access '/path/to/file'" });
    assert.equal(result.errorType, ERROR_TYPES.PERMISSION_ERROR);
    assert.equal(result.canAutoRepair, false);
  });

  it("classifies auth errors", () => {
    const result = classifyError({ stderr: "401 Unauthorized: invalid credentials" });
    assert.equal(result.errorType, ERROR_TYPES.AUTH_ERROR);
    assert.equal(result.canAutoRepair, false);
  });

  it("classifies timeout errors", () => {
    const result = classifyError({ stderr: "ETIMEDOUT: connection timed out after 30000ms" });
    assert.equal(result.errorType, ERROR_TYPES.TIMEOUT);
  });

  it("classifies security policy violations", () => {
    const result = classifyError({ stderr: "Content Security Policy violation: script-src 'unsafe-inline'" });
    assert.equal(result.errorType, ERROR_TYPES.SECURITY_POLICY_VIOLATION);
    assert.equal(result.canAutoRepair, false);
  });

  it("returns unknown for unrecognized errors", () => {
    const result = classifyError({ stderr: "some completely unrelated error message xyz123" });
    assert.equal(result.errorType, ERROR_TYPES.UNKNOWN);
    assert.equal(result.canAutoRepair, false);
  });

  it("handles empty result", () => {
    const result = classifyError({});
    assert.equal(result.errorType, ERROR_TYPES.UNKNOWN);
    assert.equal(result.canAutoRepair, false);
  });

  it("extracts fix target from error message", () => {
    const result = classifyError({ stderr: "Cannot find module './my-module'" });
    assert.ok(result.fixTarget);
    assert.equal(result.fixTarget, "./my-module");
  });
});

describe("repair-classifier: getErrorDescription", () => {
  it("returns Chinese descriptions", () => {
    assert.equal(getErrorDescription(ERROR_TYPES.LINT_FORMAT), "代码格式或 lint 错误");
    assert.equal(getErrorDescription(ERROR_TYPES.IMPORT_MISSING), "导入的模块找不到");
    assert.equal(getErrorDescription("unknown"), "未知错误");
  });
});

describe("repair-classifier: shouldEscalateToHuman", () => {
  it("returns true for permission errors", () => {
    assert.equal(shouldEscalateToHuman(ERROR_TYPES.PERMISSION_ERROR), true);
  });

  it("returns true for auth errors", () => {
    assert.equal(shouldEscalateToHuman(ERROR_TYPES.AUTH_ERROR), true);
  });

  it("returns true for test assertion errors", () => {
    assert.equal(shouldEscalateToHuman(ERROR_TYPES.TEST_ASSERTION), true);
  });

  it("returns false for auto-repairable errors", () => {
    assert.equal(shouldEscalateToHuman(ERROR_TYPES.LINT_FORMAT), false);
    assert.equal(shouldEscalateToHuman(ERROR_TYPES.IMPORT_MISSING), false);
  });
});

describe("repair-classifier: classifyErrors", () => {
  it("classifies multiple errors", () => {
    const results = [
      { stderr: "Cannot find module './a'" },
      { stderr: "Expected semicolon" },
    ];
    const classified = classifyErrors(results);
    assert.equal(classified.length, 2);
    assert.equal(classified[0].errorType, ERROR_TYPES.IMPORT_MISSING);
    assert.equal(classified[1].errorType, ERROR_TYPES.LINT_FORMAT);
  });

  it("handles single error as array", () => {
    const classified = classifyErrors({ stderr: "timeout" });
    assert.ok(Array.isArray(classified));
  });
});

describe("repair-classifier: summarizeErrors", () => {
  it("summarizes multiple errors", () => {
    const results = [
      { stderr: "Cannot find module './a'" },
      { stderr: "Expected semicolon" },
      { stderr: "permission denied" },
    ];
    const summary = summarizeErrors(results);
    assert.equal(summary.summary.total, 3);
    assert.equal(summary.summary.autoRepairable, 2);
    assert.equal(summary.summary.requiresHuman, 1);
    assert.equal(summary.summary.byType[ERROR_TYPES.IMPORT_MISSING], 1);
  });

  it("suggests auto_repair when possible", () => {
    const results = [{ stderr: "Cannot find module".toLowerCase() }];
    const summary = summarizeErrors(results);
    assert.equal(summary.建议.action, "auto_repair");
  });

  it("suggests escalate when human required", () => {
    const results = [{ stderr: "permission denied" }];
    const summary = summarizeErrors(results);
    assert.equal(summary.建议.action, "escalate");
  });
});

describe("repair-classifier: ERROR_TYPES", () => {
  it("exports all error types", () => {
    assert.equal(ERROR_TYPES.LINT_FORMAT, "lint_format");
    assert.equal(ERROR_TYPES.IMPORT_MISSING, "import_missing");
    assert.equal(ERROR_TYPES.EXPORT_MISSING, "export_missing");
    assert.equal(ERROR_TYPES.SCHEMA_INVALID, "schema_invalid");
    assert.equal(ERROR_TYPES.DUPLICATE_DEFINITION, "duplicate_definition");
    assert.equal(ERROR_TYPES.TEST_ASSERTION, "test_assertion");
    assert.equal(ERROR_TYPES.SNAPSHOT_MISMATCH, "snapshot_mismatch");
    assert.equal(ERROR_TYPES.PERMISSION_ERROR, "permission_error");
    assert.equal(ERROR_TYPES.AUTH_ERROR, "auth_error");
    assert.equal(ERROR_TYPES.TIMEOUT, "timeout");
    assert.equal(ERROR_TYPES.SECURITY_POLICY_VIOLATION, "security_policy_violation");
    assert.equal(ERROR_TYPES.UNKNOWN, "unknown");
  });
});