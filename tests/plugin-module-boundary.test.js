import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { loadActionPackage } from "../lib/action-loader.js";
import { resolvePluginModulePath } from "../lib/plugin-module-boundary.js";

function tmp(prefix = "plugin-module-boundary-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createSymlinkOrSkip(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, "file");
    return true;
  } catch (err) {
    t.skip(`symlink unavailable: ${err.message}`);
    return false;
  }
}

describe("plugin module boundary", () => {
  it("rejects module paths outside the action package", () => {
    const actionsRoot = tmp("plugin-module-actions-");
    const packageDir = path.join(actionsRoot, "safe_action");
    const outsideDir = tmp("plugin-module-outside-");
    const outsideModule = path.join(outsideDir, "execute.js");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(outsideModule, "export async function execute() {}\n", "utf-8");

    const result = resolvePluginModulePath(outsideModule, packageDir, { label: "execute.js" });

    assert.equal(result.ok, false);
    assert.match(result.error, /escapes action package/);
  });

  it("rejects symlinked action package modules", (t) => {
    const actionsRoot = tmp("plugin-module-symlink-actions-");
    const packageDir = path.join(actionsRoot, "linked_action");
    const outsideDir = tmp("plugin-module-symlink-outside-");
    const outsideModule = path.join(outsideDir, "execute.js");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "action.json"), JSON.stringify({
      name: "linked_action",
      riskTier: "R1",
      autoExecutable: true,
      permissions: { filesystem: "read" },
      verification: { required: false },
    }, null, 2), "utf-8");
    fs.writeFileSync(outsideModule, "export async function execute() { return { status: 'succeeded' }; }\n", "utf-8");
    if (!createSymlinkOrSkip(t, outsideModule, path.join(packageDir, "execute.js"))) return;

    const loaded = loadActionPackage(packageDir, { actionsRoot });

    assert.equal(loaded.ok, false);
    assert.match(loaded.errors.join("\n"), /regular file inside action package/);
  });

  it("rejects package-declared commands outside the loader command policy", () => {
    const actionsRoot = tmp("plugin-command-policy-actions-");
    const packageDir = path.join(actionsRoot, "command_action");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "action.json"), JSON.stringify({
      name: "command_action",
      riskTier: "R1",
      autoExecutable: true,
      permissions: { filesystem: "read" },
      verification: {
        required: true,
        commands: ["powershell -NoProfile -Command Get-ChildItem"],
      },
    }, null, 2), "utf-8");
    fs.writeFileSync(path.join(packageDir, "execute.js"), "export async function execute() { return { status: 'succeeded' }; }\n", "utf-8");

    const loaded = loadActionPackage(packageDir, { actionsRoot });

    assert.equal(loaded.ok, false);
    assert.match(loaded.errors.join("\n"), /declared command not allowed by action loader command policy/);
    assert.match(loaded.errors.join("\n"), /command not in allowlist/);
  });
});
