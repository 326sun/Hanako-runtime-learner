#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { scanComplexity, topFilesBy } from "../lib/complexity.js";

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project-root") args.projectRoot = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/complexity-report.js [options]",
      "",
      "Generates docs/COMPLEXITY_REPORT.md from a fresh complexity scan.",
      "Read-only with respect to business logic; only writes the report file.",
      "",
      "Options:",
      "  --project-root <dir>   Project root. Default: cwd",
      "  --out <file>           Output path. Default: docs/COMPLEXITY_REPORT.md",
    ].join("\n"),
  );
}

function table(header, rows) {
  const lines = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`|${header.map(() => "---").join("|")}|`);
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

function buildReport(scan) {
  const t = scan.totals;
  const lines = [];
  lines.push("# Complexity Report");
  lines.push("");
  lines.push("> 自动生成，请勿手工编辑。运行 `npm run complexity:report` 刷新。");
  lines.push("> 预算与规则见 [COMPLEXITY_BUDGET.md](COMPLEXITY_BUDGET.md)，债务清单见 [COMPLEXITY_DEBT.md](COMPLEXITY_DEBT.md)。");
  lines.push("");
  lines.push(`Generated at: ${scan.generatedAt}`);
  lines.push(`Scan scope: ${scan.dirs.join(", ")}`);
  lines.push(`Status: ${scan.ok ? "within budget" : "OVER BUDGET"}`);
  lines.push("");
  lines.push("## 摘要");
  lines.push("");
  lines.push(
    table(
      ["指标", "当前值", "hard limit", "soft target"],
      [
        ["文件数", String(t.fileCount), "-", "-"],
        ["lib 模块数", String(t.libModuleCount), String(scan.hardLimits.libModuleCount), String(scan.softTargets.libModuleCount)],
        ["总 LOC", String(t.loc), "-", "-"],
        ["总代码 LOC", String(t.codeLoc), "-", "-"],
        ["单文件最大 LOC", String(t.maxLoc), String(scan.hardLimits.fileLoc), String(scan.softTargets.fileLoc)],
        ["单文件最大 imports", String(t.maxImports), String(scan.hardLimits.fileImports), String(scan.softTargets.fileImports)],
        ["单文件最大 exports", String(t.maxExports), String(scan.hardLimits.fileExports), String(scan.softTargets.fileExports)],
        ["TODO/FIXME 总数", String(t.todos), String(scan.hardLimits.totalTodos), String(scan.softTargets.totalTodos)],
        ["soft 警告数", String(scan.softWarnings.length), "-", "0"],
        ["结构规则警告数", String(scan.structuralWarnings?.length || 0), "-", "0"],
        ["hard 违规数", String(scan.violations.length), "0", "-"],
      ],
    ),
  );
  lines.push("");

  lines.push("## Top 10 最大文件 (LOC)");
  lines.push("");
  lines.push(table(["文件", "LOC", "代码 LOC"], topFilesBy(scan, "loc").map((f) => [f.path, String(f.loc), String(f.codeLoc)])));
  lines.push("");

  lines.push("## Top 10 import 最多文件");
  lines.push("");
  lines.push(table(["文件", "imports"], topFilesBy(scan, "imports").map((f) => [f.path, String(f.imports)])));
  lines.push("");

  lines.push("## Top 10 export 最多文件");
  lines.push("");
  lines.push(table(["文件", "exports"], topFilesBy(scan, "exports").map((f) => [f.path, String(f.exports)])));
  lines.push("");

  lines.push("## TODO / FIXME 统计");
  lines.push("");
  const todoFiles = scan.files.filter((f) => f.todos > 0).sort((a, b) => b.todos - a.todos);
  lines.push(`总计 ${t.todos} 处，分布于 ${todoFiles.length} 个文件。`);
  lines.push("");
  if (todoFiles.length > 0) {
    lines.push(table(["文件", "TODO/FIXME"], todoFiles.map((f) => [f.path, String(f.todos)])));
    lines.push("");
  }

  if (scan.violations.length > 0) {
    lines.push("## Hard limit 违规");
    lines.push("");
    for (const v of scan.violations) lines.push(`- ${v.message}`);
    lines.push("");
  }

  if (scan.softWarnings.length > 0) {
    lines.push("## Soft target 警告");
    lines.push("");
    lines.push("以下项目超出 soft target 但仍在 hard limit 内，是优先治理对象（参见 COMPLEXITY_DEBT.md）。");
    lines.push("");
    for (const w of scan.softWarnings.sort((a, b) => b.value - a.value)) lines.push(`- ${w.message}`);
    lines.push("");
  }

  if ((scan.structuralWarnings?.length || 0) > 0) {
    lines.push("## 结构规则警告");
    lines.push("");
    lines.push("以下项目不阻断发布，但说明结构约束正在漂移，应优先登记或治理。");
    lines.push("");
    for (const w of scan.structuralWarnings) lines.push(`- ${w.message}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const scan = scanComplexity(args.projectRoot);
  const outPath = path.resolve(args.out || path.join(args.projectRoot, "docs", "COMPLEXITY_REPORT.md"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buildReport(scan), "utf-8");
  console.log(`Complexity report written to: ${outPath}`);
  console.log(`Status: ${scan.ok ? "within budget" : "OVER BUDGET"} (${scan.violations.length} violation(s), ${scan.softWarnings.length} soft warning(s))`);
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(2);
}
