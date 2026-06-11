import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { projectScriptsFingerprint, validateProjectScriptTrust } from "../lib/project-script-trust.js";
import { runSandboxedCommand } from "../lib/command-allowlist.js";
import { isAllowedCommand } from "../lib/action-executor.js";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "project-script-trust-"));
}

function writePackage(root, scripts) {
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts }, null, 2), "utf-8");
}

describe("project script trust gate", () => {
  it("requires an approved scripts hash before project scripts run", () => {
    const root = tmpdir();
    try {
      writePackage(root, { test: "node --version" });
      const policy = { commands: { allowProjectScripts: true } };
      const readiness = validateProjectScriptTrust("npm test", { cwd: root, policy });
      assert.equal(readiness.ok, false);
      assert.equal(readiness.decision, "manual_confirm");
      assert.match(readiness.reason, /hash has not been approved/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows project scripts when the package scripts hash is trusted", async () => {
    const root = tmpdir();
    try {
      writePackage(root, { test: "node --version" });
      const { scriptsHash } = projectScriptsFingerprint(root);
      const policy = { commands: { allowlist: ["npm test"], denylist: [], allowProjectScripts: true, projectScripts: { scriptsHash } } };
      const readiness = validateProjectScriptTrust("npm test", { cwd: root, policy });
      assert.equal(readiness.ok, true);

      const result = await runSandboxedCommand("npm test", { cwd: root, policy, timeout: 10000 });
      assert.equal(result.status, "succeeded");
      assert.match(result.stdout, /v\d+\.\d+\.\d+/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("revokes trust when package scripts change", () => {
    const root = tmpdir();
    try {
      writePackage(root, { test: "node --version" });
      const { scriptsHash } = projectScriptsFingerprint(root);
      const policy = { commands: { allowProjectScripts: true, projectScripts: { scriptsHash } } };
      assert.equal(validateProjectScriptTrust("npm test", { cwd: root, policy }).ok, true);

      writePackage(root, { test: "node -e console.log('changed')" });
      const readiness = validateProjectScriptTrust("npm test", { cwd: root, policy });
      assert.equal(readiness.ok, false);
      assert.equal(readiness.decision, "manual_confirm");
      assert.match(readiness.reason, /scripts changed/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries trusted script hashes through the action executor command helper", () => {
    const root = tmpdir();
    try {
      writePackage(root, { test: "node --version" });
      const { scriptsHash } = projectScriptsFingerprint(root);
      const config = { autoActionCommands: { allowlist: ["npm test"], denylist: [], allowProjectScripts: true, projectScripts: { scriptsHash } } };
      assert.equal(isAllowedCommand("npm test", config, { cwd: root }), true);

      writePackage(root, { test: "node -e console.log('changed')" });
      assert.equal(isAllowedCommand("npm test", config, { cwd: root }), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
