import fs from "fs";
import path from "path";

import { DEFAULT_CONFIG, writeJson } from "./common.js";
import { appendEvent } from "./event-log.js";
import { isWriteAllowed, safeReadFile, safeWriteFile } from "./filesystem-boundary.js";
import {
  applyProposal,
  proposalPath,
  readProposal,
  verifyProposal,
  verifyProposalReviewBinding,
} from "./proposals.js";
import { readReview, markReviewForProposal, reviewIdForProposal } from "./review-queue.js";
import { updateSkillState } from "./skill-lifecycle.js";
import { validateProposal as validateWithGate } from "./validation-gate.js";

function normalizeRoots(roots = []) {
  return roots.filter(Boolean).map((root) => path.resolve(root));
}

function isSelfLearningSkillPath(skillPath) {
  const parts = String(skillPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length >= 3
    && parts.at(-3) === "skills"
    && parts.at(-2) === "self-learning"
    && parts.at(-1) === "SKILL.md";
}

function resolveTrustedSkillRoot(skillPath, roots = []) {
  const full = path.resolve(skillPath);
  const policy = { filesystem: { deny: [] } };
  for (const root of normalizeRoots(roots)) {
    const check = isWriteAllowed(full, root, policy);
    if (check.allowed) return root;
  }
  return null;
}

function assertSkillPatchWriteAllowed(learnerDir, skillPath, allowedSkillRoots = []) {
  if (!isSelfLearningSkillPath(skillPath)) {
    throw new Error("skill_patch target must be skills/self-learning/SKILL.md");
  }
  const root = resolveTrustedSkillRoot(skillPath, [learnerDir, ...allowedSkillRoots]);
  if (!root) throw new Error("skill_patch target outside trusted skill roots");
  return { root, full: path.resolve(skillPath) };
}

export function applyProposalSafely(learnerDir, id, { configPath = null, requireReview = false, allowedSkillRoots = [] } = {}) {
  const proposal = readProposal(learnerDir, id);
  if (!proposal || proposal.type !== "skill_patch") {
    return applyProposal(learnerDir, id, { configPath, requireReview });
  }
  if (proposal.status === "rejected") throw new Error(`proposal rejected: ${id}`);

  const review = readReview(learnerDir, reviewIdForProposal(proposal));
  if (review) {
    const binding = verifyProposalReviewBinding(proposal, review);
    if (!binding.ok) throw new Error(binding.error);
  }
  if (requireReview && (!review || !["approved", "applied"].includes(review.status))) {
    throw new Error(`review approval required before applying proposal: ${id}`);
  }

  const verification = verifyProposal(proposal);
  if (!verification.ok) throw new Error(verification.error);
  const gate = validateWithGate(proposal, { config: DEFAULT_CONFIG });
  if (!gate.ok) throw new Error(`validation gate failed: ${gate.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ")}`);

  const skillPath = proposal.target.skillPath;
  const allowed = assertSkillPatchWriteAllowed(learnerDir, skillPath, allowedSkillRoots);
  fs.mkdirSync(path.dirname(allowed.full), { recursive: true });

  let backupPath = null;
  if (fs.existsSync(allowed.full)) {
    const backupRead = safeReadFile(allowed.full, allowed.root, { filesystem: { deny: [] } });
    if (!backupRead.ok) throw new Error(`${backupRead.error}: ${skillPath}`);
    backupPath = `${allowed.full}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    const backupWrite = safeWriteFile(backupPath, backupRead.content, allowed.root, { filesystem: { deny: [] } });
    if (!backupWrite.ok) throw new Error(`${backupWrite.error}: ${backupPath}`);
  }

  const write = safeWriteFile(allowed.full, proposal.patch.content, allowed.root, { filesystem: { deny: [] } });
  if (!write.ok) throw new Error(`${write.error}: ${skillPath}`);

  try {
    updateSkillState(learnerDir, allowed.full, {
      status: "active",
      sourceProposalId: id,
      lastGeneratedAt: new Date().toISOString(),
      sourcePatternIds: proposal.triggerPatternIds || [],
      lastValidation: gate,
    });
  } catch {}

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
    appendEvent(learnerDir, {
      type: "proposal.applied",
      entityType: "proposal",
      entityId: id,
      summary: `Applied proposal: ${id}`,
      data: { backupPath },
    });
  } catch {}
  return applied;
}
