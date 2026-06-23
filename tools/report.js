import { readJson, readRecentJsonl, countBy, decoratePatterns, describeOfficialUtilityModel, summarizeSessionRows, inspectSessionIdentityCoverage } from "../lib/common.js";
import { modelAdviceFile } from "../lib/model-advisor.js";
import { listProposals } from "../lib/proposals.js";
import { toolPaths, loadConfig, loadPatterns } from "./_shared.js";

export const name = "self_learning_report";

export const description = "Generate a local self-learning report: task trends, error trends, review states, injectable hints, and skill candidates.";

export const sessionPermission = { readOnly: true };

export const parameters = {
  type: "object",
  properties: {
    days: { type: "number", description: "Days to analyze, default 7" },
  },
};

export async function execute(input = {}, ctx) {
  const days = input.days || 7;
  const p = toolPaths(ctx);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const experiences = readRecentJsonl(p.experiencePath, cutoff);
    const errors = readRecentJsonl(p.errorPath, cutoff);
    const sessions = summarizeSessionRows(experiences);
    const errorSessions = summarizeSessionRows(errors);
    const sessionCoverage = [
      ["experience_log.jsonl", inspectSessionIdentityCoverage(p.experiencePath)],
      ["error_log.jsonl", inspectSessionIdentityCoverage(p.errorPath)],
      ["turns.jsonl", inspectSessionIdentityCoverage(p.turnsPath)],
      ["activity_log.jsonl", inspectSessionIdentityCoverage(p.activityPath)],
    ].map(([file, coverage]) => ({
      file,
      ...coverage,
      coveragePct: Math.round((coverage.coverageRatio || 0) * 100),
    })).filter((item) => item.total > 0);
    const config = loadConfig(p.configPath);
    const patterns = decoratePatterns(loadPatterns(p.patternsPath), config);

    const injectable = patterns.filter((pattern) => pattern.injectable);
    const pending = patterns.filter((pattern) => pattern.status === "pending");
    const rejected = patterns.filter((pattern) => pattern.status === "rejected");
    const skillCandidates = patterns.filter((pattern) => pattern.decayedScore >= 12 && pattern.count >= 3);
    const usage = readJson(p.usageSummaryPath, null);
    const capabilities = readJson(p.capabilitiesPath, null);
    const modelAdvice = readJson(modelAdviceFile(p.learnerDir), null);
    const proposals = listProposals(p.learnerDir, { limit: 30 });
    const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
    const officialUtilityModel = describeOfficialUtilityModel();
    config.officialUtilityModelDisplay = officialUtilityModel.display;
    const topModels = Object.entries(usage?.byModel || {})
      .sort((a, b) => (b[1].totalTokens || 0) - (a[1].totalTokens || 0))
      .slice(0, 8);

    const text = [
      `# Self-Learning Report (last ${days} days)`,
      "",
      "## Overview",
      `- Total tasks: ${experiences.length}`,
      `- Errors: ${errors.length}`,
      `- Sessions observed: ${sessions.length}`,
      `- Sessions with errors: ${errorSessions.length}`,
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
      `- includeUsageInAdvisorPrompt: ${config.includeUsageInAdvisorPrompt}`,
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
      "## Session Activity",
      ...(sessions.length ? sessions.slice(0, 8).map((s) => `- ${s.sessionKey}: turns=${s.count}, label=${s.sessionLabel}, lastSeen=${s.lastSeenAt}`) : ["- No sessions observed"]),
      "",
      "## Session Identity Coverage",
      ...(sessionCoverage.length
        ? sessionCoverage.map((item) => `- ${item.file}: stable=${item.withStableIdentity}/${item.total} (${item.coveragePct}%), legacyOnly=${item.legacyPathOnly}, unknown=${item.unknown}`)
        : ["- No sampled session-bearing log rows found"]),
      "",
      "## Error Distribution",
      ...(errors.length ? Object.entries(countBy(errors, "errorType")).map(([k, v]) => `- ${k}: ${v}`) : ["- No errors recorded"]),
      ...(errorSessions.length ? ["", "## Error Sessions", ...errorSessions.slice(0, 8).map((s) => `- ${s.sessionKey}: errors=${s.count}, label=${s.sessionLabel}, lastSeen=${s.lastSeenAt}`)] : []),
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
      `> Data dir: ${p.learnerDir}`,
    ].join("\n");

  return {
    content: [{ type: "text", text: text }],
  };
}
