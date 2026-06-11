#!/usr/bin/env node
import path from "path";
import { buildReleaseReadiness, exportReleaseReadiness, formatReleaseReadinessReport } from "../lib/release-readiness.js";

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), outputDir: null, minBenchmarkScenarios: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project-root") args.projectRoot = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--min-benchmark-scenarios") args.minBenchmarkScenarios = Number(argv[++i]);
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/release-readiness.js [options]\n\nOptions:\n  --project-root <dir>              Project root. Default: cwd\n  --output-dir <dir>                Write Markdown/JSON report to directory\n  --min-benchmark-scenarios <n>     Minimum benchmark scenario count. Default: 16\n`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = args.outputDir
    ? exportReleaseReadiness(args.projectRoot, path.resolve(args.outputDir), { minBenchmarkScenarios: args.minBenchmarkScenarios })
    : buildReleaseReadiness(args.projectRoot, { minBenchmarkScenarios: args.minBenchmarkScenarios });
  console.log(formatReleaseReadinessReport(result));
  if (result.outputDir) console.log(`Reports written to: ${result.outputDir}`);
  process.exit(result.summary.ok ? 0 : 1);
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(2);
}
