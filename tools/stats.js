import fs from "fs";
import { readJson, countJsonl, decoratePatterns, describeOfficialUtilityModel, readRecentJsonl, summarizeSessionRows, inspectSessionIdentityCoverage } from "../lib/common.js";
import { modelAdviceFile } from "../lib/model-advisor.js";
import { listProposals } from "../lib/proposals.js";
import { toolPaths, loadConfig, loadPatterns } from "./_shared.js";

export const name = "self_learning_stats";

export const description = "View runtime self-learning statistics: turns, patterns, injectable hints, review states, and current config.";

export const sessionPermission = { readOnly: true };

export const parameters = {
  type: "object",
  properties: {},
};

export async function execute(input, ctx) {
  const p = toolPaths(ctx);
  const config = loadConfig(p.configPath);
  const officialUtilityModel = describeOfficialUtilityModel();
  config.officialUtilityModelDisplay = officialUtilityModel.display;
  const patterns = loadPatterns(p.patternsPath);
  const decorated = decoratePatterns(patterns, config);
  const proposals = listProposals(p.learnerDir, { limit: 50 });
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentExperiences = readRecentJsonl(p.experiencePath, recentCutoff);
  const recentErrors = readRecentJsonl(p.errorPath, recentCutoff);
  const recentSessions = summarizeSessionRows(recentExperiences);
  const recentErrorSessions = summarizeSessionRows(recentErrors);
  const sessionIdentityCoverage = {
    experience_log: inspectSessionIdentityCoverage(p.experiencePath),
    error_log: inspectSessionIdentityCoverage(p.errorPath),
    turns: inspectSessionIdentityCoverage(p.turnsPath),
    activity_log: inspectSessionIdentityCoverage(p.activityPath),
  };
  for (const item of Object.values(sessionIdentityCoverage)) {
    item.coveragePct = Math.round((item.coverageRatio || 0) * 100);
  }

  const byStatus = { pending: 0, approved: 0, rejected: 0 };
  const byKnowledgeTier = {};
  let injectableCount = 0;
  for (const pattern of decorated) {
    byStatus[pattern.status] = (byStatus[pattern.status] || 0) + 1;
    byKnowledgeTier[pattern.knowledgeTier] = (byKnowledgeTier[pattern.knowledgeTier] || 0) + 1;
    if (pattern.injectable) injectableCount += 1;
  }

  const proposalCounts = { pending: 0, applied: 0, rejected: 0 };
  const pendingItems = [];
  for (const proposal of proposals) {
    if (proposalCounts[proposal.status] !== undefined) proposalCounts[proposal.status] += 1;
    if (proposal.status === "pending" && pendingItems.length < 10) {
      pendingItems.push({
        id: proposal.id,
        type: proposal.type,
        risk: proposal.risk,
        title: proposal.title,
        autoApply: proposal.autoApply,
        updatedAt: proposal.updatedAt,
      });
    }
  }

  let historySnapshots = 0;
  try {
    historySnapshots = fs.readdirSync(p.historyDir).filter((n) => n.endsWith("-SKILL.md")).length;
  } catch {}

  const result = {
    totalTurns: countJsonl(p.experiencePath),
    compactTurns: countJsonl(p.turnsPath),
    errors: countJsonl(p.errorPath),
    recentSessions: {
      observed: recentSessions.length,
      withErrors: recentErrorSessions.length,
      top: recentSessions.slice(0, 8),
    },
    sessionIdentityCoverage,
    patternCount: decorated.length,
    injectableCount,
    byStatus,
    byKnowledgeTier,
    historySnapshots,
    usage: readJson(p.usageSummaryPath, null),
    hostCapabilities: readJson(p.capabilitiesPath, null),
    officialUtilityModel,
    officialMemoryBridge: {
      enabled: config.officialMemoryBridgeEnabled !== false,
      maxResults: config.officialMemoryBridgeMaxResults,
      mode: "read-only-file-bridge",
    },
    proposals: {
      pending: proposalCounts.pending,
      applied: proposalCounts.applied,
      rejected: proposalCounts.rejected,
      pendingItems,
    },
    modelAdvice: readJson(modelAdviceFile(p.learnerDir), null),
    config,
    topPatterns: decorated.slice(0, 5).map((pattern) => ({
      id: pattern.id,
      type: pattern.type,
      status: pattern.status,
      count: pattern.count,
      decayedScore: pattern.decayedScore,
      knowledgeTier: pattern.knowledgeTier,
      injectable: pattern.injectable,
      desc: pattern.desc,
    })),
    dataDir: p.learnerDir,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}
