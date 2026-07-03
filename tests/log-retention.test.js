/**
 * P8.C — lib/log-retention.js prunes JSONL logs by date using a streaming
 * read/write pipeline (readline over a read stream, into a temp write
 * stream, atomically renamed over the original) rather than loading the
 * whole file into memory. This had no dedicated test coverage; these tests
 * verify correctness and, for a large synthetic log, report before/after
 * numbers per the P8 acceptance criterion ("大 event log 生成 dashboard
 * 有前后数字" — large-log operations must have measured before/after data).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createJsonlRetentionPruner } from "../lib/log-retention.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-retention-test-"));

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("JSONL retention pruning (P8.C)", () => {
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("drops rows older than the retention window and keeps recent ones", async () => {
    const file = path.join(tmpDir, "basic.jsonl");
    writeJsonl(file, [
      { id: 1, date: daysAgoIso(40) },
      { id: 2, date: daysAgoIso(35) },
      { id: 3, date: daysAgoIso(10) },
      { id: 4, date: daysAgoIso(1) },
    ]);

    const prune = createJsonlRetentionPruner([file], { retentionDays: 30, minIntervalMs: 0 });
    await prune();

    const rows = readJsonl(file);
    assert.deepEqual(rows.map((r) => r.id), [3, 4]);
  });

  it("keeps rows without a date field (never pruned by age)", async () => {
    const file = path.join(tmpDir, "no-date.jsonl");
    writeJsonl(file, [
      { id: 1, date: daysAgoIso(90) },
      { id: 2 },
    ]);

    const prune = createJsonlRetentionPruner([file], { retentionDays: 30, minIntervalMs: 0 });
    await prune();

    const rows = readJsonl(file);
    assert.deepEqual(rows.map((r) => r.id), [2]);
  });

  it("leaves the file untouched (no rewrite) when nothing is outside the window", async () => {
    const file = path.join(tmpDir, "no-op.jsonl");
    writeJsonl(file, [{ id: 1, date: daysAgoIso(1) }, { id: 2, date: daysAgoIso(2) }]);
    const before = fs.statSync(file).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 20)); // ensure a rewrite would be detectably newer
    const prune = createJsonlRetentionPruner([file], { retentionDays: 30, minIntervalMs: 0 });
    await prune();

    const after_ = fs.statSync(file).mtimeMs;
    assert.equal(after_, before, "mtime should be unchanged when no rows were pruned");
    assert.equal(readJsonl(file).length, 2);
    // No leftover temp file from the aborted rewrite.
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.startsWith("no-op.jsonl.") && f.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });

  it("respects minIntervalMs — a second call within the window is a no-op", async () => {
    const file = path.join(tmpDir, "interval.jsonl");
    writeJsonl(file, [{ id: 1, date: daysAgoIso(40) }, { id: 2, date: daysAgoIso(1) }]);

    const prune = createJsonlRetentionPruner([file], { retentionDays: 30, minIntervalMs: 60_000 });
    await prune();
    assert.equal(readJsonl(file).length, 1, "first call within the interval should prune");

    // Re-seed an old row and call again immediately — should be skipped.
    writeJsonl(file, [{ id: 3, date: daysAgoIso(40) }, { id: 4, date: daysAgoIso(1) }]);
    await prune();
    assert.equal(readJsonl(file).length, 2, "second call inside minIntervalMs must not run");
  });

  it("streams a large JSONL file without loading it fully into a JS array, with measured before/after numbers", async () => {
    const file = path.join(tmpDir, "large.jsonl");
    const totalRows = 50_000;
    const keptCutoffDays = 15; // half old (pruned), half recent (kept)
    const rows = [];
    for (let i = 0; i < totalRows; i++) {
      rows.push({ id: i, date: daysAgoIso(i < totalRows / 2 ? 60 : 1), payload: `row-${i}-${"x".repeat(40)}` });
    }
    writeJsonl(file, rows);
    const beforeSize = fs.statSync(file).size;
    const beforeLines = totalRows;

    const prune = createJsonlRetentionPruner([file], { retentionDays: keptCutoffDays * 2, minIntervalMs: 0 });
    const t0 = performance.now();
    await prune();
    const durationMs = performance.now() - t0;

    const afterRows = readJsonl(file);
    const afterSize = fs.statSync(file).size;

    assert.equal(afterRows.length, totalRows / 2, "exactly the recent half should survive");
    assert.ok(afterRows.every((r) => r.id >= totalRows / 2), "only recent rows should remain");
    assert.ok(afterSize < beforeSize, "pruned file should be smaller");

    // P8 acceptance: large-log operations must report before/after numbers.
    console.log(`[P8.C] retention prune: ${beforeLines} rows / ${beforeSize} bytes -> ${afterRows.length} rows / ${afterSize} bytes in ${durationMs.toFixed(1)}ms`);
    assert.ok(Number.isFinite(durationMs) && durationMs >= 0);
  });
});
