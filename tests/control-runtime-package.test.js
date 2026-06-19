import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { execute as executeControl } from "../tools/control.js";
import { openDirectoryCommand } from "../tools/open-dir.js";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function copyRuntimePackageFixture(sourceRoot) {
  const runtime = tmp("runtime-package-");
  for (const file of ["manifest.json", "package.json", "index.js", "README.md", "ARCHITECTURE.md", "INSTALL.md", "LICENSE"]) {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(runtime, file));
  }
  for (const dir of ["lib", "tools", "skills", "docs"]) {
    fs.cpSync(path.join(sourceRoot, dir), path.join(runtime, dir), { recursive: true });
  }
  return runtime;
}

function withHome(fn) {
  const oldHome = process.env.HANA_HOME;
  const home = tmp("runtime-package-home-");
  process.env.HANA_HOME = home;
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      if (oldHome == null) delete process.env.HANA_HOME;
      else process.env.HANA_HOME = oldHome;
      fs.rmSync(home, { recursive: true, force: true });
    });
}

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("control release_readiness resolves source root metadata from a trimmed runtime package", async () => withHome(async () => {
  const runtime = copyRuntimePackageFixture(sourceRoot);
  write(path.join(runtime, ".source-root.json"), JSON.stringify({ sourceRoot }, null, 2));
  try {
    const result = JSON.parse(await executeControl({ action: "release_readiness", format: "json" }, { pluginDir: runtime }));
    assert.equal(result.ok, true);
    assert.equal(result.projectRoot, sourceRoot);
    assert.equal(result.projectRootSource, "metadata");
    assert.equal(result.summary.status, "ready");
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
}));

test("control release_readiness reports unavailable instead of blocked when only a trimmed runtime package is available", async () => withHome(async () => {
  const runtime = copyRuntimePackageFixture(sourceRoot);
  try {
    const result = JSON.parse(await executeControl({ action: "release_readiness", format: "json" }, { pluginDir: runtime }));
    assert.equal(result.ok, false);
    assert.equal(result.status, "unavailable");
    assert.match(result.reason, /Runtime plugin packages are intentionally trimmed/);
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
}));

test("control run_benchmarks uses source root metadata and writes a non-empty report", async () => withHome(async (home) => {
  const runtime = copyRuntimePackageFixture(sourceRoot);
  write(path.join(runtime, ".source-root.json"), JSON.stringify({ sourceRoot }, null, 2));
  const outputDir = path.join(home, "bench-out");
  try {
    const result = JSON.parse(await executeControl({ action: "run_benchmarks", benchmarkId: "quality.node_check_ok", benchmarkOutputDir: outputDir }, { pluginDir: runtime }));
    assert.equal(result.ok, true);
    assert.equal(result.projectRoot, sourceRoot);
    assert.equal(result.projectRootSource, "metadata");
    assert.equal(result.metrics.total, 1);
    assert.equal(fs.existsSync(path.join(outputDir, "benchmark-report.json")), true);
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
}));

test("open-dir uses argument-vector command construction on Windows", () => {
  const spec = openDirectoryCommand("C:\\Users\\me\\.hanako\\self-learning", "win32");
  assert.equal(spec.command, "cmd");
  assert.deepEqual(spec.args, ["/c", "start", "", "C:\\Users\\me\\.hanako\\self-learning"]);
});
