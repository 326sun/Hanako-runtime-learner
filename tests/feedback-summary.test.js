// Tests for the read-only `feedback_summary` control action (v5.1 M5b).
//
// It surfaces summarizeFeedback() for developers as a diagnostic. It MUST be a
// pure read: no file writes, no thresholds, no adaptive suggestions, no decision.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execute } from "../tools/control.js";
import { appendEvent, eventLogPath } from "../lib/event-log.js";
import { FEEDBACK_TYPES } from "../lib/feedback-signals.js";

async function withLearner(seedEvents, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `feedback-summary-${process.pid}-${Date.now()}-`));
  const saved = process.env.HANA_HOME;
  process.env.HANA_HOME = home;
  const learner = path.join(home, "self-learning");
  fs.mkdirSync(learner, { recursive: true });
  fs.writeFileSync(path.join(learner, "patterns.json"), "[]", "utf-8");
  for (const ev of seedEvents || []) appendEvent(learner, ev);
  try {
    return await fn({ ctx: { pluginDir: home, learner }, learner });
  } finally {
    if (saved === undefined) delete process.env.HANA_HOME; else process.env.HANA_HOME = saved;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const summary = async (ctx, extra = {}) => (await execute({ action: "feedback_summary", ...extra }, ctx)).details;

describe("control · feedback_summary", () => {
  it("defaults sinceDays to 30 and returns a zeroed summary on an empty log", async () => {
    await withLearner([], async ({ ctx }) => {
      const out = await summary(ctx);
      assert.equal(out.ok, true);
      assert.equal(out.sinceDays, 30);
      assert.equal(out.memoryInjected, 0);
      assert.equal(out.injectionRevoked, 0);
      assert.equal(out.memoryClosed, 0);
      assert.equal(out.proposalApplied, 0);
      assert.equal(out.proposalRejected, 0);
      assert.equal(out.patternApproved, 0);
      assert.equal(out.patternRejected, 0);
      assert.equal(out.injectedIdTotal, 0);
    });
  });

  it("counts pre-existing proposal/pattern events plus new feedback.* events", async () => {
    const seed = [
      { type: "proposal.applied", entityType: "proposal", entityId: "p1" },
      { type: "proposal.rejected", entityType: "proposal", entityId: "p2" },
      { type: "pattern.approved", entityType: "pattern", entityId: "wf:a" },
      { type: "pattern.rejected", entityType: "pattern", entityId: "wf:b" },
      { type: FEEDBACK_TYPES.injected, entityType: "memory", data: { patternIds: ["wf:a", "wf:b"], count: 2 } },
      { type: FEEDBACK_TYPES.revoked, entityType: "memory", entityId: "wf:b", data: { patternId: "wf:b" } },
      { type: FEEDBACK_TYPES.closed, entityType: "memory", entityId: "wf:b", data: { patternId: "wf:b", actor: "user" } },
    ];
    await withLearner(seed, async ({ ctx }) => {
      const out = await summary(ctx);
      assert.equal(out.memoryInjected, 1);
      assert.equal(out.injectionRevoked, 1);
      assert.equal(out.memoryClosed, 1);
      assert.equal(out.proposalApplied, 1);
      assert.equal(out.proposalRejected, 1);
      assert.equal(out.patternApproved, 1);
      assert.equal(out.patternRejected, 1);
      assert.equal(out.injectedIdTotal, 2);
    });
  });

  it("excludes events older than sinceDays", async () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const seed = [
      { type: FEEDBACK_TYPES.injected, entityType: "memory", date: old, data: { patternIds: ["old"], count: 1 } },
      { type: FEEDBACK_TYPES.injected, entityType: "memory", data: { patternIds: ["recent"], count: 1 } },
    ];
    await withLearner(seed, async ({ ctx }) => {
      assert.equal((await summary(ctx, { sinceDays: 30 })).memoryInjected, 1, "only recent counts");
      assert.equal((await summary(ctx, { sinceDays: 365 })).memoryInjected, 2, "wider window counts both");
    });
  });

  it("is a pure read — never modifies the event-log or patterns", async () => {
    const seed = [{ type: FEEDBACK_TYPES.closed, entityType: "memory", entityId: "x", data: { patternId: "x" } }];
    await withLearner(seed, async ({ ctx, learner }) => {
      const logBefore = fs.readFileSync(eventLogPath(learner), "utf-8");
      const patBefore = fs.readFileSync(path.join(learner, "patterns.json"), "utf-8");
      await summary(ctx);
      assert.equal(fs.readFileSync(eventLogPath(learner), "utf-8"), logBefore, "event-log unchanged");
      assert.equal(fs.readFileSync(path.join(learner, "patterns.json"), "utf-8"), patBefore, "patterns unchanged");
    });
  });

  it("returns no threshold or adaptive suggestion fields", async () => {
    await withLearner([], async ({ ctx }) => {
      const out = await summary(ctx);
      assert.equal(out.threshold, undefined);
      assert.equal(out.suggestion, undefined);
      assert.equal(out.adaptive, undefined);
      assert.equal(out.recommendation, undefined);
    });
  });
});
