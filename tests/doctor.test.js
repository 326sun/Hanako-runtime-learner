// Tests for self_learning_doctor's pure analysis core (tools/doctor.js · diagnose).
// Each case isolates one check by constructing minimal triggering inputs.

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_CONFIG } from "../lib/common.js";
import { applyPolicyProfile } from "../lib/policy-profiles.js";
import { diagnose, formatReport, runDoctorFromDisk } from "../tools/doctor.js";

const NOW = Date.parse("2026-06-09T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();
const types = (r) => r.issues.map((i) => i.type);

const base = (over) => ({
  id: "p", type: "workflow", status: "approved", score: 5, count: 2,
  firstSeen: daysAgo(1), lastSeen: daysAgo(1), scope: { project: "general", taskType: "general" }, ...over,
});

describe("doctor · healthy baseline", () => {
  it("reports Good with no issues for a clean store", () => {
    const r = diagnose({
      patterns: [base({ id: "wf:a", desc: "do a" }), base({ id: "wf:b", desc: "do b" })],
      now: NOW,
    });
    assert.equal(r.status, "good");
    assert.equal(r.mode, "deep");
    assert.equal(r.label, "Good");
    assert.equal(r.score, 100);
    assert.equal(r.issues.length, 0);
  });
});

describe("doctor · fast mode", () => {
  it("runDoctorFromDisk fast mode skips deep log retention checks without changing the default", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `doctor-fast-${process.pid}-`));
    try {
      fs.writeFileSync(path.join(dir, "patterns.json"), "[]", "utf-8");
      fs.writeFileSync(path.join(dir, "experience_log.jsonl"), JSON.stringify({
        date: new Date(NOW - 90 * 86_400_000).toISOString(),
        type: "turn",
      }) + "\n", "utf-8");
      fs.writeFileSync(path.join(dir, "embeddings_cache.json"), JSON.stringify({
        "m:a": { vector: [1, 0], createdAt: NOW - 1000, lastUsedAt: NOW },
      }, null, 2), "utf-8");

      const deep = runDoctorFromDisk(dir);
      const fast = runDoctorFromDisk(dir, { fast: true });

      assert.equal(deep.mode, "deep");
      assert.equal(fast.mode, "fast");
      assert.equal(deep.summary.semanticEmbeddingCache.entries, 1);
      assert.match(formatReport(deep), /semanticCache=1\/1000/);
      assert.ok(types(deep).includes("privacy_retention"));
      assert.ok(!types(fast).includes("privacy_retention"));
      assert.equal(fast.summary.sessionIdentityCoveragePct, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("doctor · duplicate_patterns", () => {
  it("flags identical desc/fix across records", () => {
    const r = diagnose({
      patterns: [
        base({ id: "wf:a", desc: "run tests then build", fix: "npm test" }),
        base({ id: "wf:b", desc: "run tests then build", fix: "npm test" }),
      ],
      now: NOW,
    });
    assert.ok(types(r).includes("duplicate_patterns"));
    assert.equal(r.status, "warning");
  });
});

describe("doctor · conflicting_facts", () => {
  it("flags same subject/predicate with multiple active values", () => {
    const r = diagnose({
      patterns: [],
      facts: [
        { subject: "model", predicate: "has_module", object: "A" },
        { subject: "model", predicate: "has_module", object: "B" },
      ],
      now: NOW,
    });
    assert.ok(types(r).includes("conflicting_facts"));
    assert.equal(r.status, "warning"); // high severity → warning status
  });

  it("does not flag once one value is superseded/expired", () => {
    const r = diagnose({
      patterns: [],
      facts: [
        { subject: "model", predicate: "has_module", object: "A", validTo: daysAgo(1) },
        { subject: "model", predicate: "has_module", object: "B" },
      ],
      now: NOW,
    });
    assert.ok(!types(r).includes("conflicting_facts"));
  });
});

describe("doctor · stale_auto_approved", () => {
  it("flags aged auto-approved patterns never adopted", () => {
    const r = diagnose({
      patterns: [base({ id: "wf:x", desc: "stale", status: "pending", autoApproved: true, lastSeen: daysAgo(200) })],
      now: NOW,
    });
    assert.ok(types(r).includes("stale_auto_approved"));
  });
});

describe("doctor · pending preferences", () => {
  it("raises a high issue when includePendingPreferences is ON with pending prefs", () => {
    const r = diagnose({
      patterns: [base({ id: "pref:a", type: "preference", status: "pending", desc: "use tabs" })],
      config: { includePendingPreferences: true },
      now: NOW,
    });
    assert.ok(types(r).includes("pending_preference_injection"));
    assert.equal(r.status, "warning");
  });

  it("only warns about backlog (info) when opt-in is OFF and many pending", () => {
    const patterns = [];
    for (let i = 0; i < 12; i++) patterns.push(base({ id: `pref:${i}`, type: "preference", status: "pending", desc: `c${i}` }));
    const r = diagnose({ patterns, config: { includePendingPreferences: false }, now: NOW });
    assert.ok(types(r).includes("pending_preference_backlog"));
    assert.ok(!types(r).includes("pending_preference_injection"));
  });
});

describe("doctor · policy consistency", () => {
  it("flags conservative profile when requireReviewForAutoApply is false", () => {
    const conservative = applyPolicyProfile(DEFAULT_CONFIG, "conservative").config;
    const r = diagnose({
      config: { ...conservative, requireReviewForAutoApply: false },
      now: NOW,
    });
    const issue = r.issues.find((i) => i.type === "policy_inconsistent");
    assert.equal(issue?.severity, "high");
    assert.ok(issue.mismatches.some((m) => m.key === "requireReviewForAutoApply"));
    assert.equal(r.priorityActions[0].priority, "P0");
    assert.match(r.priorityActions[0].action, /set_policy_profile/);
  });

  it("does not flag a capability toggle (semanticSearchEnabled) as a profile mismatch", () => {
    // Capability toggles are user-owned and orthogonal to the review/apply posture
    // a profile governs, so enabling one is never a policy_inconsistent.
    const conservative = applyPolicyProfile(DEFAULT_CONFIG, "conservative").config;
    const r = diagnose({
      config: { ...conservative, semanticSearchEnabled: true },
      now: NOW,
    });
    assert.ok(!types(r).includes("policy_inconsistent"));
  });

  it("does not flag autonomous when the user has enabled capability/privacy/UX toggles", () => {
    const autonomous = applyPolicyProfile(DEFAULT_CONFIG, "autonomous").config;
    const r = diagnose({
      config: {
        ...autonomous,
        modelAdvisorEnabled: true,
        semanticSearchEnabled: true,
        llmExtractionEnabled: true,
        includeUsageInAdvisorPrompt: true,
        workStatusEnabled: true,
      },
      now: NOW,
    });
    assert.ok(!types(r).includes("policy_inconsistent"),
      "enabling user-owned toggles under autonomous must not be a policy mismatch");
  });

  it("does not flag balanced default policy config", () => {
    const r = diagnose({ config: DEFAULT_CONFIG, now: NOW });
    assert.ok(!types(r).includes("policy_inconsistent"));
  });

  it("does not flag autonomous default policy config", () => {
    const autonomous = applyPolicyProfile(DEFAULT_CONFIG, "autonomous").config;
    const r = diagnose({ config: autonomous, now: NOW });
    assert.ok(!types(r).includes("policy_inconsistent"));
  });

  it("does not flag autonomous when the user has explicitly disabled includePendingPreferences", () => {
    // The safety gate is user-owned: autonomous + includePendingPreferences=false is
    // a valid "safe autonomous" setup, not a profile drift to nag about.
    const autonomous = applyPolicyProfile(DEFAULT_CONFIG, "autonomous").config;
    const r = diagnose({ config: { ...autonomous, includePendingPreferences: false }, now: NOW });
    const issue = r.issues.find((i) => i.type === "policy_inconsistent");
    assert.ok(
      !issue || !issue.mismatches.some((m) => m.key === "includePendingPreferences"),
      "autonomous + includePendingPreferences=false must not be a policy mismatch",
    );
  });
});

describe("doctor · proposal_backlog", () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `prop${i}`, status: "pending" }));
  it("warns at ≥10 pending proposals", () => {
    const r = diagnose({ patterns: [], proposals: mk(10), now: NOW });
    assert.ok(types(r).includes("proposal_backlog"));
    assert.equal(r.status, "warning");
  });
  it("escalates to critical at ≥25", () => {
    const r = diagnose({ patterns: [], proposals: mk(25), now: NOW });
    const issue = r.issues.find((i) => i.type === "proposal_backlog");
    assert.equal(issue.severity, "critical");
    assert.equal(r.status, "critical");
  });
});

describe("doctor · skill_budget", () => {
  it("flags when injectable hints exceed maxSkillTokens", () => {
    const patterns = [];
    for (let i = 0; i < 6; i++) {
      patterns.push(base({ id: `wf:${i}`, status: "approved", desc: `a long hint number ${i} ${"x".repeat(60)}`, fix: `${"y".repeat(60)}` }));
    }
    const r = diagnose({ patterns, config: { maxSkillTokens: 50 }, now: NOW });
    assert.ok(types(r).includes("skill_budget"));
  });
});

describe("doctor · privacy_retention", () => {
  it("flags log entries older than the retention window", () => {
    const r = diagnose({
      patterns: [],
      logs: [{ name: "experience_log.jsonl", oldestMs: NOW - 40 * 86_400_000 }],
      now: NOW,
    });
    assert.ok(types(r).includes("privacy_retention"));
  });
  it("does not flag fresh logs", () => {
    const r = diagnose({
      patterns: [],
      logs: [{ name: "experience_log.jsonl", oldestMs: NOW - 5 * 86_400_000 }],
      now: NOW,
    });
    assert.ok(!types(r).includes("privacy_retention"));
  });
});

describe("doctor · session identity coverage", () => {
  it("reports legacy-only session logs when stable identifiers are absent", () => {
    const r = diagnose({
      patterns: [],
      logs: [{
        name: "experience_log.jsonl",
        oldestMs: NOW - 5 * 86_400_000,
        sessionCoverage: { total: 12, withStableIdentity: 0, legacyPathOnly: 12, unknown: 0 },
      }],
      now: NOW,
    });
    assert.ok(types(r).includes("legacy_session_logs"));
    assert.equal(r.summary.sessionIdentityCoveragePct, 0);
    assert.equal(r.summary.legacySessionRows, 12);
  });

  it("warns when stable session identity coverage is low on sampled logs", () => {
    const r = diagnose({
      patterns: [],
      logs: [
        {
          name: "turns.jsonl",
          oldestMs: NOW - 2 * 86_400_000,
          sessionCoverage: { total: 40, withStableIdentity: 12, legacyPathOnly: 24, unknown: 4, coverageRatio: 0.3 },
        },
        {
          name: "activity_log.jsonl",
          oldestMs: NOW - 2 * 86_400_000,
          sessionCoverage: { total: 10, withStableIdentity: 8, legacyPathOnly: 2, unknown: 0, coverageRatio: 0.8 },
        },
      ],
      now: NOW,
    });
    assert.ok(types(r).includes("session_identity_coverage"));
    assert.equal(r.summary.sampledLogRows, 50);
    assert.equal(r.summary.withStableIdentity, 20);
    assert.equal(r.summary.unknownSessionRows, 4);
    assert.equal(r.summary.sessionIdentityCoveragePct, 40);
    assert.equal(r.summary.byFile.length, 2);
    assert.equal(r.summary.byFile[0].name, "turns.jsonl");
  });
});

describe("doctor · scope_leakage", () => {
  it("notes injectable patterns spanning multiple concrete projects", () => {
    const r = diagnose({
      patterns: [
        base({ id: "wf:a", status: "approved", scope: { project: "proj-x", taskType: "coding" } }),
        base({ id: "wf:b", status: "approved", scope: { project: "proj-y", taskType: "coding" } }),
      ],
      now: NOW,
    });
    assert.ok(types(r).includes("scope_leakage"));
  });
});

describe("doctor · orphan_relations", () => {
  it("flags relation edges pointing at missing patterns", () => {
    const r = diagnose({
      patterns: [base({ id: "wf:a", context: { relations: [{ targetId: "wf:ghost", type: "same-task", weight: 0.5 }] } })],
      now: NOW,
    });
    assert.ok(types(r).includes("orphan_relations"));
  });
});

describe("doctor · evidence_missing", () => {
  it("flags high-score patterns lacking evidence once evidence is in use", () => {
    const r = diagnose({
      patterns: [
        base({ id: "wf:withev", score: 20, evidence: [{ type: "turn", quote: "x" }] }),
        base({ id: "wf:noev", score: 20 }),
      ],
      now: NOW,
    });
    assert.ok(types(r).includes("evidence_missing"));
  });
  it("stays silent before any pattern carries evidence (pre-v1.1)", () => {
    const r = diagnose({ patterns: [base({ id: "wf:noev", score: 20 })], now: NOW });
    assert.ok(!types(r).includes("evidence_missing"));
  });
});

describe("doctor · advisor status", () => {
  const enabled = { modelAdvisorEnabled: true };
  const at = (h) => new Date(NOW - h * 3600_000).toISOString();

  it("notes advisor_never_run (info) when enabled but no status exists yet", () => {
    const r = diagnose({ patterns: [], config: enabled, advisorStatus: null, now: NOW });
    const issue = r.issues.find((i) => i.type === "advisor_never_run");
    assert.equal(issue?.severity, "info");
  });

  it("stays silent about the advisor when disabled, even with an error status", () => {
    const r = diagnose({
      patterns: [], config: { modelAdvisorEnabled: false },
      advisorStatus: { status: "error", reason: "boom", consecutiveFailures: 5, lastRunAt: at(0) },
      now: NOW,
    });
    assert.ok(!types(r).some((t) => t.startsWith("advisor_")));
  });

  it("reports no advisor issue on a successful run", () => {
    const r = diagnose({
      patterns: [], config: enabled,
      advisorStatus: { status: "success", reason: null, source: "official-bus", suggestionCount: 2, consecutiveFailures: 0, lastRunAt: at(0) },
      now: NOW,
    });
    assert.ok(!types(r).some((t) => t.startsWith("advisor_")));
  });

  it("treats a benign skip (not enough patterns) as info, not warning", () => {
    const r = diagnose({
      patterns: [], config: enabled,
      advisorStatus: { status: "skipped", reason: "only 2 new pattern(s), need 3", consecutiveFailures: 0, lastRunAt: at(0) },
      now: NOW,
    });
    const issue = r.issues.find((i) => i.type === "advisor_skipped");
    // info (penalty 3) — a normal idle advisor must not raise a warning-level issue.
    assert.equal(issue?.severity, "info");
    assert.match(issue.message, /not enough new patterns/);
  });

  it("flags a config-driven skip (incomplete endpoint) as a warning", () => {
    const r = diagnose({
      patterns: [], config: enabled,
      advisorStatus: { status: "skipped", reason: "model advisor endpoint incomplete", consecutiveFailures: 0, lastRunAt: at(0) },
      now: NOW,
    });
    const issue = r.issues.find((i) => i.type === "advisor_skipped");
    assert.equal(issue?.severity, "warning");
  });

  it("treats a single advisor error as a transient warning, not high", () => {
    const r = diagnose({
      patterns: [], config: enabled,
      advisorStatus: { status: "error", reason: "session busy", consecutiveFailures: 1, lastRunAt: at(0) },
      now: NOW,
    });
    const issue = r.issues.find((i) => i.type === "advisor_error");
    assert.equal(issue?.severity, "warning");
  });

  it("escalates an advisor error to high after repeated consecutive failures", () => {
    const r = diagnose({
      patterns: [], config: enabled,
      advisorStatus: { status: "error", reason: "HTTP 401", consecutiveFailures: 3, lastRunAt: at(0) },
      now: NOW,
    });
    const issue = r.issues.find((i) => i.type === "advisor_error");
    assert.equal(issue?.severity, "high");
  });
});

describe("doctor · host network contract", () => {
  it("flags manifest network.fetch declarations for user-configured endpoints", () => {
    const r = diagnose({
      patterns: [],
      manifest: { capabilities: ["network.fetch"], network: { allowedHosts: ["api.example.com"] } },
      now: NOW,
    });
    const issue = r.issues.find((i) => i.type === "host_network_contract");
    assert.equal(issue?.severity, "warning");
    assert.equal(issue.hasNetworkBlock, true);
    assert.equal(issue.networkFetchCapability, true);
  });

  it("does not flag a manifest without static network declarations", () => {
    const r = diagnose({
      patterns: [],
      manifest: { permissions: ["usage.read"] },
      now: NOW,
    });
    assert.ok(!types(r).includes("host_network_contract"));
  });
});

describe("doctor · formatReport", () => {
  it("renders a human-readable report and never claims to modify files", () => {
    const r = diagnose({
      patterns: [base({ id: "wf:a", desc: "x", fix: "y" }), base({ id: "wf:b", desc: "x", fix: "y" })],
      logs: [{
        name: "activity_log.jsonl",
        oldestMs: NOW - 2 * 86_400_000,
        sessionCoverage: { total: 10, withStableIdentity: 8, legacyPathOnly: 2, unknown: 0 },
      }],
      now: NOW,
    });
    const text = formatReport(r);
    assert.match(text, /Self-Learning Doctor/);
    assert.match(text, /Read-only diagnostic/);
    assert.match(text, /duplicate_patterns/);
    assert.match(text, /Priority actions/);
    assert.match(text, /sessionCoverage=80%/);
    assert.match(text, /Session Coverage/);
    assert.match(text, /activity_log\.jsonl: stable=8\/10 \(80%\)/);
  });
});
