import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

import { updateJsonLocked, readJson } from "../lib/common.js";
import { recordFact, loadFacts } from "../lib/facts.js";

const __filename = fileURLToPath(import.meta.url);

if (!isMainThread) {
  const { file, dir, index } = workerData;
  if (file) {
    updateJsonLocked(file, [], (rows) => [...rows, { id: index }], { lockName: "shared-state" });
  } else {
    recordFact(dir, { subject: "service", predicate: "version", object: String(index), scope: { project: `p${index}` } });
  }
  process.exit(0);
}

function worker(data) {
  return new Promise((resolve, reject) => {
    const instance = new Worker(__filename, { workerData: data });
    instance.once("error", reject);
    instance.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)));
  });
}

describe("whole-file state locking", () => {
  it("preserves every concurrent read-modify-write successor", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-lock-"));
    const file = path.join(dir, "state.json");
    await Promise.all([...Array(12)].map((_, index) => worker({ file, index })));
    const ids = readJson(file, []).map((row) => row.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [...Array(12)].map((_, index) => index));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records concurrent facts without losing independent state", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "facts-lock-"));
    await Promise.all([...Array(8)].map((_, index) => worker({ dir, index })));
    assert.equal(loadFacts(dir).length, 8);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
