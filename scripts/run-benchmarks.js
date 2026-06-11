#!/usr/bin/env node
import path from "path";
import { runBenchmarkCorpus, formatBenchmarkReport } from "../lib/benchmark-corpus.js";

function parseArgs(argv) {
  const args = { ids: [], outputDir: path.join(process.cwd(), "benchmark-results") };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--id") args.ids.push(argv[++i]);
    else if (arg === "--benchmark-root") args.benchmarkRoot = argv[++i];
    else if (arg === "--baseline") args.baselinePath = argv[++i];
    else if (arg === "--thresholds") args.thresholdsPath = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--keep-workspaces") args.keepBenchmarkWorkspaces = true;
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/run-benchmarks.js [options]\n\nOptions:\n  --id <scenarioId>          Run one scenario; may be repeated.\n  --benchmark-root <dir>     Benchmark root. Default: ./benchmarks\n  --baseline <file>          Baseline metrics JSON.\n  --thresholds <file>        Regression thresholds JSON.\n  --output-dir <dir>         Output report directory. Default: ./benchmark-results\n  --keep-workspaces          Do not remove fixture workspaces.\n`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const result = await runBenchmarkCorpus(args, { pluginDir: process.cwd() });
  if (result.status === "invalid_corpus") {
    console.error(JSON.stringify(result.corpus, null, 2));
    process.exit(2);
  }
  console.log(formatBenchmarkReport(result));
  if (result.outputDir) console.log(`Reports written to: ${result.outputDir}`);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(2);
}
