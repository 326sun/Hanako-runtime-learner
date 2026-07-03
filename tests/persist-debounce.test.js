// P6.E — persist debounce write-count coverage.
//
// index.js's persistPatterns() coalesces the many flush-triggered persist
// calls in a busy session (one per turn/usage flush) into at most one disk
// write per ~1.5s via a debounce timer; onunload force-flushes synchronously
// so nothing pending is lost on shutdown. This asserts the coalescing
// actually happens (not one write per flush) and that the force-flush path
// still fires exactly once for whatever is pending at unload.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { writeJson } from "../lib/common.js";
import { FakeEventBus, createFakeRuntimeContext, emitSuccessfulTurn } from "./fixtures/fake-hanako-runtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-persist-debounce-"));
const homeDir = path.join(tempRoot, "hana-home");
const pluginDir = path.join(tempRoot, "plugin");
const dataDir = path.join(homeDir, "self-learning");
const patternsPath = path.join(dataDir, "patterns.json");

let RuntimePlugin;
let previousHome;

const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };

async function resetDisk() {
  await fs.promises.rm(homeDir, RM_OPTS);
  await fs.promises.rm(pluginDir, RM_OPTS);
  fs.mkdirSync(pluginDir, { recursive: true });
}

/** Count fs.renameSync calls targeting `file` — the atomic-write "commit" step — while still performing the real rename. */
function countRenamesTo(t, file) {
  let count = 0;
  const original = fs.renameSync;
  t.mock.method(fs, "renameSync", (src, dest) => {
    if (dest === file) count += 1;
    return original(src, dest);
  });
  return () => count;
}

/**
 * Count fs.statSync calls against `file` — persistPatternsNow() always
 * statSyncs PATTERNS_FILE (directly, and via syncDiskStatus) whether or not
 * it ends up writing, so this observes how many times the debounced persist
 * actually *ran*, independent of the P7 dirty-flag write-dedup that can make
 * "final write count" alone an unreliable signal for debounce coalescing.
 */
function countStatsOf(t, file) {
  let count = 0;
  const original = fs.statSync;
  t.mock.method(fs, "statSync", (target, ...rest) => {
    if (target === file) count += 1;
    return original(target, ...rest);
  });
  return () => count;
}

describe("persist debounce write count (P6.E)", () => {
  before(async () => {
    previousHome = process.env.HANA_HOME;
    process.env.HANA_HOME = homeDir;
    RuntimePlugin = (await import(`${pathToFileURL(path.join(root, "index.js")).href}?persist_debounce=${Date.now()}`)).default;
  });

  beforeEach(async () => {
    await resetDisk();
  });

  after(async () => {
    if (previousHome == null) delete process.env.HANA_HOME;
    else process.env.HANA_HOME = previousHome;
    await fs.promises.rm(tempRoot, RM_OPTS);
  });

  it("coalesces several rapid in-window flushes into a single debounced write", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const getRenames = countRenamesTo(t, patternsPath);

    const bus = new FakeEventBus();
    const ctx = createFakeRuntimeContext({ pluginDir, bus });
    const plugin = new RuntimePlugin();
    plugin.ctx = ctx;
    await plugin.onload();

    const sessionPath = path.join(tempRoot, "sessions", "debounce-project", "turn.jsonl");

    // Start counting only after onload's own housekeeping settles, so the
    // stat count below reflects just the 5 turn flushes.
    const getStats = countStatsOf(t, patternsPath);

    for (let i = 0; i < 5; i++) {
      emitSuccessfulTurn(bus, sessionPath, {
        userText: `turn ${i}: read the target file and edit the implementation`,
        tools: ["read", "edit"],
      });
    }

    // Five flushes each queued a debounced persist, but the timer is mocked
    // and none have fired yet — no write and no persistPatternsNow run yet.
    assert.equal(getRenames(), 0, "no write before the debounce timer fires");
    assert.equal(getStats(), 0, "persistPatternsNow should not run before the debounce timer fires");

    // Advance past the ~1.5s debounce window once.
    t.mock.timers.tick(1600);
    assert.equal(getRenames(), 1, "five rapid flushes should coalesce into exactly one write");
    // persistPatternsNow itself statSyncs PATTERNS_FILE twice per run (once in
    // syncDiskStatus, once directly) — a broken debounce (one timer per
    // flush) would run it 5x instead of once, i.e. ~10 stats instead of ~2.
    assert.ok(getStats() <= 2, `expected persistPatternsNow to run once (<=2 stats), got ${getStats()} stats`);

    t.mock.timers.reset();
    await plugin.onunload();
  });

  it("force-flushes exactly once on unload even with a pending debounced write", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const getRenames = countRenamesTo(t, patternsPath);

    const bus = new FakeEventBus();
    const ctx = createFakeRuntimeContext({ pluginDir, bus });
    const plugin = new RuntimePlugin();
    plugin.ctx = ctx;
    await plugin.onload();

    const sessionPath = path.join(tempRoot, "sessions", "unload-project", "turn.jsonl");
    emitSuccessfulTurn(bus, sessionPath, {
      userText: "read the target file and edit the implementation",
      tools: ["read", "edit"],
    });

    assert.equal(getRenames(), 0, "no write yet — debounce timer hasn't fired");

    t.mock.timers.reset();
    await plugin.onunload();

    assert.equal(getRenames(), 1, "onunload must force-flush the pending write exactly once");
  });

  it("does not write when a flush produces no detector changes (no-op stays no-op under debounce)", async (t) => {
    // Seed an approved workflow pattern on disk with a fixed mtime so the
    // detector's restored state exactly matches what's already persisted.
    fs.mkdirSync(path.dirname(patternsPath), { recursive: true });
    writeJson(patternsPath, [{
      id: "workflow:seeded-debounce",
      type: "workflow",
      status: "approved",
      score: 12,
      count: 3,
      desc: "seeded workflow",
      fix: "keep seeded workflow",
      tools: ["read", "edit"],
      context: { categories: ["file_management", "coding"], taskType: "coding" },
      scope: { project: "general", taskType: "coding" },
      firstSeen: "2026-06-01T00:00:00.000Z",
      lastSeen: "2026-06-30T00:00:00.000Z",
    }]);

    t.mock.timers.enable({ apis: ["setTimeout"] });
    const getRenames = countRenamesTo(t, patternsPath);

    const ctx = createFakeRuntimeContext({ pluginDir });
    const plugin = new RuntimePlugin();
    plugin.ctx = ctx;
    await plugin.onload();

    t.mock.timers.reset();
    await plugin.onunload();

    assert.equal(getRenames(), 0, "unchanged detector state must not trigger a write even at force-flush");
  });
});
