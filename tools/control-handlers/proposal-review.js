// Proposal/review workflow control handlers (S2.P2b split — subsystem-simplify-v5.1.6).
//
// Extracted verbatim from tools/control.js. These handlers take (input, p) or
// (input, p, config) and drive the proposal/review state machine. They own NO
// permission/side-effect decisions — control.js keeps the action dispatch, the
// *_ACTIONS classification sets, describeControlSideEffect and sessionPermission.
// Moving them here removes proposals/proposal-apply-safe/review-queue imports
// (and the proposal-review slice of validation-gate) from control.js.

import { listProposals, readProposal, rejectProposal, previewProposalDiff, verifyProposalReviewBinding } from "../../lib/proposals.js";
import { applyProposalSafely } from "../../lib/proposal-apply-safe.js";
import { validateProposal } from "../../lib/validation-gate.js";
import { enqueueReviewForProposal, listReviews, readReview, reviewPanel, updateReviewStatus } from "../../lib/review-queue.js";
import { appendEvent } from "../../lib/event-log.js";
import { runDoctorFromDisk } from "../doctor.js";
import { validationNextAction, reviewPanelNextActions } from "../control-summaries.js";

export const proposalReviewHandlers = {
  list_proposals(input, p) {
    const proposals = listProposals(p.learnerDir, { status: input.status || null, limit: input.limit || 50 });
    return JSON.stringify({ ok: true, proposals, nextAction: "show_proposal or preview_proposal" }, null, 2);
  },

  show_proposal(input, p) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    const proposal = readProposal(p.learnerDir, input.proposalId || input.id);
    if (!proposal) throw new Error(`proposal not found: ${input.proposalId || input.id}`);
    return JSON.stringify(proposal, null, 2);
  },

  apply_proposal(input, p, config) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    if (config.governanceProfile === "conservative") {
      throw new Error("conservative profile requires review-first flow: approve_review then apply_review");
    }
    const applied = applyProposalSafely(p.learnerDir, input.proposalId || input.id, {
      configPath: p.configPath,
      requireReview: !!config.requireReviewForAutoApply,
      allowedSkillRoots: [p.pluginDir],
    });
    return JSON.stringify({ ok: true, proposal: applied, nextAction: "verify_event_log or export_audit_bundle" }, null, 2);
  },

  reject_proposal(input, p) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    const rejected = rejectProposal(p.learnerDir, input.proposalId || input.id, input.reason || "");
    return JSON.stringify({ ok: true, proposal: rejected, nextAction: "review_panel" }, null, 2);
  },

  review_panel(input, p) {
    const report = runDoctorFromDisk(p.learnerDir);
    const panel = reviewPanel(p.learnerDir, { proposals: listProposals(p.learnerDir, { limit: 100 }), doctorReport: report });
    return JSON.stringify({ ...panel, recommendedNextActions: reviewPanelNextActions(panel) }, null, 2);
  },

  preview_proposal(input, p, config) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    const proposal = readProposal(p.learnerDir, input.proposalId || input.id);
    if (!proposal) throw new Error(`proposal not found: ${input.proposalId || input.id}`);
    const preview = previewProposalDiff(proposal, { configPath: p.configPath });
    enqueueReviewForProposal(p.learnerDir, proposal, { configPath: p.configPath, config });
    appendEvent(p.learnerDir, { type: "proposal.previewed", entityType: "proposal", entityId: proposal.id, summary: `Previewed proposal: ${proposal.id}` });
    return JSON.stringify({ ...preview, nextAction: "validate_proposal, then approve_review or reject_review" }, null, 2);
  },

  validate_proposal(input, p, config) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    const proposal = readProposal(p.learnerDir, input.proposalId || input.id);
    if (!proposal) throw new Error(`proposal not found: ${input.proposalId || input.id}`);
    const validation = validateProposal(proposal, { config, doctorReport: runDoctorFromDisk(p.learnerDir) });
    const review = enqueueReviewForProposal(p.learnerDir, proposal, { configPath: p.configPath, config });
    if (review) updateReviewStatus(p.learnerDir, review.id, validation.ok ? "queued" : "blocked", { validation });
    appendEvent(p.learnerDir, { type: "proposal.validated", entityType: "proposal", entityId: proposal.id, summary: `Validated proposal: ${proposal.id}`, data: { ok: validation.ok } });
    return JSON.stringify({ ...validation, nextAction: validationNextAction(validation) }, null, 2);
  },

  approve_review(input, p) {
    const reviewId = input.id || (input.proposalId ? `review:${input.proposalId}` : null);
    if (!reviewId) throw new Error("id or proposalId is required");
    const review = readReview(p.learnerDir, reviewId);
    if (!review) throw new Error(`review not found: ${reviewId}`);
    const proposal = readProposal(p.learnerDir, review.proposalId);
    if (!proposal) throw new Error(`proposal not found: ${review.proposalId}`);
    const binding = verifyProposalReviewBinding(proposal, review);
    if (!binding.ok) throw new Error(binding.error);
    const next = updateReviewStatus(p.learnerDir, reviewId, "approved");
    return JSON.stringify({ ok: true, review: next, nextAction: "apply_review" }, null, 2);
  },

  reject_review(input, p) {
    const reviewId = input.id || (input.proposalId ? `review:${input.proposalId}` : null);
    if (!reviewId) throw new Error("id or proposalId is required");
    const next = updateReviewStatus(p.learnerDir, reviewId, "rejected", { reason: input.reason || "" });
    return JSON.stringify({ ok: true, review: next, nextAction: "reject_proposal or review_panel" }, null, 2);
  },

  apply_review(input, p) {
    const reviewId = input.id || (input.proposalId ? `review:${input.proposalId}` : null);
    if (!reviewId) throw new Error("id or proposalId is required");
    const review = readReview(p.learnerDir, reviewId);
    if (!review) throw new Error(`review not found: ${reviewId}`);
    if (review.status !== "approved") throw new Error(`review must be approved before apply: ${reviewId}`);
    const proposal = readProposal(p.learnerDir, review.proposalId);
    if (!proposal) throw new Error(`proposal not found: ${review.proposalId}`);
    const binding = verifyProposalReviewBinding(proposal, review);
    if (!binding.ok) throw new Error(binding.error);
    const applied = applyProposalSafely(p.learnerDir, review.proposalId, { configPath: p.configPath, requireReview: true, allowedSkillRoots: [p.pluginDir] });
    return JSON.stringify({ ok: true, reviewId, proposal: applied, nextAction: "verify_event_log or export_audit_bundle" }, null, 2);
  },

  list_reviews(input, p) {
    const reviews = listReviews(p.learnerDir, { limit: input.limit || 50 });
    return JSON.stringify({ ok: true, reviews, nextAction: "show_proposal then preview_proposal" }, null, 2);
  },
};
