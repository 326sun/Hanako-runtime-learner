import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { DEFAULT_CONFIG } from "../lib/common.js";
import { validateProposal, validateConfigPatch } from "../lib/validation-gate.js";
import { applyPolicyProfile } from "../lib/policy-profiles.js";
import { upsertProposal, applyProposal, verifyProposal, previewProposalDiff } from "../lib/proposals.js";

const tmpDir = path.join(os.tmpdir(), "learner-llmgov-test-" + Date.now());

function patternCandidate(over = {}) {
  return {
    id: "pattern_candidate:abc123",
    type: "pattern_candidate",
    source: "llm",
    kind: "workflow",
    title: "LLM candidate (workflow): edit→test→commit",
    desc: "edit→test→commit repeats",
    generalization: "when iterating on code",
    evidenceIds: ["e1", "e2"],
    confidence: 0.9,
    suggestedRiskTier: "R2",
    risk: "medium",
    autoApply: false,
    ...over,
  };
}

describe("M2 governance · config defaults", () => {
  it("declares the six llm-extraction config keys with safe defaults", () => {
    assert.equal(DEFAULT_CONFIG.llmExtractionEnabled, false);
    assert.equal(DEFAULT_CONFIG.llmExtractionMinIntervalMinutes, 30);
    assert.equal(DEFAULT_CONFIG.llmExtractionMinConfidence, 0.72);
    assert.equal(DEFAULT_CONFIG.llmExtractionMaxAttempts, 3);
    assert.equal(DEFAULT_CONFIG.llmExtractionMaxJobsPerRun, 5);
    assert.equal(DEFAULT_CONFIG.llmExtractionTimeoutMs, 15000);
  });
});

describe("M2 governance · validation gate", () => {
  it("accepts a well-formed pattern_candidate proposal (queued)", () => {
    const r = validateProposal(patternCandidate(), { config: DEFAULT_CONFIG });
    assert.equal(r.ok, true);
  });

  it("blocks a pattern_candidate that is not tagged source:llm", () => {
    const r = validateProposal(patternCandidate({ source: "detector" }), { config: DEFAULT_CONFIG });
    assert.equal(r.ok, false);
  });

  it("blocks a pattern_candidate with empty evidence", () => {
    const r = validateProposal(patternCandidate({ evidenceIds: [] }), { config: DEFAULT_CONFIG });
    assert.equal(r.ok, false);
  });

  it("blocks a pattern_candidate that tries to auto-apply", () => {
    const r = validateProposal(patternCandidate({ autoApply: true }), { config: DEFAULT_CONFIG });
    assert.equal(r.ok, false);
  });

  it("validates the new numeric config keys within range", () => {
    const ok = validateConfigPatch({ llmExtractionMinConfidence: 0.8, llmExtractionTimeoutMs: 20000 }, DEFAULT_CONFIG);
    assert.equal(ok.ok, true);
    const bad = validateConfigPatch({ llmExtractionMinConfidence: 5 }, DEFAULT_CONFIG);
    assert.equal(bad.ok, false);
  });

  it("forbids enabling llmExtraction under the conservative profile", () => {
    const r = validateConfigPatch(
      { governanceProfile: "conservative", llmExtractionEnabled: true },
      { ...DEFAULT_CONFIG, governanceProfile: "conservative", llmExtractionEnabled: false },
    );
    assert.equal(r.ok, false);
    assert.ok(r.checks.some((c) => c.name === "config_conservative:llmExtractionEnabled" && c.status === "fail"));
  });
});

describe("M2 governance · policy profiles", () => {
  it("conservative profile does not touch the user-owned llmExtractionEnabled toggle", () => {
    // Profiles govern only the review/apply posture; enabling llmExtraction under
    // conservative is blocked by the validation gate (config_conservative:*), not by
    // the profile template force-flipping a user's explicit capability choice.
    const r = applyPolicyProfile({ ...DEFAULT_CONFIG, llmExtractionEnabled: true }, "conservative");
    assert.equal(r.config.llmExtractionEnabled, true);
    assert.equal(r.changed.llmExtractionEnabled, undefined);
  });
});

describe("M2 governance · pattern_candidate is review-only", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("verifyProposal refuses to auto-apply a pattern_candidate", () => {
    const v = verifyProposal(patternCandidate());
    assert.equal(v.ok, false);
  });

  it("applyProposal throws for a pattern_candidate (never materializes a pattern)", () => {
    upsertProposal(tmpDir, patternCandidate());
    assert.throws(() => applyProposal(tmpDir, "pattern_candidate:abc123"), /review-only|cannot be applied/i);
  });

  it("previewProposalDiff renders a readable candidate preview", () => {
    const preview = previewProposalDiff(patternCandidate());
    assert.equal(preview.ok, true);
    assert.equal(preview.type, "pattern_candidate");
    assert.ok(Array.isArray(preview.diff));
  });
});
