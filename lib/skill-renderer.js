import path from "path";
import { DEFAULT_CONFIG } from "./config-defaults.js";
import { readJson } from "./json-io.js";
import { decoratePatterns, estimateTokensRaw, knowledgeTier } from "./scoring.js";

function safeOneLine(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function loadActiveSkillRegistry(dataDir = "") {
  if (!dataDir) return { schemaVersion: 1, skills: [] };
  const file = path.join(dataDir, "active_skills.json");
  const raw = readJson(file, { schemaVersion: 1, skills: [] });
  return {
    schemaVersion: raw.schemaVersion || 1,
    generatedAt: raw.generatedAt || null,
    skills: Array.isArray(raw.skills) ? raw.skills.filter((item) => item && item.id) : [],
  };
}

export function isActiveSkillInjectable(skill = {}, config = DEFAULT_CONFIG) {
  const evidence = skill.evidence || {};
  const minSuccess = Number(config.activeSkillsInjectionMinSuccess ?? DEFAULT_CONFIG.activeSkillsInjectionMinSuccess);
  const maxRegression = Number(config.activeSkillsInjectionMaxRegression ?? DEFAULT_CONFIG.activeSkillsInjectionMaxRegression);
  const successCount = Number(evidence.successCount || 0);
  const regressionCount = Number(evidence.regressionCount || 0);
  return skill.status === "active"
    && !!skill.rule
    && successCount >= minSuccess
    && regressionCount <= maxRegression
    && skill.injectable !== false;
}

export function selectInjectableActiveSkills(dataDir = "", config = DEFAULT_CONFIG) {
  if (!config?.activeSkillsInjectionEnabled) return [];
  const maxCount = Math.max(0, Number(config.activeSkillsInjectionMaxCount ?? DEFAULT_CONFIG.activeSkillsInjectionMaxCount));
  if (maxCount <= 0) return [];
  const registry = loadActiveSkillRegistry(dataDir);
  return registry.skills
    .filter((skill) => isActiveSkillInjectable(skill, config))
    .sort((a, b) => Number(b.evidence?.successCount || 0) - Number(a.evidence?.successCount || 0))
    .slice(0, maxCount);
}

export function buildSkillMdFromPatterns(patterns, config, { turnCount = 0, dataDir = "" } = {}) {
  const decorated = decoratePatterns(patterns, config);
  const injectable = decorated.filter(p => p.injectable);
  const allPrefs = decorated.filter(p => p.type === "preference" && p.injectable && (
    knowledgeTier(p) !== "durable" || p.status === "approved" || p.advisorUpdatedAt
  ));
  const prefs = allPrefs.slice(0, 5);
  const workflows = decorated.filter(p => p.type === "workflow" && p.injectable).slice(0, 3);
  const risks = decorated.filter(p => (p.type === "error" || p.type === "usage") && p.injectable).slice(0, 3);
  const activeSkills = selectInjectableActiveSkills(dataDir, config);

  let lines = [
    "# Runtime Self-Learning",
    "",
    turnCount
      ? `Observed ${turnCount} turns, ${patterns.length} patterns (${injectable.length} active).`
      : `${patterns.length} patterns, ${injectable.length} active.`,
    "",
    "## How to use",
    "- Use `self_learning_search <query>` to find relevant patterns before making decisions.",
    "- Example: before coding, search 'coding workflow' for past patterns.",
    "- Example: before replying, search user preferences.",
    "",
  ];

  if (activeSkills.length) {
    lines.push("## Active Validated Skills");
    for (const skill of activeSkills) {
      const success = Number(skill.evidence?.successCount || 0);
      const regression = Number(skill.evidence?.regressionCount || 0);
      const evidence = success ? ` (evidence: ${success} success${regression ? `, ${regression} regression` : ""})` : "";
      lines.push(`- ${safeOneLine(skill.rule)}${evidence}`);
    }
    lines.push("");
  }

  if (prefs.length) {
    lines.push("## Verified User Preferences");
    for (const pref of prefs) {
      const text = (pref.fix && !pref.fix.startsWith("User correction:")) ? pref.fix
        : pref.desc.replace(/^User correction: /, "");
      lines.push(`- ${text}`);
    }
    if (allPrefs.length > 5) lines.push("- ... more via self_learning_search");
    lines.push("");
  }

  if (workflows.length) {
    lines.push("## Recent Workflows");
    for (const wf of workflows) lines.push(`- ${wf.desc}`);
    lines.push("");
  }

  if (risks.length) {
    lines.push("## Active Runtime Hints");
    for (const risk of risks) {
      const fix = risk.fix ? ` -> ${risk.fix}` : "";
      lines.push(`- ${risk.desc}${fix}`);
    }
    lines.push("");
  }

  const maxTokens = Math.max(200, Number((config || DEFAULT_CONFIG).maxSkillTokens || DEFAULT_CONFIG.maxSkillTokens));
  const rawTokens = estimateTokensRaw;
  const NEWLINE_RAW = rawTokens("\n");
  let currentRaw = 0;
  for (const line of lines) currentRaw += rawTokens(line) + NEWLINE_RAW;
  currentRaw -= NEWLINE_RAW;
  let currentTokens = Math.ceil(currentRaw);

  if (currentTokens > maxTokens) {
    const sectionHeaders = ["## Active Runtime Hints", "## Recent Workflows", "## Active Validated Skills", "## Verified User Preferences"];
    const toDelete = new Set();
    for (const header of sectionHeaders) {
      if (currentTokens <= maxTokens) break;
      const idx = lines.indexOf(header);
      if (idx === -1) continue;
      let end = idx + 1;
      while (end < lines.length && !lines[end].startsWith("## ")) end++;
      for (let i = end - 1; i > idx; i--) {
        if (currentTokens <= maxTokens) break;
        if (!lines[i].startsWith("- ")) continue;
        currentRaw -= rawTokens(lines[i]) + NEWLINE_RAW;
        currentTokens = Math.ceil(currentRaw);
        toDelete.add(i);
      }
      let hasContent = false;
      for (let i = idx + 1; i < end; i++) {
        if (!toDelete.has(i) && lines[i].startsWith("- ")) { hasContent = true; break; }
      }
      if (!hasContent) {
        currentRaw -= rawTokens(lines[idx]) + NEWLINE_RAW;
        currentTokens = Math.ceil(currentRaw);
        toDelete.add(idx);
      }
    }
    lines = lines.filter((_, i) => !toDelete.has(i));
  }

  lines.push(
    "## Tools",
    "- `self_learning_search <query>`: search learned patterns.",
    "- `self_learning_search` may include `officialMemory` results from Hanako's built-in memory bridge when enabled.",
    "- `self_learning_activity`: recent learning activity.",
    "- `self_learning_report`: learning report, including pending improvement proposals.",
    "- `self_learning_control`: use `list_proposals`, `show_proposal`, `apply_proposal`, or `reject_proposal` when the user replies to a proposal notification.",
    "- `self_learning_open_dir`: open data folder.",
    "",
    "## Proposal Notifications",
    "- If the chat contains a Runtime Self-Learning proposal notification and the user asks to view it, call `self_learning_control` with `action=show_proposal`.",
    "- If the user says to apply a proposal, call `self_learning_control` with `action=apply_proposal` for supported proposal types. For `code_patch`, implement the proposal manually, run verification, and install if appropriate.",
    "- If the user rejects a proposal, call `self_learning_control` with `action=reject_proposal` and include the user's reason when available.",
    "",
    "## Safety",
    "- Treat learned hints as suggestions.",
    "- Prefer current user instructions.",
    "- When a bash or edit tool fails: classify the error before deciding to retry.",
    "  * Non-retryable (permission denied, command not found, syntax error, path not found, auth error, file not found): do NOT retry the same command. Fix the root cause or use an alternative approach.",
    "  * Retryable (network error, timeout): wait briefly then retry. If persistent, check connectivity or provider status.",
    "  * Unknown tool error: inspect exit codes, stderr, and specific failure reasons. Fix the underlying issue rather than blindly retrying.",
    "",
  );
  return lines.join("\n");
}
