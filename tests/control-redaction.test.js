/**
 * Characterization tests that LOCK the two distinct config-redaction behaviors
 * (C-001 phase 3c). They are deliberately separate functions with different
 * semantics and must NOT be merged:
 *
 *   - tools/control.js redactConfig (via execute "status"): masks only a fixed
 *     two-key allowlist with "***"; leaves URLs and everything else untouched.
 *   - lib/audit-bundle.js redactConfig (via buildAuditBundle): regex-masks any
 *     api-key/token/secret/password key with "[redacted]", and reduces url/
 *     endpoint values to their origin.
 *
 * Both are exercised through their public entry points, so no private function
 * is exported and no redaction logic is moved.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { buildAuditBundle } from "../lib/audit-bundle.js";

// ── control.js redactConfig (fixed allowlist, "***", URLs untouched) ──

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `control-redact-${process.pid}-${Date.now()}`));
const savedHanaHome = process.env.HANA_HOME;
process.env.HANA_HOME = tmpHome;

let control;
const learnerDir = path.join(tmpHome, "self-learning");

before(async () => {
  fs.mkdirSync(learnerDir, { recursive: true });
  control = await import("../tools/control.js");
  fs.writeFileSync(path.join(learnerDir, "patterns.json"), "[]", "utf-8");
  fs.writeFileSync(path.join(learnerDir, "runtime-config.json"), JSON.stringify({
    modelAdvisorApiKey: "sk-secret-advisor",
    semanticEmbeddingApiKey: "sk-secret-embedding",
    modelAdvisorBaseUrl: "https://api.example.com/v1/private-path",
    modelAdvisorEnabled: true,
  }), "utf-8");
});

after(() => {
  if (savedHanaHome === undefined) delete process.env.HANA_HOME;
  else process.env.HANA_HOME = savedHanaHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

async function statusConfig() {
  const raw = await control.execute({ action: "status" }, { pluginDir: tmpHome });
  const text = raw?.content?.[0]?.text ?? (typeof raw === "string" ? raw : JSON.stringify(raw));
  return JSON.parse(text).config;
}

describe("control.js redactConfig (via execute status)", () => {
  it("masks exactly the two sensitive keys with '***'", async () => {
    const cfg = await statusConfig();
    assert.equal(cfg.modelAdvisorApiKey, "***");
    assert.equal(cfg.semanticEmbeddingApiKey, "***");
  });

  it("does NOT touch URL/base-url values (key difference vs audit-bundle)", async () => {
    const cfg = await statusConfig();
    assert.equal(cfg.modelAdvisorBaseUrl, "https://api.example.com/v1/private-path");
  });

  it("leaves non-sensitive keys unchanged", async () => {
    const cfg = await statusConfig();
    assert.equal(cfg.modelAdvisorEnabled, true);
  });
});

// ── audit-bundle.js redactConfig (regex mask "[redacted]", URL→origin) ──

describe("lib/audit-bundle.js redactConfig (via buildAuditBundle)", () => {
  function redactedConfig(config) {
    return buildAuditBundle({ config }).config;
  }

  it("regex-masks api-key / token / secret / password keys with '[redacted]'", () => {
    const out = redactedConfig({
      modelAdvisorApiKey: "sk-x",
      authToken: "tok-y",
      mySecret: "s",
      password: "p",
    });
    assert.equal(out.modelAdvisorApiKey, "[redacted]");
    assert.equal(out.authToken, "[redacted]");
    assert.equal(out.mySecret, "[redacted]");
    assert.equal(out.password, "[redacted]");
  });

  it("reduces url/endpoint string values to their origin", () => {
    const out = redactedConfig({
      modelAdvisorBaseUrl: "https://api.example.com/v1/private-path?token=abc",
      someEndpoint: "https://host.example.org:8443/deep/path",
    });
    assert.equal(out.modelAdvisorBaseUrl, "https://api.example.com");
    assert.equal(out.someEndpoint, "https://host.example.org:8443");
  });

  it("keeps falsy sensitive values and non-matching keys unchanged", () => {
    const out = redactedConfig({
      modelAdvisorApiKey: "",      // sensitive but falsy → left as-is
      modelAdvisorEnabled: true,   // non-matching → untouched
      plainNumber: 42,
    });
    assert.equal(out.modelAdvisorApiKey, "");
    assert.equal(out.modelAdvisorEnabled, true);
    assert.equal(out.plainNumber, 42);
  });

  it("uses a different mask token than control.js ('[redacted]' not '***')", () => {
    const out = redactedConfig({ modelAdvisorApiKey: "sk-x" });
    assert.notEqual(out.modelAdvisorApiKey, "***");
    assert.equal(out.modelAdvisorApiKey, "[redacted]");
  });
});
