import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { safeReadFile, safeWriteFile } from "../lib/filesystem-boundary.js";

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-boundary-audit-"));
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  return dir;
}

// Symlink creation needs admin rights / developer mode on Windows; skip there.
function createSymlinkOrSkip(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (err) {
    t.skip(`symlink unavailable: ${err.message}`);
    return false;
  }
}

describe("filesystem boundary final audit hardening", () => {
  it("rejects reading a workspace symlink that points outside", (t) => {
    const workspace = tmp();
    const outside = path.join(os.tmpdir(), `outside-read-${Date.now()}.txt`);
    fs.writeFileSync(outside, "secret", "utf-8");
    if (!createSymlinkOrSkip(t, outside, path.join(workspace, "lib", "link.txt"))) return;

    const result = safeReadFile(path.join(workspace, "lib", "link.txt"), workspace, { filesystem: { deny: [] } });
    assert.equal(result.ok, false);
    assert.equal(result.error, "path outside workspace");
  });

  it("rejects writing through a workspace symlink that points outside", (t) => {
    const workspace = tmp();
    const outside = path.join(os.tmpdir(), `outside-write-${Date.now()}.txt`);
    fs.writeFileSync(outside, "original", "utf-8");
    if (!createSymlinkOrSkip(t, outside, path.join(workspace, "lib", "link.txt"))) return;

    const result = safeWriteFile(path.join(workspace, "lib", "link.txt"), "pwned", workspace, { filesystem: { deny: [], allowWrite: ["lib/"] } });
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(outside, "utf-8"), "original");
  });
});
