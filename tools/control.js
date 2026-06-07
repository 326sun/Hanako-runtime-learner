import fs from "fs";
import path from "path";
import { DEFAULT_CONFIG, readJson, writeJson, loadLearnerConfig, decoratePatterns, hanakoHome, learnerDir as resolveLearnerDir, buildSkillMdFromPatterns } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";
import { runModelAdvisor } from "../lib/model-advisor.js";

function paths(ctx) {
  const learnerDir = resolveLearnerDir();
  const pluginDir = ctx?.pluginDir || path.join(hanakoHome(), "plugins", "hanako-runtime-learner");
  return {
    learnerDir,
    pluginDir,
    configPath: path.join(learnerDir, "config.json"),
    patternsPath: path.join(learnerDir, "patterns.json"),
    historyDir: path.join(learnerDir, "skill_history"),
    skillPath: path.join(pluginDir, "skills", "self-learning", "SKILL.md"),
  };
}

function loadConfig(configPath) {
  return loadLearnerConfig(configPath, { persist: true });
}

function buildSkill(patterns, config, learnerDir) {
  return buildSkillMdFromPatterns(patterns, config, { dataDir: learnerDir });
}

function snapshotSkill(skillPath, historyDir) {
  fs.mkdirSync(historyDir, { recursive: true });
  if (!fs.existsSync(skillPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(historyDir, `${stamp}-SKILL.md`);
  fs.copyFileSync(skillPath, target);
  return target;
}

function regenerateSkill(pathsValue, patterns, config) {
  fs.mkdirSync(path.dirname(pathsValue.skillPath), { recursive: true });
  snapshotSkill(pathsValue.skillPath, pathsValue.historyDir);
  fs.writeFileSync(pathsValue.skillPath, buildSkill(patterns, config, pathsValue.learnerDir), "utf-8");
}

const tool = defineTool({
  name: "self_learning_control",
  description: "Review and control the runtime self-learning engine: list patterns, approve/reject hints, update injection config, or roll back the generated skill.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["status", "list", "approve", "reject", "set_config", "rollback", "regenerate_skill", "run_model_advisor"],
        description: "Control action to run.",
      },
      id: { type: "string", description: "Pattern id for approve/reject." },
      autoInjectHighConfidence: { type: "boolean", description: "Whether high-confidence pending patterns can be injected automatically." },
      autoApproveHighConfidence: { type: "boolean", description: "Whether high-confidence pending patterns are automatically approved (no manual review needed)." },
      minInjectScore: { type: "number", description: "Minimum decayed score for automatic injection." },
      minInjectCount: { type: "number", description: "Minimum repeat count for automatic injection." },
      decayHalfLifeDays: { type: "number", description: "Score half-life in days." },
      includePendingPreferences: { type: "boolean", description: "Whether detected user corrections can be injected before manual approval." },
      learnFromUsage: { type: "boolean", description: "Whether usage metadata can influence learned hints." },
      largeUsageTokenThreshold: { type: "number", description: "Token threshold for large-context usage hints." },
      officialUtilityModelDisplay: { type: "string", description: "Read-only display label for the current Hanako utility model." },
      modelAdvisorEnabled: { type: "boolean", description: "Whether the private small-model advisor can run." },
      modelAdvisorSource: { type: "string", enum: ["official", "private", "off"], description: "Advisor source. official uses Hanako utility model config when possible." },
      modelAdvisorBaseUrl: { type: "string", description: "OpenAI-compatible base URL for the private advisor." },
      modelAdvisorApiKey: { type: "string", description: "API key for the private advisor." },
      modelAdvisorModel: { type: "string", description: "Model id for the private advisor." },
      modelAdvisorMaxTokens: { type: "number", description: "Maximum output tokens for advisor calls." },
      modelAdvisorMinIntervalMinutes: { type: "number", description: "Minimum interval between advisor calls." },
      workStatusEnabled: { type: "boolean", description: "Whether to send a short status message when self-learning work completes." },
      workStatusText: { type: "string", description: "Status message prefix." },
    },
    required: ["action"],
  },
  async execute(input = {}, ctx) {
    const p = paths(ctx);
    const config = loadConfig(p.configPath);
    const patterns = readJson(p.patternsPath, []);
    const action = input.action;

    if (action === "status") {
      const decorated = decoratePatterns(patterns, config);
      let history = [];
      try {
        history = fs.readdirSync(p.historyDir).filter((name) => name.endsWith("-SKILL.md")).sort();
      } catch {}
      return JSON.stringify({
        config,
        patterns: decorated.length,
        injectable: decorated.filter((x) => x.injectable).length,
        pending: decorated.filter((x) => x.status === "pending").length,
        approved: decorated.filter((x) => x.status === "approved").length,
        rejected: decorated.filter((x) => x.status === "rejected").length,
        historySnapshots: history.length,
        dataDir: p.learnerDir,
      }, null, 2);
    }

    if (action === "list") {
      return JSON.stringify(decoratePatterns(patterns, config).slice(0, 20).map((pattern) => ({
        id: pattern.id,
        type: pattern.type,
        status: pattern.status,
        count: pattern.count,
        score: pattern.score,
        decayedScore: pattern.decayedScore,
        injectable: pattern.injectable,
        desc: pattern.desc,
        fix: pattern.fix || null,
      })), null, 2);
    }

    if (action === "approve" || action === "reject") {
      fs.mkdirSync(p.learnerDir, { recursive: true });
      fs.mkdirSync(p.historyDir, { recursive: true });
      if (!input.id) throw new Error("id is required for approve/reject");
      const target = patterns.find((pattern) => pattern.id === input.id);
      if (!target) throw new Error(`pattern not found: ${input.id}`);
      target.status = action === "approve" ? "approved" : "rejected";
      target.reviewedAt = new Date().toISOString();
      writeJson(p.patternsPath, patterns);
      regenerateSkill(p, patterns, config);
      return JSON.stringify({ ok: true, id: target.id, status: target.status }, null, 2);
    }

    if (action === "set_config") {
      fs.mkdirSync(p.learnerDir, { recursive: true });
      fs.mkdirSync(p.historyDir, { recursive: true });
      const next = { ...config };
      for (const key of Object.keys(DEFAULT_CONFIG)) {
        if (Object.prototype.hasOwnProperty.call(input, key)) next[key] = input[key];
      }
      writeJson(p.configPath, next);
      regenerateSkill(p, patterns, next);
      return JSON.stringify({ ok: true, config: next }, null, 2);
    }

    if (action === "regenerate_skill") {
      fs.mkdirSync(p.learnerDir, { recursive: true });
      fs.mkdirSync(p.historyDir, { recursive: true });
      regenerateSkill(p, patterns, config);
      return JSON.stringify({ ok: true, skillPath: p.skillPath }, null, 2);
    }

    if (action === "run_model_advisor") {
      const usage = readJson(path.join(p.learnerDir, "usage_summary.json"), null);
      const capabilities = readJson(path.join(p.learnerDir, "host_capabilities.json"), null);
      const result = await runModelAdvisor({
        config: { ...config, modelAdvisorEnabled: true },
        patterns: decoratePatterns(patterns, config),
        usage,
        capabilities,
        reason: "manual",
      });
      if (result.ok) regenerateSkill(p, patterns, config);
      return JSON.stringify(result, null, 2);
    }

    if (action === "rollback") {
      fs.mkdirSync(p.learnerDir, { recursive: true });
      fs.mkdirSync(p.historyDir, { recursive: true });
      const history = fs.readdirSync(p.historyDir).filter((name) => name.endsWith("-SKILL.md")).sort();
      const latest = history.at(-1);
      if (!latest) throw new Error("no skill history snapshot available");
      fs.mkdirSync(path.dirname(p.skillPath), { recursive: true });
      fs.copyFileSync(path.join(p.historyDir, latest), p.skillPath);
      return JSON.stringify({ ok: true, restored: latest, skillPath: p.skillPath }, null, 2);
    }

    throw new Error(`unknown action: ${action}`);
  },
});

export const { name, description, parameters, execute } = tool;
