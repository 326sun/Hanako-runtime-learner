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

  it("denies a dangerous verb even when written with an executable extension", () => {
    // The dangerous-verb denylist must not be bypassable by appending .exe/.cmd/.bat.
    const exePolicy = { commands: { allowlist: ["rm.exe", "del.cmd"], denylist: [] } };
    assert.equal(isCommandAllowed("rm.exe -rf /tmp/x", exePolicy).allowed, false);
    assert.equal(isCommandAllowed("del.cmd /s C:/tmp", exePolicy).allowed, false);
  });

  it("denies node --loader / --experimental-loader which run code under --check", () => {
    const nodePolicy = { commands: { allowlist: ["node"], denylist: [] } };
    assert.equal(isCommandAllowed("node --loader ./evil.mjs --check app.js", nodePolicy).allowed, false);
    assert.equal(isCommandAllowed("node --experimental-loader=./evil.mjs --check app.js", nodePolicy).allowed, false);
  });
});
