// M4a — experimental READ-ONLY agent graph skeleton. These tests pin the safety
// contract: the graph observes/plans/checks/verifies/learns/reports but NEVER
// executes. It performs no file writes, no config changes, no shell/process
// calls; it rejects any side-effecting or execute/repair/rollback node; it
// fail-softs on empty / malformed input; and every action it emits is marked
// readonly:true. See docs/AGENT_GRAPH_READONLY.md and the M5c/M4 constraints.

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  READONLY_NODES,
  READONLY_NODE_ORDER,
  FORBIDDEN_NODE_TYPES,
  runReadonlyAgentGraph,
} from "../lib/agent-graph-readonly.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleSource = fs.readFileSync(path.join(here, "../lib/agent-graph-readonly.js"), "utf-8");

function readonlyInput() {
  return {
    context: {
      summary: "session had 3 failed tool calls",
      config: { minInjectScore: 8 },
      observations: ["a", "b"],
    },
    plan: {
      nodes: [
        { type: "Plan", title: "analyze failures" },
        { type: "Observe", title: "summarize logs", riskTier: "R0" },
      ],
    },
  };
}

describe("agent-graph-readonly · node set", () => {
  it("exposes exactly the six allowed read-only nodes in order", () => {
    assert.deepStrictEqual(READONLY_NODE_ORDER, [
      READONLY_NODES.OBSERVE,
      READONLY_NODES.PLAN,
      READONLY_NODES.POLICY,
      READONLY_NODES.VERIFY,
      READONLY_NODES.LEARN,
      READONLY_NODES.FINALIZE,
    ]);
    assert.strictEqual(READONLY_NODE_ORDER.length, 6);
  });

  it("lists execute/repair/rollback/human-approval as forbidden", () => {
    for (const t of ["execute", "repair", "rollback", "humanapproval"]) {
      assert.ok(FORBIDDEN_NODE_TYPES.includes(t), `${t} must be forbidden`);
    }
  });
});

describe("agent-graph-readonly · happy path", () => {
  it("runs a clean read-only graph through all six nodes", () => {
    const res = runReadonlyAgentGraph(readonlyInput());
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.status, "completed");
    assert.strictEqual(res.readonly, true);
    assert.strictEqual(res.nodes.length, 6);
    assert.deepStrictEqual(res.nodes.map((n) => n.name), READONLY_NODE_ORDER);
    assert.ok(res.nodes.every((n) => n.status === "ok"));
    assert.strictEqual(res.policy.ok, true);
    assert.deepStrictEqual(res.policy.rejected, []);
    assert.ok(res.report);
    assert.deepStrictEqual(res.sideEffects, []);
  });

  it("marks every planned action readonly:true", () => {
    const res = runReadonlyAgentGraph(readonlyInput());
    assert.ok(res.plan.nodes.length > 0);
    assert.ok(res.plan.nodes.every((n) => n.readonly === true));
  });

  it("includes a risk summary and a human-review-required flag", () => {
    const res = runReadonlyAgentGraph(readonlyInput());
    assert.ok(res.risk, "risk summary present");
    assert.ok("maxTier" in res.risk);
    assert.ok(typeof res.risk.summary === "string");
    assert.strictEqual(typeof res.humanReviewRequired, "boolean");
  });
});

describe("agent-graph-readonly · policy rejections", () => {
  it("rejects any node declaring sideEffect:true", () => {
    const input = readonlyInput();
    input.plan.nodes.push({ type: "Plan", title: "write file", sideEffect: true });
    const res = runReadonlyAgentGraph(input);
    assert.strictEqual(res.status, "rejected");
    assert.strictEqual(res.policy.ok, false);
    assert.ok(res.policy.rejected.some((r) => r.reason === "side-effect-forbidden"));
    assert.strictEqual(res.humanReviewRequired, true);
    assert.deepStrictEqual(res.sideEffects, []);
  });

  it("rejects a node declaring readonly:false", () => {
    const input = readonlyInput();
    input.plan.nodes.push({ type: "Plan", title: "mutate", readonly: false });
    const res = runReadonlyAgentGraph(input);
    assert.strictEqual(res.status, "rejected");
    assert.ok(res.policy.rejected.some((r) => r.reason === "non-readonly"));
  });

  it("rejects Execute / Repair / Rollback / HumanApproval node types", () => {
    const input = readonlyInput();
    input.plan.nodes = [
      { type: "Execute", title: "run it" },
      { type: "RepairNode", title: "auto-fix" },
      { type: "Rollback", title: "revert" },
      { type: "HumanApproval", title: "auto-apply after approval" },
    ];
    const res = runReadonlyAgentGraph(input);
    assert.strictEqual(res.status, "rejected");
    assert.strictEqual(res.policy.rejected.length, 4);
    assert.ok(res.policy.rejected.every((r) => r.reason.startsWith("forbidden-node-type")));
    assert.strictEqual(res.humanReviewRequired, true);
    assert.deepStrictEqual(res.sideEffects, []);
  });
});

describe("agent-graph-readonly · no side effects", () => {
  it("module source imports no fs / child_process and calls no exec/spawn/write", () => {
    assert.ok(!/from\s+["']fs["']/.test(moduleSource), "must not import fs");
    assert.ok(!/from\s+["']fs\/promises["']/.test(moduleSource), "must not import fs/promises");
    assert.ok(!/from\s+["']child_process["']/.test(moduleSource), "must not import child_process");
    assert.ok(!/\b(execSync|exec|spawnSync|spawn|fork)\s*\(/.test(moduleSource), "must not call exec/spawn/fork");
    assert.ok(!/\bwriteFile(Sync)?\s*\(/.test(moduleSource), "must not write files");
  });

  it("does not mutate a frozen input context or config", () => {
    const input = readonlyInput();
    Object.freeze(input);
    Object.freeze(input.context);
    Object.freeze(input.context.config);
    const before = JSON.stringify(input);
    const res = runReadonlyAgentGraph(input); // must not throw
    assert.strictEqual(JSON.stringify(input), before, "input unchanged");
    assert.strictEqual(input.context.config.minInjectScore, 8, "config unchanged");
    assert.deepStrictEqual(res.sideEffects, []);
  });

  it("never reports an executed action", () => {
    const res = runReadonlyAgentGraph(readonlyInput());
    assert.ok(!("executed" in res));
    assert.ok(res.nodes.every((n) => n.status !== "executed"));
    assert.strictEqual(res.readonly, true);
  });
});

describe("agent-graph-readonly · fail-soft", () => {
  it("fail-softs on empty input without throwing", () => {
    for (const bad of [null, undefined, {}, { context: null }]) {
      const res = runReadonlyAgentGraph(bad);
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.status, "failed-soft");
      assert.ok(res.errors.includes("empty-input"));
      assert.strictEqual(res.readonly, true);
      assert.deepStrictEqual(res.sideEffects, []);
    }
  });

  it("fail-softs on a malformed plan without throwing", () => {
    for (const badPlan of ["nope", 123, { nodes: 5 }, { nodes: [42, "x"] }]) {
      const res = runReadonlyAgentGraph({ context: { summary: "x" }, plan: badPlan });
      assert.strictEqual(res.status, "failed-soft");
      assert.ok(res.errors.includes("malformed-plan"));
      assert.strictEqual(res.verify.structureValid, false);
      assert.strictEqual(res.readonly, true);
      assert.deepStrictEqual(res.sideEffects, []);
    }
  });
});
