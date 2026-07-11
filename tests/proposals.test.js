import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  applyProposal,
  buildCodePatchProposal,
  buildSkillPatchProposal,
  isActionableCodePatchPattern,
  listProposals,
  proposalPath,
  proposalContentHash,
  readProposal,
  rejectProposal,
  verifyProposal,
  writeProposal,
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

  it("treats an already-applied proposal as idempotent", () => {
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n\nonce\n" });
    const first = applyProposal(tmpDir, proposal.id);
    const second = applyProposal(tmpDir, proposal.id);

    assert.deepEqual(second, first);
    assert.deepEqual(fs.readdirSync(path.dirname(skillPath)).filter((name) => name.endsWith(".bak")), []);
  });

  it("does not allow an applied proposal to become rejected", () => {
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n\nterminal\n" });
    applyProposal(tmpDir, proposal.id);
    assert.throws(() => rejectProposal(tmpDir, proposal.id, "late rejection"), /already applied/);
  });

  it("recovers an interrupted applying skill proposal by converging its target and governance record", () => {
    const skillPath = path.join(tmpDir, "recover", "SKILL.md");
    const content = "# Runtime Self-Learning\n\nRecovered content.\n";
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content });
    // Model a crash after the target's atomic replacement but before proposal
    // metadata can be finalized. The next apply call must not write a second
    // time or reopen the already-realized side effect.
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, content, "utf-8");
    fs.writeFileSync(proposalPath(tmpDir, proposal.id), JSON.stringify({ ...proposal, status: "applying" }, null, 2), "utf-8");

    const recovered = applyProposal(tmpDir, proposal.id);
    assert.equal(recovered.status, "applied");
    assert.equal(fs.readFileSync(skillPath, "utf-8"), content);
  });

  it("keeps proposal ids distinct even when their readable slugs collide", () => {
    writeProposal(tmpDir, { id: "a:b", type: "code_patch", title: "colon" });
    writeProposal(tmpDir, { id: "a/b", type: "code_patch", title: "slash" });
    assert.equal(listProposals(tmpDir).length, 2);
    assert.equal(readProposal(tmpDir, "a:b").title, "colon");
    assert.equal(readProposal(tmpDir, "a/b").title, "slash");
  });

  it("binds nested status and result fields into the reviewed content hash", () => {
    const proposal = {
      id: "action:nested",
      type: "action_plan",
      status: "pending",
      plan: { steps: [{ action: "verify", status: "pending", result: { ok: false } }] },
    };
    const changed = structuredClone(proposal);
    changed.plan.steps[0].status = "completed";
    changed.plan.steps[0].result.ok = true;
    assert.notEqual(proposalContentHash(changed), proposalContentHash(proposal));
  });

  it("does not bind top-level crash-recovery metadata into reviewed content", () => {
    const proposal = { id: "skill:recovery", type: "skill_patch", patch: { content: "same" } };
    const applying = {
      ...proposal,
      status: "applying",
      applicationStartedAt: new Date().toISOString(),
      recovery: { action: "reopened", at: new Date().toISOString() },
    };
    assert.equal(proposalContentHash(applying), proposalContentHash(proposal));
  });

  it("rejects skill patches whose target is not a SKILL.md file", () => {
    const skillPath = path.join(tmpDir, "SKILL.md");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n" });
    proposal.target.skillPath = path.join(tmpDir, "not-a-skill.txt");
    const result = verifyProposal(proposal);
    assert.equal(result.ok, false);
    assert.match(result.error, /must be a SKILL\.md file/);
  });

  it("rejects tampered skill patch content", () => {
    const skillPath = path.join(tmpDir, "SKILL.md");
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content: "# Runtime Self-Learning\n" });
    proposal.patch.content = "# Runtime Self-Learning\nchanged\n";
    const result = verifyProposal(proposal);
    assert.equal(result.ok, false);
    assert.match(result.error, /hash mismatch/);
  });

  it("rejects tampered skill patch target paths", () => {
    const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
    const content = "# Runtime Self-Learning\n";
    const proposal = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content });
    const tampered = { ...proposal, target: { ...proposal.target, skillPath: path.join(tmpDir, ".ssh", "SKILL.md") } };
    fs.writeFileSync(proposalPath(tmpDir, proposal.id), JSON.stringify(tampered, null, 2), "utf-8");
    assert.throws(() => applyProposal(tmpDir, proposal.id), /proposal content changed after review|target path hash mismatch/);
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

  it("only treats specific error patterns as actionable code patches", () => {
    assert.equal(isActionableCodePatchPattern({ id: "error:unknown", type: "error", count: 3 }), false);
    assert.equal(isActionableCodePatchPattern({ id: "error:file_not_found", type: "error", count: 3 }), true);
    assert.equal(isActionableCodePatchPattern({ id: "usage:failed_request:openai_chat", type: "usage", count: 3 }), false);
    assert.equal(isActionableCodePatchPattern({ id: "usage:large_context:pixel_api_gpt-5.5", type: "usage", count: 3 }), false);
  });

  it("keeps a rejected stable proposal terminal after its proposal file is pruned", () => {
    const pattern = {
      id: "error:permission_denied",
      type: "error",
      count: 3,
      desc: "Repeated error: permission_denied",
      fix: "Check write permissions.",
    };
    const rejected = buildCodePatchProposal({ learnerDir: tmpDir, pattern });
    rejectProposal(tmpDir, rejected.id, "duplicate");

    // Simulate resolved-proposal retention pruning. Review records are the
    // durable tombstones and must prevent the same stable id from reopening.
    fs.rmSync(proposalPath(tmpDir, rejected.id));
    const regenerated = buildCodePatchProposal({ learnerDir: tmpDir, pattern });

    assert.equal(regenerated.status, "rejected");
    assert.equal(regenerated.rejectionReason, "duplicate");
    assert.equal(fs.existsSync(proposalPath(tmpDir, rejected.id)), false);
    assert.equal(listProposals(tmpDir, { status: "pending" }).length, 0);
  });

  it("caps resolved proposals but always keeps pending ones", () => {
    // Create + apply 45 distinct skill_patch proposals (terminal "applied").
    for (let i = 0; i < 45; i++) {
      const skillPath = path.join(tmpDir, "plugin", "skills", "self-learning", "SKILL.md");
      const content = `# Runtime Self-Learning\n\nhint ${i}\n`;
      const p = buildSkillPatchProposal({ learnerDir: tmpDir, skillPath, content });
      applyProposal(tmpDir, p.id);
    }
    // And a couple of pending code_patch proposals (actionable, must survive).
    const pendingIds = [];
    for (let i = 0; i < 3; i++) {
      const p = buildCodePatchProposal({
        learnerDir: tmpDir,
        pattern: { id: `error:type_${i}`, type: "error", count: 3, desc: `err ${i}`, fix: `fix ${i}` },
      });
      pendingIds.push(p.id);
    }

    const applied = listProposals(tmpDir, { status: "applied" });
    assert.ok(applied.length <= 40, `applied capped at 40, got ${applied.length}`);

    const pending = listProposals(tmpDir, { status: "pending" });
    assert.equal(pending.length, 3, "all pending proposals retained");
    for (const id of pendingIds) {
      assert.ok(pending.some((p) => p.id === id), `pending ${id} kept`);
    }
  });
});
