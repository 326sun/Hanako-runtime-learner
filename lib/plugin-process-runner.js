import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHILD_RUNNER = path.join(__dirname, "plugin-process-runner-child.js");
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 128;

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stripDefinition(definition = {}) {
  const copy = cloneJson(definition) || {};
  delete copy.handler;
  delete copy.verifyHandler;
  delete copy.rollbackHandler;
  return copy;
}

function safeWorkspaceRoot(context = {}) {
  // TODO(P1): cwd fallback for plugin child processes should log a warning
  // when no explicit workspaceRoot is supplied.  The directory-exists check
  // below is a good guard, but the scope implicitisation is still worth
  // surfacing in audit.
  const root = context.workspaceRoot || process.cwd();
  const resolved = path.resolve(root);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw new Error("workspaceRoot is not a directory");
  } catch (err) {
    throw new Error(`invalid plugin workspaceRoot: ${resolved} (${err.message})`);
  }
  return resolved;
}

function sanitizedEnv(extraEnv = {}) {
  const env = {
    NODE_ENV: process.env.NODE_ENV || "production",
    HANAKO_PLUGIN_CHILD: "1",
  };
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  if (process.env.WINDIR) env.WINDIR = process.env.WINDIR;
  if (process.env.COMSPEC) env.COMSPEC = process.env.COMSPEC;
  for (const [key, value] of Object.entries(extraEnv || {})) {
    if (/^(PATH|SystemRoot|WINDIR|COMSPEC|NODE_ENV)$/i.test(key)) env[key] = String(value);
  }
  return env;
}

function appendLimited(current, chunk, maxBytes) {
  const next = current + String(chunk || "");
  if (Buffer.byteLength(next, "utf8") <= maxBytes) return { value: next, truncated: false };
  const buffer = Buffer.from(next, "utf8").subarray(0, maxBytes);
  return { value: `${buffer.toString("utf8")}\n[truncated]`, truncated: true };
}

function boundedNumber(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function pluginIsolationConfig(context = {}) {
  const configured = context.pluginIsolation || context.config?.pluginIsolation || {};
  return {
    timeoutMs: boundedNumber(configured.timeoutMs || context.timeout || context.config?.autoActions?.maxExecutionMsPerAction, DEFAULT_TIMEOUT_MS, { min: 100, max: 10 * 60_000 }),
    maxOutputBytes: boundedNumber(configured.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, { min: 1024, max: 10 * 1024 * 1024 }),
    maxOldSpaceSizeMb: boundedNumber(configured.maxOldSpaceSizeMb || configured.maxOldSpaceSizeMB, DEFAULT_MAX_OLD_SPACE_SIZE_MB, { min: 16, max: 4096 }),
    env: configured.env || {},
  };
}

export async function runPluginFunctionInChild({ modulePath, exportName, actionPlan = {}, context = {}, definition = {} } = {}) {
  if (!modulePath) return { status: "failed", error: "plugin modulePath is required", exitCode: null };
  const resolvedModulePath = path.resolve(modulePath);
  if (!fs.existsSync(resolvedModulePath)) return { status: "failed", error: `plugin module not found: ${resolvedModulePath}`, exitCode: null };

  const workspaceRoot = safeWorkspaceRoot(context);
  const config = pluginIsolationConfig(context);
  const started = Date.now();
  const payload = {
    modulePath: resolvedModulePath,
    exportName,
    actionPlan: cloneJson(actionPlan) || {},
    context: {
      ...(cloneJson(context) || {}),
      workspaceRoot,
      pluginProcess: {
        isolated: true,
        cwd: workspaceRoot,
      },
    },
    definition: stripDefinition(definition),
  };

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let childMessage = null;

    const child = fork(CHILD_RUNNER, [], {
      cwd: workspaceRoot,
      env: sanitizedEnv(config.env),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      execArgv: [`--max-old-space-size=${config.maxOldSpaceSizeMb}`],
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        isolated: true,
        pid: child.pid || null,
        cwd: workspaceRoot,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        durationMs: Date.now() - started,
      });
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ status: "failed", error: `plugin module execution timed out after ${config.timeoutMs}ms`, exitCode: null, timedOut: true });
    }, config.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      const next = appendLimited(stdout, chunk, config.maxOutputBytes);
      stdout = next.value;
      stdoutTruncated = stdoutTruncated || next.truncated;
      if (next.truncated) child.kill("SIGKILL");
    });

    child.stderr?.on("data", (chunk) => {
      const next = appendLimited(stderr, chunk, config.maxOutputBytes);
      stderr = next.value;
      stderrTruncated = stderrTruncated || next.truncated;
      if (next.truncated) child.kill("SIGKILL");
    });

    child.on("message", (message) => {
      childMessage = message;
    });

    child.on("error", (err) => {
      finish({ status: "failed", error: err.message, exitCode: null });
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      if (stdoutTruncated || stderrTruncated) {
        finish({ status: "failed", error: "plugin module output exceeded maxOutputBytes", exitCode: code, signal, outputExceeded: true });
        return;
      }
      if (childMessage?.ok) {
        finish({ status: "succeeded", result: childMessage.result, exitCode: code ?? 0, signal });
        return;
      }
      finish({
        status: "failed",
        error: childMessage?.error || `plugin child exited before returning a result${signal ? ` (${signal})` : ""}`,
        stack: childMessage?.stack || null,
        exitCode: code,
        signal,
      });
    });

    child.send(payload, (err) => {
      if (err) finish({ status: "failed", error: err.message, exitCode: null });
    });
  });
}
