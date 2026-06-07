import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  applyProposal,
  buildCodePatchProposal,
  buildSkillPatchProposal,
  listProposals,
  verifyProposal,
} from "../lib/proposals.js";

const tmpDir = path.join(os.tmpdir(), "learner-proposals-test-" + Date.now());

describe("proposal engine", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates, verifies, and applies a skill patch proposal", () => {
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    const content = "# Runtime Self-Learning\n\nUpdated hints.\n";
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content, triggerPatternIds: ["pref:test"] });

    assert.equal(proposal.type, "skill_patch");
    assert.equal(proposal.status, "pending");
    assert.deepEqual(verifyProposal(proposal), { ok: true });

    const applied = applyProposal(tmpDir, proposal.id);
    assert.equal(applied.status, "applied");
    assert.equal(fs.readFileSync(skillPath, "utf-8"), content);
    assert.equal(listProposals(tmpDir, { status: "applied" }).length, 1);
  });

  it("rejects tampered skill patch content", () => {
    const skillPath = path.join(tmpDir, "SKILL.md");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n" });
    proposal.patch.content = "# Runtime Self-Learning\nchanged\n";
    const result = verifyProposal(proposal);
    assert.equal(result.ok, false);
    assert.match(result.error, /hash mismatch/);
  });

  it("creates high-risk code patch proposals but does not auto-apply them", () => {
    const proposal = buildCodePatchProposal({
      learnerDir: tmpDir,
      pattern: {
        id: "error:permission_denied",
        type: "error",
        count: 3,
        desc: "Repeated error: permission_denied",
        fix: "Check write permissions.",
      },
    });

    assert.equal(proposal.type, "code_patch");
    assert.equal(proposal.risk, "high");
    assert.equal(proposal.autoApply, false);
    assert.throws(() => applyProposal(tmpDir, proposal.id), /cannot be auto-applied/);
  });
});
