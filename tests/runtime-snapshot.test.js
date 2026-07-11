import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { DEFAULT_CONFIG } from "../lib/common.js";
import { loadRuntimeSnapshot } from "../tools/runtime-snapshot.js";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf-8");
}

function makeRuntimeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `runtime-snapshot-${process.pid}-`));
  const dataDir = path.join(root, "data");
  const pluginDir = path.join(root, "plugin");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });

  writeJson(path.join(dataDir, "runtime-config.json"), {
    ...DEFAULT_CONFIG,
    minInjectScore: 1,
    minInjectCount: 1,
  });
  writeJson(path.join(dataDir, "patterns.json"), [{
    id: "wf:test",
    type: "workflow",
    status: "approved",
    score: 10,
    count: 3,
    firstSeen: "2026-06-01T00:00:00.000Z",
    lastSeen: "2026-06-30T00:00:00.000Z",
    desc: "run tests",
    fix: "npm test",
    scope: { project: "general", taskType: "coding" },
  }]);
  writeJson(path.join(dataDir, "facts.json"), [{ subject: "repo", predicate: "uses", object: "node" }]);
  writeJson(path.join(dataDir, "proposals", "one.json"), { id: "proposal:one", status: "pending", updatedAt: "2026-06-30T00:00:00.000Z" });
  writeJson(path.join(dataDir, "reviews", "one.json"), { id: "review:one", status: "queued", updatedAt: "2026-06-30T00:00:00.000Z" });
  writeJson(path.join(pluginDir, "manifest.json"), { id: "hanako-runtime-learner", version: "test" });
  writeJsonl(path.join(dataDir, "experience_log.jsonl"), [{
    date: "2026-06-30T00:00:00.000Z",
    taskType: "coding",
    sessionId: "s1",
  }]);
  writeJsonl(path.join(dataDir, "error_log.jsonl"), []);
  writeJsonl(path.join(dataDir, "turns.jsonl"), []);
  writeJsonl(path.join(dataDir, "activity_log.jsonl"), []);
  return { root, dataDir, pluginDir };
}

describe("runtime snapshot", () => {
  it("loads only the requested shared runtime state", () => {
    const store = makeRuntimeStore();
    try {
      const snapshot = loadRuntimeSnapshot({ dataDir: store.dataDir, pluginDir: store.pluginDir }, {
        includeDecorated: true,
        includeProposals: true,
        includeReviews: true,
        includeLogs: true,
        includeFacts: true,
        includeManifest: true,
      });

      assert.equal(snapshot.paths.learnerDir, store.dataDir);
      assert.equal(snapshot.patterns.length, 1);
      assert.equal(snapshot.decoratedPatterns.length, 1);
      assert.equal(snapshot.decoratedPatterns[0].injectable, true);
      assert.equal(snapshot.proposals.length, 1);
      assert.equal(snapshot.reviews.length, 1);
      assert.equal(snapshot.facts.length, 1);
      assert.equal(snapshot.manifest.version, "test");
      assert.equal(snapshot.logs.experience.count, 1);
      assert.equal(snapshot.logs.experience.coverage.withStableIdentity, 1);
      assert.equal(snapshot.logs.experience.sessions[0].sessionKey, "sid:s1");
      assert.deepEqual(snapshot.logs.turns.sessions, []);
      assert.deepEqual(snapshot.logs.activity.sessions, []);
    } finally {
      fs.rmSync(store.root, { recursive: true, force: true });
    }
  });

  it("does not load optional heavy fields by default", () => {
    const store = makeRuntimeStore();
    try {
      const snapshot = loadRuntimeSnapshot({ dataDir: store.dataDir, pluginDir: store.pluginDir });

      assert.ok(snapshot.config);
      assert.equal("patterns" in snapshot, true);
      assert.equal("decoratedPatterns" in snapshot, false);
      assert.equal("proposals" in snapshot, false);
      assert.equal("reviews" in snapshot, false);
      assert.equal("logs" in snapshot, false);
      assert.equal("facts" in snapshot, false);
      assert.equal("manifest" in snapshot, false);
    } finally {
      fs.rmSync(store.root, { recursive: true, force: true });
    }
  });
});
