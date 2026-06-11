import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCommandAllowed } from "../lib/command-allowlist.js";
import { isAllowedCommand } from "../lib/action-executor.js";

const policy = {
  commands: {
    allowlist: ["node --check", "npm test"],
    denylist: ["rm", "git push", "npm publish"],
  },
};

describe("command allowlist hardening", () => {
  it("does not reject safe paths containing denied substrings", () => {
    const result = isCommandAllowed("node --check lib/formatter.js", policy);
    assert.equal(result.allowed, true);
    assert.equal(isAllowedCommand("node --check lib/formatter.js", { autoActionCommands: policy.commands }), true);
  });

  it("rejects dangerous shell segments", () => {
    assert.equal(isCommandAllowed("npm test && rm -rf .", policy).allowed, false);
    assert.equal(isCommandAllowed("git push origin main", policy).allowed, false);
    assert.equal(isAllowedCommand("npm test && rm -rf .", { autoActionCommands: policy.commands }), false);
  });
});
