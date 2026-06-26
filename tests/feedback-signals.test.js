// Tests for lib/feedback-signals.js (v5.1 M5 — feedback instrumentation only).
//
// Feedback signals are written to the real hash-chained event-log (no mocks).
// They are INSTRUMENTATION ONLY: no thresholds, no decisions, pure local audit.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { appendEvent, readEvents, verifyEventLog, eventLogPath } from "../lib/event-log.js";
import { execute } from "../tools/control.js";
import {
  FEEDBACK_TYPES,
  recordMemoryInjected,
  recordInjectionRevoked,
  recordMemoryClosed,
  wasRecentlyInjected,
  summarizeFeedback,
} from "../lib/feedback-signals.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "learner-feedback-"));
}

describe("feedback-signals · recordMemoryInjected", () => {
  it("appends a feedback.memory_injected event carrying ids, count, and skillRef", () => {
    const dir = tmp();
    const ok = recordMemoryInjected(dir, { patternIds: ["wf:a", "pref:b"], skillRef: "skills/self-learning/SKILL.md" });
    assert.equal(ok, true);
    const [ev] = readEvents(dir, { type: FEEDBACK_TYPES.injected });
    assert.equal(ev.type, "feedback.memory_injected");
    assert.deepEqual(ev.data.patternIds, ["wf:a", "pref:b"]);
    assert.equal(ev.data.count, 2);
    assert.equal(ev.data.skillRef, "skills/self-learning/SKILL.md");
    assert.equal(verifyEventLog(dir).ok, true);
  });

  it("is a no-op (returns false, writes nothing) when there are no ids", () => {
    const dir = tmp();
    assert.equal(recordMemoryInjected(dir, { patternIds: [] }), false);
    assert.equal(readEvents(dir, { type: FEEDBACK_TYPES.injected }).length, 0);
  });

  it("never leaks an absolute skillPath — only a relative ref or basename", () => {
    const dir = tmp();
    recordMemoryInjected(dir, { patternIds: ["x"], skillRef: "C:\\\\Users\\\\secret\\\\plugin\\\\SKILL.md" });
    const [ev] = readEvents(dir, { type: FEEDBACK_TYPES.injected });
    assert.ok(!path.isAbsolute(ev.data.skillRef), `skillRef must not be absolute: ${ev.data.skillRef}`);
    assert.ok(!/secret/.test(ev.data.skillRef), "absolute path segments must not leak");
  });
});

describe("feedback-signals · revoked + closed", () => {
  it("records injection_revoked and memory_closed for a pattern id with a short reason code", () => {
    const dir = tmp();
    assert.equal(recordInjectionRevoked(dir, { patternId: "wf:a", reason: "rejected" }), true);
    assert.equal(recordMemoryClosed(dir, { patternId: "wf:a", actor: "user", reason: "rejected" }), true);
    const revoked = readEvents(dir, { type: FEEDBACK_TYPES.revoked })[0];
    const closed = readEvents(dir, { type: FEEDBACK_TYPES.closed })[0];
    assert.equal(revoked.entityId, "wf:a");
    assert.equal(closed.data.actor, "user");
    assert.equal(closed.entityId, "wf:a");
  });

  it("returns false with no id, and caps an over-long free-text reason", () => {
    const dir = tmp();
    assert.equal(recordInjectionRevoked(dir, { patternId: "" }), false);
    recordMemoryClosed(dir, { patternId: "p1", reason: "x".repeat(500) + "\ninjected user text" });
    const ev = readEvents(dir, { type: FEEDBACK_TYPES.closed })[0];
    assert.ok(ev.data.reason.length <= 64, "reason capped");
    assert.ok(!/\n/.test(ev.data.reason), "reason single-line");
  });
});

describe("feedback-signals · fail-soft", () => {
  it("never throws when the event-log cannot be written, returns false", () => {
    // baseDir is an existing FILE → event-log mkdir/append fails internally.
    const f = path.join(os.tmpdir(), "learner-feedback-file-" + Date.now());
    fs.writeFileSync(f, "x");
    assert.doesNotThrow(() => {
      const r = recordMemoryInjected(f, { patternIds: ["a"] });
      assert.equal(r, false);
    });
  });
});

describe("feedback-signals · wasRecentlyInjected", () => {
  it("is true only after that id was recorded as injected", () => {
    const dir = tmp();
    assert.equal(wasRecentlyInjected(dir, "wf:a"), false);
    recordMemoryInjected(dir, { patternIds: ["wf:a", "wf:b"] });
    assert.equal(wasRecentlyInjected(dir, "wf:a"), true);
    assert.equal(wasRecentlyInjected(dir, "wf:zzz"), false);
  });
});

describe("feedback-signals · summarizeFeedback (pure read)", () => {
  it("counts new feedback plus existing proposal/pattern events without modifying the log", () => {
    const dir = tmp();
    // existing event-log signals (already emitted elsewhere — not re-instrumented)
    appendEvent(dir, { type: "proposal.applied", entityType: "proposal", entityId: "p1" });
    appendEvent(dir, { type: "proposal.rejected", entityType: "proposal", entityId: "p2" });
    appendEvent(dir, { type: "pattern.approved", entityType: "pattern", entityId: "wf:a" });
    appendEvent(dir, { type: "pattern.rejected", entityType: "pattern", entityId: "wf:b" });
    // new feedback signals
    recordMemoryInjected(dir, { patternIds: ["wf:a", "wf:b"] });
    recordInjectionRevoked(dir, { patternId: "wf:b", reason: "rejected" });
    recordMemoryClosed(dir, { patternId: "wf:b", actor: "user", reason: "rejected" });

    const before = fs.readFileSync(eventLogPath(dir), "utf-8");
    const sum = summarizeFeedback(dir, { sinceDays: 30 });
    const after = fs.readFileSync(eventLogPath(dir), "utf-8");

    assert.equal(after, before, "summarizeFeedback must not modify the log");
    assert.equal(sum.counts.memoryInjected, 1);
    assert.equal(sum.counts.injectionRevoked, 1);
    assert.equal(sum.counts.memoryClosed, 1);
    assert.equal(sum.counts.proposalApplied, 1);
    assert.equal(sum.counts.proposalRejected, 1);
    assert.equal(sum.counts.patternApproved, 1);
    assert.equal(sum.counts.patternRejected, 1);
    assert.equal(sum.injectedIdTotal, 2);
    // pure read: must NOT return any threshold/decision suggestion
    assert.equal(sum.threshold, undefined);
    assert.equal(sum.suggestion, undefined);
  });

  it("excludes events older than sinceDays", () => {
    const dir = tmp();
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    appendEvent(dir, { type: FEEDBACK_TYPES.injected, entityType: "memory", date: old, data: { patternIds: ["old"], count: 1 } });
    recordMemoryInjected(dir, { patternIds: ["new"] });
    const sum = summarizeFeedback(dir, { sinceDays: 30 });
    assert.equal(sum.counts.memoryInjected, 1, "only the recent injection counts");
  });
});

// Integration: the control `reject` action must emit the user-close signal, and
// injection_revoked only when the memory had been injected before.
describe("feedback-signals · control.reject hook", () => {
  async function withLearner(fn) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `feedback-reject-${process.pid}-${Date.now()}-`));
    const saved = process.env.HANA_HOME;
    process.env.HANA_HOME = home;
    const learner = path.join(home, "self-learning");
    fs.mkdirSync(learner, { recursive: true });
    fs.writeFileSync(
      path.join(learner, "patterns.json"),
      JSON.stringify([{ id: "wf:a", type: "workflow", desc: "demo workflow", status: "approved", count: 3 }]),
      "utf-8",
    );
    try {
      return await fn({ ctx: { pluginDir: home, learner }, learner });
    } finally {
      if (saved === undefined) delete process.env.HANA_HOME; else process.env.HANA_HOME = saved;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  it("emits feedback.memory_closed for a rejected pattern", async () => {
    await withLearner(async ({ ctx, learner }) => {
      await execute({ action: "reject", id: "wf:a" }, ctx);
      const closed = readEvents(learner, { type: FEEDBACK_TYPES.closed });
      assert.equal(closed.length, 1, "one memory_closed signal");
      assert.equal(closed[0].entityId, "wf:a");
      assert.equal(closed[0].data.actor, "user");
    });
  });

  it("also emits feedback.injection_revoked when that memory had been injected", async () => {
    await withLearner(async ({ ctx, learner }) => {
      appendEvent(learner, { type: FEEDBACK_TYPES.injected, entityType: "memory", data: { patternIds: ["wf:a"], count: 1 } });
      await execute({ action: "reject", id: "wf:a" }, ctx);
      assert.equal(readEvents(learner, { type: FEEDBACK_TYPES.revoked }).length, 1, "injection_revoked emitted");
    });
  });

  it("does not emit injection_revoked for a memory that was never injected", async () => {
    await withLearner(async ({ ctx, learner }) => {
      await execute({ action: "reject", id: "wf:a" }, ctx);
      assert.equal(readEvents(learner, { type: FEEDBACK_TYPES.revoked }).length, 0, "no spurious injection_revoked");
    });
  });
});
