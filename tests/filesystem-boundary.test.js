import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import {
  isWithinWorkspace,
  isPathForbidden,
  isWriteAllowed,
  safeReadFile,
  safeWriteFile,
} from "../lib/filesystem-boundary.js";

const tmpDir = path.join(os.tmpdir(), "learner-fs-boundary-test-" + Date.now());

describe("filesystem-boundary", () => {
  it("detects within workspace", () => {
    assert.equal(isWithinWorkspace(tmpDir, tmpDir), true);
    assert.equal(isWithinWorkspace(path.join(tmpDir, "sub"), tmpDir), true);
  });

  it("detects outside workspace", () => {
    assert.equal(isWithinWorkspace("/outside", tmpDir), false);
  });

  it("detects forbidden path", () => {
    const policy = { filesystem: { deny: [".env", "secrets"] } };
    assert.equal(isPathForbidden(path.join(tmpDir, ".env"), policy).forbidden, true);
    assert.equal(isPathForbidden(path.join(tmpDir, "lib", "ok.js"), policy).forbidden, false);
  });

  it("checks write allowed", () => {
    const policy = { filesystem: { deny: [".env"], allowWrite: ["lib/", "src/"] } };
    assert.equal(isWriteAllowed(path.join(tmpDir, "lib", "a.js"), tmpDir, policy).allowed, true);
    assert.equal(isWriteAllowed(path.join(tmpDir, "outside", "a.js"), tmpDir, policy).allowed, false);
  });

  it("safeReadFile reads existing file", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const testFile = path.join(tmpDir, "test.txt");
    fs.writeFileSync(testFile, "hello", "utf-8");
    const result = safeReadFile(testFile, tmpDir, {});
    assert.equal(result.ok, true);
    assert.equal(result.content, "hello");
  });

  it("safeReadFile rejects outside workspace", () => {
    const result = safeReadFile("/outside.txt", tmpDir, {});
    assert.equal(result.ok, false);
  });

  it("safeWriteFile writes inside workspace", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const testFile = path.join(tmpDir, "write.txt");
    const result = safeWriteFile(testFile, "content", tmpDir, { filesystem: { deny: [] } });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(testFile, "utf-8"), "content");
  });

  it("safeWriteFile rejects forbidden path", () => {
    const testFile = path.join(tmpDir, ".env");
    const result = safeWriteFile(testFile, "x", tmpDir, { filesystem: { deny: [".env"] } });
    assert.equal(result.ok, false);
  });

  it("safeWriteFile keeps the original file when atomic rename fails", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const testFile = path.join(tmpDir, "atomic.txt");
    fs.writeFileSync(testFile, "old", "utf-8");
    const originalRename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (String(to) === testFile) throw new Error("simulated rename failure");
      return originalRename(from, to);
    };
    try {
      const result = safeWriteFile(testFile, "new", tmpDir, { filesystem: { deny: [] } });
      assert.equal(result.ok, false);
      assert.match(result.error, /simulated rename failure/);
      assert.equal(fs.readFileSync(testFile, "utf-8"), "old");
      const leftovers = fs.readdirSync(tmpDir).filter((name) => name.startsWith("atomic.txt.") && name.endsWith(".tmp"));
      assert.deepEqual(leftovers, []);
    } finally {
      fs.renameSync = originalRename;
    }
  });
});
