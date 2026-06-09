const NON_RETRYABLE = new Set([
  "permission_denied",
  "command_not_found",
  "syntax_error",
  "path_error",
  "auth_error",
  "file_not_found",
]);

const REPAIR_LIBRARY = {
  file_not_found: {
    retry: false,
    reason: "file_not_found is non-retryable without locating the target first",
    repairPlan: [
      "Do not retry the same read/write path blindly.",
      "Search the parent directory or workspace for a similar filename.",
      "If the file was provided by the user, ask them to re-upload or confirm the path.",
    ],
    suggestedTools: ["find", "grep", "ls"],
  },
  path_error: {
    retry: false,
    reason: "path_error requires path verification before retry",
    repairPlan: [
      "Verify the parent directory exists before re-running the command.",
      "Normalize quoting, slashes, and spaces in the path.",
      "Use a directory listing or search to locate the intended target.",
    ],
    suggestedTools: ["ls", "find"],
  },
  permission_denied: {
    retry: false,
    reason: "permission_denied will not be fixed by repeating the same operation",
    repairPlan: [
      "Do not retry the same write/delete command.",
      "Check whether the target is outside the allowed workspace or requires elevated permissions.",
      "Ask the user for access or choose a writable output path.",
    ],
    suggestedTools: ["ls"],
  },
  command_not_found: {
    retry: false,
    reason: "command_not_found requires an available alternative",
    repairPlan: [
      "Do not retry the same unavailable command.",
      "Check package.json scripts or use a built-in Node/Python alternative.",
      "If the command is essential, tell the user what dependency is missing.",
    ],
    suggestedTools: ["bash", "node"],
  },
  syntax_error: {
    retry: false,
    reason: "syntax_error requires editing the command or code before retry",
    repairPlan: [
      "Fix quoting, escaping, parentheses, or JSON syntax before re-running.",
      "Prefer writing complex scripts to a temporary file instead of one-line shell quoting.",
      "Run a syntax-only check when available.",
    ],
    suggestedTools: ["node", "bash"],
  },
  auth_error: {
    retry: false,
    reason: "auth_error requires credential or provider configuration changes",
    repairPlan: [
      "Do not retry until credentials or provider configuration are fixed.",
      "Check whether the API key, token, or provider setting is missing/expired.",
      "Ask the user to update credentials if needed; never print secrets.",
    ],
    suggestedTools: [],
  },
  network_error: {
    retry: true,
    reason: "network_error may be transient",
    repairPlan: [
      "Retry once after a brief wait with backoff.",
      "If it persists, check proxy, provider status, or reduce request size.",
    ],
    suggestedTools: [],
  },
  model_error: {
    retry: true,
    reason: "model_error may be fixed by reducing request size or splitting work",
    repairPlan: [
      "Compact the prompt or retrieve narrower context before retrying.",
      "Split large jobs into smaller steps.",
    ],
    suggestedTools: ["self_learning_search"],
  },
  tool_error: {
    retry: false,
    reason: "tool_error needs root-cause inspection before retry",
    repairPlan: [
      "Inspect the exact error message first.",
      "Change one variable before retrying; do not loop the identical call.",
    ],
    suggestedTools: [],
  },
  unknown: {
    retry: false,
    reason: "unknown error should be inspected before retry",
    repairPlan: [
      "Do not blindly retry the identical operation.",
      "Read the error message and choose a narrower diagnostic step.",
    ],
    suggestedTools: [],
  },
};

export function shouldRetryToolCall(errorType) {
  const type = String(errorType || "unknown");
  if (NON_RETRYABLE.has(type)) return false;
  return !!(REPAIR_LIBRARY[type]?.retry);
}

export function suggestToolRepair(error = {}, context = {}) {
  const type = String(error.errorType || error.type || "unknown");
  const base = REPAIR_LIBRARY[type] || REPAIR_LIBRARY.unknown;
  return {
    errorType: type,
    retry: shouldRetryToolCall(type),
    reason: base.reason,
    repairPlan: [...base.repairPlan],
    suggestedTools: [...base.suggestedTools],
    context: {
      tool: error.tool || context.tool || null,
      taskType: error.taskType || context.taskType || null,
    },
  };
}

export function buildRepairHint(error = {}, context = {}) {
  const repair = suggestToolRepair(error, context);
  return `${repair.reason}. ${repair.repairPlan.join(" ")}`;
}
