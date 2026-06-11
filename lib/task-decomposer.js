import crypto from "crypto";

export const TASK_TYPES = Object.freeze({
  GENERAL: "general",
  LARGE_CONTEXT: "large_context",
  REPO_MODIFICATION: "repo_modification",
  CODE_REVIEW: "code_review",
  TEST_REPAIR: "test_repair",
  DOCUMENTATION: "documentation",
  PROPOSAL_EXECUTION: "proposal_execution",
});

function stableId(prefix, payload) {
  return `${prefix}:${crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex").slice(0, 12)}`;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function topGroup(file) {
  const normalized = String(file || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith(".")) return "root";
  const first = normalized.split("/").filter(Boolean)[0] || "root";
  return ["lib", "tests", "tools", "scripts", "docs", "skills", "benchmarks"].includes(first) ? first : "root";
}

function chunkText(text, maxChars) {
  const raw = String(text || "");
  if (!raw) return [];
  const chunks = [];
  for (let index = 0; index < raw.length; index += maxChars) {
    chunks.push(raw.slice(index, index + maxChars));
  }
  return chunks;
}

export function inferTaskType(input = {}) {
  if (input.type && Object.values(TASK_TYPES).includes(input.type)) return input.type;
  if (asArray(input.failedTests).length || asArray(input.errors).length) return TASK_TYPES.TEST_REPAIR;
  if (asArray(input.proposals).length) return TASK_TYPES.PROPOSAL_EXECUTION;
  if (String(input.title || input.objective || "").match(/doc|readme|文档|报告/i)) return TASK_TYPES.DOCUMENTATION;
  const files = normalizeTaskFiles(input);
  if (files.length) return input.reviewOnly ? TASK_TYPES.CODE_REVIEW : TASK_TYPES.REPO_MODIFICATION;
  const text = String(input.input || input.prompt || input.text || "");
  const threshold = Number(input.largeContextThreshold || input.maxSubtaskChars || 8000);
  if (text.length > threshold) return TASK_TYPES.LARGE_CONTEXT;
  return TASK_TYPES.GENERAL;
}

export function normalizeTaskFiles(input = {}) {
  return [...new Set([
    ...asArray(input.files),
    ...asArray(input.paths),
    ...asArray(input.changedFiles),
    ...asArray(input.repoFiles),
  ].map((file) => String(file).replace(/\\/g, "/")).filter(Boolean))].sort();
}

function subtask(parentSeed, index, title, type, scope = {}, expectedOutput = {}, dependencies = []) {
  const id = stableId("subtask", { parentSeed, index, title, type, scope });
  return {
    subtaskId: id,
    parentTaskId: null,
    index,
    title,
    type,
    scope,
    inputBudget: { maxTokens: 80000 },
    expectedOutput,
    dependencies,
    status: "pending",
  };
}

function withParent(taskId, subtasks) {
  return subtasks.map((item) => ({ ...item, parentTaskId: taskId }));
}

function decomposeLargeContext(input, seed, options) {
  const maxChars = Number(options.maxSubtaskChars || input.maxSubtaskChars || 12000);
  const text = String(input.input || input.prompt || input.text || "");
  const chunks = chunkText(text, maxChars);
  const analysis = chunks.slice(0, Number(options.maxSubtasks || input.maxSubtasks || 8)).map((chunk, i) => subtask(seed, i + 1, `Analyze context chunk ${i + 1}/${chunks.length}`, "analysis", { chunkIndex: i, charStart: i * maxChars, charEnd: i * maxChars + chunk.length }, { type: "structured_findings" }));
  const mergeDeps = analysis.map((item) => item.subtaskId);
  const merge = subtask(seed, analysis.length + 1, "Merge chunk findings and detect dropped requirements", "merge", {}, { type: "merged_findings" }, mergeDeps);
  const verify = subtask(seed, analysis.length + 2, "Verify final answer covers original objective", "verification", {}, { type: "verification_checklist" }, [merge.subtaskId]);
  return [...analysis, merge, verify];
}

function decomposeFiles(input, seed, reviewOnly = false) {
  const files = normalizeTaskFiles(input);
  const groups = new Map();
  for (const file of files) {
    const key = topGroup(file);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const inspections = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, groupFiles], i) => subtask(seed, i + 1, `Inspect ${group} module`, "analysis", { files: groupFiles, group }, { type: "structured_findings" }));
  if (reviewOnly) return inspections;
  const plan = subtask(seed, inspections.length + 1, "Create bounded modification plan", "planning", { files }, { type: "action_plan" }, inspections.map((item) => item.subtaskId));
  const execute = subtask(seed, inspections.length + 2, "Execute approved low-risk changes", "execution", { files }, { type: "execution_result" }, [plan.subtaskId]);
  const verify = subtask(seed, inspections.length + 3, "Run verification and summarize risk", "verification", { files }, { type: "verification_checklist" }, [execute.subtaskId]);
  return [...inspections, plan, execute, verify];
}

function decomposeTestRepair(input, seed) {
  const failures = asArray(input.failedTests).length ? asArray(input.failedTests) : asArray(input.errors);
  const groups = failures.length ? failures : [{ name: "unknown failure", errorType: "unknown" }];
  const classify = subtask(seed, 1, "Classify failing tests or errors", "analysis", { failures: groups }, { type: "failure_classification" });
  const repairs = groups.slice(0, 6).map((failure, i) => subtask(seed, i + 2, `Prepare minimal repair for ${failure.name || failure.errorType || `failure ${i + 1}`}`, "planning", { failure }, { type: "repair_plan" }, [classify.subtaskId]));
  const verify = subtask(seed, repairs.length + 2, "Run verification after repair candidates", "verification", {}, { type: "verification_checklist" }, repairs.map((item) => item.subtaskId));
  return [classify, ...repairs, verify];
}

function decomposeDocumentation(input, seed) {
  const sections = asArray(input.sections).length ? asArray(input.sections) : ["overview", "usage", "governance", "acceptance"];
  const drafts = sections.map((section, i) => subtask(seed, i + 1, `Draft documentation section: ${section}`, "documentation", { section }, { type: "markdown_section" }));
  const merge = subtask(seed, drafts.length + 1, "Merge documentation and remove contradictions", "merge", {}, { type: "document" }, drafts.map((item) => item.subtaskId));
  return [...drafts, merge];
}

function decomposeProposals(input, seed) {
  const proposals = asArray(input.proposals);
  const reviews = proposals.map((proposal, i) => subtask(seed, i + 1, `Review proposal ${proposal.id || i + 1}`, "policy_check", { proposalId: proposal.id || null, riskTier: proposal.riskTier || proposal.risk || null }, { type: "policy_decision" }));
  const execute = subtask(seed, reviews.length + 1, "Execute approved proposals through unified executor", "execution", {}, { type: "execution_result" }, reviews.map((item) => item.subtaskId));
  return [...reviews, execute];
}

export function decomposeTask(input = {}, options = {}) {
  const type = inferTaskType({ ...input, ...options });
  const seed = input.taskId || stableId("task_seed", { type, title: input.title, objective: input.objective, files: normalizeTaskFiles(input), textLength: String(input.input || input.prompt || input.text || "").length });
  const taskId = input.taskId || stableId("task", { seed, type });
  const budget = {
    maxSubtasks: Number(input.budget?.maxSubtasks || options.maxSubtasks || 8),
    maxTokensPerSubtask: Number(input.budget?.maxTokensPerSubtask || 80000),
    maxExecutionMs: Number(input.budget?.maxExecutionMs || 300000),
  };
  const scope = input.scope || { files: normalizeTaskFiles(input), allowedDirs: input.allowedDirs || [], forbiddenFiles: input.forbiddenFiles || [".env", "secrets", "credentials"] };
  let subtasks;
  if (type === TASK_TYPES.LARGE_CONTEXT) subtasks = decomposeLargeContext(input, seed, { ...options, maxSubtasks: budget.maxSubtasks });
  else if (type === TASK_TYPES.REPO_MODIFICATION) subtasks = decomposeFiles(input, seed, false);
  else if (type === TASK_TYPES.CODE_REVIEW) subtasks = decomposeFiles(input, seed, true);
  else if (type === TASK_TYPES.TEST_REPAIR) subtasks = decomposeTestRepair(input, seed);
  else if (type === TASK_TYPES.DOCUMENTATION) subtasks = decomposeDocumentation(input, seed);
  else if (type === TASK_TYPES.PROPOSAL_EXECUTION) subtasks = decomposeProposals(input, seed);
  else subtasks = [subtask(seed, 1, "Analyze task", "analysis", {}, { type: "structured_findings" }), subtask(seed, 2, "Verify final result", "verification", {}, { type: "verification_checklist" })];
  subtasks = subtasks.slice(0, Math.max(1, budget.maxSubtasks));
  return {
    schemaVersion: 1,
    taskId,
    type,
    title: input.title || input.objective || type,
    status: "planned",
    riskTier: input.riskTier || "R2",
    budget,
    scope,
    subtasks: withParent(taskId, subtasks),
    createdAt: new Date().toISOString(),
  };
}
