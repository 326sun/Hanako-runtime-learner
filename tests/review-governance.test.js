import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { buildCodePatchProposal, buildSkillPatchProposal, applyProposal, readProposal, rejectProposal, writeProposal } from "../lib/proposals.js";
import { previewProposalDiff } from "../lib/proposals.js";
import { validateProposal } from "../lib/validation-gate.js";
import { listReviews, reviewIdForProposal, updateReviewStatus, reviewPanel } from "../lib/review-queue.js";
import { readEvents, replayEventState, appendEvent } from "../lib/event-log.js";
import { loadSkillRegistry } from "../lib/skill-lifecycle.js";
import { DEFAULT_CONFIG, writeJson } from "../lib/common.js";
import { execute as executeControl } from "../tools/control.js";
import { parseToolResult, unwrapToolResult } from "./_test-utils.js";

const tmpDir = path.join(os.tmpdir(), `learner-review-test-${Date.now()}`);
const savedHanaHome = process.env.HANA_HOME;

describe("review governance", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    delete process.env.HANA_HOME;
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedHanaHome === undefined) delete process.env.HANA_HOME;
    else process.env.HANA_HOME = savedHanaHome;
  });

  it("creates a review item and diff preview for skill_patch proposals", () => {
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "# Runtime Self-Learning\n\nold\n", "utf-8");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n\nnew\n" });
    const reviews = listReviews(tmpDir);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].proposalId, proposal.id);
    assert.equal(reviews[0].validation.ok, true);
    assert.ok(reviews[0].diffPreview.diff.some((line) => line.startsWith("+ new")));

    const preview = previewProposalDiff(proposal);
    assert.equal(preview.ok, true);
    assert.equal(preview.addedLines >= 1, true);
  });

  it("validation gate blocks invalid skill patches", () => {
    const bad = { id: "skill_patch:bad", type: "skill_patch", patch: { content: "no header" }, target: { skillPath: "SKILL.md" } };
    const result = validateProposal(bad);
    assert.equal(result.ok, false);
    assert.ok(result.checks.some((c) => c.name === "skill_header" && c.status === "fail"));
  });

  it("apply records events and skill registry state", () => {
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    const content = "# Runtime Self-Learning\n\nUpdated governance hint.\n";
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content, triggerPatternIds: ["workflow:test"] });
    updateReviewStatus(tmpDir, reviewIdForProposal(proposal), "approved");
    const applied = applyProposal(tmpDir, proposal.id);
    assert.equal(applied.status, "applied");
    assert.equal(fs.readFileSync(skillPath, "utf-8"), content);
    const registry = loadSkillRegistry(tmpDir);
    assert.equal(registry[skillPath].status, "active");
    assert.equal(registry[skillPath].sourceProposalId, proposal.id);
    assert.ok(readEvents(tmpDir, { limit: 20 }).some((evt) => evt.type === "proposal.applied"));
  });

  it("rejected proposals update review and event log", () => {
    const skillPath = path.join(tmpDir, "SKILL.md");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n" });
    const rejected = rejectProposal(tmpDir, proposal.id, "not needed");
    assert.equal(rejected.status, "rejected");
    const reviews = listReviews(tmpDir, { status: "rejected" });
    assert.equal(reviews.length, 1);
    assert.ok(readEvents(tmpDir, { limit: 20 }).some((evt) => evt.type === "proposal.rejected"));
  });

  it("does not reopen a terminal review when validation is repeated", async () => {
    const home = path.join(tmpDir, "terminal-home");
    process.env.HANA_HOME = home;
    const learnerDir = path.join(home, "self-learning");
    const pluginDir = path.join(tmpDir, "terminal-plugin");
    const proposal = buildSkillPatchProposal({
      learnerDir,
      skillPath: path.join(pluginDir, "skills", "self-learning", "SKILL.md"),
      content: "# Runtime Self-Learning\n\nterminal review\n",
    });
    rejectProposal(learnerDir, proposal.id, "not needed");

    await executeControl({ action: "validate_proposal", proposalId: proposal.id }, { pluginDir });
    assert.equal(listReviews(learnerDir)[0].status, "rejected");
  });

  it("does not approve a review whose validation is blocked", async () => {
    const home = path.join(tmpDir, "blocked-home");
    process.env.HANA_HOME = home;
    const learnerDir = path.join(home, "self-learning");
    const pluginDir = path.join(tmpDir, "blocked-plugin");
    const proposal = buildSkillPatchProposal({
      learnerDir,
      skillPath: path.join(pluginDir, "skills", "self-learning", "SKILL.md"),
      content: "# Runtime Self-Learning\n\nblocked review\n",
    });
    updateReviewStatus(learnerDir, reviewIdForProposal(proposal), "blocked", { validation: { ok: false } });

    await assert.rejects(
      () => executeControl({ action: "approve_review", proposalId: proposal.id }, { pluginDir }),
      /blocked|validation/i,
    );
  });

  it("keeps applied and rejected reviews terminal", () => {
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath: path.join(tmpDir, "SKILL.md"), content: "# Runtime Self-Learning\n" });
    const reviewId = reviewIdForProposal(proposal);
    updateReviewStatus(tmpDir, reviewId, "applied");
    assert.throws(() => updateReviewStatus(tmpDir, reviewId, "approved"), /terminal/);
  });

  it("rejects the proposal atomically when its review is rejected", async () => {
    const home = path.join(tmpDir, "reject-home");
    process.env.HANA_HOME = home;
    const learnerDir = path.join(home, "self-learning");
    const pluginDir = path.join(tmpDir, "reject-plugin");
    const proposal = buildSkillPatchProposal({
      learnerDir,
      skillPath: path.join(pluginDir, "skills", "self-learning", "SKILL.md"),
      content: "# Runtime Self-Learning\n\nreject atomically\n",
    });

    await executeControl({ action: "reject_review", proposalId: proposal.id, reason: "not useful" }, { pluginDir });
    assert.equal(readProposal(learnerDir, proposal.id).status, "rejected");
    assert.equal(listReviews(learnerDir)[0].status, "rejected");
  });

  it("reconciles a legacy pending proposal with its rejected review tombstone", () => {
    const pattern = { id: "error:legacy_review", type: "error", count: 3, desc: "legacy", fix: "inspect" };
    const proposal = buildCodePatchProposal({ learnerDir: tmpDir, pattern });
    updateReviewStatus(tmpDir, reviewIdForProposal(proposal), "rejected", { rejectionReason: "legacy rejection" });

    const regenerated = buildCodePatchProposal({ learnerDir: tmpDir, pattern });
    assert.equal(regenerated.status, "rejected");
    assert.equal(readProposal(tmpDir, proposal.id).status, "rejected");
  });


  it("strict review mode blocks apply until the proposal review is approved", () => {
    const skillPath = path.join(tmpDir, "strict", "SKILL.md");
    const content = "# Runtime Self-Learning\n\nStrict review gated content.\n";
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content });

    assert.throws(
      () => applyProposal(tmpDir, proposal.id, { requireReview: true }),
      /review approval required/
    );

    updateReviewStatus(tmpDir, reviewIdForProposal(proposal), "approved");
    const applied = applyProposal(tmpDir, proposal.id, { requireReview: true });
    assert.equal(applied.status, "applied");
    assert.equal(fs.readFileSync(skillPath, "utf-8"), content);
  });

  it("strict review mode rejects proposals changed after approval", () => {
    const skillPath = path.join(tmpDir, "tampered", "SKILL.md");
    const content = "# Runtime Self-Learning\n\nOriginal approved content.\n";
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content, reason: "original" });
    updateReviewStatus(tmpDir, reviewIdForProposal(proposal), "approved");
    writeProposal(tmpDir, { ...proposal, reason: "tampered after approval" });

    assert.throws(
      () => applyProposal(tmpDir, proposal.id, { requireReview: true }),
      /proposal content changed after review/
    );
  });

  it("event replay reconstructs proposal and review state", () => {
    const skillPath = path.join(tmpDir, "events", "SKILL.md");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n\nEvent replay.\n" });
    updateReviewStatus(tmpDir, reviewIdForProposal(proposal), "approved");
    applyProposal(tmpDir, proposal.id, { requireReview: true });

    const replay = replayEventState(readEvents(tmpDir, { limit: 100 }));
    assert.equal(replay.byType["proposal.applied"] >= 1, true);
    assert.equal(replay.entities[`proposal:${proposal.id}`].status, "applied");
    assert.equal(replay.entities[`review:${reviewIdForProposal(proposal)}`].status, "applied");
  });

  it("event replay keeps append order for same-millisecond events", () => {
    const date = new Date().toISOString();
    appendEvent(tmpDir, { type: "proposal.created", entityType: "proposal", entityId: "p_same_ms", date });
    appendEvent(tmpDir, { type: "proposal.applied", entityType: "proposal", entityId: "p_same_ms", date });

    const replay = replayEventState(readEvents(tmpDir, { limit: 10 }));
    assert.equal(replay.entities["proposal:p_same_ms"].status, "applied");
  });

  it("reviewPanel summarizes queued and blocked items", () => {
    const skillPath = path.join(tmpDir, "SKILL.md");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n" });
    const panel = reviewPanel(tmpDir, { proposals: [proposal], doctorReport: { status: "good", suggestedActions: [] } });
    assert.equal(panel.ok, true);
    assert.equal(panel.counts.pendingReviews >= 1, true);
  });

  it("control set_config validates patches and redacts secrets", async () => {
    const home = path.join(tmpDir, "home");
    process.env.HANA_HOME = home;
    const raw = await executeControl({
      action: "set_config",
      modelAdvisorApiKey: "sk-secret-value",
      minInjectScore: 12,
    }, { pluginDir: path.join(tmpDir, "plugin") });
    assert.equal(unwrapToolResult(raw).includes("sk-secret-value"), false);
    const result = parseToolResult(raw);
    assert.equal(result.ok, true);
    assert.equal(result.config.modelAdvisorApiKey, "***");
    assert.equal(result.config.minInjectScore, 12);

    await assert.rejects(
      () => executeControl({ action: "set_config", minInjectScore: "bad" }, { pluginDir: path.join(tmpDir, "plugin") }),
      /config validation failed/
    );
  });

  it("control apply_proposal respects strict review settings", async () => {
    const home = path.join(tmpDir, "home");
    process.env.HANA_HOME = home;
    const learnerDir = path.join(home, "self-learning");
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    writeJson(path.join(learnerDir, "runtime-config.json"), { ...DEFAULT_CONFIG, governanceProfile: "balanced", requireReviewForAutoApply: true });
    const proposal = buildSkillPatchProposal({
      learnerDir,
      skillPath,
      content: "# Runtime Self-Learning\n\nStrict control apply.\n",
    });

    await assert.rejects(
      () => executeControl({ action: "apply_proposal", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }),
      /review approval required/
    );

    updateReviewStatus(learnerDir, reviewIdForProposal(proposal), "approved");
    const result = parseToolResult(await executeControl({ action: "apply_proposal", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }));
    assert.equal(result.proposal.status, "applied");
    assert.equal(fs.readFileSync(skillPath, "utf-8"), "# Runtime Self-Learning\n\nStrict control apply.\n");
  });

  it("control apply_proposal allows balanced low-risk proposals when strict review is off", async () => {
    const home = path.join(tmpDir, "home");
    process.env.HANA_HOME = home;
    const learnerDir = path.join(home, "self-learning");
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    writeJson(path.join(learnerDir, "runtime-config.json"), { ...DEFAULT_CONFIG, governanceProfile: "balanced", requireReviewForAutoApply: false });
    const proposal = buildSkillPatchProposal({
      learnerDir,
      skillPath,
      content: "# Runtime Self-Learning\n\nBalanced control apply.\n",
    });

    const result = parseToolResult(await executeControl({ action: "apply_proposal", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }));
    assert.equal(result.proposal.status, "applied");
    assert.equal(fs.readFileSync(skillPath, "utf-8"), "# Runtime Self-Learning\n\nBalanced control apply.\n");
  });

  it("control apply_proposal is blocked in conservative profile even after approval", async () => {
    const home = path.join(tmpDir, "home");
    process.env.HANA_HOME = home;
    const learnerDir = path.join(home, "self-learning");
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    writeJson(path.join(learnerDir, "runtime-config.json"), { ...DEFAULT_CONFIG, governanceProfile: "conservative", requireReviewForAutoApply: true });
    const proposal = buildSkillPatchProposal({
      learnerDir,
      skillPath,
      content: "# Runtime Self-Learning\n\nConservative control apply.\n",
    });
    updateReviewStatus(learnerDir, reviewIdForProposal(proposal), "approved");

    await assert.rejects(
      () => executeControl({ action: "apply_proposal", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }),
      /conservative profile requires review-first/
    );

    const result = parseToolResult(await executeControl({ action: "apply_review", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }));
    assert.equal(result.proposal.status, "applied");
    assert.equal(fs.readFileSync(skillPath, "utf-8"), "# Runtime Self-Learning\n\nConservative control apply.\n");
  });

  it("control apply_proposal still blocks code_patch proposals", async () => {
    const home = path.join(tmpDir, "home");
    process.env.HANA_HOME = home;
    const learnerDir = path.join(home, "self-learning");
    writeJson(path.join(learnerDir, "runtime-config.json"), { ...DEFAULT_CONFIG, governanceProfile: "balanced", requireReviewForAutoApply: false });
    const proposal = buildCodePatchProposal({
      learnerDir,
      pattern: { id: "error:control_code_patch", type: "error", count: 3, desc: "Repeated failure.", fix: "Inspect manually." },
    });

    await assert.rejects(
      () => executeControl({ action: "apply_proposal", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }),
      /code_patch proposals cannot be auto-applied/
    );
  });

  it("control proposal review actions include actionable next steps", async () => {
    const home = path.join(tmpDir, "home");
    process.env.HANA_HOME = home;
    const learnerDir = path.join(home, "self-learning");
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    writeJson(path.join(learnerDir, "runtime-config.json"), { ...DEFAULT_CONFIG, governanceProfile: "balanced", requireReviewForAutoApply: true });
    const proposal = buildSkillPatchProposal({
      learnerDir,
      skillPath,
      content: "# Runtime Self-Learning\n\nNext action hint.\n",
    });

    const preview = parseToolResult(await executeControl({ action: "preview_proposal", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }));
    assert.equal(preview.nextAction, "validate_proposal, then approve_review or reject_review");

    const validation = parseToolResult(await executeControl({ action: "validate_proposal", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }));
    assert.equal(validation.ok, true);
    assert.equal(validation.nextAction, "approve_review then apply_review");

    const panel = parseToolResult(await executeControl({ action: "review_panel" }, { pluginDir: path.join(tmpDir, "plugin") }));
    assert.ok(panel.recommendedNextActions.some((action) => action.includes("preview queued reviews")));

    const approved = parseToolResult(await executeControl({ action: "approve_review", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }));
    assert.equal(approved.nextAction, "apply_review");

    const applied = parseToolResult(await executeControl({ action: "apply_review", proposalId: proposal.id }, { pluginDir: path.join(tmpDir, "plugin") }));
    assert.equal(applied.nextAction, "verify_event_log or export_audit_bundle");
  });
});
