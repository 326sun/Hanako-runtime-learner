import path from "path";
import { runAllowedCommand } from "./action-executor.js";
import { validateCrossProjectCandidate } from "./cross-project-scope.js";
import {
  loadTransferCandidateRecord,
  recordTransferValidation,
  registerTransferCandidate,
  summarizeTransferCandidate,
  TRANSFER_STATUSES,
} from "./transfer-registry.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function commandConfig(config = {}, commands = []) {
  const declared = unique(commands);
  return {
    ...config,
    autoActionCommands: {
      ...(config.autoActionCommands || {}),
      allowlist: unique([...(config.autoActionCommands?.allowlist || []), ...declared]),
      denylist: unique([...(config.autoActionCommands?.denylist || []), "rm", "del", "git push", "git tag", "npm publish", "curl", "wget"]),
      allowProjectScripts: true,
    },
  };
}

function compact(text, maxChars = 600) {
  const raw = String(text || "");
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, Math.floor(maxChars * 0.65))}\n[...truncated ${raw.length - maxChars} chars...]\n${raw.slice(-Math.floor(maxChars * 0.25))}`;
}

function commandEvidence(result = {}) {
  return [
    `command=${result.command}`,
    `status=${result.status}`,
    `exitCode=${result.exitCode}`,
    result.stdout ? `stdout=${compact(result.stdout)}` : null,
    result.stderr ? `stderr=${compact(result.stderr)}` : null,
    result.error ? `error=${compact(result.error)}` : null,
  ].filter(Boolean);
}

function ensureRegisteredCandidate(registryBaseDir, candidate, decision, targetProfile) {
  const existing = loadTransferCandidateRecord(registryBaseDir, candidate.id);
  if (existing) return existing;
  const registered = registerTransferCandidate(registryBaseDir, candidate, {
    decision,
    validationOptions: { targetProfile },
  });
  return registered.record;
}

export async function runTransferCandidateValidation(candidate = {}, options = {}) {
  const registryBaseDir = path.resolve(options.registryBaseDir || path.join(options.workspaceRoot || process.cwd(), ".hanako"));
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const targetProfile = options.targetProfile || {};
  const decision = validateCrossProjectCandidate(candidate, { targetProfile, targetPolicy: options.targetPolicy || {} });
  const record = ensureRegisteredCandidate(registryBaseDir, candidate, decision, targetProfile);

  if (decision.decision === "reject") {
    return { ok: false, status: "rejected", decision, record: summarizeTransferCandidate(record), commandResults: [] };
  }
  if (decision.decision === "manual_confirm") {
    return { ok: false, status: "manual_confirm", decision, record: summarizeTransferCandidate(record), commandResults: [] };
  }

  const commands = unique(candidate.validation?.commands || record.validation?.commands || []);
  const config = commandConfig(options.config || {}, commands);
  const timeout = Number(options.timeout || config.autoActions?.maxExecutionMsPerAction || 30000);
  const commandResults = [];
  for (const command of commands) {
    const result = await runAllowedCommand(command, { cwd: workspaceRoot, timeout, config });
    commandResults.push({ command, ...result });
    if (result.status !== "succeeded" || result.exitCode !== 0) break;
  }

  const passed = commands.length > 0 && commandResults.length === commands.length && commandResults.every((item) => item.status === "succeeded" && item.exitCode === 0);
  const recorded = recordTransferValidation(registryBaseDir, candidate.id, {
    status: passed ? "passed" : "failed",
    summary: passed ? "target validation commands passed" : "target validation commands failed",
    commands,
    evidence: commandResults.flatMap(commandEvidence),
    verifier: "transfer_validation_runner",
  });

  return {
    ok: passed,
    status: passed ? TRANSFER_STATUSES.VALIDATED : TRANSFER_STATUSES.VALIDATION_FAILED,
    decision,
    commands,
    commandResults,
    record: summarizeTransferCandidate(recorded.record),
  };
}

export function summarizeTransferValidationReadiness(candidate = {}, options = {}) {
  const decision = validateCrossProjectCandidate(candidate, { targetProfile: options.targetProfile || {}, targetPolicy: options.targetPolicy || {} });
  const commands = asArray(candidate.validation?.commands);
  return {
    ok: decision.ok && commands.length > 0,
    decision: decision.decision,
    commands,
    reason: decision.reason,
    violations: decision.violations,
  };
}
