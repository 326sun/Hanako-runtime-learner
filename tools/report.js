import path from "path";
import { readJson, readRecentJsonl, countBy, loadLearnerConfig, decoratePatterns, learnerDir as resolveLearnerDir, describeOfficialUtilityModel } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";
import { MODEL_ADVICE_FILE } from "../lib/model-advisor.js";
import { listProposals } from "../lib/proposals.js";

const tool = defineTool({
  name: "self_learning_report",
  description: "Generate a local self-learning report: task trends, error trends, review states, injectable hints, and skill candidates.",
  parameters: {
    type: "object",
    properties: {
      days: { type: "number", description: "Days to analyze, default 7" },
    },
    required: [],
  },
  async execute(input = {}) {
    const days = input.days || 7;
    const learnerDir = resolveLearnerDir();
    const experiencePath = path.join(learnerDir, "experience_log.jsonl");
    const errorPath = path.join(learnerDir, "error_log.jsonl");
    const patternsPath = path.join(learnerDir, "patterns.json");
    const configPath = path.join(learnerDir, "config.json");
    const usageSummaryPath = path.join(learnerDir, "usage_summary.json");
    const capabilitiesPath = path.join(learnerDir, "host_capabilities.json");
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const experiences = readRecentJsonl(experiencePath, cutoff);
    const errors = readRecentJsonl(errorPath, cutoff);
    const config = loadLearnerConfig(configPath);
    const patterns = decoratePatterns(readJson(patternsPath, []), config);

    const injectable = patterns.filter((pattern) => pattern.injectable);
    const pending = patterns.filter((pattern) => pattern.status === "pending");
    const rejected = patterns.filter((pattern) => pattern.status === "rejected");
    const skillCandidates = patterns.filter((pattern) => pattern.decayedScore >= 12 && pattern.count >= 3);
    const usage = readJson(usageSummaryPath, null);
    const capabilities = readJson(capabilitiesPath, null);
    const modelAdvice = readJson(MODEL_ADVICE_FILE, null);
    const proposals = listProposals(learnerDir, { limit: 30 });
    const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
    const officialUtilityModel = describeOfficialUtilityModel();
    config.officialUtilityModelDisplay = officialUtilityModel.display;
    const topModels = Object.entries(usage?.byModel || {})
      .sort((a, b) => (b[1].totalTokens || 0) - (a[1].totalTokens || 0))
      .slice(0, 8);

    return [
      `# Self-Learning Report (last ${days} days)`,
      "",
      "## Overview",
      `- Total tasks: ${experiences.length}`,
      `- Errors: ${errors.length}`,
      `- Patterns detected: ${patterns.length}`,
      `- Injectable hints: ${injectable.length}`,
      `- Durable settings: ${patterns.filter((pattern) => pattern.knowledgeTier === "durable").length}`,
      `- Core patterns: ${patterns.filter((pattern) => pattern.knowledgeTier === "core").length}`,
      `- Pending review: ${pending.length}`,
      `- Pending proposals: ${pendingProposals.length}`,
      `- Rejected: ${rejected.length}`,
      `- Skill candidates: ${skillCandidates.length}`,
      "",
      "## Current Config",
      `- autoInjectHighConfidence: ${config.autoInjectHighConfidence}`,
      `- minInjectScore: ${config.minInjectScore}`,
      `- minInjectCount: ${config.minInjectCount}`,
      `- decayHalfLifeDays: ${config.decayHalfLifeDays}`,
      `- includePendingPreferences: ${config.includePendingPreferences}`,
      `- learnFromUsage: ${config.learnFromUsage}`,
      `- officialMemoryBridgeEnabled: ${config.officialMemoryBridgeEnabled}`,
      `- officialMemoryBridgeMaxResults: ${config.officialMemoryBridgeMaxResults}`,
      `- durableMemoryMaxCount: ${config.durableMemoryMaxCount}`,
      `- largeUsageTokenThreshold: ${config.largeUsageTokenThreshold}`,
      `- modelAdvisorEnabled: ${config.modelAdvisorEnabled}`,
      `- modelAdvisorSource: ${config.modelAdvisorSource}`,
      `- officialUtilityModel: ${officialUtilityModel.display}`,
      `- workStatusEnabled: ${config.workStatusEnabled}`,
      `- proposalChatNotificationsEnabled: ${config.proposalChatNotificationsEnabled}`,
      "",
      "## Usage Signals",
      ...(usage ? [
        `- Requests observed: ${usage.totalRequests}`,
        `- Total tokens: ${usage.totalTokens}`,
        `- Cost total: ${usage.costTotal}`,
        ...topModels.map(([model, item]) => `- ${model}: requests=${item.requests}, tokens=${item.totalTokens}`),
      ] : ["- No usage summary recorded"]),
      "",
      "## Host Capabilities",
      ...(capabilities ? [
        `- Available: ${capabilities.availableCount}/${capabilities.count}`,
      ] : ["- No host capability snapshot recorded"]),
      "",
      "## Small Model Advisor",
      ...(modelAdvice?.suggestions?.length ? [
        `- Updated: ${modelAdvice.updatedAt}`,
        `- Source: ${modelAdvice.source || "unknown"}`,
        `- Provider: ${modelAdvice.provider || "unknown"}`,
        `- Model: ${modelAdvice.model}`,
        ...modelAdvice.suggestions.slice(0, 10).map((item) => `- [${item.risk || "unknown"}] ${item.title || item.patternId}: ${item.advice || ""}`),
      ] : ["- No model advisor draft recorded"]),
      "",
      "## Task Distribution",
      ...Object.entries(countBy(experiences, "taskType")).map(([k, v]) => `- ${k}: ${v}`),
      "",
      "## Error Distribution",
      ...(errors.length ? Object.entries(countBy(errors, "errorType")).map(([k, v]) => `- ${k}: ${v}`) : ["- No errors recorded"]),
      "",
      "## Injectable Hints",
      ...(injectable.length ? injectable.slice(0, 10).map((p) => `- [${p.type}, ${p.status}, score=${p.decayedScore}] ${p.id}: ${p.desc}${p.fix ? ` -> ${p.fix}` : ""}`) : ["- No injectable hints"]),
      "",
      "## Pending Review",
      ...(pending.length ? pending.slice(0, 10).map((p) => `- [score=${p.decayedScore}] ${p.id}: ${p.desc}`) : ["- No pending patterns"]),
      "",
      "## Pending Proposals",
      ...(pendingProposals.length ? pendingProposals.slice(0, 10).map((proposal) => `- [${proposal.risk}, ${proposal.type}] ${proposal.id}: ${proposal.title || proposal.reason || "Untitled proposal"}`) : ["- No pending proposals"]),
      "",
      `> Data dir: ${learnerDir}`,
    ].join("\n");
  },
});

export const { name, description, parameters, execute } = tool;
