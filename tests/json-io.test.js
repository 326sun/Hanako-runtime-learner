import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { readJson, writeJson, writeJsonIfChanged } from "../lib/json-io.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanako-json-io-"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("writeJsonIfChanged", () => {
  it("creates parent directories and writes JSON atomically", () => {
    const file = path.join(tmpDir(), "nested", "state.json");

    assert.equal(writeJsonIfChanged(file, { ok: true }), true);

    assert.deepEqual(readJson(file, null), { ok: true });
  });

  it("skips writing when serialized content is unchanged", async () => {
    const file = path.join(tmpDir(), "state.json");
    writeJson(file, { a: 1, b: ["x"] });
    const before = fs.statSync(file).mtimeMs;

    await sleep(20);
    const changed = writeJsonIfChanged(file, { a: 1, b: ["x"] });
    const after = fs.statSync(file).mtimeMs;

    assert.equal(changed, false);
    assert.equal(after, before);
  });

  it("rewrites when serialized content changes", async () => {
    const file = path.join(tmpDir(), "state.json");
    writeJson(file, { value: 1 });
    const before = fs.statSync(file).mtimeMs;

    await sleep(20);
    const changed = writeJsonIfChanged(file, { value: 2 });
    const after = fs.statSync(file).mtimeMs;

    assert.equal(changed, true);
    assert.ok(after > before, `expected mtime to increase: before=${before}, after=${after}`);
    assert.deepEqual(readJson(file, null), { value: 2 });
  });
});
