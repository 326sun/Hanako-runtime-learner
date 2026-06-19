import fs from "fs";
import path from "path";
import { spawn } from "node:child_process";
import { isProjectScriptCommand, validateProjectScriptTrust } from "./project-script-trust.js";
import { appendEvent } from "./event-log.js";

/**
 * command-allowlist.js
 *
 * v4.0.1 LTS hardening — Command execution with allowlist/denylist enforcement.
 *
 * The denylist is intentionally token/segment aware. A plain substring check would
 * reject safe commands such as `node --check lib/formatter.js` because "formatter"
 * contains "rm". Dangerous shell verbs must appear as command tokens, or as an
 * explicitly denied multi-token command such as `git push`.
 */

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DENYLIST_PATTERN_CACHE = new Map();
const MAX_DENYLIST_PATTERN_CACHE = 64;
const NPM_CLI_CACHE = new Map();

function normalizeCommand(command) {
  return String(command || "").trim();
}

function hasUnsafeShellSyntax(command) {
  // runSandboxedCommand uses spawn(..., shell:false), so even allowlisted
  // commands must be single commands rather than shell programs. Reject compound
  // operators, redirection, command substitution, variable expansion, and
  // newlines before allowlist matching. Quotes are still allowed for paths.
  // `#` is included because in bash/sh it starts a comment, truncating the
  // rest of the command — an attacker could use it to hide a malicious suffix
  // (e.g. "allowed-cmd --safe-arg #; rm -rf /").
  return /[;&|<>$`#!\n\r]/.test(String(command || ""));
}

function parseCommandLine(command) {
  const input = normalizeCommand(command);
  const args = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (quote) return { ok: false, error: "unterminated quoted argument", args: [] };
  if (current) args.push(current);
  return { ok: true, args };
}

function deniedByDangerousRuntimeFlag(command) {
  const parsed = parseCommandLine(command);
  if (!parsed.ok) return parsed.error;
  const [bin, ...args] = parsed.args;
  const executable = String(bin || "").toLowerCase().replace(/\.(exe|cmd|bat)$/i, "");
  if (executable !== "node") return null;
  const dangerous = new Set(["-e", "--eval", "-p", "--print", "-r", "--require", "--import", "--loader", "--experimental-loader"]);
  for (const arg of args) {
    const flag = String(arg || "").split("=")[0];
    if (dangerous.has(flag)) return `dangerous runtime flag is not allowed: ${flag}`;
  }
  return null;
}

function splitShellSegments(command) {
  return normalizeCommand(command)
    .split(/\s*(?:&&|\|\||;|\|)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function deniedByBuiltinPattern(command) {
  const normalized = normalizeCommand(command);
  const segments = splitShellSegments(normalized);

  const dangerousVerbs = new Set(["rm", "rmdir", "del"]);
  for (const segment of segments) {
    // Strip a Windows executable extension so `rm.exe` / `del.cmd` cannot slip
    // past the verb denylist (mirrors deniedByDangerousRuntimeFlag).
    const first = segment.split(/\s+/)[0]?.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, "");
    if (dangerousVerbs.has(first)) return `command starts with denied verb: ${first}`;
    if (/^git\s+(push|tag)\b/i.test(segment)) return "git push/tag is denied";
    if (/^npm\s+publish\b/i.test(segment)) return "npm publish is denied";
    if (/^curl\b.*\b-X\s*(POST|PUT|PATCH|DELETE)\b/i.test(segment)) return "external mutating curl request is denied";
    if (/^wget\b/i.test(segment)) return "wget is denied";
  }

  return null;
}

function deniedByConfiguredPattern(command, denylist = []) {
  const normalized = normalizeCommand(command).toLowerCase();
  const segments = splitShellSegments(normalized);

  for (const entry of compiledDenylistPatterns(denylist)) {
    if (segments.some((segment) => entry.re.test(segment))) {
      return entry.multi
        ? `command matches denylist entry: ${entry.raw}`
        : `command contains denied token: ${entry.raw}`;
    }
  }

  return null;
}

function compiledDenylistPatterns(denylist = []) {
  const entries = [];
  const keyParts = [];
  for (const raw of denylist || []) {
    const denied = String(raw || "").trim().toLowerCase();
    if (!denied) continue;
    keyParts.push(denied);
    entries.push({ raw, denied, multi: /\s/.test(denied) });
  }
  const cacheKey = keyParts.join("\n");
  const cached = DENYLIST_PATTERN_CACHE.get(cacheKey);
  if (cached) return cached;

  const compiled = entries.map((entry) => ({
    raw: entry.raw,
    multi: entry.multi,
    re: entry.multi
      ? new RegExp(`^${escapeRegExp(entry.denied)}(?:\\s|$)`, "i")
      : new RegExp(`(^|\\s)${escapeRegExp(entry.denied)}(?=$|\\s)`, "i"),
  }));
  if (DENYLIST_PATTERN_CACHE.size >= MAX_DENYLIST_PATTERN_CACHE) DENYLIST_PATTERN_CACHE.clear();
  DENYLIST_PATTERN_CACHE.set(cacheKey, compiled);
  return compiled;
}

function npmCliPath(name) {
  const key = `${process.execPath}\0${name}`;
  if (NPM_CLI_CACHE.has(key)) return NPM_CLI_CACHE.get(key);
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", `${name}-cli.js`);
  const resolved = fs.existsSync(cli) ? cli : null;
  NPM_CLI_CACHE.set(key, resolved);
  return resolved;
}

/**
 * 检查命令是否在允许列表中。
 */
export function isCommandAllowed(command, policy = {}) {
  const normalized = normalizeCommand(command);
  if (!normalized) return { allowed: false, reason: "empty command" };

  if (hasUnsafeShellSyntax(normalized)) {
    return { allowed: false, reason: "unsafe shell syntax is not allowed" };
  }

  const builtinDenied = deniedByBuiltinPattern(normalized);
  if (builtinDenied) return { allowed: false, reason: builtinDenied };

  const dangerousFlag = deniedByDangerousRuntimeFlag(normalized);
  if (dangerousFlag) return { allowed: false, reason: dangerousFlag };

  const configuredDenied = deniedByConfiguredPattern(normalized, policy?.commands?.denylist || []);
  if (configuredDenied) return { allowed: false, reason: configuredDenied };

  if (isProjectScriptCommand(normalized) && policy?.commands?.allowProjectScripts !== true) {
    return { allowed: false, reason: "project npm scripts require explicit project-script permission" };
  }

  const allowlist = policy?.commands?.allowlist || [];
  for (const allowed of allowlist) {
    const allowedCommand = String(allowed || "").trim();
    if (!allowedCommand) continue;
    if (normalized === allowedCommand || normalized.startsWith(`${allowedCommand} `)) {
      return { allowed: true, reason: "command in allowlist" };
    }
  }

  return { allowed: false, reason: "command not in allowlist" };
}

/**
 * 在沙箱中执行命令。
 */
export async function runSandboxedCommand(command, {
  cwd,
  policy,
  timeout = 30000,
  maxOutputBytes = 10 * 1024 * 1024,
  learnerDir = null,
} = {}) {
  const check = isCommandAllowed(command, policy);
  if (!check.allowed) {
    return {
      status: "rejected",
      command,
      error: check.reason,
      stdout: "",
      stderr: "",
      exitCode: null,
    };
  }

  const trust = validateProjectScriptTrust(command, { cwd, policy });
  if (!trust.ok) {
    if (learnerDir && trust.projectScript) {
      try {
        appendEvent(learnerDir, {
          type: "trust.project_script_rejected",
          entityType: "command",
          entityId: trust.scriptName || command,
          summary: `Project script rejected: ${command} (${trust.reason})`,
          data: { command, cwd, scriptName: trust.scriptName, scriptsHash: trust.scriptsHash, reason: trust.reason, decision: trust.decision },
        });
      } catch {}
    }
    return {
      status: trust.decision === "manual_confirm" ? "manual_confirm" : "rejected",
      command,
      error: trust.reason,
      stdout: "",
      stderr: "",
      exitCode: null,
      trust: { projectScript: true, scriptName: trust.scriptName, scriptsHash: trust.scriptsHash, packageJsonPath: trust.packageJsonPath },
    };
  }

  if (learnerDir && trust.projectScript) {
    try {
      appendEvent(learnerDir, {
        type: "trust.project_script_executed",
        entityType: "command",
        entityId: trust.scriptName || command,
        summary: `Project script executed with trusted hash: ${command}`,
        data: { command, cwd, scriptName: trust.scriptName, scriptsHash: trust.scriptsHash, packageJsonPath: trust.packageJsonPath },
      });
    } catch {}
  }

  const parsed = parseCommandLine(command);
  if (!parsed.ok || parsed.args.length === 0) {
    return { status: "rejected", command, error: parsed.error || "empty command", stdout: "", stderr: "", exitCode: null };
  }
  const [rawFile, ...rawArgs] = parsed.args;
  let file = rawFile;
  let args = rawArgs;
  if (process.platform === "win32") {
    const lower = rawFile.toLowerCase();
    if (lower === "npm" || lower === "npx") {
      const cli = npmCliPath(lower);
      if (cli) {
        file = process.execPath;
        args = [cli, ...rawArgs];
      }
    }
  }

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { cwd, windowsHide: true, shell: false });
    } catch (err) {
      resolve({ status: "failed", command, stdout: "", stderr: "", exitCode: 1, error: err.message });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = timeout > 0 ? setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      resolve({ status: "failed", command, stdout, stderr, exitCode: null, error: `command timed out after ${timeout}ms` });
    }, timeout) : null;

    const append = (which, chunk) => {
      if (settled) return;
      const text = chunk.toString();
      if (which === "stdout") stdout += text;
      else stderr += text;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxOutputBytes) {
        settled = true;
        if (timer) clearTimeout(timer);
        try { child.kill("SIGKILL"); } catch {}
        resolve({ status: "failed", command, stdout, stderr, exitCode: null, error: `command output exceeded ${maxOutputBytes} bytes` });
      }
    };

    child.stdout?.on("data", (chunk) => append("stdout", chunk));
    child.stderr?.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status: "failed", command, stdout, stderr, exitCode: 1, error: err.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status: code === 0 ? "succeeded" : "failed", command, stdout, stderr, exitCode: typeof code === "number" ? code : 1, error: code === 0 ? null : `command exited with code ${code}` });
    });
  });
}
