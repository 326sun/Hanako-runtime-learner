// Tests for the read-only `agent_graph_preview` control action (v5.1 M4b).
//
// It runs lib/agent-graph-readonly.js over a caller-supplied context + plan and
// returns the graph report. It MUST be read-only: it executes no node side
// effect, writes no event-log / config / patterns, runs no shell, and never
// reports an applied/executed action. Forbidden and side-effecting nodes are
// rejected. See docs/AGENT_GRAPH_READONLY.md.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execute, sessionPermission } from "../tools/control.js";
import { eventLogPath } from "../lib/event-log.js";

async function withLearner(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `agraph-preview-${process.pid}-${Date.now()}-`));
  const saved = process.env.HANA_HOME;
  process.env.HANA_HOME = home;
  const learner = path.join(home, "self-learning");
  fs.mkdirSync(learner, { recursive: true });
  fs.writeFileSync(path.join(learner, "patterns.json"), "[]", "utf-8");
  try {
    return await fn({ ctx: { pluginDir: home, learner }, learner });
  } finally {
    if (saved === undefined) delete process.env.HANA_HOME; else process.env.HANA_HOME = saved;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const preview = async (ctx, extra = {}) =>
  (await execute({ action: "agent_graph_preview", ...extra }, ctx)).details;

const readonlyPlan = () => ({
  context: { summary: "3 failed tool calls", observations: ["a", "b"] },
  plan: { nodes: [
    { type: "Plan", title: "analyze failures" },
    { type: "Observe", title: "summarize logs", riskTier: "R0" },
  ] },
});

describe("control · agent_graph_preview · classification", () => {
  it("is classified as a read-only control action", () => {
    const desc = sessionPermission.describeSideEffect({ action: "agent_graph_preview" });
    assert.equal(desc.kind, "read");
  });
});

describe("control · agent_graph_preview · happy path", () => {
  it("returns a completed read-only report for a clean plan", async () => {
    await withLearner(async ({ ctx }) => {
      const out = await preview(ctx, readonlyPlan());
      assert.equal(out.ok, true);
      assert.equal(out.status, "completed");
      assert.equal(out.readonly, true);
      assert.deepEqual(out.sideEffects, []);
      assert.equal(out.policy.ok, true);
      assert.ok(out.report);
    });
  });
});

describe("control · agent_graph_preview · rejections", () => {
  it("rejects Execute / Repair / Rollback / HumanApproval / Apply node types", async () => {
    await withLearner(async ({ ctx }) => {
      const out = await preview(ctx, { context: { summary: "x" }, plan: { nodes: [
        { type: "Execute", title: "run" },
        { type: "Repair", title: "fix" },
        { type: "Rollback", title: "revert" },
        { type: "HumanApproval", title: "auto-apply" },
        { type: "Apply", title: "apply" },
      ] } });
      assert.equal(out.status, "rejected");
      assert.equal(out.policy.rejected.length, 5);
      assert.ok(out.policy.rejected.every((r) => r.reason.startsWith("forbidden-node-type")));
      assert.equal(out.humanReviewRequired, true);
      assert.deepEqual(out.sideEffects, []);
    });
  });

  it("rejects a node declaring sideEffect:true", async () => {
    await withLearner(async ({ ctx }) => {
      const out = await preview(ctx, { context: { summary: "x" }, plan: { nodes: [
        { type: "Plan", title: "write", sideEffect: true },
      ] } });
      assert.equal(out.status, "rejected");
      assert.ok(out.policy.rejected.some((r) => r.reason === "side-effect-forbidden"));
    });
  });

  it("rejects a node declaring readonly:false", async () => {
    await withLearner(async ({ ctx }) => {
      const out = await preview(ctx, { context: { summary: "x" }, plan: { nodes: [
        { type: "Plan", title: "mutate", readonly: false },
      ] } });
      assert.equal(out.status, "rejected");
      assert.ok(out.policy.rejected.some((r) => r.reason === "non-readonly"));
    });
  });
});

describe("control · agent_graph_preview · fail-soft", () => {
  it("fail-softs on empty input (no context)", async () => {
    await withLearner(async ({ ctx }) => {
      const out = await preview(ctx, {});
      assert.equal(out.ok, false);
      assert.equal(out.status, "failed-soft");
      assert.ok(out.errors.includes("empty-input"));
      assert.deepEqual(out.sideEffects, []);
    });
  });

  it("fail-softs on a malformed plan", async () => {
    await withLearner(async ({ ctx }) => {
      const out = await preview(ctx, { context: { summary: "x" }, plan: { nodes: 5 } });
      assert.equal(out.status, "failed-soft");
      assert.ok(out.errors.includes("malformed-plan"));
      assert.equal(out.verify.structureValid, false);
    });
  });
});

describe("control · agent_graph_preview · no side effects", () => {
  it("writes no event-log, config, or patterns", async () => {
    await withLearner(async ({ ctx, learner }) => {
      // Warm up once so the framework's one-time config.json persist settles.
      await preview(ctx, readonlyPlan());
      const cfgPath = path.join(learner, "config.json");
      const patPath = path.join(learner, "patterns.json");
      const cfgBefore = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf-8") : null;
      const patBefore = fs.readFileSync(patPath, "utf-8");
      const logExistedBefore = fs.existsSync(eventLogPath(learner));

      await preview(ctx, readonlyPlan());

      assert.equal(fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf-8") : null, cfgBefore, "config unchanged");
      assert.equal(fs.readFileSync(patPath, "utf-8"), patBefore, "patterns unchanged");
      assert.equal(fs.existsSync(eventLogPath(learner)), logExistedBefore, "event-log not written");
      assert.equal(logExistedBefore, false, "no event-log was created by the preview");
    });
  });

  it("output carries no apply / executed / shell-result fields", async () => {
    await withLearner(async ({ ctx }) => {
      const out = await preview(ctx, readonlyPlan());
      assert.equal(out.apply, undefined);
      assert.equal(out.executed, undefined);
      assert.equal(out.shellResult, undefined);
      assert.ok(out.nodes.every((n) => n.status !== "executed"));
      assert.deepEqual(out.sideEffects, []);
    });
  });
});
