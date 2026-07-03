import fs from "fs";
import path from "path";
import { buildSkillMdFromPatterns } from "./common.js";
import { buildSkillPatchProposal } from "./proposals.js";
import { applyProposalSafely } from "./proposal-apply-safe.js";
import { recordMemoryInjected } from "./feedback-signals.js";
import { buildRepeatedCodePatchProposals } from "./advisor-insights.js";
import { normalizeSessionTarget } from "./helpers.js";
import { snapshotSkill, pruneSkillBackups, skipObservedLine, skillRenderFingerprint } from "./skill-lifecycle.js";
import { isProposalReviewApproved } from "./review-queue.js";
import { createSessionMessenger } from "./session-messenger.js";

function fileStatKey(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

export function createSkillRefresh(ctx, rt, options = {}) {
  const {
    runtimeState,
    minRefreshMs = 10_000,
    maxSkillHistory = 20,
    codeProposalMinCount = 3,
  } = options;
  const messenger = createSessionMessenger(ctx, {
    proposalNotifiedIds: runtimeState.proposalNotifiedIds,
    statusNotifiedAt: runtimeState.statusNotifiedAt,
  });
  rt.resolveSessionTarget = (sessionHandle) => runtimeState.sessionTargets.get(sessionHandle) || sessionHandle;
  rt.notifyProposalReview = (sessionHandle, proposals = [], notifyOptions = {}) => (
    messenger.notifyProposalReview(rt.resolveSessionTarget(sessionHandle), proposals, rt.config, { ...notifyOptions, sessionKey: sessionHandle })
  );
  rt.notifyWorkStatus = (sessionHandle, detail = "") => (
    messenger.notifyWorkStatus(rt.resolveSessionTarget(sessionHandle), rt.config, detail, { sessionKey: sessionHandle })
  );

  let lastSkillRefresh = 0;
  let lastSkillRenderFingerprint = null;
  let lastSkillRenderStatKey = null;
  rt.refreshSkill = (force = false, sessionHandle = null, cachedAll = null) => {
    const now = Date.now();
    if (!force && now - lastSkillRefresh < minRefreshMs) return;
    const allPatterns = cachedAll || rt.detector.all();
    const skillDir = path.join(ctx.pluginDir, "skills", "self-learning");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    const renderOptions = {
      turnCount: rt.detector.turnCount,
      dataDir: rt.paths.DATA_DIR,
    };
    const currentFingerprint = skillRenderFingerprint(allPatterns, rt.config, renderOptions);
    const currentStatKey = fileStatKey(skillPath);
    const shouldRenderSkill = currentFingerprint !== lastSkillRenderFingerprint || currentStatKey !== lastSkillRenderStatKey;
    if (shouldRenderSkill) {
      const content = buildSkillMdFromPatterns(allPatterns, rt.config, renderOptions);
      let current = null;
      try { current = fs.readFileSync(skillPath, "utf-8"); } catch {}
      if (skipObservedLine(current) !== skipObservedLine(content)) {
        snapshotSkill(skillPath, rt.paths.HISTORY_DIR, { keep: maxSkillHistory });
        const triggerPatternIds = allPatterns.filter(p => p.injectable).slice(0, 8).map(p => p.id);
        const proposal = buildSkillPatchProposal({
          learnerDir: rt.paths.DATA_DIR,
          skillPath,
          content,
          triggerPatternIds,
        });
        if (proposal.autoApply && proposal.status !== "applied") {
          if (rt.config.requireReviewForAutoApply && !isProposalReviewApproved(rt.paths.DATA_DIR, proposal.id)) {
            ctx.log.info(`runtime-learner: queued ${proposal.id} for review before auto-apply (strict review mode)`);
          } else {
            const applied = applyProposalSafely(rt.paths.DATA_DIR, proposal.id, {
              configPath: rt.paths.CONFIG_FILE,
              requireReview: !!rt.config.requireReviewForAutoApply,
              allowedSkillRoots: [ctx.pluginDir],
            });
            pruneSkillBackups(skillDir, { keep: maxSkillHistory });
            if (rt.config.feedbackSignalsEnabled && applied?.status === "applied" && applied?.result?.ok) {
              recordMemoryInjected(rt.paths.DATA_DIR, { patternIds: triggerPatternIds, skillRef: "skills/self-learning/SKILL.md" });
            }
          }
        }
      }
      lastSkillRenderFingerprint = currentFingerprint;
      lastSkillRenderStatKey = fileStatKey(skillPath);
    }
    const { proposals, created } = buildRepeatedCodePatchProposals({
      learnerDir: rt.paths.DATA_DIR, patterns: allPatterns, minCount: codeProposalMinCount,
    });
    if (proposals.length > 0) {
      if (created > 0) {
        const sessionTarget = normalizeSessionTarget(rt.resolveSessionTarget(sessionHandle));
        rt.logActivity({
          type: "proposal_created",
          summary: `Created ${created} high-risk code improvement proposal(s) for review`,
          sessionId: sessionTarget.sessionId,
          sessionRef: sessionTarget.sessionRef,
          sessionPath: sessionTarget.sessionPath,
        });
      }
      void rt.notifyProposalReview(sessionHandle, proposals);
    }
    lastSkillRefresh = now;
  };
}
