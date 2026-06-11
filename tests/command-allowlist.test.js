import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isCommandAllowed,
  runSandboxedCommand,
} from "../lib/command-allowlist.js";

describe("command-allowlist", () => {
  it("allows listed non-project command", () => {
    const policy = { commands: { allowlist: ["node --version"], denylist: [] } };
    const check = isCommandAllowed("node --version", policy);
    assert.equal(check.allowed, true);
  });

  it("requires explicit project-script permission for npm scripts", () => {
    const policy = { commands: { allowlist: ["npm test"], denylist: [] } };
    assert.equal(isCommandAllowed("npm test", policy).allowed, false);
    assert.equal(isCommandAllowed("npm test", { commands: { ...policy.commands, allowProjectScripts: true } }).allowed, true);
  });

  it("rejects denied substring", () => {
    const policy = { commands: { allowlist: ["npm test"], denylist: ["git push"] } };
    const check = isCommandAllowed("git push origin main", policy);
    assert.equal(check.allowed, false);
  });

  it("rejects unknown command", () => {
    const policy = { commands: { allowlist: ["npm test"], denylist: [] } };
    const check = isCommandAllowed("rm -rf /", policy);
    assert.equal(check.allowed, false);
  });

  it("rejects empty command", () => {
    const check = isCommandAllowed("", {});
    assert.equal(check.allowed, false);
  });

  it("runs allowed command successfully", async () => {
    const policy = { commands: { allowlist: ["node --version"], denylist: [] } };
    const result = await runSandboxedCommand("node --version", { policy, timeout: 5000 });
    assert.equal(result.status, "succeeded");
    assert.ok(result.stdout.includes("v"));
  });

  it("rejects disallowed command execution", async () => {
    const policy = { commands: { allowlist: ["npm test"], denylist: [] } };
    const result = await runSandboxedCommand("rm -rf /", { policy });
    assert.equal(result.status, "rejected");
  });
});
