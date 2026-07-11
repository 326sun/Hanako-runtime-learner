import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DEFAULT_CONFIG, readJson, writeJson, mergeConfig } from "./common.js";
import { atomicWriteFileSync } from "./atomic-file.js";
import { cleanupMatchingLegacyEntityFile, entityFilePath, resolveEntityFilePath } from "./entity-file.js";
import { enqueueReviewForProposal, markReviewForProposal, readReview, reviewIdForProposal } from "./review-queue.js";
import { validateProposal as validateWithGate } from "./validation-gate.js";
import { appendEvent } from "./event-log.js";
import { updateSkillState } from "./skill-lifecycle.js";

// ── Proposal fingerprinting (was proposal-fingerprint.js) ──────────────────

const AUDIT_FIELDS = new Set([
  "schemaVersion", "status", "createdAt", "updatedAt", "appliedAt",
  "rejectedAt", "reviewedAt", "result", "rejectionReason",
  // Crash-recovery metadata is governance state, not reviewed proposal
  // content. Binding it would make an approved proposal impossible to resume
  // after the durable `applying` marker had been written.
  "applicationStartedAt", "recovery",
]);

function stableValue(value, { topLevel = false } = {}) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (topLevel && AUDIT_FIELDS.has(key)) continue;
    const next = stableValue(value[key]);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export function proposalContentHash(proposal = {}) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(proposal || {}, { topLevel: true }))).digest("hex");
}

export function verifyProposalReviewBinding(proposal, review) {
  if (!proposal?.id) return { ok: false, error: "proposal missing" };
  if (!review?.id) return { ok: false, error: "review missing" };
  if (review.proposalId !== proposal.id) return { ok: false, error: `review/proposal id mismatch: ${review.proposalId} !== ${proposal.id}` };
  if (!review.proposalContentHash) return { ok: false, error: `review is not bound to proposal content: ${review.id}` };
  const actual = proposalContentHash(proposal);
  if (review.proposalContentHash !== actual) return { ok: false, error: `proposal content changed after review: ${proposal.id}` };
  return { ok: true, proposalContentHash: actual };
}

// ── Core proposal functions ────────────────────────────────────────────────

function hashText(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

export function proposalsDir(learnerDir) {
  return path.join(learnerDir, "proposals");
}

export function proposalPath(learnerDir, id) {
  return entityFilePath(proposalsDir(learnerDir), id, { fallback: "proposal", max: 160 });
}

export function readProposal(learnerDir, id) {
  const file = resolveEntityFilePath(proposalsDir(learnerDir), id, { fallback: "proposal", max: 160 });
  const proposal = readJson(file, null);
  return proposal?.id === id ? proposal : null;
}

function writeProposalRecord(learnerDir, proposal) {
  writeJson(proposalPath(learnerDir, proposal.id), proposal);
  cleanupMatchingLegacyEntityFile(proposalsDir(learnerDir), proposal.id, { fallback: "proposal", max: 160 });
}

function appliedProposalRecord(proposal, backupPath = null) {
  const now = new Date().toISOString();
  return {
    ...proposal,
    status: "applied",
    appliedAt: proposal.appliedAt || now,
    updatedAt: now,
    result: { ok: true, backupPath: backupPath ?? proposal.result?.backupPath ?? null },
  };
}

// A target file and its governance records live in separate files, so the
// filesystem cannot make them a literal transaction. `applying` is a durable
// write-ahead marker: after a crash we can deterministically converge forward
// when the target contains the proposed bytes, or reopen pending when it does
// not. No target write is ever repeated blindly from an ambiguous state.
function recoverApplyingProposal(learnerDir, proposal, { configPath = null } = {}) {
  if (proposal?.status !== "applying") return proposal;
  let targetMatches = false;
  if (proposal.type === "skill_patch") {
    try { targetMatches = fs.readFileSync(proposal.target?.skillPath, "utf-8") === proposal.patch?.content; } catch {}
  } else if (proposal.type === "config_patch" && configPath) {
    try {
      const current = mergeConfig(readJson(configPath, {}));
      const expected = mergeConfig(current, proposal.patch?.config || {});
      targetMatches = Object.entries(proposal.patch?.config || {}).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(expected[key]) && JSON.stringify(current[key]) === JSON.stringify(value));
    } catch {}
  }
  if (!targetMatches) {
    const pending = { ...proposal, status: "pending", updatedAt: new Date().toISOString(), recovery: { action: "reopened", at: new Date().toISOString() } };
    writeProposalRecord(learnerDir, pending);
    return pending;
  }
  const applied = appliedProposalRecord(proposal);
  writeProposalRecord(learnerDir, applied);
  try { markReviewForProposal(learnerDir, proposal.id, "applied", { recovery: "target_already_applied" }); } catch {}
  try { appendEvent(learnerDir, { type: "proposal.recovered_applied", entityType: "proposal", entityId: proposal.id, summary: `Recovered applied proposal: ${proposal.id}` }); } catch {}
  return applied;
}

// Terminal proposals (applied/rejected) are kept only for audit/history and are
// never re-acted on, yet new ones accrue continuously — every distinct skill
// refresh produces a fresh content-hashed `applied` skill_patch file. Cap them
// so the proposals/ dir doesn't grow without bound. Pending proposals are
// actionable and always retained.
const MAX_RESOLVED_PROPOSALS = 40;

export function pruneProposals(learnerDir, { keepResolved = MAX_RESOLVED_PROPOSALS } = {}) {
  const dir = proposalsDir(learnerDir);
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  try {
    const names = fs.readdirSync(dir).filter((file) => file.endsWith(".json"));
    // Cheap gate: total file count (pending + terminal) is an upper bound on the
    // terminal count, so if it's within the cap there is nothing to prune and we
    // skip the parse-heavy scan below — the common steady-state path.
    if (names.length <= keepResolved) return 0;
    const resolved = names
      .map((file) => {
        const full = path.join(dir, file);
        try {
          const row = readJson(full, null);
          if (row) return { full, status: row.status, ts: row.updatedAt || row.createdAt || "" };
        } catch {
          return { full, status: "unknown", ts: "" };
        }
      })
      .filter((p) => p.status === "applied" || p.status === "rejected")
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    for (const stale of resolved.slice(keepResolved)) {
      try { fs.rmSync(stale.full, { force: true }); removed += 1; } catch {}
    }
  } catch {}
  return removed;
}

export function writeProposal(learnerDir, proposal) {
  fs.mkdirSync(proposalsDir(learnerDir), { recursive: true });
  const existed = readProposal(learnerDir, proposal.id);
  const now = new Date().toISOString();
  const next = {
    schemaVersion: 1,
    status: "pending",
    createdAt: now,
    ...proposal,
    updatedAt: now,
  };
  writeProposalRecord(learnerDir, next);
  try {
    enqueueReviewForProposal(learnerDir, next);
    appendEvent(learnerDir, {
      type: existed ? "proposal.updated" : "proposal.created",
      entityType: "proposal",
      entityId: next.id,
      summary: `${next.type || "proposal"}: ${next.title || next.id}`,
      data: { risk: next.risk, autoApply: !!next.autoApply, triggerPatternIds: next.triggerPatternIds || [] },
    });
  } catch {}
  pruneProposals(learnerDir);
  return next;
}

export function listProposals(learnerDir, { status = null, limit = 0 } = {}) {
  const dir = proposalsDir(learnerDir);
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      try {
        return { file, mtimeMs: fs.statSync(path.join(dir, file)).mtimeMs };
      } catch {
        return { file, mtimeMs: 0 };
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => entry.file);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const row = readJson(path.join(dir, file), null);
      if (row && (!status || row.status === status)) rows.push(row);
      if (limit > 0 && rows.length >= limit) break;
    } catch {}
  }
  return rows.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

export function upsertProposal(learnerDir, proposal) {
  const existing = readProposal(learnerDir, proposal.id);
  if (existing && ["applied", "rejected"].includes(existing.status)) return existing;

  // Resolved proposal files are pruned to cap storage, while their review
  // records remain as durable audit tombstones. Respect that terminal review
  // when the same stable proposal id is generated again; otherwise pruning a
  // rejected proposal silently makes it pending again and recreates backlog.
  const review = readReview(learnerDir, reviewIdForProposal(proposal));
  if (review && ["applied", "rejected"].includes(review.status)) {
    const rejectionReason = review.rejectionReason || review.reason || "";
    const terminal = {
      ...(existing || {}),
      ...proposal,
      status: review.status,
      updatedAt: review.updatedAt || review.reviewedAt || review.createdAt,
      ...(review.status === "rejected" && rejectionReason ? { rejectionReason } : {}),
    };
    // Heal legacy split-brain state created when a review was rejected while
    // its proposal file remained pending. Missing (already-pruned) proposal
    // files stay pruned and use the review as a lightweight tombstone.
    if (existing) {
      writeProposalRecord(learnerDir, terminal);
      pruneProposals(learnerDir);
    }
    return terminal;
  }

  return writeProposal(learnerDir, { ...(existing || {}), ...proposal });
}

export function buildSkillPatchProposal({ learnerDir, skillPath, content, reason = "Refresh active runtime learning hints", triggerPatternIds = [] }) {
  const contentHash = hashText(content);
  const resolvedSkillPath = path.resolve(skillPath);
  return upsertProposal(learnerDir, {
    id: `skill_patch:${contentHash.slice(0, 16)}`,
    type: "skill_patch",
    title: "Refresh self-learning skill hints",
    risk: "low",
    autoApply: true,
    reason,
    triggerPatternIds,
    target: { skillPath, skillPathHash: hashText(resolvedSkillPath) },
    patch: { content, contentHash },
  });
}

// Error buckets that must never become high-risk code_patch investigation
// tickets — they lack a stable, code-addressable failure mode, so a proposal is
// noise instead of a fix plan:
//   error:unknown       — diagnostic catch-all, no classifier match at all.
//   error:tool_error    — broad catch-all (classifyError matches generic
//                         /error|failed/), so one pattern aggregates heterogeneous
//                         failures with no single code target.
//   error:network_error — environmental (connectivity / timeouts); there is
//                         nothing in plugin code to patch.
// Specific buckets (file_not_found, permission_denied, syntax_error, path_error,
// command_not_found, auth_error, model_error) stay actionable.
const NON_ACTIONABLE_CODE_PATCH_PATTERNS = new Set([
  "error:unknown",
  "error:tool_error",
  "error:network_error",
]);

export function isActionableCodePatchPattern(pattern) {
  if (!pattern || pattern.type !== "error") return false;
  return !NON_ACTIONABLE_CODE_PATCH_PATTERNS.has(String(pattern.id || ""));
}

export function buildCodePatchProposal({ learnerDir, pattern }) {
  // Hash by pattern id only — not the fix/desc text. Including the (mutable)
  // advice meant every advisor rephrase minted a fresh proposal id, so a
  // proposal the user already rejected for this pattern no longer suppressed
  // re-notification. A stable per-pattern id keeps rejections sticky while
  // upsertProposal still refreshes the summary of a still-pending proposal.
  const idHash = hashText(pattern.id).slice(0, 16);
  return upsertProposal(learnerDir, {
    id: `code_patch:${idHash}`,
    type: "code_patch",
    title: `Investigate repeated ${pattern.type} pattern`,
    risk: "high",
    autoApply: false,
    reason: "Repeated runtime pattern may need a plugin code or workflow change.",
    triggerPatternIds: [pattern.id],
    target: { plugin: "hanako-runtime-learner" },
    patch: {
      summary: pattern.fix || pattern.desc,
      suggestedPlan: [
        "Reproduce the repeated pattern with a focused test or local event fixture.",
        "Identify whether the fix belongs in runtime detection, a tool, generated skill text, or documentation.",
        "Apply a minimal code patch only after review approval.",
      ],
      verification: { metrics: ["manual_review_required"] },
    },
  });
}

export function verifyProposal(proposal) {
  if (!proposal?.id) return { ok: false, error: "proposal id missing" };
  if (proposal.type === "skill_patch") {
    if (!proposal.target?.skillPath) return { ok: false, error: "skillPath missing" };
    // A tampered proposal file must not be able to redirect the write to an
    // arbitrary path (e.g. a shell rc file). Every legitimate skill_patch
    // targets a file literally named SKILL.md.
    const rawSkillPath = String(proposal.target.skillPath);
    if (rawSkillPath.split(/[\\/]+/).includes("..")) {
      return { ok: false, error: "skill_patch target path must not contain traversal segments" };
    }
    if (path.basename(rawSkillPath) !== "SKILL.md") {
      return { ok: false, error: "skill_patch target must be a SKILL.md file" };
    }
    if (proposal.target.skillPathHash && proposal.target.skillPathHash !== hashText(path.resolve(rawSkillPath))) {
      return { ok: false, error: "skill_patch target path hash mismatch" };
    }
    if (!proposal.patch?.content) return { ok: false, error: "skill content missing" };
    const actualHash = hashText(proposal.patch.content);
    if (proposal.patch.contentHash && proposal.patch.contentHash !== actualHash) {
      return { ok: false, error: "skill content hash mismatch" };
    }
    if (!proposal.patch.content.includes("# Runtime Self-Learning")) {
      return { ok: false, error: "skill content does not look like a self-learning skill" };
    }
    return { ok: true };
  }
  if (proposal.type === "config_patch") {
    return proposal.patch?.config ? { ok: true } : { ok: false, error: "config patch missing" };
  }
  if (proposal.type === "code_patch") {
    return { ok: false, error: "code_patch proposals require manual implementation; automatic apply is disabled" };
  }
  if (proposal.type === "pattern_candidate") {
    return { ok: false, error: "pattern_candidate proposals are review-only; they are never auto-applied" };
  }
  if (proposal.type === "action_plan") {
    const actionType = proposal.plan?.actionType;
    if (!actionType) return { ok: false, error: "action_plan actionType missing" };
    if (!Array.isArray(proposal.plan?.steps) || proposal.plan.steps.length === 0) return { ok: false, error: "action_plan steps missing" };
    if (!proposal.verification && !proposal.plan?.verification) return { ok: false, error: "action_plan verification missing" };
    return { ok: true };
  }
  return { ok: false, error: `unsupported proposal type: ${proposal.type}` };
}

export function applyProposal(learnerDir, id, { configPath = null, requireReview = false } = {}) {
  const proposal = readProposal(learnerDir, id);
  if (!proposal) throw new Error(`proposal not found: ${id}`);
  if (proposal.status === "applied") return proposal;
  if (proposal.status === "rejected") throw new Error(`proposal rejected: ${id}`);
  const recovered = recoverApplyingProposal(learnerDir, proposal, { configPath });
  if (recovered.status === "applied") return recovered;
  if (recovered.status !== "pending") throw new Error(`proposal recovery left unsupported status: ${recovered.status}`);
  const review = readReview(learnerDir, reviewIdForProposal(proposal));
  if (review) {
    const binding = verifyProposalReviewBinding(proposal, review);
    if (!binding.ok) throw new Error(binding.error);
  }
  if (requireReview && (!review || !["approved", "applied"].includes(review.status))) {
    throw new Error(`review approval required before applying proposal: ${id}`);
  }
  if (proposal.type === "code_patch") throw new Error("code_patch proposals cannot be auto-applied");
  if (proposal.type === "pattern_candidate") throw new Error("pattern_candidate proposals are review-only and cannot be applied");
  if (proposal.type === "action_plan") throw new Error("action_plan proposals are executed by the runtime action executor, not applyProposal");
  const activeProposal = recovered;
  const verification = verifyProposal(activeProposal);
  if (!verification.ok) throw new Error(verification.error);
  const currentConfig = activeProposal.type === "config_patch" && configPath
    ? mergeConfig(readJson(configPath, {}))
    : DEFAULT_CONFIG;
  const gate = validateWithGate(activeProposal, { config: currentConfig });
  if (!gate.ok) throw new Error(`validation gate failed: ${gate.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ")}`);

  // Persist intent before crossing the first external-file boundary.
  const applying = { ...activeProposal, status: "applying", applicationStartedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  writeProposalRecord(learnerDir, applying);

  let backupPath = null;
  if (activeProposal.type === "skill_patch") {
    const skillPath = activeProposal.target.skillPath;
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    if (fs.existsSync(skillPath)) {
      backupPath = `${skillPath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      fs.copyFileSync(skillPath, backupPath);
    }
    atomicWriteFileSync(skillPath, activeProposal.patch.content, "utf-8");
    try { updateSkillState(learnerDir, skillPath, { status: "active", sourceProposalId: id, lastGeneratedAt: new Date().toISOString(), sourcePatternIds: activeProposal.triggerPatternIds || [], lastValidation: gate }); } catch {}
  } else if (activeProposal.type === "config_patch") {
    if (!configPath) throw new Error("configPath is required for config_patch");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const current = mergeConfig(readJson(configPath, {}));
    const nextConfig = mergeConfig(current, activeProposal.patch.config);
    if (fs.existsSync(configPath)) {
      backupPath = `${configPath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      fs.copyFileSync(configPath, backupPath);
    }
    writeJson(configPath, nextConfig);
  }

  const applied = appliedProposalRecord(applying, backupPath);
  writeProposalRecord(learnerDir, applied);
  try {
    markReviewForProposal(learnerDir, id, "applied", { validation: gate });
    appendEvent(learnerDir, { type: "proposal.applied", entityType: "proposal", entityId: id, summary: `Applied proposal: ${id}`, data: { backupPath } });
  } catch {}
  pruneProposals(learnerDir);
  return applied;
}

export function rejectProposal(learnerDir, id, reason = "") {
  const proposal = readProposal(learnerDir, id);
  if (!proposal) throw new Error(`proposal not found: ${id}`);
  if (proposal.status === "applied") throw new Error(`proposal already applied: ${id}`);
  if (proposal.status === "rejected") return proposal;
  const rejected = {
    ...proposal,
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rejectionReason: reason || "Rejected by control action",
  };
  writeProposalRecord(learnerDir, rejected);
  try {
    markReviewForProposal(learnerDir, id, "rejected", { rejectionReason: reason || "Rejected by control action" });
    appendEvent(learnerDir, { type: "proposal.rejected", entityType: "proposal", entityId: id, summary: `Rejected proposal: ${id}`, data: { reason } });
  } catch {}
  pruneProposals(learnerDir);
  return rejected;
}

// ── Diff preview (previously diff-preview.js, now split back out) ──
export { previewProposalDiff } from "./proposal-diff-preview.js";
