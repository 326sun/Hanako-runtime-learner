import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { appendEvent, eventLogPath, readEvents, verifyEventLog } from "../lib/event-log.js";
import { execute as executeControl } from "../tools/control.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-log-test-"));

describe("event log hash chain", () => {
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends events with a verifiable hash chain", () => {
    const dir = path.join(tmpDir, "valid");
    const first = appendEvent(dir, { type: "proposal.created", entityType: "proposal", entityId: "p1", summary: "created", date: "2026-06-09T00:00:00.000Z" });
    const second = appendEvent(dir, { type: "review.queued", entityType: "review", entityId: "r1", summary: "queued", date: "2026-06-09T00:00:01.000Z" });

    assert.equal(first.prevHash, "");
    assert.equal(second.prevHash, first.hash);

    const result = verifyEventLog(dir);
    assert.equal(result.ok, true);
    assert.equal(result.events, 2);
    assert.equal(result.rootHash, "");
    assert.equal(result.headHash, second.hash);
    assert.equal(result.brokenAt, null);
  });

  it("detects tampered event payloads", () => {
    const dir = path.join(tmpDir, "tampered");
    appendEvent(dir, { type: "proposal.created", entityType: "proposal", entityId: "p1", summary: "created" });
    appendEvent(dir, { type: "review.queued", entityType: "review", entityId: "r1", summary: "queued" });

    const file = eventLogPath(dir);
    const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
    const tampered = JSON.parse(lines[1]);
    tampered.summary = "silently changed";
    lines[1] = JSON.stringify(tampered);
    fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf-8");

    const result = verifyEventLog(dir);
    assert.equal(result.ok, false);
    assert.equal(result.brokenAt, 1);
    assert.equal(result.reason, "hash mismatch");
  });

  it("detects legacy or malformed rows without hashes", () => {
    const dir = path.join(tmpDir, "legacy");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(eventLogPath(dir), `${JSON.stringify({ id: "old", type: "legacy" })}\n`, "utf-8");

    const result = verifyEventLog(dir);
    assert.equal(result.ok, false);
    assert.equal(result.brokenAt, 0);
    assert.equal(result.reason, "missing hash");
  });

  it("exposes verification through self_learning_control", async () => {
    const oldHome = process.env.HANA_HOME;
    const home = path.join(tmpDir, "control-home");
    process.env.HANA_HOME = home;
    try {
      const learnerDir = path.join(home, "self-learning");
      appendEvent(learnerDir, { type: "policy.applied", entityType: "config", entityId: "governanceProfile", summary: "Applied policy" });

      const result = JSON.parse(await executeControl({ action: "verify_event_log" }));
      assert.equal(result.ok, true);
      assert.equal(result.events, 1);
      assert.equal(result.brokenAt, null);
    } finally {
      if (oldHome == null) delete process.env.HANA_HOME;
      else process.env.HANA_HOME = oldHome;
    }
  });

  it("keeps the chain intact across many appends (tail-read finds the head)", () => {
    const dir = path.join(tmpDir, "many-appends");
    for (let i = 0; i < 200; i++) {
      appendEvent(dir, { type: "proposal.created", entityType: "proposal", entityId: `p${i}`, summary: `event ${i}` });
    }
    const result = verifyEventLog(dir);
    assert.equal(result.ok, true);
    assert.equal(result.events, 200);
    assert.equal(result.brokenAt, null);
  });

  it("chains correctly when the last event exceeds the tail window (full-read fallback)", () => {
    const dir = path.join(tmpDir, "large-event");
    appendEvent(dir, { type: "proposal.created", entityType: "proposal", entityId: "first", summary: "small" });
    // A single event larger than the 8 KiB tail window forces lastEventHash to
    // fall back to a full read on the following append.
    appendEvent(dir, { type: "proposal.updated", entityType: "proposal", entityId: "huge", summary: "x".repeat(20000) });
    appendEvent(dir, { type: "proposal.applied", entityType: "proposal", entityId: "after", summary: "small again" });

    const result = verifyEventLog(dir);
    assert.equal(result.ok, true);
    assert.equal(result.events, 3);
    assert.equal(result.brokenAt, null);
  });

  it("reads recent events from the tail while preserving reverse-chronological API order", () => {
    const dir = path.join(tmpDir, "tail-read-events");
    for (let i = 0; i < 120; i++) {
      appendEvent(dir, {
        type: i % 2 === 0 ? "proposal.created" : "review.queued",
        entityType: "proposal",
        entityId: `p${i}`,
        summary: `event ${i}`,
        date: `2026-06-09T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      });
    }

    const latest = readEvents(dir, { limit: 5 });
    assert.deepEqual(latest.map((evt) => evt.entityId), ["p119", "p118", "p117", "p116", "p115"]);

    const proposals = readEvents(dir, { limit: 3, type: "proposal.created" });
    assert.deepEqual(proposals.map((evt) => evt.entityId), ["p118", "p116", "p114"]);
  });
});
