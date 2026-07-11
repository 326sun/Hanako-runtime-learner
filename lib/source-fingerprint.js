import crypto from "crypto";
import fs from "fs";
import path from "path";

const ROOT_FILES = [
  ".gitignore",
  "ARCHITECTURE.md",
  "CHANGELOG.md",
  "INSTALL.md",
  "LICENSE",
  "README.md",
  "index.js",
  "install.cjs",
  "manifest.json",
  "package-lock.json",
  "package.json",
];
const SOURCE_DIRS = [".github", "benchmarks", "docs", "lib", "scripts", "skills", "tests", "tools"];

function listTreeFiles(root, relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...listTreeFiles(root, relative));
    else if (entry.isFile()) files.push(relative.replace(/\\/g, "/"));
  }
  return files;
}

export function releaseInputFiles(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  return [
    ...ROOT_FILES.filter((file) => fs.existsSync(path.join(root, file))),
    ...SOURCE_DIRS.flatMap((dir) => listTreeFiles(root, dir)),
  ].sort();
}

export function computeSourceFingerprint(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const hash = crypto.createHash("sha256");
  for (const relative of releaseInputFiles(root)) {
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
