import fs from "fs";
import path from "path";
import { readJson, loadLearnerConfig, countJsonl, decoratePatterns, learnerDir as resolveLearnerDir, describeOfficialUtilityModel } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";
import { MODEL_ADVICE_FILE } from "../lib/model-advisor.js";
import { listProposals } from "../lib/proposals.js";

const tool = defineTool({
  name: "self_learning_stats",
  description: "View runtime self-learning statistics: turns, patterns, injectable hints, review states, and current config.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    const learnerDir = resolveLearnerDir();
    const patternsPath = path.join(learnerDir, "patterns.json");
    const experiencePath = path.join(learnerDir, "experience_log.jsonl");
    const errorPath = path.join(learnerDir, "error_log.jsonl");
    const turnsPath = path.join(learnerDir, "turns.jsonl");
    const configPath = path.join(learnerDir, "config.json");
    const historyDir = path.join(learnerDir, "skill_history");
    const usageSummaryPath = path.join(learnerDir, "usage_summary.json");
    const capabilitiesPath = path.join(learnerDir, "host_capabilities.json");

    const config = loadLearnerConfig(configPath);
    const officialUtilityModel = describeOfficialUtilityModel();
    config.officialUtilityModelDisplay = officialUtilityModel.display;
    const patterns = readJson(patternsPath, []);
    const decorated = decoratePatterns(patterns, config);
    const proposals = listProposals(learnerDir, { limit: 50 });

    const byStatus = { pending: 0, approved: 0, rejected: 0 };
    for (const pattern of decorated) byStatus[pattern.status] = (byStatus[pattern.status] || 0) + 1;

    let historySnapshots = 0;
    try {
      historySnapshots = fs.readdirSync(historyDir).filter((name) => name.endsWith("-SKILL.md")).length;
    } catch {}

    return JSON.stringify({
      totalTurns: countJsonl(experiencePath),
      compactTurns: countJsonl(turnsPath),
      errors: countJsonl(errorPath),
      patternCount: decorated.length,
      injectableCount: decorated.filter((pattern) => pattern.injectable).length,
      byStatus,
      historySnapshots,
      usage: readJson(usageSummaryPath, null),
      hostCapabilities: readJson(capabilitiesPath, null),
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
        injectable: pattern.injectable,
        desc: pattern.desc,
      })),
      dataDir: learnerDir,
    }, null, 2);
  },
});

export const { name, description, parameters, execute } = tool;
