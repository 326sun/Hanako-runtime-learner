import fs from "fs";
import path from "path";

export const SOURCE_ROOT_METADATA = ".source-root.json";

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function existsDir(dirPath) {
  try { return fs.statSync(dirPath).isDirectory(); } catch { return false; }
}

function existsFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

export function isPluginProjectRoot(dir) {
  if (!dir || !existsDir(dir)) return false;
  return existsFile(path.join(dir, "manifest.json"))
    && existsFile(path.join(dir, "package.json"))
    && existsFile(path.join(dir, "index.js"));
}

export function hasReleaseArtifacts(dir) {
  if (!isPluginProjectRoot(dir)) return false;
  return existsFile(path.join(dir, "package-lock.json"))
    && existsFile(path.join(dir, "CHANGELOG.md"))
    && existsDir(path.join(dir, "benchmarks", "scenarios"))
    && existsFile(path.join(dir, "scripts", "release-readiness.js"));
}

export function hasBenchmarkCorpus(dir) {
  if (!dir || !existsDir(dir)) return false;
  return existsDir(path.join(dir, "benchmarks", "scenarios"));
}

function normalizeCandidate(candidate, source) {
  if (!candidate || typeof candidate !== "string") return null;
  const resolved = path.resolve(candidate);
  return { path: resolved, source };
}

function metadataSourceRoot(pluginDir) {
  const metaPath = path.join(pluginDir || "", SOURCE_ROOT_METADATA);
  const meta = readJson(metaPath);
  return normalizeCandidate(meta?.sourceRoot, "metadata");
}

export function projectRootCandidates(input = {}, paths = {}, env = process.env) {
  const candidates = [];
  for (const item of [
    normalizeCandidate(input.projectRoot, "input.projectRoot"),
    normalizeCandidate(input.sourceRoot, "input.sourceRoot"),
    normalizeCandidate(env.HANAKO_RUNTIME_LEARNER_SOURCE_ROOT, "env.HANAKO_RUNTIME_LEARNER_SOURCE_ROOT"),
    normalizeCandidate(env.SELF_EVOLVE_SOURCE_ROOT, "env.SELF_EVOLVE_SOURCE_ROOT"),
    metadataSourceRoot(paths.pluginDir),
    normalizeCandidate(paths.pluginDir, "pluginDir"),
  ]) {
    if (item && !candidates.some((c) => c.path === item.path)) candidates.push(item);
  }
  return candidates;
}

export function resolveProjectRoot(input = {}, paths = {}, options = {}) {
  const requireReleaseArtifacts = options.requireReleaseArtifacts === true;
  const requireBenchmarkCorpus = options.requireBenchmarkCorpus === true;
  const candidates = projectRootCandidates(input, paths, options.env || process.env);
  const checked = [];
  for (const candidate of candidates) {
    const isProject = isPluginProjectRoot(candidate.path);
    const releaseReady = hasReleaseArtifacts(candidate.path);
    const benchmarkReady = hasBenchmarkCorpus(candidate.path);
    checked.push({ ...candidate, isProject, releaseReady, benchmarkReady });
    if (!isProject) continue;
    if (requireReleaseArtifacts && !releaseReady) continue;
    if (requireBenchmarkCorpus && !benchmarkReady) continue;
    return { ok: true, projectRoot: candidate.path, source: candidate.source, checked };
  }
  const missing = requireReleaseArtifacts
    ? "release artifacts"
    : requireBenchmarkCorpus
      ? "benchmark corpus"
      : "plugin project root";
  return {
    ok: false,
    projectRoot: null,
    source: null,
    reason: `No usable ${missing} found. Runtime plugin packages are intentionally trimmed; provide input.projectRoot/sourceRoot or install with ${SOURCE_ROOT_METADATA}.`,
    checked,
  };
}

export function writeSourceRootMetadata(pluginDir, sourceRoot, extra = {}) {
  if (!pluginDir || !sourceRoot) return null;
  const filePath = path.join(pluginDir, SOURCE_ROOT_METADATA);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ sourceRoot: path.resolve(sourceRoot), ...extra }, null, 2)}\n`, "utf-8");
  return filePath;
}
