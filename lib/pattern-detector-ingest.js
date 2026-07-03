import { preferencePatternId, stableKey } from "./helpers.js";
import { DEFAULT_CONFIG } from "./common.js";
import { suggestToolRepair, buildRepairHint } from "./tool-repair.js";
import { makeEvidence, attachEvidence } from "./evidence.js";
import { preferenceTierFromText, scopeFrom, uniqueSortedToolCategories } from "./pattern-detector-utils.js";

// A usage entry is a failure only when it carries an error, or its status is an
// explicit failure word. The previous whitelist approach (anything not in
// {success, ok, completed, complete}) misclassified benign statuses like
// "succeeded", "stopped" or "finished" as failures and spawned phantom
// usage:failed_request patterns.
const FAILURE_STATUSES = new Set([
  "error", "failed", "failure", "cancelled", "canceled",
  "timeout", "timed_out", "aborted", "rejected", "incomplete",
]);

function isUsageFailure(entry = {}) {
  if (entry.error) return true;
  const status = String(entry.status || "").toLowerCase();
  return FAILURE_STATUSES.has(status);
}

function mergeUniqueList(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const value of a || []) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  for (const value of b || []) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function mergeTaskTypes(rawTaskType, nextTaskType) {
  const seen = new Set();
  const out = [];
  for (const item of String(rawTaskType || "").split(",")) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  const next = nextTaskType || "general";
  if (next && !seen.has(next)) out.push(next);
  return out.join(",");
}

export function ingestWorkflow(detector, exp, newPatterns) {
  if (exp.toolsUsed.length < 2) return;
  const uniqueCats = uniqueSortedToolCategories(exp.toolsUsed);
  if (uniqueCats.length < 2 || uniqueCats.every(c => c === "其他")) return;
  const catKey = uniqueCats.join("→");
  const toolKey = exp.toolsUsed.join("->");
  const count = (detector.seqCache.get(catKey) || 0) + 1;
  detector.seqCache.set(catKey, count);
  if (count < 3) return;
  if (!detector.seqInsertOrder.includes(catKey)) {
    detector.seqInsertOrder.push(catKey);
    while (detector.seqInsertOrder.length > detector.maxPatternCount) detector.seqCache.delete(detector.seqInsertOrder.shift());
  }
  const pid = `workflow:${catKey}`;
  const desc = `跨类别工作流: ${catKey}`;
  const existing = detector.patterns.get(pid);
  const hint = `This ${uniqueCats.join(" → ")} sequence repeats across sessions. Consider whether these steps can be automated or consolidated.`;
  const ctx = { taskType: exp.taskType || "general", tools: [...exp.toolsUsed], categories: uniqueCats };
  if (existing) {
    const wasBelow = existing.count < 3;
    existing.count = count;
    existing.lastSeen = exp.date;
    existing.score = count * 3 + (existing.bonus || 0);
    existing.tools = mergeUniqueList(existing.tools, exp.toolsUsed);
    const mergedTaskTypes = mergeTaskTypes(existing.context?.taskType, ctx.taskType);
    existing.context = { ...existing.context, ...ctx, taskType: mergedTaskTypes };
    existing.scope = { ...scopeFrom(exp), ...(existing.scope || {}), taskType: mergedTaskTypes };
    attachEvidence(existing, makeEvidence({ type: "turn", file: "experience_log.jsonl", date: exp.date, quote: exp.taskSummary || exp.userIntent }));
    detector._indexPattern(pid, uniqueCats);
    const subs = existing.subSignatures = existing.subSignatures || {};
    subs[toolKey] = (subs[toolKey] || 0) + 1;
    const subEntries = Object.entries(subs).sort((a, b) => b[1] - a[1]);
    if (subEntries.length > 10) existing.subSignatures = Object.fromEntries(subEntries.slice(0, 10));
    const topSub = subEntries[0];
    if (topSub && topSub[1] >= 3) {
      existing.fix = `Common sequence: ${topSub[0].replace(/->/g, " → ")} (seen ${topSub[1]}×). Consider automating or templating this flow.`;
    }
    if (wasBelow) newPatterns.push({ id: pid, type: "workflow", desc, count });
  } else {
    const wf = {
      id: pid, type: "workflow", status: "pending",
      desc, count, context: ctx, scope: scopeFrom(exp),
      firstSeen: exp.date, lastSeen: exp.date,
      score: count * 3, tools: [...exp.toolsUsed],
      fix: hint, subSignatures: { [toolKey]: 1 },
    };
    attachEvidence(wf, makeEvidence({ type: "turn", file: "experience_log.jsonl", date: exp.date, quote: exp.taskSummary || exp.userIntent }));
    detector.patterns.set(pid, wf);
    detector._indexPattern(pid, uniqueCats);
    newPatterns.push({ id: pid, type: "workflow", desc, count });
  }
}

export function ingestPreference(detector, exp, newPatterns) {
  if (!exp.correction) return;
  const ck = preferencePatternId(exp.correction);
  const existing = detector.patterns.get(ck);
  const tier = preferenceTierFromText(exp.correction, exp.toolsUsed);
  if (!existing) {
    newPatterns.push({ id: ck, type: "preference", desc: `User correction: ${exp.correction}` });
  }
  if (existing) {
    existing.count += 1;
    existing.lastSeen = exp.date;
    existing.score += 3;
    if (tier === "durable") existing.knowledgeTier = "durable";
    else if (!existing.knowledgeTier) existing.knowledgeTier = "core";
    existing.tools = mergeUniqueList(existing.tools, exp.toolsUsed);
    if (!existing.context) existing.context = { taskType: exp.taskType || "general" };
    if (!existing.scope) existing.scope = scopeFrom(exp);
    attachEvidence(existing, makeEvidence({ type: "correction", file: "experience_log.jsonl", date: exp.date, quote: exp.correction }));
  } else {
    detector.patterns.set(ck, {
      id: ck, type: "preference", knowledgeTier: tier, status: "pending",
      desc: `User correction: ${exp.correction}`, count: 1,
      firstSeen: exp.date, lastSeen: exp.date, score: 6,
      tools: exp.toolsUsed || [],
      context: { taskType: exp.taskType || "general" },
      scope: scopeFrom(exp), fix: exp.correction,
      evidence: [makeEvidence({ type: "correction", file: "experience_log.jsonl", date: exp.date, quote: exp.correction })],
    });
  }
}

export function ingestError(detector, err) {
  const ek = `error:${err.errorType}`;
  const existing = detector.patterns.get(ek);
  const inc = Math.max(1, err.severity || 1);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = err.date;
    existing.score += inc;
    if (err.candidateSkill && !existing.fix) existing.fix = err.candidateSkill;
    attachEvidence(existing, makeEvidence({ type: "error", file: "error_log.jsonl", date: err.date, quote: err.errorDesc }));
    return { pattern: existing, isNew: false };
  }
  const NON_RETRYABLE = new Set(["permission_denied", "command_not_found", "syntax_error", "path_error", "auth_error", "file_not_found"]);
  const RETRY_ADVISORY = {
    permission_denied: "Do NOT retry the same command. Check file/folder permissions or ask the user for access.",
    command_not_found: "Do NOT retry the same command. The command is not available in this environment; use an alternative tool or approach.",
    syntax_error: "Do NOT retry the same command. Fix the syntax (quoting, escaping, path format) before re-running.",
    path_error: "Do NOT retry the same command. Verify the target path exists before re-running.",
    auth_error: "Do NOT retry without fixing credentials. Check API key validity and provider configuration.",
    file_not_found: "Do NOT retry the same read. Verify the file path, or use find/grep to locate it.",
    network_error: "Retry after a brief wait. If persistent, check connectivity, proxy, or provider status.",
    model_error: "Reduce input size or split the request before retrying.",
    tool_error: "Inspect the error message for root cause before retrying. Fix the underlying issue rather than re-running the identical command.",
  };
  const repairPlan = suggestToolRepair(err);
  const fix = err.candidateSkill || RETRY_ADVISORY[err.errorType] || buildRepairHint(err);
  const pattern = {
    id: ek,
    type: "error",
    status: "pending",
    desc: `Repeated error: ${err.errorType} - ${err.errorDesc}`,
    count: 1,
    firstSeen: err.date,
    lastSeen: err.date,
    score: inc,
    tools: err.tool ? [err.tool] : [],
    scope: scopeFrom(err),
    fix,
    retryable: repairPlan.retry && !NON_RETRYABLE.has(err.errorType),
    repairPlan,
    evidence: [makeEvidence({ type: "error", file: "error_log.jsonl", date: err.date, quote: err.errorDesc })],
  };
  detector.patterns.set(ek, pattern);
  return { pattern, isNew: true };
}

export function ingestUsage(detector, entry = {}) {
  const patterns = [];
  const now = entry.date || new Date().toISOString();
  const model = stableKey(entry.model);
  const operation = stableKey(entry.operation || entry.subsystem);
  const totalTokens = Number(entry.totalTokens || 0);
  const threshold = Number(detector.config?.largeUsageTokenThreshold || DEFAULT_CONFIG.largeUsageTokenThreshold);

  if (totalTokens >= threshold) {
    patterns.push({
      id: `usage:large_context:${model}`,
      type: "usage",
      desc: `Large context usage on ${entry.model}: ${totalTokens} tokens`,
      fix: `Before using ${entry.model} for similar work, search prior context and compact inputs; split large jobs when possible.`,
      score: Math.max(4, Math.min(20, Math.round(totalTokens / Math.max(1, threshold)) * 4)),
      context: { taskType: "usage", model: entry.model, operation: entry.operation, subsystem: entry.subsystem },
    });
  }

  if (isUsageFailure(entry)) {
    patterns.push({
      id: `usage:failed_request:${model}:${operation}`,
      type: "usage",
      desc: `Model request failure on ${entry.model}/${entry.operation || entry.subsystem || "unknown"}`,
      fix: entry.error
        ? `This request path has failed before: ${entry.error}. Check provider health, auth, and request size before retrying.`
        : "This request path has failed before. Check provider health, auth, and request size before retrying.",
      score: 3,
      context: { taskType: "usage", model: entry.model, operation: entry.operation, subsystem: entry.subsystem },
    });
  }

  const changed = [];
  for (const pattern of patterns) {
    const existing = detector.patterns.get(pattern.id);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
      existing.score = Math.max(existing.score || 0, 0) + pattern.score;
      existing.desc = pattern.desc;
      existing.fix = pattern.fix;
      existing.context = { ...(existing.context || {}), ...(pattern.context || {}) };
      changed.push({ pattern: existing, isNew: false });
    } else {
      const next = { ...pattern, status: "pending", count: 1, firstSeen: now, lastSeen: now };
      detector.patterns.set(pattern.id, next);
      changed.push({ pattern: next, isNew: true });
    }
  }
  return changed;
}
