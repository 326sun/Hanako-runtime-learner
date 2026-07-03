/**
 * Characterization tests for tools/control.js HANDLERS (C-001 phase 4 / pre-split).
 *
 * Purpose: lock the CURRENT observable behavior of control handler domains that
 * are not already covered elsewhere, so a future "split HANDLERS by domain"
 * refactor has a regression net. These assert behavior as-is; they do not change it.
 *
 * Already covered elsewhere (NOT duplicated here):
 *   - proposals/reviews happy + reject paths: tests/review-governance.test.js
 *   - run_model_advisor mock-key decrypt path + set_config non-persist:
 *     tests/control-credentials.test.js
 *   - redactConfig behaviors: tests/control-redaction.test.js
 *   - release_readiness / runtime-package resolution: tests/control-runtime-package.test.js
 *
 * No network is exercised; no real user directory is written (HANA_HOME → tmp).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execute } from "../tools/control.js";
import { parseToolResult, unwrapToolResult } from "./_test-utils.js";

const savedHanaHome = process.env.HANA_HOME;
const savedFetch = globalThis.fetch;

before(() => {
  // Any network attempt during these tests is a failure.
  globalThis.fetch = async () => { throw new Error("network must not be reached in characterization tests"); };
});

after(() => {
  if (savedHanaHome === undefined) delete process.env.HANA_HOME;
  else process.env.HANA_HOME = savedHanaHome;
  globalThis.fetch = savedFetch;
});

/**
 * Run `fn(ctx)` against a fresh, isolated learner home. Optionally seeds
 * runtime-config.json with `config`. Restores HANA_HOME afterward.
 */
async function withLearner({ config } = {}, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `control-char-${process.pid}-${Date.now()}-`));
  process.env.HANA_HOME = home;
  const learner = path.join(home, "self-learning");
  fs.mkdirSync(learner, { recursive: true });
  fs.writeFileSync(path.join(learner, "patterns.json"), "[]", "utf-8");
  if (config) fs.writeFileSync(path.join(learner, "runtime-config.json"), JSON.stringify(config), "utf-8");
  try {
    return await fn({ pluginDir: home, learner });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const run = (action, extra = {}, ctx) => execute({ action, ...extra }, ctx);
const json = async (action, extra, ctx) => parseToolResult(await run(action, extra, ctx));

// ── Domain 1: status / doctor read-only output ──

describe("status / doctor read-only output", () => {
  it("status reports a zeroed snapshot with redacted config on a fresh store", async () => {
    await withLearner({}, async (ctx) => {
      const out = await json("status", {}, ctx);
      assert.equal(out.patterns, 0);
      assert.equal(out.injectable, 0);
      assert.deepEqual(out.proposals, { pending: 0, applied: 0, rejected: 0, dir: out.proposals.dir });
      assert.deepEqual(out.reviews, { queued: 0, blocked: 0, approved: 0 });
      assert.deepEqual(out.agentTasks, { total: 0, waiting: 0 });
      assert.deepEqual(out.transferCandidates, { total: 0, pending: 0, validated: 0, failed: 0 });
      assert.deepEqual(out.skillPromotion, { candidates: 0, active: 0 });
      assert.equal(out.config.governanceProfile, "balanced");
      assert.ok(out.dataDir.endsWith(path.join("self-learning")) || out.dataDir.includes("self-learning"));
    });
  });

  it("status does not create runtime-config.json while reading", async () => {
    await withLearner({}, async (ctx) => {
      const configPath = path.join(ctx.learner, "runtime-config.json");
      assert.equal(fs.existsSync(configPath), false);
      await json("status", {}, ctx);
      assert.equal(fs.existsSync(configPath), false);
    });
  });

  it("doctor format=json returns a structured report (status good on empty store)", async () => {
    await withLearner({}, async (ctx) => {
      const report = await json("doctor", { format: "json" }, ctx);
      assert.equal(report.status, "good");
      assert.equal(report.score, 100);
      assert.deepEqual(report.issues, []);
      assert.equal(typeof report.generatedAt, "string");
    });
  });

  it("doctor default format returns a non-JSON text report", async () => {
    await withLearner({}, async (ctx) => {
      const text = unwrapToolResult(await run("doctor", {}, ctx));
      assert.equal(typeof text, "string");
      assert.ok(text.length > 0);
      assert.ok(!text.trimStart().startsWith("{"), "default doctor output should be text, not JSON");
    });
  });

  it("doctor format=json fast=true returns the fast health snapshot", async () => {
    await withLearner({}, async (ctx) => {
      const report = await json("doctor", { format: "json", fast: true }, ctx);
      assert.equal(report.mode, "fast");
      assert.equal(report.status, "good");
    });
  });

  it("list returns an empty array on a fresh store", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("list", {}, ctx), []);
    });
  });
});

// ── Domain 2: proposals / reviews query output (empty-state shape) ──

describe("proposals / reviews query output", () => {
  it("list_proposals returns ok + empty list + nextAction", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("list_proposals", {}, ctx), {
        ok: true, proposals: [], nextAction: "show_proposal or preview_proposal",
      });
    });
  });

  it("list_reviews returns ok + empty list + nextAction", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("list_reviews", {}, ctx), {
        ok: true, reviews: [], nextAction: "show_proposal then preview_proposal",
      });
    });
  });

  it("review_panel recommends no action on an empty store", async () => {
    await withLearner({}, async (ctx) => {
      const panel = await json("review_panel", {}, ctx);
      assert.deepEqual(panel.recommendedNextActions, ["no review action needed"]);
    });
  });

  it("show_proposal without an id is rejected", async () => {
    await withLearner({}, async (ctx) => {
      await assert.rejects(() => run("show_proposal", {}, ctx), /proposalId is required/);
    });
  });
});

// ── Domain 3: events / event log ──

describe("events / event log output", () => {
  it("list_events returns an empty list", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("list_events", {}, ctx), { ok: true, events: [] });
    });
  });

  it("event_summary returns an empty replay summary", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("event_summary", {}, ctx), {
        ok: true, summary: { count: 0, byType: {}, entities: {} },
      });
    });
  });

  it("verify_event_log reports an intact (empty) chain", async () => {
    await withLearner({}, async (ctx) => {
      const out = await json("verify_event_log", {}, ctx);
      assert.equal(out.ok, true);
      assert.equal(out.events, 0);
      assert.equal(out.brokenAt, null);
    });
  });
});

// ── Domain 4: agent-tasks query + waiting state ──

describe("agent-tasks query output", () => {
  it("list_agent_tasks returns ok + empty tasks", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("list_agent_tasks", {}, ctx), {
        ok: true, tasks: [], nextAction: "show_agent_task",
      });
    });
  });

  it("show_agent_task without a taskId is rejected", async () => {
    await withLearner({}, async (ctx) => {
      await assert.rejects(() => run("show_agent_task", {}, ctx), /taskId is required/);
    });
  });
});

// ── Domain 5: transfers query ──

describe("transfers query output", () => {
  it("list_transfer_candidates returns ok + empty candidates", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("list_transfer_candidates", {}, ctx), {
        ok: true, candidates: [], nextAction: "show_transfer_candidate or record_transfer_validation",
      });
    });
  });

  it("show_transfer_candidate without a candidateId is rejected", async () => {
    await withLearner({}, async (ctx) => {
      await assert.rejects(() => run("show_transfer_candidate", {}, ctx), /candidateId is required/);
    });
  });
});

// ── Domain 6: skill promotion queries + policy profiles ──

describe("skill promotion / policy profile output", () => {
  it("list_skill_candidates returns ok + empty candidates", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("list_skill_candidates", {}, ctx), {
        ok: true, candidates: [], nextAction: "run_skill_promotion_loop or list_active_skills",
      });
    });
  });

  it("list_active_skills returns ok + empty skills", async () => {
    await withLearner({}, async (ctx) => {
      assert.deepEqual(await json("list_active_skills", {}, ctx), {
        ok: true, skills: [], nextAction: "export_audit_bundle",
      });
    });
  });

  it("list_policy_profiles lists the three profiles with balanced current by default", async () => {
    await withLearner({}, async (ctx) => {
      const out = await json("list_policy_profiles", {}, ctx);
      assert.equal(out.ok, true);
      assert.equal(out.current, "balanced");
      assert.deepEqual(out.profiles.map((p) => p.name), ["conservative", "balanced", "autonomous"]);
    });
  });
});

// ── Domain 7: set_config sensitive output / config boundary ──

describe("set_config output and validation boundary", () => {
  it("applies a valid numeric config and echoes the persisted value", async () => {
    await withLearner({}, async (ctx) => {
      const out = await json("set_config", { minInjectCount: 5 }, ctx);
      assert.equal(out.ok, true);
      assert.equal(out.config.minInjectCount, 5);
      assert.ok(out.validation);
      // persisted: a follow-up status reflects it
      const status = await json("status", {}, ctx);
      assert.equal(status.config.minInjectCount, 5);
    });
  });

  it("rejects an invalid config value without partial application", async () => {
    await withLearner({}, async (ctx) => {
      await assert.rejects(() => run("set_config", { minInjectScore: "bad" }, ctx), /config validation failed/);
    });
  });
});

// ── Domain 8: run_model_advisor disabled / no-key (no network) ──

describe("run_model_advisor without network", () => {
  it("short-circuits when the advisor is disabled (default config)", async () => {
    await withLearner({}, async (ctx) => {
      const out = await json("run_model_advisor", {}, ctx);
      assert.equal(out.ok, false);
      assert.equal(out.error, "disabled");
    });
  });

  it("reports a missing key when enabled for a private endpoint with no key", async () => {
    await withLearner({ config: { modelAdvisorEnabled: true, modelAdvisorSource: "private", modelAdvisorBaseUrl: "https://x.example.com", modelAdvisorModel: "m" } }, async (ctx) => {
      const out = await json("run_model_advisor", {}, ctx);
      assert.equal(out.ok, false);
      assert.match(out.error, /api key missing/i);
    });
  });
});

// ── Domain 9: safe-rejection / security boundary paths ──

describe("safe-rejection and security boundary paths", () => {
  it("apply_proposal is blocked under the conservative governance profile", async () => {
    await withLearner({ config: { governanceProfile: "conservative" } }, async (ctx) => {
      await assert.rejects(
        () => run("apply_proposal", { proposalId: "p-does-not-exist" }, ctx),
        /conservative profile requires review-first flow/,
      );
    });
  });

  it("apply_proposal without an id is rejected", async () => {
    await withLearner({}, async (ctx) => {
      await assert.rejects(() => run("apply_proposal", {}, ctx), /proposalId is required/);
    });
  });

  it("approve_review / apply_review reject unknown reviews", async () => {
    await withLearner({}, async (ctx) => {
      await assert.rejects(() => run("approve_review", {}, ctx), /id or proposalId is required/);
      await assert.rejects(() => run("approve_review", { id: "review:nope" }, ctx), /review not found/);
      await assert.rejects(() => run("apply_review", { id: "review:nope" }, ctx), /review not found/);
    });
  });

  it("trust_project_scripts refuses a workspace whose package.json has no scripts", async () => {
    await withLearner({}, async (ctx) => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), "control-char-ws-"));
      fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "x" }), "utf-8");
      try {
        await assert.rejects(() => run("trust_project_scripts", { workspaceRoot: ws }, ctx), /no scripts found in package\.json/);
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });
  });

  it("an unknown action is rejected by execute", async () => {
    await withLearner({}, async (ctx) => {
      await assert.rejects(() => run("__no_such_action__", {}, ctx), /unknown action/);
    });
  });
});
