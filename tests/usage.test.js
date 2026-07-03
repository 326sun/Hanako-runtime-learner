import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { usageDedupKey, normalizeSeenIds } from "../lib/helpers.js";
import fs from "fs";
import os from "os";
import path from "path";
import { summarizeUsageEntry, usageBootstrapSince, recordUsageBootstrap } from "../lib/usage-pipeline.js";

const summary = {
  date: "2026-06-08T10:00:00.000Z",
  requestId: null,
  status: "success",
  model: "openai/gpt-5",
  subsystem: "chat",
  operation: "completion",
  trigger: "user",
  sessionPath: "D:/sessions/a.jsonl",
  totalTokens: 1234,
  inputTokens: 1000,
  outputTokens: 234,
  reasoningTokens: 0,
  cacheHitRatio: null,
  costTotal: 0.01,
  error: null,
};

describe("usageDedupKey", () => {
  it("preserves requestId keys for compatibility with existing usage_seen.json", () => {
    assert.equal(
      usageDedupKey({ requestId: "req-123", endedAt: summary.date }, { ...summary, requestId: "req-123" }),
      "req-123",
    );
  });

  it("creates a stable fallback key for request-less entries with stable timestamps", () => {
    const entry = { endedAt: summary.date };
    const a = usageDedupKey(entry, summary);
    const b = usageDedupKey({ startedAt: summary.date }, summary);
    assert.match(a, /^usage:[a-f0-9]{16}$/);
    assert.equal(a, b);
  });

  it("changes fallback key when usage identity changes", () => {
    const entry = { endedAt: summary.date };
    const a = usageDedupKey(entry, summary);
    const b = usageDedupKey(entry, { ...summary, totalTokens: 1235 });
    assert.notEqual(a, b);
  });

  it("does not invent a fallback key without requestId or stable timestamp", () => {
    assert.equal(usageDedupKey({}, summary), null);
  });
});

describe("normalizeSeenIds", () => {
  it("treats corrupt persisted seen-id state as empty", () => {
    assert.deepEqual(normalizeSeenIds(null), []);
    assert.deepEqual(normalizeSeenIds({ requestIds: ["a"] }), []);
  });

  it("keeps only non-empty string ids within cap", () => {
    assert.deepEqual(normalizeSeenIds(["a", "", 1, "b", "c"], { cap: 2 }), ["b", "c"]);
  });
});

describe("summarizeUsageEntry", () => {
  it("preserves stable session identifiers from new host payloads", () => {
    const result = summarizeUsageEntry({
      endedAt: summary.date,
      status: "success",
      model: { provider: "openai", modelId: "gpt-5" },
      source: { subsystem: "chat", operation: "completion", trigger: "user" },
      usage: { totalTokens: 1234 },
      attribution: { sessionId: "sess-1", sessionRef: { tabId: "tab-1" }, sessionPath: "D:/sessions/a.jsonl" },
    });
    assert.equal(result.sessionId, "sess-1");
    assert.deepEqual(result.sessionRef, { tabId: "tab-1" });
    assert.equal(result.sessionPath, "D:/sessions/a.jsonl");
  });
});

describe("usage bootstrap cursor", () => {
  it("falls back to a seven-day lookback when no cursor exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `usage-cursor-${process.pid}-`));
    try {
      const stateFile = path.join(dir, "usage_bootstrap_state.json");
      assert.equal(
        usageBootstrapSince(stateFile, { now: Date.parse("2026-07-02T00:00:00.000Z") }),
        "2026-06-25T00:00:00.000Z",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records the newest usage entry timestamp as the next cursor", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `usage-cursor-${process.pid}-`));
    try {
      const stateFile = path.join(dir, "usage_bootstrap_state.json");
      const state = recordUsageBootstrap(stateFile, [
        { startedAt: "2026-07-01T08:00:00.000Z" },
        { endedAt: "2026-07-01T09:30:00.000Z" },
      ], {
        now: Date.parse("2026-07-02T00:00:00.000Z"),
        requestedSince: "2026-06-25T00:00:00.000Z",
      });

      assert.equal(state.lastSeenAt, "2026-07-01T09:30:00.000Z");
      assert.equal(state.lastEntryCount, 2);
      assert.equal(usageBootstrapSince(stateFile), "2026-07-01T09:30:00.000Z");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses lastCheckedAt after an empty bootstrap result", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `usage-cursor-${process.pid}-`));
    try {
      const stateFile = path.join(dir, "usage_bootstrap_state.json");
      recordUsageBootstrap(stateFile, [], {
        now: Date.parse("2026-07-02T00:00:00.000Z"),
        requestedSince: "2026-06-25T00:00:00.000Z",
      });
      assert.equal(usageBootstrapSince(stateFile), "2026-07-02T00:00:00.000Z");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
