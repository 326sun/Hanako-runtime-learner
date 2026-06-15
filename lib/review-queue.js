import fs from "fs";
import path from "path";
import { readJson, safeFileSlug, writeJson } from "./common.js";
import { previewProposalDiff, proposalContentHash } from "./proposals.js";
import { validateProposal } from "./validation-gate.js";
import { appendEvent } from "./event-log.js";

function reviewsDir(learnerDir) { return path.join(learnerDir, "reviews"); }
function reviewPath(learnerDir, id) { return path.join(reviewsDir(learnerDir), `${safeFileSlug(id, "review")}.json`); }
export function reviewIdForProposal(proposal) { return `review:${proposal?.id || "unknown"}`; }

export function readReview(learnerDir, id) {
  return readJson(reviewPath(learnerDir, id), null);
}

function writeReview(learnerDir, review) {
  const next = { schemaVersion: 1, createdAt: new Date().toISOString(), ...review, updatedAt: new Date().toISOString() };
  writeJson(reviewPath(learnerDir, next.id), next);
  return next;
}

export function enqueueReviewForProposal(learnerDir, proposal, { configPath = null, config = {}, doctorReport = null } = {}) {
  if (!proposal?.id) return null;
  const id = reviewIdForProposal(proposal);
  const existing = readReview(learnerDir, id);
  if (existing && ["approved", "rejected", "applied"].includes(existing.status)) return existing;
  const diffPreview = previewProposalDiff(proposal, { configPath });
  const validation = validateProposal(proposal, { config, doctorReport });
  const review = writeReview(learnerDir, {
    ...(existing || {}),
    id,
    type: proposal.type,
    status: validation.ok ? "queued" : "blocked",
    risk: proposal.risk || "unknown",
    proposalId: proposal.id,
    proposalContentHash: proposalContentHash(proposal),
    sourcePatternIds: proposal.triggerPatternIds || proposal.sourcePatternIds || [],
    evidenceIds: proposal.evidenceIds || [],
    title: proposal.title || proposal.reason || proposal.id,
    reason: proposal.reason || "",
    diffPreview,
    validation,
  });
  appendEvent(learnerDir, {
    type: existing ? "review.updated" : "review.queued",
    entityType: "review",
    entityId: review.id,
    summary: `${review.status}: ${review.title}`,
    data: { proposalId: proposal.id, risk: review.risk, validationOk: validation.ok },
  });
  return review;
}

export function listReviews(learnerDir, { status = null, limit = 50 } = {}) {
  const dir = reviewsDir(learnerDir);
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    try {
      const row = readJson(path.join(dir, file), null);
      if (row && (!status || row.status === status)) rows.push(row);
    } catch {}
  }
  rows.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export function updateReviewStatus(learnerDir, id, status, extra = {}) {
  const existing = readReview(learnerDir, id);
  if (!existing) throw new Error(`review not found: ${id}`);
  const next = writeReview(learnerDir, { ...existing, ...extra, status, reviewedAt: new Date().toISOString() });
  appendEvent(learnerDir, {
    type: `review.${status}`,
    entityType: "review",
    entityId: id,
    summary: `Review ${status}: ${id}`,
    data: { proposalId: next.proposalId, ...extra },
  });
  return next;
}

export function markReviewForProposal(learnerDir, proposalId, status, extra = {}) {
  return updateReviewStatus(learnerDir, reviewIdForProposal({ id: proposalId }), status, extra);
}

export function isProposalReviewApproved(learnerDir, proposalId) {
  const review = readReview(learnerDir, reviewIdForProposal({ id: proposalId }));
  return review?.status === "approved" || review?.status === "applied";
}

export function reviewPanel(learnerDir, { proposals = [], doctorReport = null } = {}) {
  const reviews = listReviews(learnerDir, { limit: 100 });
  const pendingStatuses = new Set(["queued", "blocked", "approved"]);
  return {
    ok: true,
    doctorStatus: doctorReport?.status || null,
    counts: {
      reviews: reviews.length,
      pendingReviews: reviews.filter((r) => pendingStatuses.has(r.status)).length,
      blockedReviews: reviews.filter((r) => r.status === "blocked").length,
      pendingProposals: proposals.filter((p) => p.status === "pending").length,
    },
    pendingReviews: reviews.filter((r) => pendingStatuses.has(r.status)).slice(0, 30).map((r) => ({
      id: r.id,
      status: r.status,
      type: r.type,
      risk: r.risk,
      proposalId: r.proposalId,
      proposalContentHash: r.proposalContentHash || null,
      title: r.title,
      validationOk: !!r.validation?.ok,
      diff: r.diffPreview ? { target: r.diffPreview.target, addedLines: r.diffPreview.addedLines, removedLines: r.diffPreview.removedLines } : null,
      updatedAt: r.updatedAt,
    })),
    recommendedActions: doctorReport?.suggestedActions || [],
  };
}
