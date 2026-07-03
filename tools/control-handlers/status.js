// Status read-model control handler (S2.P2a split — subsystem-simplify-v5.1.6).
//
// Extracted verbatim from tools/control.js. This is a pure read handler: it
// takes (input, p, config, patterns, ctx), reads from p.learnerDir and the
// runtime snapshot, and returns a JSON string. It owns NO permission/side-effect
// decisions — control.js keeps the action dispatch, the *_ACTIONS classification
// sets, describeControlSideEffect and sessionPermission. This module only
// implements the handler body and is spread back into the control HANDLERS
// table under the same action name.

import fs from "fs";
import { loadRuntimeSnapshot } from "../runtime-snapshot.js";
import { countByStatus, summarizeDecoratedPatterns, countWaitingAgentTasks } from "../control-summaries.js";
import { listAgentTaskStates } from "../../lib/agent-task-store.js";
import { loadActiveSkills, loadSkillCandidates } from "../../lib/skill-promotion-loop.js";
import { countTransferCandidatesByStatus } from "./transfer.js";

const SENSITIVE_CONFIG_KEYS = new Set(["modelAdvisorApiKey", "semanticEmbeddingApiKey"]);

function redactConfig(config = {}) {
  const safeConfig = { ...config };
  for (const key of Object.keys(safeConfig)) {
    if (SENSITIVE_CONFIG_KEYS.has(key) && safeConfig[key]) safeConfig[key] = "***";
  }
  return safeConfig;
}

export const statusHandlers = {
  status(input, p, config, patterns, ctx) {
    const snapshot = loadRuntimeSnapshot(ctx, {
      includeDecorated: true,
      includeProposals: true,
      includeReviews: true,
      proposalLimit: 0,
      reviewLimit: 0,
    });
    const statusConfig = snapshot.config;
    const patternSummary = summarizeDecoratedPatterns(snapshot.decoratedPatterns);
    let history = [];
    try { history = fs.readdirSync(p.historyDir).filter((n) => n.endsWith("-SKILL.md")).sort(); } catch {}
    const proposalCounts = countByStatus(snapshot.proposals);
    const reviewCounts = countByStatus(snapshot.reviews);
    const agentTasks = listAgentTaskStates(p.learnerDir, { limit: 1000 });
    const transferCounts = countTransferCandidatesByStatus(p.learnerDir, { limit: 1000 });
    return JSON.stringify({
      config: redactConfig(statusConfig),
      patterns: patternSummary.total,
      injectable: patternSummary.injectable,
      pending: patternSummary.pending,
      approved: patternSummary.approved,
      rejected: patternSummary.rejected,
      historySnapshots: history.length,
      proposals: { pending: proposalCounts.pending || 0, applied: proposalCounts.applied || 0, rejected: proposalCounts.rejected || 0, dir: p.proposalsDir },
      reviews: { queued: reviewCounts.queued || 0, blocked: reviewCounts.blocked || 0, approved: reviewCounts.approved || 0 },
      agentTasks: { total: agentTasks.length, waiting: countWaitingAgentTasks(agentTasks) },
      transferCandidates: {
        total: Object.values(transferCounts).reduce((s, n) => s + n, 0),
        pending: transferCounts.transferred_candidate || 0, validated: transferCounts.validated || 0, failed: transferCounts.validation_failed || 0,
      },
      skillPromotion: { candidates: loadSkillCandidates(p.learnerDir).candidates.length, active: loadActiveSkills(p.learnerDir).skills.length },
      dataDir: p.learnerDir,
    }, null, 2);
  },
};
