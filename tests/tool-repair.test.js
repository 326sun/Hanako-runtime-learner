import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldRetryToolCall, suggestToolRepair, buildRepairHint } from "../lib/tool-repair.js";
import { PatternDetector } from "../lib/pattern-detector.js";
import { DEFAULT_CONFIG } from "../lib/common.js";

describe("tool-call repair", () => {
  it("does not retry non-retryable file/path/permission errors", () => {
    for (const type of ["file_not_found", "path_error", "permission_denied", "command_not_found", "syntax_error", "auth_error"]) {
      assert.equal(shouldRetryToolCall(type), false, `${type} should not be retried blindly`);
      const repair = suggestToolRepair({ errorType: type });
      assert.equal(repair.retry, false);
      assert.ok(repair.repairPlan.length > 0);
    }
  });

  it("allows cautious retry for network/model errors", () => {
    assert.equal(shouldRetryToolCall("network_error"), true);
    assert.equal(shouldRetryToolCall("model_error"), true);
    assert.match(buildRepairHint({ errorType: "network_error" }), /transient|Retry/i);
  });

  it("attaches repairPlan to error patterns", () => {
    const detector = new PatternDetector(DEFAULT_CONFIG);
    const { pattern } = detector.ingestError({ date: new Date().toISOString(), errorType: "file_not_found", errorDesc: "ENOENT", severity: 3, tool: "read" });
    assert.equal(pattern.retryable, false);
    assert.equal(pattern.repairPlan.errorType, "file_not_found");
    assert.match(pattern.fix, /file_not_found|do not retry/i);
  });
});
