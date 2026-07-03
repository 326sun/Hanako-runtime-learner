/**
 * Unit tests for lib/common.js — decay algorithms, injection logic, decoration.
 * Run: node --test tests/common.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  ageDays,
  decayedScore,
  knowledgeTier,
  memoryStrength,
  scoreSignals,
  isInjectable,
  decoratePatterns,
  buildSkillMdFromPatterns,
  isActiveSkillInjectable,
  selectInjectableActiveSkills,
  countJsonl,
  countValues,
  readRecentJsonl,
  readJsonlSample,
  estimateTokens,
  estimateTokensRaw,
} from "../lib/common.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("estimateTokensRaw / estimateTokens", () => {
  it("estimateTokens is the ceil of the raw estimate", () => {
    for (const text of ["", "hello world", "排版论文", "mixed 中文 and english 123", "a"]) {
      assert.equal(estimateTokens(text), Math.ceil(estimateTokensRaw(text)));
    }
  });

  it("weights CJK heavier than ASCII", () => {
    // 4 CJK chars (~1.8 each) clearly outweigh 4 ASCII chars (~0.25 each).
    assert.ok(estimateTokensRaw("论文排版") > estimateTokensRaw("abcd"));
  });

  it("returns 0 for empty / nullish input", () => {
    assert.equal(estimateTokensRaw(""), 0);
    assert.equal(estimateTokensRaw(null), 0);
    assert.equal(estimateTokensRaw(undefined), 0);
  });
});

describe("ageDays", () => {
  it("returns 0 for a pattern just seen", () => {
    const pattern = { lastSeen: new Date().toISOString(), score: 10 };
    assert.ok(ageDays(pattern) < 1 / 86400); // less than 1 second in days
  });

  it("returns correct age for a pattern seen 30 days ago", () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const pattern = { lastSeen: thirtyDaysAgo, score: 10 };
    const days = ageDays(pattern);
    assert.ok(days >= 29.9 && days <= 30.1, `expected ~30, got ${days}`);
  });

  it("returns 0 for missing date", () => {
    assert.equal(ageDays({ score: 5 }), 0);
    assert.equal(ageDays(null), 0);
  });
});

describe("decayedScore", () => {
  const config = { ...DEFAULT_CONFIG, decayHalfLifeDays: 30 };

  it("full score when just seen", () => {
    const pattern = { lastSeen: new Date().toISOString(), score: 10 };
    const d = decayedScore(pattern, config);
    assert.ok(d > 9.9, `expected ~10, got ${d}`);
  });

  it("halves after one half-life", () => {
    const halfLifeAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const pattern = { lastSeen: halfLifeAgo, score: 10 };
    const d = decayedScore(pattern, config);
    assert.ok(d >= 4.9 && d <= 5.1, `expected ~5, got ${d}`);
  });

  it("quarters after two half-lives", () => {
    const twoHalfLivesAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const pattern = { lastSeen: twoHalfLivesAgo, score: 10 };
    const d = decayedScore(pattern, config);
    assert.ok(d >= 2.4 && d <= 2.6, `expected ~2.5, got ${d}`);
  });

  it("uses default half-life when config is missing", () => {
    const pattern = { lastSeen: new Date().toISOString(), score: 10 };
    const d = decayedScore(pattern, {});
    assert.ok(d > 9.9);
  });

  it("does not decay durable knowledge", () => {
    const old = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const pattern = { type: "preference", lastSeen: old, score: 10 };
    assert.equal(decayedScore(pattern, config), 10);
  });
});

describe("knowledgeTier", () => {
  it("partitions preferences as durable knowledge", () => {
    assert.equal(knowledgeTier({ type: "preference" }), "durable");
  });

  it("respects explicit core preference partition", () => {
    assert.equal(knowledgeTier({ type: "preference", knowledgeTier: "core" }), "core");
  });

  it("partitions runtime noise as ephemeral, usage patterns as core", () => {
    assert.equal(knowledgeTier({ type: "capability" }), "ephemeral");
    // usage:large_context was ephemeral in v0.7 but is now core (v0.8 fix #2)
    // so it appears in skill generation and search results.
    assert.equal(knowledgeTier({ id: "usage:large_context:abc" }), "core");
  });

  it("defaults ordinary patterns to core", () => {
    assert.equal(knowledgeTier({ type: "workflow" }), "core");
  });
});

describe("memoryStrength", () => {
  const config = { ...DEFAULT_CONFIG, decayHalfLifeDays: 30 };

  it("higher count → slower decay", () => {
    const halfLifeAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const lowCount = { lastSeen: halfLifeAgo, score: 10, count: 1 };
    const highCount = { lastSeen: halfLifeAgo, score: 10, count: 9 };
    const lowMs = memoryStrength(lowCount, config);
    const highMs = memoryStrength(highCount, config);
    assert.ok(highMs > lowMs, `highCount=${highMs} should be > lowCount=${lowMs}`);
  });

  it("full strength when just seen", () => {
    const pattern = { lastSeen: new Date().toISOString(), score: 10, count: 1 };
    const ms = memoryStrength(pattern, config);
    assert.ok(ms > 9.9, `expected ~10, got ${ms}`);
  });

  it("decays to near-zero after many half-lives with low count", () => {
    const ages = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const pattern = { lastSeen: ages, score: 10, count: 1 };
    const ms = memoryStrength(pattern, config);
    assert.ok(ms < 1, `expected < 1, got ${ms}`);
  });

  it("keeps durable knowledge strength stable", () => {
    const ages = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const pattern = { type: "preference", lastSeen: ages, score: 10, count: 1 };
    assert.equal(memoryStrength(pattern, config), 10);
  });
});

describe("scoreSignals", () => {
  const config = { ...DEFAULT_CONFIG, decayHalfLifeDays: 30 };

  it("matches decayedScore and memoryStrength from one combined calculation", () => {
    const now = Date.now();
    const pattern = {
      lastSeen: new Date(now - 14 * 86_400_000).toISOString(),
      score: 12,
      count: 4,
    };
    const signals = scoreSignals(pattern, config, now);
    assert.equal(signals.decayedScore, decayedScore(pattern, config, now));
    assert.equal(signals.memoryStrength, memoryStrength(pattern, config, now));
  });
});

describe("isInjectable", () => {
  const config = { ...DEFAULT_CONFIG, autoInjectHighConfidence: true, minInjectScore: 8, minInjectCount: 2 };

  it("approved pattern is always injectable", () => {
    assert.equal(isInjectable({ status: "approved", score: 0, count: 0 }, config), true);
  });

  it("rejected pattern is never injectable", () => {
    assert.equal(isInjectable({ status: "rejected", score: 100, count: 100 }, config), false);
  });

  it("high-score, high-count pending is injectable", () => {
    const pattern = { status: "pending", score: 20, count: 5, lastSeen: new Date().toISOString() };
    assert.equal(isInjectable(pattern, config), true);
  });

  it("low-score pending is not injectable", () => {
    const pattern = { status: "pending", score: 3, count: 1, lastSeen: new Date().toISOString() };
    assert.equal(isInjectable(pattern, config), false);
  });

  it("legacy pending preference is injectable when includePendingPreferences is on", () => {
    const pattern = { status: "pending", type: "preference", score: 0, count: 1, fix: "do this" };
    assert.equal(isInjectable(pattern, { ...config, includePendingPreferences: true }), true);
  });

  it("legacy pending preference is gated off by the default (includePendingPreferences off)", () => {
    const pattern = { status: "pending", type: "preference", score: 0, count: 1, fix: "do this" };
    assert.equal(isInjectable(pattern, config), false);
  });

  it("reinforced core preference is injectable when includePendingPreferences is on", () => {
    const pattern = { status: "pending", type: "preference", knowledgeTier: "core", score: 20, count: 5, lastSeen: new Date().toISOString(), fix: "do this" };
    assert.equal(isInjectable(pattern, { ...config, includePendingPreferences: true }), true);
  });

  it("core preference is gated off when includePendingPreferences is off", () => {
    const pattern = { status: "pending", type: "preference", knowledgeTier: "core", score: 20, count: 5, lastSeen: new Date().toISOString(), fix: "do this" };
    assert.equal(isInjectable(pattern, { ...config, includePendingPreferences: false }), false);
  });

  it("low-confidence core preference stays local even with the opt-in on", () => {
    const pattern = { status: "pending", type: "preference", knowledgeTier: "core", score: 6, count: 1, lastSeen: new Date().toISOString(), fix: "do this" };
    assert.equal(isInjectable(pattern, { ...config, includePendingPreferences: true }), false);
  });

  it("null pattern returns false", () => {
    assert.equal(isInjectable(null, config), false);
    assert.equal(isInjectable(undefined, config), false);
  });

  it("uses a caller-provided precomputed decayedScore when given (third arg)", () => {
    // Raw decayedScore sits just under the inject floor (7.996 < 8) but the
    // rounded score decoratePatterns computes (8.00) clears it. The precomputed
    // arg lets decoratePatterns reuse its rounded score instead of re-deriving,
    // which is how the two paths stay behaviourally identical after dedup.
    const pattern = { status: "pending", score: 7.996, count: 5, lastSeen: new Date().toISOString() };
    assert.equal(isInjectable(pattern, config), false, "raw-score path stays below the floor");
    assert.equal(isInjectable(pattern, config, 8.0), true, "precomputed rounded score clears the floor");
  });
});

describe("decoratePatterns", () => {
  const config = { ...DEFAULT_CONFIG, decayHalfLifeDays: 30 };

  it("adds status, decayedScore, injectable to each pattern", () => {
    const patterns = [
      { id: "a", score: 10, count: 3, lastSeen: new Date().toISOString(), status: "pending" },
      { id: "b", score: 3, count: 1, lastSeen: new Date().toISOString(), status: "pending" },
    ];
    const decorated = decoratePatterns(patterns, config);
    assert.equal(decorated.length, 2);
    for (const p of decorated) {
      assert.ok("decayedScore" in p);
      assert.ok("injectable" in p);
      assert.ok("status" in p);
    }
  });

  it("sorts by decayedScore descending", () => {
    const patterns = [
      { id: "low", score: 3, count: 1, lastSeen: new Date().toISOString() },
      { id: "high", score: 20, count: 5, lastSeen: new Date().toISOString() },
    ];
    const decorated = decoratePatterns(patterns, config);
    assert.equal(decorated[0].id, "high");
    assert.equal(decorated[1].id, "low");
  });

  it("handles empty array", () => {
    assert.deepEqual(decoratePatterns([], config), []);
  });

  it("handles null", () => {
    assert.deepEqual(decoratePatterns(null, config), []);
  });
});

describe("buildSkillMdFromPatterns", () => {
  const config = { ...DEFAULT_CONFIG, autoInjectHighConfidence: true, minInjectScore: 8, minInjectCount: 2 };

  it("returns a string with expected sections", () => {
    const patterns = [
      {
        id: "pref:test",
        type: "preference",
        status: "approved",
        score: 20, count: 5,
        lastSeen: new Date().toISOString(),
        fix: "Always use tabs",
      },
      {
        id: "pref:distilled",
        type: "preference",
        status: "pending",
        score: 20, count: 5,
        lastSeen: new Date().toISOString(),
        advisorUpdatedAt: new Date().toISOString(),
        fix: "Advisor-distilled hint",
      },
      {
        id: "pref:raw",
        type: "preference",
        status: "pending",
        score: 20, count: 5,
        lastSeen: new Date().toISOString(),
        fix: "Raw unprocessed correction",
      },
      {
        id: "workflow:read→write",
        type: "workflow",
        status: "pending",
        score: 30, count: 5,
        lastSeen: new Date().toISOString(),
        desc: "Read then write workflow",
      },
    ];
    patterns.push({
      id: "pref:transient",
      type: "preference",
      knowledgeTier: "core",
      status: "pending",
      score: 30,
      count: 5,
      lastSeen: new Date().toISOString(),
      fix: "Transient correction only",
    });
    const md = buildSkillMdFromPatterns(patterns, { ...config, includePendingPreferences: true }, { turnCount: 10, dataDir: "/tmp/test" });
    assert.ok(md.includes("# Runtime Self-Learning"));
    assert.ok(md.includes("Verified User Preferences"));
    assert.ok(md.includes("Always use tabs"));
    assert.ok(md.includes("Advisor-distilled hint"));
    // Raw durable pending corrections stay out of the skill (only approved or
    // advisor-distilled durable prefs qualify).
    assert.ok(!md.includes("Raw unprocessed correction"));
    // Reinforced core-tier preference now surfaces under includePendingPreferences.
    assert.ok(md.includes("Transient correction only"));
    assert.ok(md.includes("Recent Workflows"));
  });

  it("handles empty patterns", () => {
    const md = buildSkillMdFromPatterns([], config, { turnCount: 0 });
    assert.ok(md.includes("0 active"));
  });

  it("trims to budget lowest-priority first (incremental token accounting)", () => {
    const now = new Date().toISOString();
    const mk = (id, type, fix) => ({ id, type, status: type === "preference" ? "approved" : "pending", knowledgeTier: type === "preference" ? "durable" : undefined, score: 30, count: 5, lastSeen: now, desc: `${id} desc`, fix });
    const patterns = [];
    for (let i = 0; i < 5; i++) patterns.push(mk(`error:e${i}`, "error", `runtime hint ${i} ${"x".repeat(40)}`));
    for (let i = 0; i < 5; i++) patterns.push(mk(`workflow:a${i}→b${i}`, "workflow", null));
    for (let i = 0; i < 5; i++) patterns.push(mk(`pref:p${i}`, "preference", `important preference ${i} ${"y".repeat(40)}`));

    const tight = { ...config, maxSkillTokens: 200 };
    const md = buildSkillMdFromPatterns(patterns, tight, { turnCount: 15 });

    // Runtime Hints are trimmed first, Preferences last → at least one
    // preference must survive while the doc stays near budget.
    assert.ok(md.includes("important preference 0"), "highest-priority preference retained");
    assert.ok(md.includes("# Runtime Self-Learning"));
    // Budget is a soft cap; the trimmed result must be far below the untrimmed size.
    const untrimmed = buildSkillMdFromPatterns(patterns, { ...config, maxSkillTokens: 100000 }, { turnCount: 15 });
    assert.ok(md.length < untrimmed.length, "trimmed output is smaller than untrimmed");
  });

  it("bounds the per-turn injected token footprint regardless of store size", () => {
    // The injected SKILL.md is a budgeted dynamic part (maxSkillTokens) plus a
    // fixed instructional tail (~490 tokens). Section caps (≤5 prefs, ≤3
    // workflows, ≤3 risks) plus the token budget keep the footprint bounded even
    // when the pattern store is saturated, so per-call context cost never grows
    // with learning history. Measured ≈ 954 tokens at saturation.
    const now = new Date().toISOString();
    const mk = (id, type, fix) => ({ id, type, status: type === "preference" ? "approved" : "pending", knowledgeTier: type === "preference" ? "durable" : undefined, score: 40, count: 8, lastSeen: now, firstSeen: now, desc: `${id} 这是一条较长的中文描述用于测试注入足迹 ${"x".repeat(30)}`, fix });
    const patterns = [];
    for (let i = 0; i < 40; i++) patterns.push(mk(`error:e${i}`, "error", `runtime hint ${i} ${"h".repeat(50)}`));
    for (let i = 0; i < 40; i++) patterns.push(mk(`workflow:a${i}→b${i}`, "workflow", null));
    for (let i = 0; i < 40; i++) patterns.push(mk(`pref:p${i}`, "preference", `重要偏好 ${i} ${"y".repeat(40)}`));
    const cfg = { ...config, includePendingPreferences: true, autoInjectHighConfidence: true };

    const saturated = buildSkillMdFromPatterns(patterns, cfg, { turnCount: 100 });
    assert.ok(estimateTokens(saturated) <= 1100, `footprint ${estimateTokens(saturated)} tokens exceeds 1100 ceiling`);

    // Tripling the store must not grow the footprint — caps/budget dominate.
    const tripled = buildSkillMdFromPatterns(
      [...patterns, ...patterns, ...patterns].map((p, i) => ({ ...p, id: `${p.id}#${i}` })),
      cfg, { turnCount: 300 },
    );
    assert.ok(Math.abs(estimateTokens(tripled) - estimateTokens(saturated)) <= 60,
      "injected footprint stays stable as the store grows");
  });


  it("gates active skill registry injection behind explicit config", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "active-skills-gate-"));
    try {
      fs.writeFileSync(path.join(tmp, "active_skills.json"), JSON.stringify({
        schemaVersion: 1,
        skills: [
          { id: "skill:ok", status: "active", rule: "Before import repair, check local exports first.", evidence: { successCount: 8, regressionCount: 0 } },
          { id: "skill:low", status: "active", rule: "Low evidence rule", evidence: { successCount: 2, regressionCount: 0 } },
          { id: "skill:regressed", status: "active", rule: "Regressed rule", evidence: { successCount: 9, regressionCount: 1 } }
        ]
      }), "utf-8");

      const off = buildSkillMdFromPatterns([], config, { dataDir: tmp });
      assert.ok(!off.includes("Active Validated Skills"));

      const on = buildSkillMdFromPatterns([], { ...config, activeSkillsInjectionEnabled: true }, { dataDir: tmp });
      assert.ok(on.includes("Active Validated Skills"));
      assert.ok(on.includes("Before import repair"));
      assert.ok(on.includes("8 success"));
      assert.ok(!on.includes("Low evidence rule"));
      assert.ok(!on.includes("Regressed rule"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("selects only injectable active skills", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "active-skills-select-"));
    try {
      fs.writeFileSync(path.join(tmp, "active_skills.json"), JSON.stringify({ skills: [
        { id: "a", status: "active", rule: "A", evidence: { successCount: 7, regressionCount: 0 } },
        { id: "b", status: "active", rule: "B", evidence: { successCount: 9, regressionCount: 0 } },
        { id: "c", status: "staged", rule: "C", evidence: { successCount: 20, regressionCount: 0 } }
      ] }), "utf-8");
      assert.equal(isActiveSkillInjectable({ status: "active", rule: "A", evidence: { successCount: 7, regressionCount: 0 } }, config), true);
      const selected = selectInjectableActiveSkills(tmp, { ...config, activeSkillsInjectionEnabled: true, activeSkillsInjectionMaxCount: 1 });
      assert.deepEqual(selected.map((s) => s.id), ["b"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("includes injectable runtime hints", () => {
    const patterns = [
      {
        id: "usage:large_context:test",
        type: "usage",
        status: "pending",
        score: 20, count: 3,
        lastSeen: new Date().toISOString(),
        desc: "Large context usage on test-model: 150000 tokens",
        fix: "Compact inputs before retrying.",
      },
      {
        id: "error:permission_denied",
        type: "error",
        status: "approved",
        score: 1, count: 1,
        lastSeen: new Date().toISOString(),
        desc: "Repeated error: permission_denied",
        fix: "Check write permissions.",
      },
    ];
    const md = buildSkillMdFromPatterns(patterns, config, { turnCount: 2 });
    assert.ok(md.includes("Active Runtime Hints"));
    assert.ok(md.includes("Large context usage"));
    assert.ok(md.includes("Check write permissions."));
  });
});


describe("countJsonl", () => {
  const tmpDir = path.join(os.tmpdir(), "learner-test-" + Date.now());

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 for non-existent file", () => {
    assert.equal(countJsonl(path.join(tmpDir, "nope.jsonl")), 0);
  });

  it("returns line count for a file with entries", () => {
    const file = path.join(tmpDir, "test.jsonl");
    fs.writeFileSync(file, '{"a":1}\n{"b":2}\n{"c":3}\n', "utf-8");
    assert.equal(countJsonl(file), 3);
  });

  it("returns 0 for empty file", () => {
    const file = path.join(tmpDir, "empty.jsonl");
    fs.writeFileSync(file, "", "utf-8");
    assert.equal(countJsonl(file), 0);
  });
});

describe("countValues", () => {
  it("counts primitive values with an unknown bucket", () => {
    assert.deepEqual(countValues(["a", "b", "a", null, ""]), { a: 2, b: 1, unknown: 2 });
  });
});

describe("readRecentJsonl", () => {
  const tmpDir = path.join(os.tmpdir(), "learner-recent-jsonl-test-" + Date.now());

  before(() => fs.mkdirSync(tmpDir, { recursive: true }));
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("reads recent rows from a bounded tail", () => {
    const file = path.join(tmpDir, "recent.jsonl");
    const old = "2020-01-01T00:00:00.000Z";
    const recent = new Date().toISOString();
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(JSON.stringify({ id: `old-${i}`, date: old }));
    rows.push(JSON.stringify({ id: "recent-1", date: recent }));
    rows.push("not-json");
    rows.push(JSON.stringify({ id: "recent-2", date: recent }));
    fs.writeFileSync(file, `${rows.join("\n")}\n`, "utf-8");

    const cutoff = Date.now() - 60_000;
    assert.deepEqual(readRecentJsonl(file, cutoff, { maxLines: 5 }).map((row) => row.id), ["recent-1", "recent-2"]);
  });

  it("normalizes stable session identity fields while reading", () => {
    const file = path.join(tmpDir, "recent-session.jsonl");
    const recent = new Date().toISOString();
    fs.writeFileSync(file, `${JSON.stringify({
      id: "recent-1",
      date: recent,
      sessionId: "sess-1",
      sessionRef: { tabId: "tab-1" },
      sessionPath: "sessions/test.jsonl",
    })}\n`, "utf-8");

    const cutoff = Date.now() - 60_000;
    const [row] = readRecentJsonl(file, cutoff, { maxLines: 5 });
    assert.equal(row.sessionId, "sess-1");
    assert.deepEqual(row.sessionRef, { tabId: "tab-1" });
    assert.equal(row.sessionKey, "sid:sess-1");
    assert.equal(row.sessionLabel, "sessions/test.jsonl");
  });

  it("samples recent rows and session identity coverage in one pass", () => {
    const file = path.join(tmpDir, "sample.jsonl");
    const cutoff = Date.now() - 60_000;
    const rows = [
      { eventId: "stable-old", date: new Date(cutoff - 60_000).toISOString(), sessionId: "s-old" },
      { eventId: "legacy-recent", date: new Date(cutoff + 1_000).toISOString(), sessionPath: "sessions/legacy.jsonl" },
      { eventId: "unknown-recent", date: new Date(cutoff + 2_000).toISOString() },
    ];
    fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf-8");

    const sample = readJsonlSample(file, { cutoff, maxLines: 10 });

    assert.deepEqual(sample.rows.map((row) => row.eventId), ["legacy-recent", "unknown-recent"]);
    assert.equal(sample.coverage.total, 3);
    assert.equal(sample.coverage.withStableIdentity, 1);
    assert.equal(sample.coverage.legacyPathOnly, 1);
    assert.equal(sample.coverage.unknown, 1);
    assert.equal(sample.coverage.coverageRatio, 1 / 3);
  });
});
