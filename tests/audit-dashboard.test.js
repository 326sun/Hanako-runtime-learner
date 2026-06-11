import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { buildAuditDashboard, exportAuditDashboard, renderAuditDashboardMarkdown } from "../lib/audit-dashboard.js";
import { createAuditTrace, appendAuditEvent, saveAuditTrace } from "../lib/audit-trace.js";
import { saveAgentTaskState } from "../lib/agent-task-store.js";
import { registerTransferCandidate, recordTransferValidation } from "../lib/transfer-registry.js";
import { saveActiveSkills, saveSkillCandidates } from "../lib/skill-promotion-loop.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanako-audit-dashboard-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function seedBenchmark(dir) {
  writeJson(path.join(dir, "benchmark-runs", "run-1", "benchmark-report.json"), {
    schemaVersion: 1,
    generatedAt: "2026-06-10T00:00:00.000Z",
    ok: true,
    metrics: {
      task_success_rate: 1,
      auto_execution_success_rate: 1,
      rollback_success_rate: 1,
      repair_success_rate: 1,
      false_auto_apply_rate: 0,
      manual_escalation_rate: 0.1,
    },
    regressions: [],
    corpus: { selectedScenarioCount: 14 },
    runs: [
      { scenarioId: "controller.repair_branch", category: "controller", ok: true, status: "succeeded" },
      { scenarioId: "skill.promotion_e2e_loop", category: "skill", ok: true, status: "succeeded" },
    ],
  });
}

function seedTrace(dir) {
  let trace = createAuditTrace({ taskId: "task:dashboard" });
  trace = appendAuditEvent(trace, { type: "node.started", node: "VerifyNode", state: "verifying", summary: "verify" });
  trace = appendAuditEvent(trace, { type: "node.completed", node: "VerifyNode", state: "verifying", summary: "verified" });
  saveAuditTrace(dir, trace);
}

test("audit dashboard consolidates benchmark, agent, transfer, skill, and trace evidence", () => {
  const dir = tmp();
  try {
    seedBenchmark(dir);
    seedTrace(dir);
    saveAgentTaskState(dir, {
      taskId: "task:dashboard",
      state: "waiting_for_human",
      currentNode: "HumanApprovalNode",
      risk: { riskTier: "R2" },
      graph: { title: "Dashboard task" },
      approvalRequests: [{ id: "approval:1", status: "pending" }],
      artifacts: [],
      history: [],
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:01:00.000Z",
    });
    const registered = registerTransferCandidate(dir, {
      id: "transfer:1",
      rule: "Revalidate import repair before transfer",
      sourceProjectId: "source",
      targetProjectId: "target",
      sourceMemoryId: "memory:1",
      riskTier: "R2",
      confidence: 0.7,
      transfer: { requiresRevalidation: true, cannotWriteSkillDirectly: true, cannotAutoPromote: true },
      validation: { required: true, commands: ["npm test"] },
    });
    recordTransferValidation(dir, registered.record.id, { status: "passed", evidence: ["npm test passed"] });
    saveSkillCandidates(dir, { candidates: [{ id: "skill:1", status: "staged", rule: "Check exports before import repair", evidence: { successCount: 5, regressionCount: 0 } }] });
    saveActiveSkills(dir, { skills: [{ id: "skill:2", rule: "Run node --check after patch", evidence: { successCount: 7, regressionCount: 0 }, scope: { taskTypes: ["code_patch"] } }] });

    const dashboard = buildAuditDashboard(dir, { version: "test" });
    assert.equal(dashboard.ok, true);
    assert.equal(dashboard.status, "generated");
    assert.equal(dashboard.safetyPosture, "healthy");
    assert.equal(dashboard.summary.scenarios, 2);
    assert.equal(dashboard.summary.pendingApprovals, 1);
    assert.equal(dashboard.summary.auditTraces, 1);
    assert.equal(dashboard.summary.transferManualPromotionEligible, 1);
    assert.equal(dashboard.summary.skillCandidates, 1);
    assert.equal(dashboard.summary.activeSkills, 1);
    assert.equal(dashboard.governanceBoundaries.r4AutoExecution, "blocked");
    assert.ok(dashboard.recommendations.some((item) => item.area === "agent_controller"));

    const markdown = renderAuditDashboardMarkdown(dashboard);
    assert.match(markdown, /Runtime Learner Audit Dashboard/);
    assert.match(markdown, /Cross-project Transfer/);
    assert.match(markdown, /SKILL.md auto-write: blocked by default/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("audit dashboard export writes json and markdown report", () => {
  const dir = tmp();
  try {
    seedBenchmark(dir);
    const written = exportAuditDashboard(dir, null, { name: "unit", version: "test" });
    assert.equal(written.ok, true);
    assert.equal(written.status, "generated");
    assert.equal(fs.existsSync(written.jsonPath), true);
    assert.equal(fs.existsSync(written.mdPath), true);
    const json = JSON.parse(fs.readFileSync(written.jsonPath, "utf-8"));
    assert.equal(json.summary.benchmarkAvailable, true);
    const md = fs.readFileSync(written.mdPath, "utf-8");
    assert.match(md, /Benchmark Evidence/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("self_learning_control exposes audit dashboard generation", async () => {
  const { execute: executeControl } = await import("../tools/control.js");
  const oldHome = process.env.HANA_HOME;
  const home = tmp();
  process.env.HANA_HOME = home;
  try {
    const learnerDir = path.join(home, "self-learning");
    fs.mkdirSync(learnerDir, { recursive: true });
    seedBenchmark(learnerDir);
    const result = JSON.parse(await executeControl({ action: "generate_audit_dashboard", id: "control-test" }, { pluginDir: process.cwd() }));
    assert.equal(result.ok, true);
    assert.equal(result.status, "generated");
    assert.equal(fs.existsSync(result.mdPath), true);
    assert.equal(result.summary.benchmarkAvailable, true);
  } finally {
    if (oldHome == null) delete process.env.HANA_HOME;
    else process.env.HANA_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
