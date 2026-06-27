import fs from "fs";
import { mergeConfig, readJson } from "./common.js";

function lines(text) {
  return String(text || "").replace(/\r\n/g, "\n").split("\n");
}

function trimDiff(diff, maxLines = 240) {
  if (diff.length <= maxLines) return diff;
  return [...diff.slice(0, maxLines), `... diff truncated (${diff.length - maxLines} more line(s))`];
}

function lineDiff(before = "", after = "", { context = 2, maxLines = 240 } = {}) {
  if (before === after) return [];
  const beforeLines = lines(before);
  const afterLines = lines(after);
  const diff = [];
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start++;
  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (endBefore >= start && endAfter >= start && beforeLines[endBefore] === afterLines[endAfter]) {
    endBefore--;
    endAfter--;
  }

  const from = Math.max(0, start - context);
  const toBefore = Math.min(beforeLines.length - 1, endBefore + context);
  const toAfter = Math.min(afterLines.length - 1, endAfter + context);
  if (from > 0) diff.push(`... ${from} unchanged line(s) before`);
  for (let i = from; i <= toBefore; i += 1) {
    if (i < start || i > endBefore) diff.push(`  ${beforeLines[i] ?? ""}`);
    else diff.push(`- ${beforeLines[i] ?? ""}`);
  }
  for (let i = start; i <= toAfter; i += 1) diff.push(`+ ${afterLines[i] ?? ""}`);
  const tail = Math.max(beforeLines.length - 1 - toBefore, afterLines.length - 1 - toAfter);
  if (tail > 0) diff.push(`... ${tail} unchanged line(s) after`);
  return trimDiff(diff, maxLines);
}

function countChanges(diff) {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.startsWith("+ ")) added += 1;
    else if (line.startsWith("- ")) removed += 1;
  }
  return { addedLines: added, removedLines: removed };
}

export function previewProposalDiff(proposal, { configPath = null } = {}) {
  if (!proposal) return { ok: false, error: "proposal missing" };
  if (proposal.type === "skill_patch") {
    const target = proposal.target?.skillPath || "SKILL.md";
    let before = "";
    try { before = fs.readFileSync(target, "utf-8"); } catch {}
    const after = proposal.patch?.content || "";
    const diff = lineDiff(before, after);
    return { ok: true, proposalId: proposal.id, type: proposal.type, target, diff, ...countChanges(diff) };
  }
  if (proposal.type === "config_patch") {
    const target = configPath || proposal.target?.configPath || "config.json";
    let before = "";
    try { before = fs.readFileSync(target, "utf-8"); } catch {}
    const current = configPath || proposal.target?.configPath
      ? mergeConfig(readJson(target, {}))
      : {};
    const after = JSON.stringify(mergeConfig(current, proposal.patch?.config || {}), null, 2);
    const diff = lineDiff(before, after);
    return { ok: true, proposalId: proposal.id, type: proposal.type, target, diff, ...countChanges(diff) };
  }
  if (proposal.type === "code_patch") {
    const plan = proposal.patch?.suggestedPlan || [];
    return {
      ok: true,
      proposalId: proposal.id,
      type: proposal.type,
      target: proposal.target || { plugin: "hanako-runtime-learner" },
      diff: plan.map((step) => `? ${step}`),
      addedLines: 0,
      removedLines: 0,
      note: "code_patch is a plan preview only; the plugin will not auto-edit code.",
    };
  }
  if (proposal.type === "action_plan") {
    const steps = proposal.plan?.steps || [];
    return {
      ok: true,
      proposalId: proposal.id,
      type: proposal.type,
      target: proposal.plan?.actionType || "runtime_action",
      diff: steps.map((step) => `? ${step}`),
      addedLines: 0,
      removedLines: 0,
      note: "action_plan is a runtime strategy preview; execution is controlled by the action policy gate.",
    };
  }
  if (proposal.type === "pattern_candidate") {
    const previewLines = [
      `kind: ${proposal.kind || "unknown"}  ·  confidence: ${proposal.confidence ?? "n/a"}  ·  risk: ${proposal.suggestedRiskTier || "n/a"}`,
      `desc: ${proposal.desc || ""}`,
    ];
    if (proposal.generalization) previewLines.push(`when: ${proposal.generalization}`);
    if (Array.isArray(proposal.evidenceIds) && proposal.evidenceIds.length) previewLines.push(`evidence: ${proposal.evidenceIds.join(", ")}`);
    return {
      ok: true,
      proposalId: proposal.id,
      type: proposal.type,
      target: `pattern_candidate:${proposal.kind || "unknown"}`,
      diff: previewLines.map((line) => `? ${line}`),
      addedLines: 0,
      removedLines: 0,
      note: "pattern_candidate is an LLM-distilled review item; it is never auto-applied and creates no pattern until a human acts on it.",
    };
  }
  return { ok: false, proposalId: proposal.id, error: `unsupported proposal type: ${proposal.type}` };
}
