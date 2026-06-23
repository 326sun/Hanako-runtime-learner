import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { runtimeConfigPath, migrateRuntimeConfigFile, RUNTIME_CONFIG_FILENAME } from "../lib/runtime-config-path.js";

describe("runtime-config-path", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `rcfg-${process.pid}-`));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const legacy = () => path.join(dir, "config.json");
  const current = () => path.join(dir, RUNTIME_CONFIG_FILENAME);

  it("runtimeConfigPath points at runtime-config.json, never config.json", () => {
    assert.equal(runtimeConfigPath(dir), path.join(dir, "runtime-config.json"));
    assert.notEqual(path.basename(runtimeConfigPath(dir)), "config.json");
  });

  it("no-ops when there is no legacy file and creates nothing", () => {
    const r = migrateRuntimeConfigFile(dir);
    assert.equal(r.migrated, false);
    assert.equal(r.reason, "no-legacy-file");
    assert.equal(fs.existsSync(current()), false);
  });

  it("moves a legacy flat config.json to runtime-config.json, preserving content", () => {
    fs.writeFileSync(legacy(), JSON.stringify({ governanceProfile: "balanced", minInjectScore: 8 }));
    const r = migrateRuntimeConfigFile(dir);
    assert.equal(r.migrated, true);
    assert.equal(fs.existsSync(legacy()), false, "config.json is freed for the host store");
    assert.equal(fs.existsSync(current()), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(current(), "utf-8")), { governanceProfile: "balanced", minInjectScore: 8 });
  });

  it("never touches a host-shaped config.json ({global,...})", () => {
    const hostShape = { schemaVersion: 1, global: { governanceProfile: "balanced" }, agents: {}, sessions: {} };
    fs.writeFileSync(legacy(), JSON.stringify(hostShape));
    const r = migrateRuntimeConfigFile(dir);
    assert.equal(r.migrated, false);
    assert.equal(r.reason, "host-owned-config");
    assert.equal(fs.existsSync(current()), false, "must not create runtime-config.json from host data");
    assert.deepEqual(JSON.parse(fs.readFileSync(legacy(), "utf-8")), hostShape, "host config.json left intact");
  });

  it("is idempotent: once migrated, leaves any later config.json alone", () => {
    fs.writeFileSync(current(), JSON.stringify({ minInjectScore: 5 }));
    fs.writeFileSync(legacy(), JSON.stringify({ schemaVersion: 1, global: {} }));
    const r = migrateRuntimeConfigFile(dir);
    assert.equal(r.migrated, false);
    assert.equal(r.reason, "already-migrated");
    assert.deepEqual(JSON.parse(fs.readFileSync(current(), "utf-8")), { minInjectScore: 5 });
    assert.equal(fs.existsSync(legacy()), true);
  });

  it("leaves an unreadable legacy file in place without throwing", () => {
    fs.writeFileSync(legacy(), "{ not json");
    const r = migrateRuntimeConfigFile(dir);
    assert.equal(r.migrated, false);
    assert.equal(r.reason, "legacy-unreadable");
    assert.equal(fs.existsSync(legacy()), true);
    assert.equal(fs.existsSync(current()), false);
  });
});
