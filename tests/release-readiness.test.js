import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import { REQUIRED_TOOL_FILES } from "../lib/dist-verify.js";
import { buildReleaseReadiness, exportReleaseReadiness, formatReleaseReadinessReport, REQUIRED_RELEASE_DOCS } from "../lib/release-readiness.js";

function writeZipEntryNames(filePath, entryNames = []) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const name of entryNames) {
    const nameBuf = Buffer.from(name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    local.push(localHeader, nameBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entryNames.length, 8);
  eocd.writeUInt16LE(entryNames.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([...local, centralBuf, eocd]));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function makeProject({ version = "5.0.0", lockVersion = version, scenarios = 16, omitAcceptance = false, testCount = 946, zipEntries = ["index.js", "manifest.json", ...REQUIRED_TOOL_FILES] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-release-readiness-"));
  const baseVersion = version.replace(/-lts$/, "");
  write(path.join(root, "package.json"), JSON.stringify({ name: "hanako-runtime-learner", version }, null, 2));
  write(path.join(root, "package-lock.json"), JSON.stringify({ name: "hanako-runtime-learner", version: lockVersion, lockfileVersion: 3, packages: { "": { name: "hanako-runtime-learner", version: lockVersion } } }, null, 2));
  write(path.join(root, "manifest.json"), JSON.stringify({ name: "hanako-runtime-learner", version, minAppVersion: "0.345.0" }, null, 2));
  write(
    path.join(root, "README.md"),
    [
      `<img src="https://img.shields.io/badge/version-${baseVersion}-blue" alt="version">`,
      `<img src="https://img.shields.io/badge/tests-${testCount}%2F${testCount}-success" alt="tests">`,
      `git clone --branch v${version} https://github.com/example/hanako-runtime-learner.git`,
      `npm test           # ${testCount} 项测试`,
      "",
    ].join("\n"),
  );
  write(path.join(root, "CHANGELOG.md"), `# Changelog\n\n## ${version.replace(/-lts$/i, " LTS")}\n\n- Release readiness.\n`);
  for (const rel of REQUIRED_RELEASE_DOCS) write(path.join(root, rel), rel.endsWith("API_FREEZE.md") ? "# API Freeze\n\nv5.0 frozen API surface.\n" : `# ${rel}\n\n${version}\n`);
  write(path.join(root, "docs", "DESIGN_GOAL_COMPLETION_MATRIX.md"), `# Design Goal Completion Matrix\n\nStatus: ${version}.\n`);
  if (!omitAcceptance) write(path.join(root, `docs/ACCEPTANCE-v${version.replace(/-lts$/i, "-LTS")}.md`), "# 验收报告\n\nok\n");
  write(path.join(root, "benchmarks", "baseline-v4.0.9.json"), JSON.stringify({ metrics: { task_success_rate: 1 } }, null, 2));
  write(path.join(root, "benchmarks", "thresholds.json"), JSON.stringify({ thresholds: {} }, null, 2));
  for (const rel of ["index.js", "manifest.json", "README.md", "LICENSE", "plugin-process-runner-child.js", ...REQUIRED_TOOL_FILES]) {
    write(path.join(root, "dist", rel), rel.endsWith(".js") ? "export default {};\n" : "ok\n");
  }
  writeZipEntryNames(path.join(root, "release", "hanako-runtime-learner-dist.zip"), zipEntries);
  for (let i = 0; i < scenarios; i += 1) {
    write(path.join(root, "benchmarks", "scenarios", "quality", `scenario-${i}.json`), JSON.stringify({ id: `quality.scenario_${i}`, title: `Scenario ${i}`, steps: [{ type: "note", note: "ok" }] }, null, 2));
  }
  return root;
}

test("release readiness passes when v5 release contract is coherent", () => {
  const root = makeProject();
  const result = buildReleaseReadiness(root, { minBenchmarkScenarios: 16, requireDistPackage: true });
  assert.equal(result.summary.status, "ready");
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.version, "5.0.0");
});

test("release readiness blocks mismatched lockfile and missing acceptance report", () => {
  const root = makeProject({ lockVersion: "4.3.23", omitAcceptance: true });
  const result = buildReleaseReadiness(root, { minBenchmarkScenarios: 16 });
  assert.equal(result.summary.status, "blocked");
  assert(result.summary.failedChecks.includes("package_lock.version_matches"));
  assert(result.summary.failedChecks.includes("docs.acceptance_current_version"));
});

test("release readiness blocks a release zip that nests the plugin under dist", () => {
  const root = makeProject({ zipEntries: ["dist/index.js", "dist/manifest.json", ...REQUIRED_TOOL_FILES.map((file) => `dist/${file}`)] });
  const result = buildReleaseReadiness(root, { minBenchmarkScenarios: 16, requireDistPackage: true });
  assert.equal(result.summary.status, "blocked");
  assert(result.summary.failedChecks.includes("dist.package_verified"));
});

test("release readiness report can be exported as JSON and Markdown", () => {
  const root = makeProject();
  const outputDir = path.join(root, "out");
  const result = exportReleaseReadiness(root, outputDir, { minBenchmarkScenarios: 16, requireDistPackage: true });
  assert.equal(result.status, "ready");
  assert(fs.existsSync(path.join(outputDir, "release-readiness.json")));
  const md = fs.readFileSync(path.join(outputDir, "release-readiness.md"), "utf-8");
  assert(md.includes("# Release Readiness Report"));
  assert(md.includes("Status: ready"));
});

test("release readiness formatter surfaces failed checks", () => {
  const root = makeProject({ scenarios: 2 });
  const result = buildReleaseReadiness(root, { minBenchmarkScenarios: 16 });
  const md = formatReleaseReadinessReport(result);
  assert.equal(result.summary.status, "blocked");
  assert(md.includes("benchmarks.corpus_valid"));
  assert(md.includes("blocked"));
});

test("P10.B: every check reports a finite non-negative durationMs, surfaced in the Markdown report", () => {
  const root = makeProject();
  const result = buildReleaseReadiness(root, { minBenchmarkScenarios: 16, requireDistPackage: true });
  assert.ok(result.checks.length > 0);
  for (const check of result.checks) {
    assert.ok(Number.isFinite(check.durationMs) && check.durationMs >= 0, `${check.id} should have a finite non-negative durationMs`);
  }
  const md = formatReleaseReadinessReport(result);
  assert.match(md, /\| Check \| Status \| Duration \(ms\) \| Message \|/);
});
