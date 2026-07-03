import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { clearFileCache, fileCacheStats, readJsonCached } from "../lib/file-cache.js";
import { writeJsonIfChanged } from "../lib/json-io.js";
import { loadPatterns } from "../tools/_shared.js";

function tmpFile(name = "data.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-file-cache-"));
  return path.join(dir, name);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("file-cache", () => {
  beforeEach(() => clearFileCache());

  it("reuses cached JSON while file signature is unchanged", () => {
    const file = tmpFile();
    writeJson(file, [{ id: "a" }]);

    const first = readJsonCached(file, []);
    const second = readJsonCached(file, []);

    assert.equal(second, first);
    assert.deepEqual(second, [{ id: "a" }]);
    assert.equal(fileCacheStats().entries, 1);
  });

  it("invalidates when mtime or size changes", async () => {
    const file = tmpFile();
    writeJson(file, [{ id: "a" }]);
    assert.deepEqual(readJsonCached(file, []), [{ id: "a" }]);

    await sleep(20);
    writeJson(file, [{ id: "b" }, { id: "c" }]);

    assert.deepEqual(readJsonCached(file, []), [{ id: "b" }, { id: "c" }]);
  });

  it("can clear one cached file without clearing others", () => {
    const one = tmpFile("one.json");
    const two = tmpFile("two.json");
    writeJson(one, { one: true });
    writeJson(two, { two: true });
    readJsonCached(one, null);
    readJsonCached(two, null);

    clearFileCache(one);

    assert.equal(fileCacheStats().entries, 1);
    assert.deepEqual(readJsonCached(two, null), { two: true });
  });

  it("loadPatterns uses the mtime-aware JSON cache", async () => {
    const file = tmpFile("patterns.json");
    writeJson(file, [{ id: "wf:a", type: "workflow" }]);
    const first = loadPatterns(file);
    const second = loadPatterns(file);
    assert.equal(second, first);

    await sleep(20);
    writeJson(file, [{ id: "wf:b", type: "workflow" }]);
    assert.deepEqual(loadPatterns(file).map((pattern) => pattern.id), ["wf:b"]);
  });

  it("writeJsonIfChanged clears a cached JSON file after writing new content", () => {
    const file = tmpFile("write-clears-cache.json");
    writeJson(file, { value: 1 });

    assert.deepEqual(readJsonCached(file, {}), { value: 1 });
    assert.equal(fileCacheStats().entries, 1);

    assert.equal(writeJsonIfChanged(file, { value: 2 }), true);
    assert.equal(fileCacheStats().entries, 0);
    assert.deepEqual(readJsonCached(file, {}), { value: 2 });
  });
});
