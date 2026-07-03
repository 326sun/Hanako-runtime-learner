import fs from "fs";
import { readJson, describeOfficialUtilityModel } from "../lib/common.js";
import { embeddingCachePath, inspectEmbeddingCache, resolveSemanticConfig } from "../lib/embeddings.js";
import { officialMemoryBridgeStats } from "../lib/official-memory-bridge.js";
import { modelAdviceFile } from "../lib/model-advisor.js";
import { loadRuntimeSnapshot } from "./runtime-snapshot.js";

export const name = "self_learning_stats";

export const description = "View runtime self-learning statistics: turns, patterns, injectable hints, review states, and current config.";

export const sessionPermission = { readOnly: true };

export const parameters = {
  type: "object",
  properties: {},
};

export async function execute(input, ctx) {
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const snapshot = loadRuntimeSnapshot(ctx, {
    includeDecorated: true,
    includeProposals: true,
    includeLogs: true,
    logCutoff: recentCutoff,
    proposalLimit: 50,
  });
  const p = snapshot.paths;
  const config = snapshot.config;
  const officialUtilityModel = describeOfficialUtilityModel();
  config.officialUtilityModelDisplay = officialUtilityModel.display;
  const decorated = snapshot.decoratedPatterns;
  const proposals = snapshot.proposals;
  const experienceSample = snapshot.logs.experience;
  const errorSample = snapshot.logs.error;
  const recentExperiences = experienceSample.rows;
  const recentErrors = errorSample.rows;
  const recentSessions = experienceSample.sessions;
  const recentErrorSessions = errorSample.sessions;
  const sessionIdentityCoverage = {
    experience_log: experienceSample.coverage,
    error_log: errorSample.coverage,
    turns: snapshot.logs.turns.coverage,
    activity_log: snapshot.logs.activity.coverage,
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
    totalTurns: snapshot.logs.experience.count,
    compactTurns: snapshot.logs.turns.count,
    errors: snapshot.logs.error.count,
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
      stats: officialMemoryBridgeStats(),
    },
    semanticEmbeddingCache: {
      enabled: !!config.semanticSearchEnabled,
      configured: resolveSemanticConfig(config).ok,
      ...inspectEmbeddingCache(embeddingCachePath(p.learnerDir), { maxEntries: config.semanticCacheMaxEntries }),
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
