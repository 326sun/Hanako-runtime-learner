import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCommandAllowed } from "../lib/command-allowlist.js";

const policy = {
  commands: {
    allowlist: ["node --check", "npm test", "npm run check"],
    denylist: ["rm", "git push", "npm publish"],
  },
};

describe("command allowlist final audit hardening", () => {
  it("allows simple allowlisted commands and safe denied substrings", () => {
    assert.equal(isCommandAllowed("node --check lib/formatter.js", policy).allowed, true);
  });

  it("rejects npm project scripts even when present in a normal allowlist", () => {
    assert.equal(isCommandAllowed("npm test", policy).allowed, false);
    assert.equal(isCommandAllowed("npm run check", policy).allowed, false);
    assert.equal(isCommandAllowed("npm run lint", { commands: { ...policy.commands, allowlist: [...policy.commands.allowlist, "npm run lint"] } }).allowed, false);
    assert.equal(isCommandAllowed("npm run build", { commands: { ...policy.commands, allowlist: [...policy.commands.allowlist, "npm run build"] } }).allowed, false);
  });

  it("uses the shared project-script parser when project script execution is explicitly enabled", () => {
    const result = isCommandAllowed("npm run build", {
      commands: { ...policy.commands, allowlist: [...policy.commands.allowlist, "npm run build"], allowProjectScripts: true },
    });
    assert.equal(result.allowed, true);
  });

  it("rejects shell metacharacters even when the command starts with an allowlisted prefix", () => {
    const commands = [
      "npm test && npm run check",
      "npm test || npm run check",
      "node --check $(echo lib/common.js)",
      "node --check `echo lib/common.js`",
      "node --check !echo",
      "node --check lib/common.js > /tmp/out",
      "node --check lib/common.js; npm run check",
    ];
    for (const command of commands) {
      assert.equal(isCommandAllowed(command, policy).allowed, false, command);
    }
  });

  it("rejects dangerous node runtime flags even under an allowlisted prefix", () => {
    const commands = [
      "node --check --eval console.log(1)",
      "node --check -e console.log(1)",
      "node --check --print process.env",
      "node --check -p process.env",
      "node --check --require ./hook.js lib/common.js",
      "node --check --import ./hook.mjs lib/common.js",
    ];
    for (const command of commands) {
      assert.equal(isCommandAllowed(command, policy).allowed, false, command);
    }
  });
});
