import fs from "fs";
import path from "path";
import { loadBenchmarkCorpus } from "./benchmark-corpus.js";
import { scanComplexity } from "./complexity.js";
import { verifyDistStructure } from "./dist-verify.js";

export const REQUIRED_RELEASE_DOCS = [
  "docs/ACTION_API.md",
  "docs/POLICY.md",
  "docs/TRANSACTION.md",
  "docs/SANDBOX.md",
  "docs/SKILL_PROMOTION.md",
  "docs/AUDIT.md",
  "docs/BENCHMARKS.md",
  "docs/MIGRATION_v4_to_v5.md",
  "docs/API_FREEZE.md",
  "docs/DESIGN_GOAL_COMPLETION_MATRIX.md",
  "docs/LTS_MAINTENANCE_PLAN.md",
  "docs/SUPPLY_CHAIN.md",
  "docs/PRIVACY.md",
  "docs/SECURITY_REVIEW-v5.0.0.md",
];

export const REQUIRED_LTS_DOCS = REQUIRED_RELEASE_DOCS;

const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-lts)?$/;
const REQUIRED_MIN_APP_VERSION = "0.345.0";

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const text = readText(filePath);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function statFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function versionHeading(version) {
  return `## ${String(version || "").replace(/-lts$/i, " LTS")}`;
}

function acceptanceReportName(version) {
  return `docs/ACCEPTANCE-v${String(version || "").replace(/-lts$/i, "-LTS")}.md`;
}

function makeCheck(id, ok, message, details = {}) {
  return { id, ok: !!ok, status: ok ? "passed" : "failed", message, details };
}

function checkRequiredDocs(projectRoot, docs = REQUIRED_RELEASE_DOCS) {
  const checked = docs.map((rel) => {
    const full = path.join(projectRoot, rel);
    const stat = statFile(full);
    return {
      path: rel,
      exists: !!stat,
      sizeBytes: stat?.size || 0,
      ok: !!stat && stat.size > 0,
    };
  });
  const missing = checked.filter((item) => !item.ok);
  return makeCheck(
    "docs.required_release_docs",
    missing.length === 0,
    missing.length === 0 ? "all required release docs exist and are non-empty" : `missing or empty docs: ${missing.map((item) => item.path).join(", ")}`,
    { required: docs.length, checked, missing: missing.map((item) => item.path) },
  );
}

function checkReadmeVersionBadge(projectRoot, version) {
  const readme = readText(path.join(projectRoot, "README.md"));
  if (!readme) return makeCheck("readme.version_badge", false, "README.md not found or empty");
  const badgeMatch = readme.match(/badge\/version-(\d+\.\d+\.\d+)(?:--lts)?-blue/);
  const ok = badgeMatch && badgeMatch[1] === version.replace(/-lts$/, "");
  return makeCheck(
    "readme.version_badge",
    ok,
    ok ? `README version badge matches package version: ${version}` : `README version badge mismatch: expected ${version}, found ${badgeMatch ? badgeMatch[1] + "-lts" : "none"}`,
    { expected: version, found: badgeMatch ? badgeMatch[1] + "-lts" : null },
  );
}

function checkReadmeTestBadge(projectRoot, expectedCount) {
  const readme = readText(path.join(projectRoot, "README.md"));
  if (!readme) return makeCheck("readme.test_badge", false, "README.md not found or empty");
  const badgeMatch = readme.match(/badge\/tests-(\d+)%2F(\d+)-success/);
  const ok = badgeMatch && Number(badgeMatch[1]) === expectedCount && Number(badgeMatch[2]) === expectedCount;
  return makeCheck(
    "readme.test_badge",
    ok,
    ok ? `README test badge matches: ${expectedCount}/${expectedCount}` : `README test badge mismatch: expected ${expectedCount}/${expectedCount}, found ${badgeMatch ? badgeMatch[1] + "/" + badgeMatch[2] : "none"}`,
    { expected: expectedCount, found: badgeMatch ? Number(badgeMatch[1]) : null },
  );
}

function checkReadmeCloneBranch(projectRoot, version) {
  const readme = readText(path.join(projectRoot, "README.md"));
  if (!readme) return makeCheck("readme.clone_branch", false, "README.md not found or empty");
  const expectedBranch = `v${version}`;
  const cloneMatch = readme.match(/git clone --branch (v[\d.]+(?:-lts)?) /);
  const ok = cloneMatch && cloneMatch[1] === expectedBranch;
  return makeCheck(
    "readme.clone_branch",
    ok,
    ok ? `README fixed clone branch matches: ${expectedBranch}` : `README fixed clone branch mismatch: expected ${expectedBranch}, found ${cloneMatch ? cloneMatch[1] : "none"}`,
    { expected: expectedBranch, found: cloneMatch ? cloneMatch[1] : null },
  );
}

function checkManifestVersion(projectRoot, version) {
  const manifest = readJson(path.join(projectRoot, "manifest.json"));
  if (!manifest) return makeCheck("manifest.version", false, "manifest.json not found or invalid");
  const ok = manifest.version === version;
  return makeCheck(
    "manifest.version",
    ok,
    ok ? `manifest version matches package.json: ${version}` : `manifest version mismatch: expected ${version}, found ${manifest.version || "none"}`,
    { expected: version, found: manifest.version || null },
  );
}

function checkManifestMinAppVersion(projectRoot, requiredMinAppVersion = REQUIRED_MIN_APP_VERSION) {
  const manifest = readJson(path.join(projectRoot, "manifest.json"));
  if (!manifest) return makeCheck("manifest.min_app_version", false, "manifest.json not found or invalid");
  const ok = manifest.minAppVersion === requiredMinAppVersion;
  return makeCheck(
    "manifest.min_app_version",
    ok,
    ok ? `manifest minAppVersion matches v5 baseline: ${requiredMinAppVersion}` : `manifest minAppVersion mismatch: expected ${requiredMinAppVersion}, found ${manifest.minAppVersion || "none"}`,
    { expected: requiredMinAppVersion, found: manifest.minAppVersion || null },
  );
}

function checkApiFreezeVersion(projectRoot, version) {
  const apiFreeze = readText(path.join(projectRoot, "docs", "API_FREEZE.md"));
  if (!apiFreeze) return makeCheck("docs.api_freeze_version", false, "API_FREEZE.md not found or empty");
  const majorMinor = version.replace(/-lts$/, "").replace(/\.\d+$/, "");
  const ok = apiFreeze.includes(version) || apiFreeze.includes(majorMinor);
  return makeCheck(
    "docs.api_freeze_version",
    ok,
    ok ? `API_FREEZE.md references current version or major.minor: ${version}` : `API_FREEZE.md does not reference current version ${version}`,
    { expected: version, majorMinor },
  );
}

function checkReadmeTestCount(projectRoot, expectedCount) {
  const readme = readText(path.join(projectRoot, "README.md"));
  if (!readme) return makeCheck("readme.test_count_text", false, "README.md not found or empty");
  const textMatch = readme.match(/(\d+)\s*(?:项测试|tests?\b)/i);
  const ok = textMatch && Number(textMatch[1]) === expectedCount;
  return makeCheck(
    "readme.test_count_text",
    ok,
    ok ? `README test count text matches: ${expectedCount}` : `README test count text mismatch: expected ${expectedCount}, found ${textMatch ? textMatch[1] : "none"}`,
    { expected: expectedCount, found: textMatch ? Number(textMatch[1]) : null },
  );
}

function checkBenchmarkCorpus(projectRoot, minBenchmarkScenarios) {
  try {
    const corpus = loadBenchmarkCorpus({ projectRoot });
    return makeCheck(
      "benchmarks.corpus_valid",
      corpus.ok && corpus.scenarioCount >= minBenchmarkScenarios,
      corpus.ok && corpus.scenarioCount >= minBenchmarkScenarios
        ? `benchmark corpus valid with ${corpus.scenarioCount} scenario(s)`
        : `benchmark corpus invalid or below minimum scenario count: ${corpus.scenarioCount}/${minBenchmarkScenarios}`,
      { scenarioCount: corpus.scenarioCount, minBenchmarkScenarios, rejected: corpus.rejected, duplicateIds: corpus.duplicateIds },
    );
  } catch (err) {
    return makeCheck("benchmarks.corpus_valid", false, `benchmark corpus check failed: ${err.message}`, { error: err.message });
  }
}

function checkComplexityBudget(projectRoot, options = {}) {
  try {
    const scan = scanComplexity(projectRoot, options.complexity || {});
    const t = scan.totals;
    return makeCheck(
      "complexity.within_budget",
      scan.ok,
      scan.ok
        ? `complexity within budget: ${t.fileCount} files, max ${t.maxLoc} LOC, ${t.todos} TODO/FIXME (${scan.softWarnings.length} soft warning(s))`
        : `complexity budget exceeded: ${scan.violations.map((v) => v.message).join("; ")}`,
      { totals: t, violations: scan.violations, softWarningCount: scan.softWarnings.length, dirs: scan.dirs },
    );
  } catch (err) {
    return makeCheck("complexity.within_budget", false, `complexity check failed: ${err.message}`, { error: err.message });
  }
}

function checkDistPackage(projectRoot) {
  const distDir = path.join(projectRoot, "dist");
  const zipPath = path.join(projectRoot, "release", "hanako-runtime-learner-dist.zip");
  const dist = verifyDistStructure(distDir);
  const zip = statFile(zipPath);
  const ok = dist.ok && !!zip && zip.size > 0;
  return makeCheck(
    "dist.package_verified",
    ok,
    ok ? "dist package and release zip are present and structurally verified" : `dist package verification failed: ${[...dist.problems, zip ? null : "missing release/hanako-runtime-learner-dist.zip"].filter(Boolean).join("; ")}`,
    { distDir: "dist", zipPath: "release/hanako-runtime-learner-dist.zip", problems: dist.problems, zipBytes: zip?.size || 0 },
  );
}

export function buildReleaseReadiness(projectRoot = process.cwd(), options = {}) {
  const root = path.resolve(projectRoot);
  const packageJsonPath = path.join(root, "package.json");
  const packageLockPath = path.join(root, "package-lock.json");
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const version = packageJson?.version || "unknown";
  const minBenchmarkScenarios = Number(options.minBenchmarkScenarios || 16);
  const acceptancePath = acceptanceReportName(version);
  const changelog = readText(path.join(root, "CHANGELOG.md")) || "";
  const designMatrix = readText(path.join(root, "docs", "DESIGN_GOAL_COMPLETION_MATRIX.md")) || "";
  const apiFreeze = readText(path.join(root, "docs", "API_FREEZE.md")) || "";

  const checks = [
    makeCheck(
      "package.version_release_format",
      typeof version === "string" && RELEASE_VERSION_RE.test(version),
      RELEASE_VERSION_RE.test(version) ? `package version is release-formatted: ${version}` : `package version is not release-formatted: ${version}`,
      { version },
    ),
    makeCheck(
      "package_lock.version_matches",
      packageLock?.version === version && packageLock?.packages?.[""]?.version === version,
      packageLock?.version === version && packageLock?.packages?.[""]?.version === version
        ? "package-lock root versions match package.json"
        : "package-lock root versions do not match package.json",
      { packageVersion: version, lockVersion: packageLock?.version || null, rootPackageVersion: packageLock?.packages?.[""]?.version || null },
    ),
    checkRequiredDocs(root, options.requiredDocs || REQUIRED_RELEASE_DOCS),
    makeCheck(
      "docs.acceptance_current_version",
      !!statFile(path.join(root, acceptancePath)),
      statFile(path.join(root, acceptancePath)) ? `current acceptance report exists: ${acceptancePath}` : `current acceptance report missing: ${acceptancePath}`,
      { acceptancePath },
    ),
    makeCheck(
      "docs.changelog_current_section",
      changelog.includes(versionHeading(version)),
      changelog.includes(versionHeading(version)) ? `CHANGELOG has current section ${versionHeading(version)}` : `CHANGELOG missing current section ${versionHeading(version)}`,
      { heading: versionHeading(version) },
    ),
    makeCheck(
      "docs.design_matrix_current_version",
      designMatrix.includes(version),
      designMatrix.includes(version) ? "design goal matrix references current package version" : "design goal matrix does not reference current package version",
      { version },
    ),
    makeCheck(
      "docs.api_freeze_mentions_lts",
      /api freeze|frozen api|冻结/i.test(apiFreeze) && apiFreeze.includes("v5.0"),
      "API freeze document exists and declares the v5.0 release surface",
      { path: "docs/API_FREEZE.md" },
    ),
    checkBenchmarkCorpus(root, minBenchmarkScenarios),
    makeCheck(
      "benchmarks.baseline_and_thresholds",
      !!statFile(path.join(root, "benchmarks", "baseline-v4.0.9.json")) && !!statFile(path.join(root, "benchmarks", "thresholds.json")),
      "benchmark baseline and thresholds are present",
      { baseline: "benchmarks/baseline-v4.0.9.json", thresholds: "benchmarks/thresholds.json" },
    ),
    checkReadmeVersionBadge(root, version),
    checkReadmeTestBadge(root, options.expectedTestCount ?? 773),
    checkReadmeCloneBranch(root, version),
    checkManifestVersion(root, version),
    checkManifestMinAppVersion(root, options.requiredMinAppVersion || REQUIRED_MIN_APP_VERSION),
    checkApiFreezeVersion(root, version),
    checkReadmeTestCount(root, options.expectedTestCount ?? 773),
    ...(options.requireDistPackage ? [checkDistPackage(root)] : []),
    checkComplexityBudget(root, options),
  ];

  const failed = checks.filter((check) => !check.ok);
  const score = checks.length === 0 ? 100 : Math.round(((checks.length - failed.length) / checks.length) * 100);
  const status = failed.length === 0 ? "ready" : "blocked";
  const summary = {
    status,
    ok: failed.length === 0,
    version,
    score,
    passed: checks.length - failed.length,
    failed: failed.length,
    total: checks.length,
    failedChecks: failed.map((check) => check.id),
    nextAction: failed.length === 0 ? "release can proceed after npm run build, npm run check, npm test, npm run benchmark, npm run perf, and npm audit pass" : "fix failed release-readiness checks before publishing",
  };

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    summary,
    checks,
  };
}

export function formatReleaseReadinessReport(result = {}) {
  const summary = result.summary || {};
  const lines = [];
  lines.push("# Release Readiness Report");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt || new Date().toISOString()}`);
  lines.push(`Version: ${summary.version || "unknown"}`);
  lines.push(`Status: ${summary.status || "unknown"}`);
  lines.push(`Score: ${summary.score ?? "n/a"}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("| Check | Status | Message |");
  lines.push("|---|---|---|");
  for (const check of result.checks || []) {
    lines.push(`| ${check.id} | ${check.status} | ${String(check.message || "").replaceAll("|", "\\|")} |`);
  }
  lines.push("");
  lines.push("## Next action");
  lines.push("");
  lines.push(summary.nextAction || "review failed checks");
  return `${lines.join("\n")}\n`;
}

export function exportReleaseReadiness(projectRoot = process.cwd(), outputDir, options = {}) {
  const result = buildReleaseReadiness(projectRoot, options);
  const dir = path.resolve(outputDir || path.join(projectRoot, "release-readiness"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "release-readiness.json"), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  fs.writeFileSync(path.join(dir, "release-readiness.md"), formatReleaseReadinessReport(result), "utf-8");
  return { ...result, outputDir: dir, status: result.summary.status };
}
