import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRuntimeConfig } from "../lib/runtime-live-config.js";

describe("runtime live config · startup failure policy", () => {
  it("propagates non-parse read failures instead of silently enabling defaults", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanako-runtime-config-"));
    const configPath = path.join(dataDir, "runtime-config.json");
    fs.mkdirSync(configPath); // reading a directory as UTF-8 is an operational error
    const rt = {
      paths: { DATA_DIR: dataDir, CONFIG_FILE: configPath },
      timer: { mark() {} },
    };
    const ctx = { log: { info() {} } };

    try {
      assert.throws(() => loadRuntimeConfig(ctx, rt));
      assert.equal(rt.config, undefined, "must not install default config after an I/O error");
      assert.equal(fs.statSync(configPath).isDirectory(), true, "must not overwrite the failing path");
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
