import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { createActionTransaction, writeTransactionFile } from "../lib/action-transaction.js";

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "action-txn-boundary-"));
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  return dir;
}

function createSymlinkOrSkip(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (err) {
    t.skip(`symlink unavailable: ${err.message}`);
    return false;
  }
}

describe("action transaction filesystem boundary", () => {
  it("rejects writes through workspace symlinks that point outside", (t) => {
    const root = workspace();
    const outside = path.join(os.tmpdir(), `action-txn-outside-${Date.now()}.txt`);
    fs.writeFileSync(outside, "original", "utf-8");
    if (!createSymlinkOrSkip(t, outside, path.join(root, "lib", "link.txt"))) return;

    const txn = createActionTransaction({ workspaceRoot: root, actionId: "symlink-test" });
    assert.throws(
      () => writeTransactionFile(txn, "lib/link.txt", "pwned"),
      /path outside workspace/
    );
    assert.equal(fs.readFileSync(outside, "utf-8"), "original");
  });

  it("rejects symlink paths when snapshotting transaction files", (t) => {
    const root = workspace();
    const outside = path.join(os.tmpdir(), `action-txn-snapshot-${Date.now()}.txt`);
    fs.writeFileSync(outside, "original", "utf-8");
    if (!createSymlinkOrSkip(t, outside, path.join(root, "lib", "link.txt"))) return;

    assert.throws(
      () => createActionTransaction({ workspaceRoot: root, actionId: "snapshot-test", filePaths: ["lib/link.txt"] }),
      /path outside workspace/
    );
  });
});
