import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

import { verifyEventLog } from "../lib/event-log.js";

const __filename = fileURLToPath(import.meta.url);

// Worker entry: do not import node:test here, just append and exit.
if (!isMainThread) {
  const { appendEvent } = await import("../lib/event-log.js");
  const { baseDir, workerIndex, count } = workerData;
  for (let i = 0; i < count; i++) {
    appendEvent(baseDir, {
      type: "proposal.created",
      entityType: "proposal",
      entityId: `w${workerIndex}-e${i}`,
      summary: `worker ${workerIndex} event ${i}`,
      date: "2026-06-09T00:00:00.000Z",
    });
  }
  // Explicitly terminate the worker event loop so node:test registration in
  // the top-level import below is never executed.
  process.exit(0);
}

describe("event log cross-process concurrency", () => {
  it("keeps the hash chain intact under concurrent appends", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "event-log-concurrent-"));
    fs.mkdirSync(dir, { recursive: true });

    const count = 25;
    const workers = 4;
    const spawned = [];
    for (let i = 0; i < workers; i++) {
      spawned.push(new Promise((resolve, reject) => {
        const w = new Worker(__filename, {
          workerData: { baseDir: dir, workerIndex: i, count },
        });
        w.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`worker ${i} exited with ${code}`));
        });
        w.on("error", reject);
      }));
    }
    await Promise.all(spawned);

    const result = verifyEventLog(dir);
    assert.equal(result.ok, true, `chain broken at ${result.brokenAt}: ${result.reason}`);
    assert.equal(result.events, workers * count);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
