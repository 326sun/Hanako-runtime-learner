import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DEFAULT_CONFIG, readJson, safeFileSlug, writeJson, mergeConfig } from "./common.js";
import { enqueueReviewForProposal, markReviewForProposal, readReview, reviewIdForProposal } from "./review-queue.js";
import { validateProposal as validateWithGate } from "./validation-gate.js";
import { appendEvent } from "./event-log.js";
import { updateSkillState } from "./skill-lifecycle.js";

// ── Proposal fingerprinting (was proposal-fingerprint.js) ──────────────────

const AUDIT_FIELDS = new Set(["schemaVersion","status","createdAt","updatedAt","appliedAt","rejectedAt","reviewedAt","result","rejectionReason"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (AUDIT_FIELDS.has(key)) continue;
    const next = stableValue(value[key]);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export function proposalContentHash(proposal = {}) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(proposal || {}))).digest("hex");
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

function safeName(value) {
  return safeFileSlug(value, "proposal", 160);
}

export function proposalsDir(learnerDir) {
  return path.join(learnerDir, "proposals");
}

export function proposalPath(learnerDir, id) {
  return path.join(proposalsDir(learnerDir), `${safeName(id)}.json`);
}

export function readProposal(learnerDir, id) {
  return readJson(proposalPath(learnerDir, id), null);
}

// Terminal proposals (applied/rejected) are kept only for audit/history and are
// never re-acted on, yet new ones accrue continuously — every distinct skill
// refresh produces a fresh content-hashed `applied` skill_patch file. Cap them
// so the proposals/ dir doesn't grow without bound. Pending proposals are
// actionable and always retained.
const MAX_RESOLVED_PROPOSALS = 40;

function pruneProposals(learnerDir, { keepResolved = MAX_RESOLVED_PROPOSALS } = {}) {
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
  writeJson(proposalPath(learnerDir, next.id), next);
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

export function isActionableCodePatchPattern(pattern) {
  if (!pattern || pattern.type !== "error") return false;
  const id = String(pattern.id || "");
  // `error:unknown` is a diagnostic bucket, not an actionable code target. It
  // lacks a stable failure mode, stack trace, or affected module, so converting
  // it into a high-risk code_patch creates noise instead of a fix plan.
  if (id === "error:unknown") return false;
  return true;
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
  if (proposal.status === "rejected") throw new Error(`proposal rejected: ${id}`);
  const review = readReview(learnerDir, reviewIdForProposal(proposal));
  if (review) {
    const binding = verifyProposalReviewBinding(proposal, review);
    if (!binding.ok) throw new Error(binding.error);
  }
  if (requireReview && (!review || !["approved", "applied"].includes(review.status))) {
    throw new Error(`review approval required before applying proposal: ${id}`);
  }
  if (proposal.type === "code_patch") throw new Error("code_patch proposals cannot be auto-applied");
  if (proposal.type === "action_plan") throw new Error("action_plan proposals are executed by the runtime action executor, not applyProposal");
  const verification = verifyProposal(proposal);
  if (!verification.ok) throw new Error(verification.error);
  const currentConfig = proposal.type === "config_patch" && configPath
    ? mergeConfig(readJson(configPath, {}))
    : DEFAULT_CONFIG;
  const gate = validateWithGate(proposal, { config: currentConfig });
  if (!gate.ok) throw new Error(`validation gate failed: ${gate.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ")}`);

  let backupPath = null;
  if (proposal.type === "skill_patch") {
    const skillPath = proposal.target.skillPath;
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    if (fs.existsSync(skillPath)) {
      backupPath = `${skillPath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      fs.copyFileSync(skillPath, backupPath);
    }
    fs.writeFileSync(skillPath, proposal.patch.content, "utf-8");
    try { updateSkillState(learnerDir, skillPath, { status: "active", sourceProposalId: id, lastGeneratedAt: new Date().toISOString(), sourcePatternIds: proposal.triggerPatternIds || [], lastValidation: gate }); } catch {}
  } else if (proposal.type === "config_patch") {
    if (!configPath) throw new Error("configPath is required for config_patch");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const current = mergeConfig(readJson(configPath, {}));
    const nextConfig = mergeConfig(current, proposal.patch.config);
    if (fs.existsSync(configPath)) {
      backupPath = `${configPath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      fs.copyFileSync(configPath, backupPath);
    }
    writeJson(configPath, nextConfig);
  }

  const applied = {
    ...proposal,
    status: "applied",
    appliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: { ok: true, backupPath },
  };
  writeJson(proposalPath(learnerDir, id), applied);
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
  const rejected = {
    ...proposal,
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rejectionReason: reason || "Rejected by control action",
  };
  writeJson(proposalPath(learnerDir, id), rejected);
  try {
    markReviewForProposal(learnerDir, id, "rejected", { rejectionReason: reason || "Rejected by control action" });
    appendEvent(learnerDir, { type: "proposal.rejected", entityType: "proposal", entityId: id, summary: `Rejected proposal: ${id}`, data: { reason } });
  } catch {}
  pruneProposals(learnerDir);
  return rejected;
}

// ── Diff preview (previously diff-preview.js, merged here) ──

function _lines(text) {
  return String(text || "").replace(/\r\n/g, "\n").split("\n");
}

function _trimDiff(diff, maxLines = 240) {
  if (diff.length <= maxLines) return diff;
  return [...diff.slice(0, maxLines), `... diff truncated (${diff.length - maxLines} more line(s))`];
}

function lineDiff(before = "", after = "", { context = 2, maxLines = 240 } = {}) {
  if (before === after) return [];
  const a = _lines(before);
  const b = _lines(after);
  const prefix = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }

  const from = Math.max(0, start - context);
  const toA = Math.min(a.length - 1, endA + context);
  const toB = Math.min(b.length - 1, endB + context);
  if (from > 0) prefix.push(`... ${from} unchanged line(s) before`);
  for (let i = from; i <= toA; i++) {
    if (i < start || i > endA) prefix.push(`  ${a[i] ?? ""}`);
    else prefix.push(`- ${a[i] ?? ""}`);
  }
  for (let i = start; i <= endB; i++) prefix.push(`+ ${b[i] ?? ""}`);
  const tail = Math.max(a.length - 1 - toA, b.length - 1 - toB);
  if (tail > 0) prefix.push(`... ${tail} unchanged line(s) after`);
  return _trimDiff(prefix, maxLines);
}

function _countChanges(diff) {
  let added = 0, removed = 0;
  for (const line of diff) {
    if (line.startsWith("+ ")) added++;
    else if (line.startsWith("- ")) removed++;
  }
  return { addedLines: added, removedLines: removed };
}

export function previewProposalDiff(proposal, { configPath = null } = {}) {
  if (!proposal) return { ok: false, error: "proposal missing" };
  if (proposal.type === "skill_patch") {
    const target = proposal.target?.skillPath || "SKILL.md";
    let before = "";
    try { before = fs.readFileSync(target, "utf-8"); } catch {}
    const after = proposal.patch?.content || "";
    const diff = lineDiff(before, after);
    return { ok: true, proposalId: proposal.id, type: proposal.type, target, diff, ..._countChanges(diff) };
  }
  if (proposal.type === "config_patch") {
    const target = configPath || proposal.target?.configPath || "config.json";
    let before = "";
    try { before = fs.readFileSync(target, "utf-8"); } catch {}
    const current = configPath || proposal.target?.configPath
      ? mergeConfig(readJson(target, {}))
      : {};
    const after = JSON.stringify(mergeConfig(current, proposal.patch?.config || {}), null, 2);
    const diff = lineDiff(before, after);
    return { ok: true, proposalId: proposal.id, type: proposal.type, target, diff, ..._countChanges(diff) };
  }
  if (proposal.type === "code_patch") {
    const plan = proposal.patch?.suggestedPlan || [];
    return {
      ok: true,
      proposalId: proposal.id,
      type: proposal.type,
      target: proposal.target || { plugin: "hanako-runtime-learner" },
      diff: plan.map((step) => `? ${step}`),
      addedLines: 0,
      removedLines: 0,
      note: "code_patch is a plan preview only; the plugin will not auto-edit code.",
    };
  }
  if (proposal.type === "action_plan") {
    const steps = proposal.plan?.steps || [];
    return {
      ok: true,
      proposalId: proposal.id,
      type: proposal.type,
      target: proposal.plan?.actionType || "runtime_action",
      diff: steps.map((step) => `? ${step}`),
      addedLines: 0,
      removedLines: 0,
      note: "action_plan is a runtime strategy preview; execution is controlled by the action policy gate.",
    };
  }
  return { ok: false, proposalId: proposal.id, error: `unsupported proposal type: ${proposal.type}` };
}
