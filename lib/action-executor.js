import fs from "fs";
import path from "path";
import { ACTION_TYPES } from "./action-types.js";
import {
  createActionTransaction,
  commitActionTransaction,
  rollbackActionTransaction,
  changedTransactionFiles,
} from "./action-transaction.js";
import { applyPatchSet, applyWritesAndPatches } from "./action-patcher.js";
import { commandResultsPassed, isAllowedCommand, runAllowedCommand, runVerificationCommands } from "./action-command-runner.js";
import { previewAndGate, SCOPE_DECISION } from "./scope-gate.js";
import { decomposeTask } from "./task-decomposer.js";
import { executeRuntimeRegisteredAction, resolveRuntimeAction } from "./action-registry-runtime.js";
import { classifyError } from "./repair-classifier.js";
import { attemptOneRepair } from "./repair-strategies.js";

function actionTypeOf(actionPlan = {}) {
  return actionPlan.plan?.actionType || actionPlan.actionType || "";
}

// ── Inlined from action-verifier.js ──

function verifyActionResult(actionPlan = {}, result = {}, context = {}) {
  const pass = (type, msg = "") => ({ type, passed: true, message: msg });
  const fail = (type, msg = "") => ({ type, passed: false, message: msg });
  const checks = [];
  checks.push(result.status === "succeeded" ? pass("result_status", result.status) : fail("result_status", result.error || result.status || "execution failed"));
  const actionType = actionPlan.plan?.actionType || actionPlan.actionType || "";
  const verification = actionPlan.verification || actionPlan.plan?.verification || {};
  const configuredMetrics = Array.isArray(verification.metrics) ? verification.metrics : [];
  const metrics = [...configuredMetrics];
  if (actionType === ACTION_TYPES.APPLY_PATCH_SANDBOXED && !metrics.includes("patch_applied")) metrics.push("patch_applied");
  if (metrics.includes("success")) checks.push(result.status === "succeeded" ? pass("success") : fail("success"));
  if (metrics.includes("diagnosisGenerated")) checks.push(result.diagnosis ? pass("diagnosisGenerated") : fail("diagnosisGenerated"));
  if (metrics.includes("candidateCount")) checks.push(Number.isFinite(result.candidateCount) ? pass("candidateCount", String(result.candidateCount)) : fail("candidateCount"));
  if (metrics.includes("uniqueCandidate")) checks.push(result.candidateCount === 1 ? pass("uniqueCandidate") : fail("uniqueCandidate"));
  if (metrics.includes("retryCount")) checks.push((result.retryCount || 0) <= 1 ? pass("retryCount") : fail("retryCount"));
  if (metrics.includes("test_pass")) checks.push(result.exitCode === 0 ? pass("test_pass") : fail("test_pass", `exitCode=${result.exitCode}`));
  if (metrics.includes("lint_pass")) checks.push(result.exitCode === 0 ? pass("lint_pass") : fail("lint_pass", `exitCode=${result.exitCode}`));
  if (metrics.includes("fileExists")) {
    const target = result.path || actionPlan.plan?.path;
    checks.push(target && fs.existsSync(path.resolve(context.workspaceRoot || process.cwd(), target)) ? pass("fileExists") : fail("fileExists"));
  }
  if (metrics.includes("diff_scope")) {
    const changed = result.changedFiles || [];
    const max = Number(context.config?.autoActions?.maxChangedFilesPerAction || 8);
    checks.push(changed.length <= max ? pass("diff_scope", `${changed.length}/${max}`) : fail("diff_scope", `${changed.length}/${max}`));
  }
  if (metrics.includes("patch_applied")) {
    const appliedPatches = result.applied?.patchResults || [];
    const appliedWrites = result.applied?.writeResults || [];
    checks.push(result.status === "succeeded" && appliedPatches.length + appliedWrites.length > 0 ? pass("patch_applied", `${appliedPatches.length} patches, ${appliedWrites.length} writes`) : fail("patch_applied"));
  }
  if (metrics.includes("verification_commands_pass")) {
    const commands = result.verificationCommandResults || [];
    const failedCommands = commands.filter((item) => item.status !== "succeeded" || item.exitCode !== 0);
    checks.push(commands.length > 0 && failedCommands.length === 0 ? pass("verification_commands_pass", `${commands.length} command(s)`) : fail("verification_commands_pass", `${failedCommands.length}/${commands.length}`));
  }
  if (metrics.includes("rollback_clean")) {
    const changed = result.rollback?.changedFiles || [];
    checks.push(result.rollback?.ok && changed.length === 0 ? pass("rollback_clean") : fail("rollback_clean"));
  }
  const failed = checks.filter((c) => !c.passed);
  return { verified: failed.length === 0, checks, confidence: failed.length === 0 ? 0.86 : 0.35 };
}

// ── Inlined from action-repair-runner.js ──

function getRepairPlan(actionPlan = {}) {
  return actionPlan.repairPlan || actionPlan.plan?.repairPlan || null;
}

async function attemptRepairOnce(txn, actionPlan, { workspaceRoot, config, failedResult = null }) {
  const repairPlan = getRepairPlan(actionPlan);
  const explicitFilePatches = normalizeArray(repairPlan?.filePatches || repairPlan?.patches);
  const explicitFileWrites = normalizeArray(repairPlan?.fileWrites);

  let filePatches = explicitFilePatches;
  let fileWrites = explicitFileWrites;

  if (filePatches.length === 0 && fileWrites.length === 0 && failedResult) {
    const errorClassification = classifyError(failedResult);
    if (errorClassification.canAutoRepair) {
      const repairContext = {
        workspaceRoot,
        targetFile: errorClassification.fixTarget,
        target: errorClassification.fixTarget,
      };
      const repairStrategy = await attemptOneRepair(errorClassification, repairContext);
      if (repairStrategy.ok && repairStrategy.patch?.type === "patch") {
        filePatches = normalizeArray(repairStrategy.patch.filePatches);
        fileWrites = normalizeArray(repairStrategy.patch.fileWrites);
      }
    }
  }

  if (filePatches.length === 0 && fileWrites.length === 0) return { attempted: false, reason: "no repair patches or writes" };
  let applied = { writeResults: [], patchResults: [] };
  try {
    applied = applyPatchSet(txn, { fileWrites, filePatches });
    const commandResults = await runVerificationCommands(actionPlan, { workspaceRoot, config });
    return { attempted: true, ok: commandResultsPassed(commandResults), ...applied, commandResults };
  } catch (err) {
    return { attempted: true, ok: false, error: err.message, ...applied };
  }
}

function findSimilarFiles(workspaceRoot, targetName, limit = 20) {
  const hits = [];
  const needle = String(targetName || "").toLowerCase();
  function walk(dir, depth = 0) {
    if (hits.length >= limit || depth > 4) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (hits.length >= limit) break;
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (!needle || entry.name.toLowerCase().includes(needle) || needle.includes(entry.name.toLowerCase())) hits.push(path.relative(workspaceRoot, full));
    }
  }
  walk(workspaceRoot);
  return hits;
}

function compactText(text, maxChars = 4000) {
  const raw = String(text || "");
  if (raw.length <= maxChars) return raw;
  const head = raw.slice(0, Math.floor(maxChars * 0.55));
  const tail = raw.slice(-Math.floor(maxChars * 0.35));
  return `${head}\n\n[... compacted ${raw.length - head.length - tail.length} chars ...]\n\n${tail}`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function patchPaths(actionPlan = {}) {
  const plan = actionPlan.plan || {};
  const writes = normalizeArray(plan.fileWrites).map((w) => w.path);
  const patches = normalizeArray(plan.filePatches || plan.patches).map((p) => p.path);
  const repairPatches = normalizeArray(actionPlan.repairPlan?.filePatches || plan.repairPlan?.filePatches).map((p) => p.path);
  return [...new Set([...writes, ...patches, ...repairPatches].filter(Boolean))];
}

function actionNeedsExplicitWorkspaceRoot(actionType) {
  return [
    ACTION_TYPES.APPLY_PATCH_SANDBOXED,
    ACTION_TYPES.EXECUTE_REPAIR_ONCE,
    ACTION_TYPES.RUN_TESTS,
    ACTION_TYPES.RUN_LINT,
    ACTION_TYPES.LOCATE_MISSING_FILE,
  ].includes(actionType);
}

export async function executeActionPlan(actionPlan = {}, context = {}) {
  const started = Date.now();
  const actionType = actionTypeOf(actionPlan);
  const config = context.config || {};
  const workspaceRootImplicit = !context.workspaceRoot;
  const workspaceRoot = path.resolve(context.workspaceRoot || process.cwd());
  let result = { actionId: actionPlan.id || null, actionType, status: "failed", logs: [], artifacts: [], errors: [], warnings: [] };
  if (workspaceRootImplicit && actionNeedsExplicitWorkspaceRoot(actionType)) {
    result.warnings.push(`workspaceRoot not supplied; using process.cwd(): ${workspaceRoot}`);
  }
  let transaction = null;
  try {
    const registryResolution = resolveRuntimeAction(actionPlan, context, { requireAutoExecutable: true });
    if (registryResolution.executeViaRegistry) {
      const registered = await executeRuntimeRegisteredAction(actionPlan, context, { requireAutoExecutable: true });
      result = {
        ...result,
        status: registered.status,
        actionType: registered.actionType || actionType,
        registry: registered.registry,
        registryRuntime: registered.registryRuntime,
        output: registered.output,
        pluginProcess: registered.pluginProcess,
        error: registered.error,
        verification: registered.verification,
        rollback: registered.rollback,
        durationMs: registered.durationMs,
      };
    } else if (actionType === ACTION_TYPES.NO_RETRY_DIAGNOSE) {
      result = { ...result, status: "succeeded", diagnosis: actionPlan.reason || actionPlan.trigger?.reason || "No retry is recommended without changing the failing condition." };
    } else if (actionType === ACTION_TYPES.RETRY_WITH_BACKOFF) {
      const retry = typeof context.retry === "function" ? await context.retry(actionPlan) : { ok: true, simulated: true };
      result = { ...result, status: retry?.ok === false ? "failed" : "succeeded", retryCount: 1, retryResult: retry };
    } else if (actionType === ACTION_TYPES.LOCATE_MISSING_FILE) {
      const target = actionPlan.plan?.target || actionPlan.trigger?.evidence?.path || "";
      const targetName = path.basename(target || "");
      const candidates = findSimilarFiles(workspaceRoot, targetName || "", 20);
      result = { ...result, status: "succeeded", candidates, candidateCount: candidates.length, path: candidates.length === 1 ? candidates[0] : null };
    } else if (actionType === ACTION_TYPES.REDUCE_PROMPT || actionType === ACTION_TYPES.SPLIT_CONTEXT) {
      const input = actionPlan.plan?.input || context.input || context.prompt || "";
      const compacted = compactText(input, Number(config.autoActions?.maxCompactedChars || 4000));
      const task = actionType === ACTION_TYPES.SPLIT_CONTEXT
        ? decomposeTask({ type: "large_context", title: actionPlan.title || "Split large context", input, riskTier: actionPlan.riskTier || "R2", scope: context.taskScope || {} }, { maxSubtasks: config.taskRuntime?.maxSubtasks || 8, maxSubtaskChars: config.taskRuntime?.maxSubtaskChars || config.autoActions?.maxCompactedChars || 4000 })
        : null;
      result = { ...result, status: "succeeded", artifact: { kind: actionType, content: compacted, task }, before: { chars: String(input).length }, after: { chars: compacted.length, subtasks: task?.subtasks?.length || 0 } };
    } else if (actionType === ACTION_TYPES.RUN_TESTS || actionType === ACTION_TYPES.RUN_LINT) {
      const command = actionPlan.plan?.command || (actionType === ACTION_TYPES.RUN_TESTS ? "npm test" : "npm run check");
      const commandResult = await runAllowedCommand(command, { cwd: workspaceRoot, timeout: Number(config.autoActions?.maxExecutionMsPerAction || 30000), config, learnerDir: context.learnerDir });
      result = { ...result, ...commandResult, command };
    } else if (actionType === ACTION_TYPES.APPLY_PATCH_SANDBOXED || actionType === ACTION_TYPES.EXECUTE_REPAIR_ONCE) {
      // v2.3: Scope Gate — all R2+ write actions must pass diff preview + scope gate before execution
      const syntheticProposal = {
        id: actionPlan.id || "action:synthetic",
        type: "code_patch",
        patch: {
          filePatches: actionPlan.plan?.filePatches || actionPlan.plan?.patches || [],
          fileWrites: actionPlan.plan?.fileWrites || [],
        },
      };
      const gateContext = {
        workspaceRoot,
        taskScope: context.taskScope || config.taskScope || null,
        config,
      };
      const gateResult = previewAndGate(syntheticProposal, gateContext);
      if (!gateResult.ok || gateResult.decision === SCOPE_DECISION.REJECT) {
        result = {
          ...result,
          status: "rejected",
          error: `scope gate rejected: ${gateResult.scopeGate?.reason?.join("; ") || "unknown"}`,
          scopeGate: gateResult.scopeGate,
          diffPreview: gateResult.diffPreview,
        };
      } else if (gateResult.decision === SCOPE_DECISION.MANUAL_CONFIRM) {
        result = {
          ...result,
          status: "queued",
          error: `scope gate requires manual confirm: ${gateResult.scopeGate?.reason?.join("; ") || "unknown"}`,
          scopeGate: gateResult.scopeGate,
          diffPreview: gateResult.diffPreview,
        };
      } else {
        const trackedPaths = patchPaths(actionPlan);
        transaction = createActionTransaction({ learnerDir: context.learnerDir, workspaceRoot, actionId: actionPlan.id, filePaths: trackedPaths });
        const applied = applyWritesAndPatches(transaction, actionPlan);
        const committed = commitActionTransaction(transaction);
        const commandResults = await runVerificationCommands(actionPlan, { workspaceRoot, config });
        const commandsOk = commandResultsPassed(commandResults);
        result = {
          ...result,
          status: commandsOk ? "succeeded" : "failed",
          transactionId: transaction.transactionId,
          changedFiles: committed.changedFiles,
          applied,
          verificationCommandResults: commandResults,
          error: commandsOk ? undefined : "verification command failed",
        };
      }
    } else if (actionType === ACTION_TYPES.UPDATE_FEEDBACK_WEIGHT || actionType === ACTION_TYPES.GENERATE_REPAIR_PLAN || actionType === ACTION_TYPES.CREATE_SKILL_CANDIDATE) {
      result = { ...result, status: "succeeded", note: `${actionType} completed as a structured internal action` };
    } else {
      result = { ...result, status: "failed", error: `unsupported executable action type: ${actionType}` };
    }
  } catch (err) {
    if (transaction) rollbackActionTransaction(transaction);
    result = { ...result, status: "failed", error: err.message };
  }
  result.durationMs = Date.now() - started;
  let verification = result.registry ? (result.verification || verifyActionResult(actionPlan, result, context)) : verifyActionResult(actionPlan, result, context);
  result.verification = verification;

  const repairEnabled = config.autoActions?.autoRepairEnabled !== false;
  if (!verification.verified && transaction && repairEnabled) {
    const failedResult = result.verificationCommandResults?.find((r) => r.status === "failed") || { error: result.error };
    const repair = await attemptRepairOnce(transaction, actionPlan, { workspaceRoot, config, failedResult });
    result.repair = repair;
    if (repair.attempted && repair.ok) {
      result.status = "succeeded";
      result.error = undefined;
      result.changedFiles = changedTransactionFiles(transaction);
      result.verificationCommandResults = repair.commandResults || result.verificationCommandResults || [];
      verification = verifyActionResult(actionPlan, result, context);
      result.verification = verification;
    }
  }

  if (!result.verification?.verified && transaction) {
    const rollback = rollbackActionTransaction(transaction);
    result.status = "reverted";
    result.rollback = rollback;
    result.changedFiles = rollback.changedFiles || [];
  }
  return result;
}

export { isAllowedCommand, runAllowedCommand };
