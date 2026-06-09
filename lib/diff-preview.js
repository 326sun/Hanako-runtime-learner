import fs from "fs";

function lines(text) {
  return String(text || "").replace(/\r\n/g, "\n").split("\n");
}

function trimDiff(diff, maxLines = 240) {
  if (diff.length <= maxLines) return diff;
  return [...diff.slice(0, maxLines), `... diff truncated (${diff.length - maxLines} more line(s))`];
}

export function lineDiff(before = "", after = "", { context = 2, maxLines = 240 } = {}) {
  if (before === after) return [];
  const a = lines(before);
  const b = lines(after);
  const prefix = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }

  const from = Math.max(0, start - context);
  const toA = Math.min(a.length - 1, endA + context);
  const toB = Math.min(b.length - 1, endB + context);
  if (from > 0) prefix.push(`... ${from} unchanged line(s) before`);
  for (let i = from; i <= toA; i++) {
    if (i < start || i > endA) prefix.push(`  ${a[i] ?? ""}`);
    else prefix.push(`- ${a[i] ?? ""}`);
  }
  for (let i = start; i <= endB; i++) prefix.push(`+ ${b[i] ?? ""}`);
  const tail = Math.max(a.length - 1 - toA, b.length - 1 - toB);
  if (tail > 0) prefix.push(`... ${tail} unchanged line(s) after`);
  return trimDiff(prefix, maxLines);
}

function countChanges(diff) {
  let added = 0, removed = 0;
  for (const line of diff) {
    if (line.startsWith("+ ")) added++;
    else if (line.startsWith("- ")) removed++;
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
    const after = JSON.stringify(proposal.patch?.config || {}, null, 2);
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
  return { ok: false, proposalId: proposal.id, error: `unsupported proposal type: ${proposal.type}` };
}
