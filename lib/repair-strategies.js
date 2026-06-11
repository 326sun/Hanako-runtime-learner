import { ERROR_TYPES } from "./repair-classifier.js";

/**
 * repair-strategies.js
 * 
 * 错误修复策略：
 * - 只修明确错误
 * - 只修一次
 * - 修复后必须重新验证
 * - 失败后必须回滚
 */

/**
 * 修复策略配置
 */
export const REPAIR_STRATEGIES = {
  [ERROR_TYPES.LINT_FORMAT]: {
    strategyId: "repair:lint_format",
    name: "Lint/Format 修复",
    requiresUniqueCandidate: false,
    maxAttempts: 1,
    risky: false,
  },
  [ERROR_TYPES.IMPORT_MISSING]: {
    strategyId: "repair:import_missing",
    name: "缺失导入修复",
    requiresUniqueCandidate: true,
    maxAttempts: 1,
    risky: false,
  },
  [ERROR_TYPES.EXPORT_MISSING]: {
    strategyId: "repair:export_missing",
    name: "缺失导出修复",
    requiresUniqueCandidate: false,
    maxAttempts: 1,
    risky: false,
  },
  [ERROR_TYPES.SCHEMA_INVALID]: {
    strategyId: "repair:schema_invalid",
    name: "Schema 修复",
    requiresUniqueCandidate: false,
    maxAttempts: 1,
    risky: true,
  },
  [ERROR_TYPES.DUPLICATE_DEFINITION]: {
    strategyId: "repair:duplicate_definition",
    name: "重复定义修复",
    requiresUniqueCandidate: false,
    maxAttempts: 1,
    risky: true,
  },
};

/**
 * 验证命令映射
 */
const VERIFICATION_COMMANDS = {
  js: ["npm run check", "node --check"],
  test: ["npm test"],
  lint: ["npm run check"],
  all: ["npm run check", "npm test"],
};

/**
 * 获取默认验证命令
 */
export function getVerificationCommands(context = {}) {
  const { language = "js", includeTests = false } = context;
  
  let commands = VERIFICATION_COMMANDS[language] || VERIFICATION_COMMANDS.js;
  
  if (includeTests) {
    const testCmd = VERIFICATION_COMMANDS.test;
    commands = [...new Set([...commands, ...testCmd])];
  }
  
  return commands;
}

/**
 * 生成修复补丁
 */
export function generateRepairPatch(errorType, context = {}) {
  const strategy = REPAIR_STRATEGIES[errorType];
  if (!strategy) {
    return { ok: false, reason: `no strategy for ${errorType}` };
  }
  
  const { workspaceRoot, targetFile, target, oldContent, newContent } = context;
  
  let patch = null;
  
  switch (errorType) {
    case ERROR_TYPES.LINT_FORMAT:
      // Lint/Format 错误通常需要格式化工具处理
      // 这里生成一个诊断建议
      patch = {
        type: "diagnose",
        actionType: "NO_RETRY_DIAGNOSE",
        suggestedCommands: ["npm run check", "npx prettier --write"],
      };
      break;
      
    case ERROR_TYPES.IMPORT_MISSING:
      // 导入缺失：尝试定位文件或模块
      patch = {
        type: "locate",
        actionType: "LOCATE_MISSING_FILE",
        target: target || targetFile,
      };
      break;
      
    case ERROR_TYPES.EXPORT_MISSING:
      // 导出缺失：检查并添加导出
      if (targetFile && oldContent && newContent) {
        patch = {
          type: "patch",
          actionType: "APPLY_PATCH_SANDBOXED",
          filePatches: [{
            path: targetFile,
            oldText: oldContent,
            newText: newContent,
          }],
        };
      } else {
        patch = { type: "diagnose", actionType: "NO_RETRY_DIAGNOSE" };
      }
      break;
      
    case ERROR_TYPES.SCHEMA_INVALID:
      // Schema 无效：尝试补全必填字段
      patch = {
        type: "diagnose",
        actionType: "NO_RETRY_DIAGNOSE",
        note: "Schema 修复需要更精确的上下文",
      };
      break;
      
    case ERROR_TYPES.DUPLICATE_DEFINITION:
      // 重复定义：删除本次新增的重复定义
      patch = {
        type: "diagnose",
        actionType: "NO_RETRY_DIAGNOSE",
        note: "重复定义修复需要更精确的上下文",
      };
      break;
      
    default:
      return { ok: false, reason: `unsupported error type: ${errorType}` };
  }
  
  return {
    ok: true,
    strategyId: strategy.strategyId,
    errorType,
    patch,
    verification: {
      commands: getVerificationCommands({ language: "js", includeTests: false }),
    },
  };
}

/**
 * 执行一次受控修复的入口
 */
export async function attemptOneRepair(errorClassification, context = {}) {
  const { workspaceRoot, attempt = 0, maxAttempts = 1 } = context;
  
  // 检查是否超过尝试次数
  if (attempt >= maxAttempts) {
    return {
      ok: false,
      attempted: true,
      reason: "repair attempt limit reached",
      shouldRollback: true,
    };
  }
  
  // 检查是否可以自动修复
  if (!errorClassification.canAutoRepair) {
    return {
      ok: false,
      attempted: false,
      reason: `error type ${errorClassification.errorType} not auto-repairable`,
      shouldEscalate: true,
    };
  }
  
  // 生成修复补丁
  const repairResult = generateRepairPatch(errorClassification.errorType, context);
  if (!repairResult.ok) {
    return {
      ok: false,
      attempted: true,
      reason: repairResult.reason,
      shouldRollback: true,
    };
  }
  
  // 注意：实际的修复执行应该在 action-executor 中进行
  // 这里只返回修复策略和信息
  
  return {
    ok: true,
    attempted: true,
    patch: repairResult.patch,
    strategyId: repairResult.strategyId,
    errorType: errorClassification.errorType,
    verification: repairResult.verification,
  };
}

/**
 * 修复状态枚举
 */
export const REPAIR_STATUS = {
  NOT_ATTEMPTED: "not_attempted",
  ATTEMPTED: "attempted",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  ROLLED_BACK: "rolled_back",
  ESCALATED: "escalated",
};

export { ERROR_TYPES as REPAIR_ERROR_TYPES };