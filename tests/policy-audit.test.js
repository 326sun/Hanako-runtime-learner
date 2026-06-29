import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { DEFAULT_CONFIG } from "../lib/common.js";
import { applyPolicyProfile, listPolicyProfiles } from "../lib/policy-profiles.js";
import { buildAuditBundle, exportAuditBundle } from "../lib/audit-bundle.js";

test("policy profiles list stable built-in modes", () => {
  const names = listPolicyProfiles().map((p) => p.name).sort();
  assert.deepEqual(names, ["autonomous", "balanced", "conservative"]);
});

test("conservative policy sets the review-first posture without touching user-owned toggles", () => {
  const result = applyPolicyProfile({ ...DEFAULT_CONFIG, modelAdvisorEnabled: true, semanticSearchEnabled: true }, "conservative");
  assert.equal(result.ok, true);
  assert.equal(result.config.governanceProfile, "conservative");
  assert.equal(result.config.requireReviewForAutoApply, true);
  assert.equal(result.config.autoApproveHighConfidence, false);
  assert.equal(result.config.autoInjectHighConfidence, false);
  assert.ok(result.changed.requireReviewForAutoApply);
  // Capability/privacy toggles the user enabled explicitly are NOT forced off:
  // they are orthogonal to the review/apply posture a profile governs.
  assert.equal(result.config.modelAdvisorEnabled, true);
  assert.equal(result.config.semanticSearchEnabled, true);
  assert.equal(result.changed.modelAdvisorEnabled, undefined);
  assert.equal(result.changed.semanticSearchEnabled, undefined);
});

// Profiles govern the review/apply posture (auto-inject / auto-approve /
// require-review) plus the proposalChatNotifications flavour that distinguishes
// autonomous from balanced. Capability, privacy and the pending-preference safety
// gate are user-owned and must survive a profile switch untouched, so doctor's
// policy_inconsistent check never nags about a user's explicit capability choice.
const USER_OWNED_TOGGLES = [
  "includePendingPreferences",
  "includeUsageInAdvisorPrompt",
  "modelAdvisorEnabled",
  "semanticSearchEnabled",
  "llmExtractionEnabled",
  "workStatusEnabled",
];

test("policy profiles never override user-owned capability/privacy/UX toggles", () => {
  for (const name of ["conservative", "balanced", "autonomous"]) {
    for (const key of USER_OWNED_TOGGLES) {
      const onResult = applyPolicyProfile({ ...DEFAULT_CONFIG, [key]: true }, name);
      assert.equal(onResult.config[key], true, `${name} must preserve explicit ${key}=true`);
      assert.equal(onResult.changed[key], undefined, `${name} must not record a change to ${key}`);

      const offResult = applyPolicyProfile({ ...DEFAULT_CONFIG, [key]: false }, name);
      assert.equal(offResult.config[key], false, `${name} must preserve explicit ${key}=false`);
      assert.equal(offResult.changed[key], undefined, `${name} must not record a change to ${key}`);
    }
  }
});

test("unknown policy is rejected with available profile names", () => {
  const result = applyPolicyProfile(DEFAULT_CONFIG, "reckless");
  assert.equal(result.ok, false);
  assert.ok(result.available.includes("balanced"));
});

test("audit bundle redacts secrets and writes markdown/json files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-bundle-"));
  const bundle = buildAuditBundle({
    version: "test",
    config: {
      ...DEFAULT_CONFIG,
      governanceProfile: "conservative",
      semanticEmbeddingApiKey: "secret",
      modelAdvisorBaseUrl: "https://user:pass@api.example.com/v1/chat/completions?token=secret",
    },
    patterns: [
      { id: "p1", type: "workflow", status: "approved", score: 9, count: 3, scope: { project: "alpha" }, desc: "A", fix: "B" },
      { id: "p2", type: "error", status: "pending", score: 3, count: 1, scope: { project: "general" }, desc: "C", fix: "D" },
    ],
    facts: [{ id: "f1" }],
    proposals: [{ id: "pr1", status: "pending" }],
    reviews: [{ id: "rv1", status: "queued" }],
    events: [{ id: "evt1" }],
    eventSummary: { proposal: { pr1: { status: "pending" } } },
    doctor: { status: "good", label: "Good", score: 100, issues: [] },
    transferCandidates: [{ id: "tc1", status: "validated", candidate: { sourceProjectId: "source", targetProjectId: "target", riskTier: "R2" }, validation: { status: "passed" }, promotion: { manualPromotionEligible: true, autoPromotionBlocked: true } }],
  });
  assert.equal(bundle.config.semanticEmbeddingApiKey, "[redacted]");
  assert.equal(bundle.config.modelAdvisorBaseUrl, "https://api.example.com");
  assert.equal(bundle.scopeDistribution.alpha, 1);
  assert.equal(bundle.summary.transferCandidates, 1);
  assert.equal(bundle.transferCandidateStatus.validated, 1);
  assert.equal(bundle.transferCandidates[0].manualPromotionEligible, true);
  const written = exportAuditBundle(tmp, bundle, { name: "run" });
  assert.ok(fs.existsSync(written.jsonPath));
  assert.ok(fs.existsSync(written.mdPath));
  const md = fs.readFileSync(written.mdPath, "utf-8");
  assert.match(md, /Runtime Self-Learning Audit Bundle/);
});
