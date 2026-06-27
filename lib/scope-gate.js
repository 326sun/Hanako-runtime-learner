import {
  buildDiffPreview,
  normalizePath,
  pathEscapesWorkspace,
  SECURITY_CRITICAL_FILES,
} from "./scope-diff-preview.js";

/**
 * scope-gate.js
 *
 * 执行前的边界检查：
 * - 要改哪里？（Diff Preview）—— 见 scope-diff-preview.js
 * - 为什么可以改？（Scope 判断）
 * - 有没有越界？（Gate 决策）
 */

/**
 * 强制要求人工确认的文件
 */
const MANDATORY_MANUAL_CONFIRM_FILES = [
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "jsconfig.json",
  ".babelrc",
  ".eslintrc",
  ".eslintrc.json",
  ".prettierrc",
  "webpack.config",
  "vite.config",
];

/**
 * 强制禁止的文件（除非人工确认）
 */
const FORBIDDEN_WITHOUT_CONFIRM = [
  ".git",
  ".github/workflows",
  "Dockerfile",
  "docker-compose",
];

/**
 * Scope Gate 决策
 */
export const SCOPE_DECISION = {
  ALLOW: "allow",
  MANUAL_CONFIRM: "manual_confirm",
  REJECT: "reject",
};

/**
 * 默认任务范围
 */
export function defaultTaskScope(config = {}) {
  return {
    allowedFiles: config.allowedFiles || [],
    allowedDirs: config.allowedDirs || [],
    forbiddenFiles: config.forbiddenFiles || [],
    forbiddenDirs: config.forbiddenDirs || [],
    maxChangedFiles: config.maxChangedFiles || 10,
    maxAddedLines: config.maxAddedLines || 500,
    maxRemovedLines: config.maxRemovedLines || 200,
  };
}

/**
 * 判断文件是否在允许范围内
 */
function isFileAllowed(filePath, scope) {
  const normalized = normalizePath(filePath);
  
  // 检查禁止列表
  for (const forbidden of scope.forbiddenFiles || []) {
    if (normalized.includes(forbidden)) return false;
  }
  for (const forbidden of scope.forbiddenDirs || []) {
    if (normalized.includes(forbidden)) return false;
  }
  
  // 检查允许列表（如果非空）
  const allowedFiles = scope.allowedFiles || [];
  const allowedDirs = scope.allowedDirs || [];
  
  if (allowedFiles.length === 0 && allowedDirs.length === 0) {
    return true; // 没有限制，全部允许
  }
  
  // Matches must respect path-segment boundaries: a bare suffix/prefix check
  // would let "evil-src/a.js" pass an allowlist entry "src/a.js" and
  // "src-evil/x.js" pass an allowedDirs entry "src".
  for (const allowed of allowedFiles) {
    if (normalized === allowed || normalized.endsWith("/" + allowed)) {
      return true;
    }
  }

  for (const allowed of allowedDirs) {
    const dir = String(allowed).replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalized === dir || normalized.startsWith(dir + "/") || normalized.includes("/" + dir + "/")) {
      return true;
    }
  }
  
  return false;
}

/**
 * 检查文件是否是安全关键
 */
function isSecurityCritical(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return SECURITY_CRITICAL_FILES.some((sc) => normalized.includes(sc.toLowerCase()));
}

/**
 * 检查文件是否强制要求人工确认
 */
function requiresManualConfirm(filePath) {
  const normalized = normalizePath(filePath).toLowerCase();
  return MANDATORY_MANUAL_CONFIRM_FILES.some((mf) =>
    normalized.endsWith(mf.toLowerCase()) || normalized === mf.toLowerCase()
  );
}

function requiresBoundaryConfirm(filePath) {
  const normalized = normalizePath(filePath).toLowerCase();
  return FORBIDDEN_WITHOUT_CONFIRM.some((entry) => {
    const item = normalizePath(entry).toLowerCase();
    return normalized === item || normalized.startsWith(`${item}/`) || normalized.includes(`/${item}/`) || normalized.endsWith(`/${item}`);
  });
}

/**
 * Scope Gate 核心决策函数
 */
export function evaluateScopeGate(proposal, diffPreview, taskScope = {}, config = {}) {
  if (!proposal) return { decision: SCOPE_DECISION.REJECT, reason: ["proposal missing"] };
  if (!diffPreview?.ok) return { decision: SCOPE_DECISION.REJECT, reason: [diffPreview?.error || "diff preview failed"] };
  
  const violations = [];
  const warnings = [];
  const riskEscalations = [];
  
  // 1. 检查文件数量限制
  const fileCount = diffPreview.files?.length || 0;
  const maxFiles = taskScope.maxChangedFiles || 10;
  if (fileCount > maxFiles) {
    violations.push(`exceeds maxChangedFiles: ${fileCount} > ${maxFiles}`);
    riskEscalations.push("R3");
  }
  
  // 2. 检查新增行数限制
  const maxAdded = taskScope.maxAddedLines || 500;
  if (diffPreview.addedLines > maxAdded) {
    violations.push(`exceeds maxAddedLines: ${diffPreview.addedLines} > ${maxAdded}`);
    riskEscalations.push("R3");
  }
  
  // 3. 检查删除行数限制
  const maxRemoved = taskScope.maxRemovedLines || 200;
  if (diffPreview.removedLines > maxRemoved) {
    violations.push(`exceeds maxRemovedLines: ${diffPreview.removedLines} > ${maxRemoved}`);
    riskEscalations.push("R3");
  }
  
  // 4. 逐文件检查范围
  for (const file of diffPreview.files || []) {
    if (pathEscapesWorkspace(file.path)) {
      violations.push(`path escapes workspace: ${file.path}`);
      riskEscalations.push("R4");
      continue;
    }

    // 4.1 安全关键文件检查
    if (isSecurityCritical(file.path)) {
      violations.push(`security-critical file: ${file.path}`);
      riskEscalations.push("R4");
    }
    
    // 4.2 强制人工确认检查
    if (requiresManualConfirm(file.path)) {
      warnings.push(`requires manual confirm: ${file.path}`);
      riskEscalations.push("R3");
    }
    
    // 4.3 仓库边界敏感文件检查
    if (requiresBoundaryConfirm(file.path)) {
      warnings.push(`repository-boundary file requires manual confirm: ${file.path}`);
      riskEscalations.push("R3");
    }

    // 4.4 范围允许检查
    if (!isFileAllowed(file.path, taskScope)) {
      violations.push(`file not in allowed scope: ${file.path}`);
      riskEscalations.push("R3");
      // 如果有明确的 allowedFiles/allowedDirs 限制，超出范围是严重违规
      const hasExplicitAllow = (taskScope.allowedFiles?.length > 0) || (taskScope.allowedDirs?.length > 0);
      if (hasExplicitAllow) {
        violations.push(`scope_violation: ${file.path} outside explicit scope`);
      }
    }
  }
  
  // 5. action_plan 类型检查（不修改文件，通常允许）
  if (proposal.type === "action_plan") {
    if (diffPreview.files?.length === 0) {
      return {
        decision: SCOPE_DECISION.ALLOW,
        reason: ["action_plan with no file changes"],
        riskEscalations: [],
      };
    }
  }
  
  // 6. 判断最终决策
  let decision;
  if (violations.some((v) => v.includes("security-critical") || v.includes("path escapes workspace") || v.includes("R4") || v.includes("scope_violation"))) {
    decision = SCOPE_DECISION.REJECT;
  } else if (violations.length > 0 || warnings.length > 0) {
    decision = SCOPE_DECISION.MANUAL_CONFIRM;
  } else {
    decision = SCOPE_DECISION.ALLOW;
  }
  
  // 7. 特殊处理：删除操作必须人工确认
  if (diffPreview.files?.some((f) => f.changeType === "delete")) {
    decision = SCOPE_DECISION.MANUAL_CONFIRM;
    violations.push("delete operation requires manual confirm");
  }
  
  // 去重并返回
  return {
    decision,
    reason: [...new Set([...violations, ...warnings])],
    riskEscalations: [...new Set(riskEscalations)],
    violations,
    warnings,
  };
}

/**
 * 简化入口：一步完成 diff preview + scope gate
 */
export function previewAndGate(proposal, context = {}) {
  const { workspaceRoot, taskScope, config } = context;
  
  // 1. 生成 Diff Preview
  const diffPreview = buildDiffPreview(proposal, { workspaceRoot });
  if (!diffPreview.ok) {
    return {
      ok: false,
      diffPreview,
      scopeGate: { decision: SCOPE_DECISION.REJECT, reason: [diffPreview.error] },
    };
  }
  
  // 2. Scope Gate 评估
  const scope = taskScope || defaultTaskScope(config);
  const scopeGate = evaluateScopeGate(proposal, diffPreview, scope, config);
  
  return {
    ok: scopeGate.decision !== SCOPE_DECISION.REJECT,
    diffPreview,
    scopeGate,
    decision: scopeGate.decision,
  };
}

// 保持对外导出面不变：buildDiffPreview / SECURITY_CRITICAL_FILES 实际定义在
// scope-diff-preview.js，此处转出以兼容既有 import 站点（含测试）。
export { buildDiffPreview, SECURITY_CRITICAL_FILES };
export { MANDATORY_MANUAL_CONFIRM_FILES };