#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { scanComplexity, summarizeComplexity } from "../lib/complexity.js";

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), json: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project-root") args.projectRoot = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/complexity-check.js [options]",
      "",
      "Scans lib/, scripts/, tests/, tools/ and enforces the v4.x complexity budget.",
      "Exits 1 when any hard limit is exceeded; 0 otherwise.",
      "",
      "Options:",
      "  --project-root <dir>   Project root. Default: cwd",
      "  --json                 Print the machine-readable summary as JSON",
      "  --out <file>           Also write the JSON summary to <file>",
    ].join("\n"),
  );
}

function formatHuman(scan) {
  const t = scan.totals;
  const lines = [];
  lines.push("Complexity check");
  lines.push(`  scope: ${scan.dirs.join(", ")}`);
  lines.push(`  files: ${t.fileCount} (lib modules: ${t.libModuleCount})`);
  lines.push(`  total LOC: ${t.loc} (code LOC: ${t.codeLoc})`);
  lines.push(`  max file LOC: ${t.maxLoc} / hard ${scan.hardLimits.fileLoc} / soft ${scan.softTargets.fileLoc}`);
  lines.push(`  max imports: ${t.maxImports} / hard ${scan.hardLimits.fileImports} / soft ${scan.softTargets.fileImports}`);
  lines.push(`  max exports: ${t.maxExports} / hard ${scan.hardLimits.fileExports} / soft ${scan.softTargets.fileExports}`);
  lines.push(`  TODO/FIXME markers: ${t.todos} / hard ${scan.hardLimits.totalTodos} / soft ${scan.softTargets.totalTodos}`);
  lines.push(`  soft warnings: ${scan.softWarnings.length}`);
  if (scan.violations.length > 0) {
    lines.push("  VIOLATIONS:");
    for (const v of scan.violations) lines.push(`    - ${v.message}`);
  }
  lines.push(`  status: ${scan.ok ? "OK" : "FAILED"}`);
  return lines.join("\n");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const scan = scanComplexity(args.projectRoot);
  const summary = summarizeComplexity(scan);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  }
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(formatHuman(scan));
  process.exit(scan.ok ? 0 : 1);
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(2);
}
