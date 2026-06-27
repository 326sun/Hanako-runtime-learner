import fs from "fs";
import path from "path";

/**
 * scope-diff-preview.js
 *
 * 执行前边界检查的「要改哪里 / 改了多少」层：
 * 从 proposal 计算受影响文件清单与增删行数，供 scope-gate 决策消费。
 * 自 scope-gate.js 拆出（S7.P2 等价重构），行为不变。
 */

/**
 * 安全关键文件列表
 */
export const SECURITY_CRITICAL_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".secrets",
  ".credentials",
  "secrets.json",
  "credentials.json",
  ".ssh",
  ".git/credentials",
];

/**
 * 获取文件变更类型
 */
export function normalizePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function lineCount(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (normalized.length === 0) return 0;
  const lines = normalized.split("\n");
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function patchLineDelta(patch = {}) {
  if (typeof patch.oldText === "string" || typeof patch.newText === "string") {
    return { added: lineCount(patch.newText), removed: lineCount(patch.oldText) };
  }
  if (typeof patch.diff === "string") return countUnifiedDiffLines(patch.diff);
  return { added: 0, removed: 0 };
}

function countUnifiedDiffLines(diffText) {
  let added = 0;
  let removed = 0;
  for (const line of String(diffText || "").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function pathEscapesWorkspace(filePath) {
  const normalized = normalizePath(filePath);
  return !normalized || path.isAbsolute(normalized) || normalized.split("/").includes("..");
}

function getChangeType(targetPath, workspaceRoot) {
  if (pathEscapesWorkspace(targetPath)) return "unsafe";
  const fullPath = path.resolve(workspaceRoot, targetPath);
  if (!fs.existsSync(fullPath)) return "create";
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) return "modify";
  } catch {}
  return "modify";
}

/**
 * 生成 Diff Preview（增强版）
 */
export function buildDiffPreview(proposal, { workspaceRoot = process.cwd(), configPath = null } = {}) {
  if (!proposal) return { ok: false, error: "proposal missing" };

  const type = proposal.type;
  let target = "";
  let addedLines = 0;
  let removedLines = 0;
  let diff = [];
  let files = [];

  if (type === "skill_patch") {
    target = proposal.target?.skillPath || "SKILL.md";
    const skillContent = proposal.patch?.content || "";
    addedLines = lineCount(skillContent);
    files = [{ path: target, changeType: getChangeType(target, workspaceRoot), addedLines, removedLines: 0 }];

  } else if (type === "config_patch") {
    target = configPath || proposal.target?.configPath || "config.json";
    const configPatch = proposal.patch?.config || {};
    addedLines = lineCount(JSON.stringify(configPatch, null, 2));
    files = [{ path: target, changeType: getChangeType(target, workspaceRoot), addedLines, removedLines: 0 }];

  } else if (type === "code_patch") {
    const filePatches = proposal.patch?.filePatches || proposal.patch?.patches || [];
    const fileWrites = proposal.patch?.fileWrites || [];

    for (const fp of filePatches) {
      const changes = patchLineDelta(fp);
      files.push({
        path: fp.path,
        changeType: getChangeType(fp.path, workspaceRoot),
        addedLines: changes.added,
        removedLines: changes.removed,
      });
      addedLines += changes.added;
      removedLines += changes.removed;
    }

    for (const fw of fileWrites) {
      const lines = lineCount(fw.content);
      files.push({
        path: fw.path,
        changeType: getChangeType(fw.path, workspaceRoot),
        addedLines: lines,
        removedLines: 0,
      });
      addedLines += lines;
    }
    target = "multiple";

  } else if (type === "action_plan") {
    // action_plan 不直接修改文件
    target = proposal.plan?.actionType || "runtime_action";
    files = [];

  } else {
    return { ok: false, error: `unsupported proposal type: ${type}` };
  }

  // 检查是否有安全关键文件
  const securityCritical = files.some((f) =>
    SECURITY_CRITICAL_FILES.some((sc) => f.path.includes(sc))
  );

  // 检查是否需要文档或测试同步。测试文件本身变更不代表“需要补测试”，
  // 源码/API/安全边界变更才应该给出测试同步提醒。
  const changedPaths = files.map((f) => normalizePath(f.path).toLowerCase());
  const requiresDocsUpdate = changedPaths.some((p) => p === "readme.md" || p.endsWith("/readme.md") || p.startsWith("docs/"));
  const requiresTestsUpdate = changedPaths.some((p) =>
    (p.startsWith("lib/") || p === "index.js") && !p.includes(".test.") && !p.includes(".spec.")
  );

  // 生成摘要
  const summary = files.length === 0
    ? "no file changes"
    : `${files.length} file${files.length > 1 ? "s" : ""} changed, ${addedLines} insertion${addedLines !== 1 ? "s" : ""}, ${removedLines} deletion${removedLines !== 1 ? "s" : ""}`;

  return {
    ok: true,
    proposalId: proposal.id,
    type,
    target,
    summary,
    files,
    addedLines,
    removedLines,
    securityCritical,
    requiresDocsUpdate,
    requiresTestsUpdate,
  };
}
