/**
 * repair-classifier.js
 *
 * 错误分类驱动的一次受控自动修复。
 * 核心原则：
 * - 只修明确错误
 * - 只修一次
 * - 修复后必须重新验证
 * - 失败后必须回滚
 */

/**
 * 错误类型枚举
 */
export const ERROR_TYPES = {
  LINT_FORMAT: "lint_format",
  IMPORT_MISSING: "import_missing",
  EXPORT_MISSING: "export_missing",
  SCHEMA_INVALID: "schema_invalid",
  DUPLICATE_DEFINITION: "duplicate_definition",
  TEST_ASSERTION: "test_assertion",
  SNAPSHOT_MISMATCH: "snapshot_mismatch",
  PERMISSION_ERROR: "permission_error",
  AUTH_ERROR: "auth_error",
  TIMEOUT: "timeout",
  SECURITY_POLICY_VIOLATION: "security_policy_violation",
  UNKNOWN: "unknown",
};

/**
 * 错误模式匹配规则
 */
const ERROR_PATTERNS = [
  { type: ERROR_TYPES.LINT_FORMAT, patterns: [/lint|formatt?ing|semi|prettier|indent/i, /expected .+ but found/i, /unexpected token/i] },
  { type: ERROR_TYPES.IMPORT_MISSING, patterns: [/Cannot find module/i, /ERR_MODULE_NOT_FOUND/i, /ENOENT.*cannot find/i, /module.*not found/i] },
  { type: ERROR_TYPES.EXPORT_MISSING, patterns: [/is not exported/i, /named export/i, /default export/i, /has no exported member/i, /does not provide.*export/i] },
  { type: ERROR_TYPES.SCHEMA_INVALID, patterns: [/schema.*invalid/i, /required.*missing/i, /validation.*(error|fail)/i, /type.*mismatch/i, /is required/i] },
  { type: ERROR_TYPES.DUPLICATE_DEFINITION, patterns: [/duplicate.*definition/i, /already been declared/i, /identifier.*has already been declared/i] },
  { type: ERROR_TYPES.TEST_ASSERTION, patterns: [/expect.*toBe/i, /assert.*fail/i, /test.*fail/i, /expectation.*failed/i] },
  { type: ERROR_TYPES.SNAPSHOT_MISMATCH, patterns: [/snapshot.*match/i, /does not match/i, /received value does not match/i] },
  { type: ERROR_TYPES.PERMISSION_ERROR, patterns: [/permission denied/i, /EACCES/i, /operation not permitted/i, /cannot access/i] },
  { type: ERROR_TYPES.AUTH_ERROR, patterns: [/auth.*fail/i, /unauthorized/i, /401|403/i, /credential/i, /token.*invalid/i] },
  { type: ERROR_TYPES.TIMEOUT, patterns: [/timeout/i, /ETIMEDOUT/i, /timed out/i, /ECONNREFUSED/i] },
  { type: ERROR_TYPES.SECURITY_POLICY_VIOLATION, patterns: [/security policy/i, /csp.*violation/i, /not allowed/i] },
];

/**
 * 提取错误消息
 */
function extractErrorMessage(result) {
  if (!result) return "";

  // 优先使用详细的 error 信息
  const error = result.error || result.stderr || result.stdout || "";
  const message = Array.isArray(error) ? error.join(" ") : String(error);

  return message.slice(0, 1000); // 限制长度
}

/**
 * 提取可能的修复目标
 */
function extractFixTarget(errorMessage) {
  const patterns = [
    // 文件路径
    /['"`]([^'"`]+)['"`]/,
    // 模块名
    /module ['"`]([^'"`]+)['"`]/i,
    // 行号相关
    /line (\d+)/i,
    // 变量名
    /(?:variable|identifier) ['"`]([^'"`]+)['"`]/i,
  ];

  for (const pattern of patterns) {
    const match = errorMessage.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * 分类错误类型
 */
export function classifyError(result = {}) {
  const message = extractErrorMessage(result);

  if (!message) {
    return {
      errorType: ERROR_TYPES.UNKNOWN,
      confidence: 0,
      message: "",
      canAutoRepair: false,
    };
  }

  // 按优先级匹配
  for (const rule of ERROR_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        return {
          errorType: rule.type,
          confidence: 0.9,
          message: message.slice(0, 500),
          canAutoRepair: canAutoRepair(rule.type),
          fixTarget: extractFixTarget(message),
        };
      }
    }
  }

  return {
    errorType: ERROR_TYPES.UNKNOWN,
    confidence: 0.1,
    message: message.slice(0, 500),
    canAutoRepair: false,
  };
}

/**
 * 判断某种错误类型是否可以自动修复
 */
function canAutoRepair(errorType) {
  const autoRepairable = [
    ERROR_TYPES.LINT_FORMAT,
    ERROR_TYPES.IMPORT_MISSING,
    ERROR_TYPES.EXPORT_MISSING,
    ERROR_TYPES.SCHEMA_INVALID,
  ];

  return autoRepairable.includes(errorType);
}

/**
 * 获取错误分类的详细描述
 */
export function getErrorDescription(errorType) {
  const descriptions = {
    [ERROR_TYPES.LINT_FORMAT]: "代码格式或 lint 错误",
    [ERROR_TYPES.IMPORT_MISSING]: "导入的模块找不到",
    [ERROR_TYPES.EXPORT_MISSING]: "导出的内容不存在",
    [ERROR_TYPES.SCHEMA_INVALID]: "数据结构不符合 schema",
    [ERROR_TYPES.DUPLICATE_DEFINITION]: "重复的定义",
    [ERROR_TYPES.TEST_ASSERTION]: "测试断言失败",
    [ERROR_TYPES.SNAPSHOT_MISMATCH]: "快照不匹配",
    [ERROR_TYPES.PERMISSION_ERROR]: "权限错误",
    [ERROR_TYPES.AUTH_ERROR]: "认证错误",
    [ERROR_TYPES.TIMEOUT]: "超时",
    [ERROR_TYPES.SECURITY_POLICY_VIOLATION]: "安全策略违规",
    [ERROR_TYPES.UNKNOWN]: "未知错误",
  };

  return descriptions[errorType] || "未知错误";
}

/**
 * 是否应该升级人工确认
 */
export function shouldEscalateToHuman(errorType) {
  const neverAutoRepair = [
    ERROR_TYPES.PERMISSION_ERROR,
    ERROR_TYPES.AUTH_ERROR,
    ERROR_TYPES.SECURITY_POLICY_VIOLATION,
    ERROR_TYPES.TEST_ASSERTION,
    ERROR_TYPES.SNAPSHOT_MISMATCH,
  ];

  return neverAutoRepair.includes(errorType);
}

/**
 * 批量分类多个错误
 */
export function classifyErrors(results = []) {
  if (!Array.isArray(results)) {
    results = [results];
  }

  return results.map((result) => classifyError(result));
}

/**
 * 分类并汇总
 */
export function summarizeErrors(results = []) {
  const classifications = classifyErrors(results);

  const summary = {
    total: classifications.length,
    autoRepairable: classifications.filter((c) => c.canAutoRepair).length,
    requiresHuman: classifications.filter((c) => shouldEscalateToHuman(c.errorType)).length,
    unknown: classifications.filter((c) => c.errorType === ERROR_TYPES.UNKNOWN).length,
    byType: {},
  };

  for (const c of classifications) {
    summary.byType[c.errorType] = (summary.byType[c.errorType] || 0) + 1;
  }

  return {
    classifications,
    summary,
    建议: suggestAction(summary),
  };
}

/**
 * 基于错误汇总给出行动建议
 */
function suggestAction(summary) {
  if (summary.requiresHuman > 0) {
    return { action: "escalate", reason: "存在需要人工处理的错误" };
  }

  if (summary.autoRepairable > 0) {
    return { action: "auto_repair", reason: "存在可自动修复的错误" };
  }

  if (summary.unknown > 0 && summary.total > 0) {
    return { action: "diagnose", reason: "需要进一步诊断未知错误" };
  }

  return { action: "unknown", reason: "无法确定行动" };
}
