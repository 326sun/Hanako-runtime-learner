import { DEFAULT_ALLOWED_COMMANDS } from "./action-types.js";
import { isCommandAllowed as isPolicyCommandAllowed, runSandboxedCommand } from "./command-allowlist.js";
import { validateProjectScriptTrust } from "./project-script-trust.js";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function commandAllowlist(config = {}) {
  return config.autoActionCommands?.allowlist || config.autoActions?.commandAllowlist || DEFAULT_ALLOWED_COMMANDS;
}

function denylist(config = {}) {
  return config.autoActionCommands?.denylist || ["rm", "del", "git push", "git tag", "npm publish"];
}

function buildCommandPolicy(config = {}) {
  const commands = config.autoActionCommands || {};
  return {
    commands: {
      ...commands,
      allowlist: commandAllowlist(config),
      denylist: denylist(config),
      allowProjectScripts: commands.allowProjectScripts === true,
    },
  };
}

export function isAllowedCommand(command, config = {}, { cwd = process.cwd() } = {}) {
  const policy = buildCommandPolicy(config);
  const allowed = isPolicyCommandAllowed(command, policy);
  if (!allowed.allowed) return false;
  return validateProjectScriptTrust(command, { cwd, policy }).ok;
}

export async function runAllowedCommand(command, { cwd, timeout, config, learnerDir = null } = {}) {
  const policy = buildCommandPolicy(config);
  const result = await runSandboxedCommand(command, { cwd, timeout, policy, maxOutputBytes: 1024 * 1024, learnerDir });
  return result.status === "rejected" ? { ...result, status: "failed" } : result;
}

function verificationCommands(actionPlan = {}) {
  const plan = actionPlan.plan || {};
  const verification = actionPlan.verification || plan.verification || {};
  return normalizeArray(plan.verifyCommands || verification.commands || verification.verifyCommands);
}

export async function runVerificationCommands(actionPlan, { workspaceRoot, config }) {
  const commands = verificationCommands(actionPlan);
  const timeout = Number(config.autoActions?.maxExecutionMsPerAction || 30000);
  const commandResults = [];
  for (const command of commands) {
    const result = await runAllowedCommand(command, { cwd: workspaceRoot, timeout, config });
    commandResults.push({ command, ...result });
  }
  return commandResults;
}

export function commandResultsPassed(commandResults = []) {
  return commandResults.every((item) => item.status === "succeeded" && item.exitCode === 0);
}
