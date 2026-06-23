// Runtime end-to-end coverage against a fake Hanako EventBus.
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { DEFAULT_CONFIG, decoratePatterns, readJson, writeJson } from "../lib/common.js";
import { applyPolicyProfile } from "../lib/policy-profiles.js";
import { readEvents } from "../lib/event-log.js";
import { listProposals } from "../lib/proposals.js";
import { listReviews } from "../lib/review-queue.js";
import { runSearch } from "../tools/search.js";
import { execute as executeControl } from "../tools/control.js";
import { parseToolResult } from "./_test-utils.js";
import {
  FakeEventBus,
  createFakeRuntimeContext,
  emitCorrectionTurn,
  emitErrorTurn,
  emitSuccessfulTurn,
} from "./fixtures/fake-hanako-runtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-runtime-e2e-"));
const homeDir = path.join(tempRoot, "hana-home");
const pluginDir = path.join(tempRoot, "plugin");
const dataDir = path.join(homeDir, "self-learning");
const configPath = path.join(dataDir, "runtime-config.json");
const patternsPath = path.join(dataDir, "patterns.json");
const skillPath = path.join(pluginDir, "skills", "self-learning", "SKILL.md");
const experiencePath = path.join(dataDir, "experience_log.jsonl");
const activityPath = path.join(dataDir, "activity_log.jsonl");

let RuntimePlugin;
let previousHome;

// The plugin fire-and-forgets pruneActivityLog() (index.js), so a background
// async write to activity_log.jsonl can still hold the file when we tear down.
// On Linux that's fine (open files unlink freely); on Windows it's an EPERM/
// ENOTEMPTY lock. We must use the *async* fs.promises.rm here: its retryDelay
// yields to the event loop so the pending prune can finish and release the
// handle. Synchronous fs.rmSync would block the loop during its retry sleep,
// so the prune never completes — which is why this only failed on Win 18/20.
const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };

async function resetDisk(config = null) {
  await fs.promises.rm(homeDir, RM_OPTS);
  await fs.promises.rm(pluginDir, RM_OPTS);
  fs.mkdirSync(pluginDir, { recursive: true });
  if (config) writeJson(configPath, config);
}

async function startRuntime({ config = null, runtimeDataDir = null } = {}) {
  await resetDisk(config);
  const bus = new FakeEventBus();
  const ctx = createFakeRuntimeContext({ pluginDir, dataDir: runtimeDataDir, bus });
  const plugin = new RuntimePlugin();
  plugin.ctx = ctx;
  await plugin.onload();
  return { bus, ctx, plugin };
}

function readPatterns() {
  return readJson(patternsPath, []);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

describe("runtime E2E with fake Hanako EventBus", () => {
  before(async () => {
    previousHome = process.env.HANA_HOME;
    process.env.HANA_HOME = homeDir;
    RuntimePlugin = (await import(`${pathToFileURL(path.join(root, "index.js")).href}?runtime_e2e=${Date.now()}`)).default;
  });

  beforeEach(async () => {
    await resetDisk();
  });

  after(async () => {
    if (previousHome == null) delete process.env.HANA_HOME;
    else process.env.HANA_HOME = previousHome;
    await fs.promises.rm(tempRoot, RM_OPTS);
  });

  it("uses host-provided ctx.dataDir for runtime state when available", async () => {
    const hostDataDir = path.join(tempRoot, "host-data-dir");
    const { plugin } = await startRuntime({ runtimeDataDir: hostDataDir });

    await plugin.onunload();

    // Runtime state lives in runtime-config.json; config.json is reserved for
    // the Hanako host's own plugin config store and must NOT be created by us.
    assert.equal(fs.existsSync(path.join(hostDataDir, "runtime-config.json")), true);
    assert.equal(fs.existsSync(path.join(hostDataDir, "config.json")), false);
    assert.equal(fs.existsSync(path.join(hostDataDir, "activity_log.jsonl")), true);
    assert.equal(fs.existsSync(configPath), false);
  });

  it("keeps usage/advisor/action outputs in host dataDir without recreating legacy self-learning", async () => {
    const hostDataDir = path.join(tempRoot, "host-data-dir-no-legacy");
    // v0.341+: the runtime reads config from ctx.dataDir (hostDataDir), not the
    // legacy HANA_HOME/self-learning path. Seed the advisor-enabling config where
    // the runtime will actually read it; writing it to the legacy dataDir (which
    // we delete below) would leave onload on DEFAULT_CONFIG (advisor disabled).
    const advisorConfig = {
      ...DEFAULT_CONFIG,
      learnFromUsage: true,
      modelAdvisorEnabled: true,
      modelAdvisorSource: "official",
      modelAdvisorMinIntervalMinutes: 1,
      minAdvisorNewPatterns: 0,
      includeUsageInAdvisorPrompt: true,
    };
    await resetDisk(advisorConfig);
    await fs.promises.rm(dataDir, RM_OPTS);
    fs.mkdirSync(hostDataDir, { recursive: true });
    writeJson(path.join(hostDataDir, "runtime-config.json"), advisorConfig);
    const bus = new FakeEventBus({
      handlers: {
        "usage:list": () => ({ entries: [{
          requestId: "usage-1",
          status: "ok",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          model: { provider: "p", modelId: "gpt-5.5" },
          source: { subsystem: "session", operation: "reply", trigger: "manual" },
          usage: { totalTokens: 180000, input: { totalTokens: 1000 }, output: { totalTokens: 100 } },
        }] }),
        "model:sample-text": () => ({ text: JSON.stringify({ suggestions: [] }), model: "utility-test" }),
      },
    });
    const ctx = createFakeRuntimeContext({ pluginDir, dataDir: hostDataDir, bus });
    const plugin = new RuntimePlugin();
    plugin.ctx = ctx;
    await plugin.onload();
    await plugin.onunload();

    assert.equal(fs.existsSync(dataDir), false, "legacy HANA_HOME/self-learning should not be recreated");
    assert.equal(fs.existsSync(path.join(hostDataDir, "usage_summary.json")), true);
    assert.equal(fs.existsSync(path.join(hostDataDir, "model_advice.json")), true);
    assert.equal(fs.existsSync(path.join(hostDataDir, "model_advice_state.json")), true);
    assert.equal(fs.existsSync(path.join(hostDataDir, "event_log.jsonl")), true);
  });

  it("absorbs externally merged disk patterns before persisting", async () => {
    const { plugin } = await startRuntime();
    const external = {
      id: "workflow:external-migration",
      type: "workflow",
      status: "approved",
      score: 12,
      count: 4,
      desc: "Migrated external workflow",
      fix: "Keep migrated pattern",
      tools: ["read", "edit"],
      context: { categories: ["文件探索", "代码编写"], taskType: "coding" },
      scope: { project: "general", taskType: "coding" },
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    writeJson(patternsPath, [external]);
    await plugin.onunload();

    const patterns = readPatterns();
    assert.ok(patterns.some((pattern) => pattern.id === external.id), "external disk pattern should survive runtime flush");
  });

  it("learns a repeated workflow and refreshes the generated skill", async () => {
    const { bus, plugin } = await startRuntime();
    const sessionPath = path.join(tempRoot, "sessions", "workflow-project", "turn.jsonl");

    for (let i = 0; i < 3; i++) {
      emitSuccessfulTurn(bus, sessionPath, {
        userText: "read the target file and edit the implementation",
        tools: ["read", "edit"],
      });
    }

    await plugin.onunload();

    const patterns = readPatterns();
    const workflow = patterns.find((pattern) => pattern.type === "workflow");
    assert.ok(workflow, "workflow pattern should be created");
    assert.equal(workflow.count >= 3, true);
    assert.equal(workflow.status, "approved");

    const decorated = decoratePatterns(patterns, DEFAULT_CONFIG);
    assert.equal(decorated.find((pattern) => pattern.id === workflow.id)?.injectable, true);
    assert.match(fs.readFileSync(skillPath, "utf-8"), /跨类别工作流/);
  });

  it("captures a user correction as pending searchable preference without injecting it", async () => {
    const { bus, plugin } = await startRuntime();
    const sessionPath = path.join(tempRoot, "sessions", "paper-project", "turn.jsonl");

    emitCorrectionTurn(bus, sessionPath, "下次记住，我写论文时 mAP50 是主指标，不是 mAP50-95。");

    await plugin.onunload();

    const patterns = readPatterns();
    const preference = patterns.find((pattern) => pattern.type === "preference");
    assert.ok(preference, "preference pattern should be created");
    assert.equal(preference.status, "pending");
    assert.equal(decoratePatterns(patterns, DEFAULT_CONFIG).find((pattern) => pattern.id === preference.id)?.injectable, false);

    const skill = fs.readFileSync(skillPath, "utf-8");
    assert.equal(skill.includes("mAP50 是主指标"), false);

    const search = runSearch(patterns, "论文 mAP50 主指标", { config: DEFAULT_CONFIG, type: "preference", limit: 5 });
    assert.ok(search.results.some((result) => result.id === preference.id));
  });

  it("turns repeated tool errors into a reviewable non-auto-applicable code proposal", async () => {
    const { bus, plugin } = await startRuntime();
    const sessionPath = path.join(tempRoot, "sessions", "error-project", "turn.jsonl");

    for (let i = 0; i < 3; i++) {
      emitErrorTurn(bus, sessionPath, {
        toolName: "read",
        error: "ENOENT: no such file or directory, open missing.txt",
      });
    }

    await plugin.onunload();

    const errorPattern = readPatterns().find((pattern) => pattern.type === "error" && pattern.id === "error:file_not_found");
    assert.ok(errorPattern, "file_not_found error pattern should be created");
    assert.equal(errorPattern.count, 3);
    assert.equal(Array.isArray(errorPattern.repairPlan?.repairPlan), true);

    const proposal = listProposals(dataDir, { status: "pending" }).find((item) => item.type === "code_patch");
    assert.ok(proposal, "code_patch proposal should be created");
    assert.ok(listReviews(dataDir).some((review) => review.proposalId === proposal.id));

    await assert.rejects(
      () => executeControl({ action: "apply_proposal", proposalId: proposal.id }, { pluginDir }),
      /code_patch proposals cannot be auto-applied/
    );
  });

  it("does not create code_patch proposals from unknown error buckets", async () => {
    const { bus, plugin } = await startRuntime();
    const sessionPath = path.join(tempRoot, "sessions", "unknown-error-project", "turn.jsonl");

    for (let i = 0; i < 3; i++) {
      emitErrorTurn(bus, sessionPath, {
        toolName: "bash",
        error: "opaque failure without classifier keywords",
      });
    }

    await plugin.onunload();

    const unknownPattern = readPatterns().find((pattern) => pattern.type === "error" && pattern.id === "error:unknown");
    assert.ok(unknownPattern, "unknown error pattern should still be tracked for diagnostics");
    assert.equal(unknownPattern.count, 3);
    assert.equal(listProposals(dataDir, { status: "pending" }).some((item) => item.type === "code_patch"), false);
  });

  it("does not create code_patch proposals from large-context usage patterns", async () => {
    const { bus, plugin } = await startRuntime({ config: { ...DEFAULT_CONFIG, largeUsageTokenThreshold: 100 } });
    const sessionPath = path.join(tempRoot, "sessions", "large-context-project", "turn.jsonl");

    for (let i = 0; i < 3; i++) {
      bus.emit({
        type: "llm_usage",
        entry: {
          requestId: `large-context-${i}`,
          status: "success",
          model: { provider: "pixel api", modelId: "gpt-5.5" },
          source: { subsystem: "chat", operation: "completion" },
          usage: { totalTokens: 500 },
          endedAt: new Date().toISOString(),
        },
      }, sessionPath);
    }

    await plugin.onunload();

    const largeContextPattern = readPatterns().find((pattern) => pattern.id === "usage:large_context:pixel_api_gpt-5.5");
    assert.ok(largeContextPattern, "large-context usage pattern should still be tracked as an advisory");
    assert.equal(listProposals(dataDir, { status: "pending" }).some((item) => item.type === "code_patch"), false);
  });

  it("keeps conservative skill proposals review-first and records the audit trail", async () => {
    const conservative = applyPolicyProfile(DEFAULT_CONFIG, "conservative").config;
    const { plugin } = await startRuntime({ config: conservative });

    await plugin.onunload();

    const proposal = listProposals(dataDir, { status: "pending" }).find((item) => item.type === "skill_patch");
    assert.ok(proposal, "strict mode should queue a skill_patch proposal");

    await assert.rejects(
      () => executeControl({ action: "apply_proposal", proposalId: proposal.id }, { pluginDir }),
      /conservative profile requires review-first/
    );
    await assert.rejects(
      () => executeControl({ action: "apply_review", proposalId: proposal.id }, { pluginDir }),
      /review must be approved/
    );

    const approved = parseToolResult(await executeControl({ action: "approve_review", proposalId: proposal.id }, { pluginDir }));
    assert.equal(approved.review.status, "approved");
    const applied = parseToolResult(await executeControl({ action: "apply_review", proposalId: proposal.id }, { pluginDir }));
    assert.equal(applied.proposal.status, "applied");

    const eventTypes = readEvents(dataDir, { limit: 100 }).map((event) => event.type);
    assert.ok(eventTypes.includes("proposal.created"));
    assert.ok(eventTypes.includes("review.approved"));
    assert.ok(eventTypes.includes("proposal.applied"));
  });

  it("persists stable session identifiers in runtime logs when provided by the host", async () => {
    const { bus, plugin } = await startRuntime();
    const sessionMeta = {
      sessionId: "sess-e2e-1",
      sessionRef: { tabId: "tab-e2e-1" },
      sessionPath: path.join(tempRoot, "sessions", "stable-session-project", "turn.jsonl"),
    };

    bus.emit({ type: "user_message", message: { role: "user", content: "下次记住，优先读配置再修改。" } }, sessionMeta);
    bus.emit({ type: "tool_execution_start", toolName: "read" }, sessionMeta);
    bus.emit({ type: "tool_execution_end", toolName: "read", isError: false, result: { ok: true } }, sessionMeta);
    bus.emit({ type: "tool_execution_start", toolName: "edit" }, sessionMeta);
    bus.emit({ type: "tool_execution_end", toolName: "edit", isError: false, result: { ok: true } }, sessionMeta);
    bus.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: "记住了" } }, sessionMeta);

    await plugin.onunload();

    const experiences = readJsonl(experiencePath);
    const activities = readJsonl(activityPath);
    const latestExperience = experiences.at(-1);
    const activityWithSession = activities.find((entry) => entry.sessionId === "sess-e2e-1" && entry.type === "turn_complete");

    assert.equal(latestExperience.sessionId, "sess-e2e-1");
    assert.deepEqual(latestExperience.sessionRef, { tabId: "tab-e2e-1" });
    assert.equal(latestExperience.sessionPath, sessionMeta.sessionPath);
    assert.ok(activityWithSession);
    assert.deepEqual(activityWithSession.sessionRef, { tabId: "tab-e2e-1" });
  });

  it("preserves stable session identity for llm_usage-driven learning activity", async () => {
    const { bus, plugin } = await startRuntime({ config: { ...DEFAULT_CONFIG, largeUsageTokenThreshold: 100 } });
    const sessionMeta = {
      sessionId: "sess-usage-1",
      sessionRef: { tabId: "tab-usage-1" },
      sessionPath: path.join(tempRoot, "sessions", "usage-session-project", "turn.jsonl"),
    };

    for (let i = 0; i < 3; i++) {
      bus.emit({
        type: "llm_usage",
        entry: {
          requestId: `usage-stable-${i}`,
          status: "success",
          model: { provider: "pixel api", modelId: "gpt-5.5" },
          source: { subsystem: "chat", operation: "completion" },
          usage: { totalTokens: 500 },
          endedAt: new Date().toISOString(),
        },
      }, sessionMeta);
    }

    await plugin.onunload();

    const activities = readJsonl(activityPath);
    const usageActivity = activities.find((entry) => entry.type === "usage_pattern_discovered" && entry.sessionId === "sess-usage-1");

    assert.ok(usageActivity);
    assert.deepEqual(usageActivity.sessionRef, { tabId: "tab-usage-1" });
    assert.equal(usageActivity.sessionPath, sessionMeta.sessionPath);
  });
});
