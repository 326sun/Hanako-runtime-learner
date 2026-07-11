import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { applyProposalSafely } from "../lib/proposal-apply-safe.js";
import { buildSkillPatchProposal, proposalPath, readProposal } from "../lib/proposals.js";
import { readReview, reviewIdForProposal, updateReviewStatus } from "../lib/review-queue.js";

const tmpDir = path.join(os.tmpdir(), `learner-proposal-safe-apply-${Date.now()}`);

describe("safe proposal apply", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("applies skill_patch only under a trusted plugin skill root", () => {
    const learnerDir = path.join(tmpDir, "data");
    const pluginDir = path.join(tmpDir, "plugin");
    const skillPath = path.join(pluginDir, "skills", "self-learning", "SKILL.md");
    const content = "# Runtime Self-Learning\n\nSafe root.\n";
    const proposal = buildSkillPatchProposal({ learnerDir, skillPath, content });

    const applied = applyProposalSafely(learnerDir, proposal.id, { allowedSkillRoots: [pluginDir] });

    assert.equal(applied.status, "applied");
    assert.equal(fs.readFileSync(skillPath, "utf-8"), content);
  });

  it("rejects skill_patch targets outside trusted skill roots", () => {
    const learnerDir = path.join(tmpDir, "data");
    const outsideRoot = path.join(tmpDir, "outside-plugin");
    const skillPath = path.join(outsideRoot, "skills", "self-learning", "SKILL.md");
    const proposal = buildSkillPatchProposal({
      learnerDir,
      skillPath,
      content: "# Runtime Self-Learning\n\nOutside root.\n",
    });

    assert.throws(
      () => applyProposalSafely(learnerDir, proposal.id, { allowedSkillRoots: [path.join(tmpDir, "plugin")] }),
      /outside trusted skill roots/
    );
    assert.equal(fs.existsSync(skillPath), false);
  });

  it("recovers a reviewed safe apply interrupted after the target replacement", () => {
    const learnerDir = path.join(tmpDir, "data");
    const pluginDir = path.join(tmpDir, "plugin");
    const skillPath = path.join(pluginDir, "skills", "self-learning", "SKILL.md");
    const content = "# Runtime Self-Learning\n\nRecovered safe apply.\n";
    const proposal = buildSkillPatchProposal({ learnerDir, skillPath, content });
    updateReviewStatus(learnerDir, reviewIdForProposal(proposal), "approved");

    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, content, "utf8");
    fs.writeFileSync(proposalPath(learnerDir, proposal.id), JSON.stringify({
      ...proposal,
      status: "applying",
      applicationStartedAt: new Date().toISOString(),
      result: { ok: false, backupPath: null },
    }, null, 2), "utf8");

    const recovered = applyProposalSafely(learnerDir, proposal.id, {
      requireReview: true,
      allowedSkillRoots: [pluginDir],
    });
    assert.equal(recovered.status, "applied");
    assert.equal(readProposal(learnerDir, proposal.id).status, "applied");
    assert.equal(readReview(learnerDir, reviewIdForProposal(proposal)).status, "applied");
    assert.deepEqual(fs.readdirSync(path.dirname(skillPath)).filter((name) => name.endsWith(".bak")), []);
  });
});
