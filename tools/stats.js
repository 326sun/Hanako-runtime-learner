import fs from "fs";
import { readJson, countJsonl, decoratePatterns, describeOfficialUtilityModel } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";
import { MODEL_ADVICE_FILE } from "../lib/model-advisor.js";
import { listProposals } from "../lib/proposals.js";
import { toolPaths, loadConfig, loadPatterns } from "./_shared.js";

const tool = defineTool({
  name: "self_learning_stats",
  description: "View runtime self-learning statistics: turns, patterns, injectable hints, review states, and current config.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    const p = toolPaths();
    const config = loadConfig(p.configPath);
    const officialUtilityModel = describeOfficialUtilityModel();
    config.officialUtilityModelDisplay = officialUtilityModel.display;
    const patterns = loadPatterns(p.patternsPath);
    const decorated = decoratePatterns(patterns, config);
    const proposals = listProposals(p.learnerDir, { limit: 50 });

    const byStatus = { pending: 0, approved: 0, rejected: 0 };
    for (const pattern of decorated) byStatus[pattern.status] = (byStatus[pattern.status] || 0) + 1;
    const byKnowledgeTier = {};
    for (const pattern of decorated) byKnowledgeTier[pattern.knowledgeTier] = (byKnowledgeTier[pattern.knowledgeTier] || 0) + 1;

    let historySnapshots = 0;
    try {
      historySnapshots = fs.readdirSync(p.historyDir).filter((name) => name.endsWith("-SKILL.md")).length;
    } catch {}

    return JSON.stringify({
      totalTurns: countJsonl(p.experiencePath),
      compactTurns: countJsonl(p.turnsPath),
      errors: countJsonl(p.errorPath),
      patternCount: decorated.length,
      injectableCount: decorated.filter((pattern) => pattern.injectable).length,
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
        pending: proposals.filter((proposal) => proposal.status === "pending").length,
        applied: proposals.filter((proposal) => proposal.status === "applied").length,
        rejected: proposals.filter((proposal) => proposal.status === "rejected").length,
        pendingItems: proposals
          .filter((proposal) => proposal.status === "pending")
          .slice(0, 10)
          .map((proposal) => ({
            id: proposal.id,
            type: proposal.type,
            risk: proposal.risk,
            title: proposal.title,
            autoApply: proposal.autoApply,
            updatedAt: proposal.updatedAt,
          })),
      },
      modelAdvice: readJson(MODEL_ADVICE_FILE, null),
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
    }, null, 2);
  },
});

export const { name, description, parameters, execute } = tool;
