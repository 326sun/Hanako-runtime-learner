// Contract regression net against the Hanako host plugin schema.
//
// Two invariants verified against authoritative host source:
//
// 1. Credential redaction (core/plugin-config.ts · normalizeProperty):
//    the host honours ONLY `sensitive === true` for redaction. The JSON-Schema
//    `format: "password"` keyword is dropped during schema normalization, so a
//    field relying on `format` is returned in plaintext by getAll({redacted}),
//    getState({redacted}) and /api/plugins/settings. Every credential field
//    MUST declare `sensitive: true`, never `format: "password"`.
//
// 2. Manifest capability vocabulary (core/plugin-context.ts):
//    the host only gates on recognized capability names — `network.fetch` and
//    the `resource.*` family. Declaring inert names (e.g. "model.sample",
//    "session") gates nothing and misleads the diagnostics panel. The manifest
//    must not declare unrecognized capabilities.

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf-8"));
const props = manifest.contributes?.configuration?.properties || {};

// Host-recognized capability names (core/plugin-context.ts). Only these gate
// behaviour; "*" is the wildcard the host also accepts.
const RECOGNIZED_CAPABILITIES = new Set([
  "*",
  "network.fetch",
  "resource.read",
  "resource.search",
  "resource.write",
  "resource.materialize",
  "resource.watch",
]);

// Fields that carry secrets and must be redacted by the host.
const CREDENTIAL_KEYS = ["modelAdvisorApiKey", "semanticEmbeddingApiKey"];

// Panel-exposed fields whose effect is established at onload (event/schedule
// subscriptions), so a live config refresh cannot apply them — they need a
// plugin reload. These MUST flag it to the user. `learnFromUsage` gates the
// llm_usage subscription in observer.js (only subscribed when true at onload).
const RESTART_REQUIRED_KEYS = ["learnFromUsage"];

describe("manifest contract · host plugin schema", () => {
  it("credential fields declare sensitive:true (host ignores format:password)", () => {
    for (const key of CREDENTIAL_KEYS) {
      const spec = props[key];
      assert.ok(spec, `credential field "${key}" missing from manifest`);
      assert.strictEqual(
        spec.sensitive, true,
        `"${key}" must declare "sensitive": true so the host redacts it`,
      );
      assert.ok(
        !("format" in spec),
        `"${key}" must not rely on "format" — the host drops it; use sensitive:true + ui.control:password`,
      );
    }
  });

  it("no manifest property uses legacy format:password instead of sensitive", () => {
    for (const [key, spec] of Object.entries(props)) {
      if (spec && spec.format === "password") {
        assert.fail(`"${key}" uses format:password (ignored by host); declare sensitive:true instead`);
      }
    }
  });

  it("restart-required fields flag reloadRequired and warn the user in the description", () => {
    for (const key of RESTART_REQUIRED_KEYS) {
      const spec = props[key];
      assert.ok(spec, `restart-required field "${key}" missing from manifest`);
      assert.strictEqual(
        spec.reloadRequired, true,
        `"${key}" must declare "reloadRequired": true (host core/plugin-config.ts normalizes it)`,
      );
      assert.ok(
        typeof spec.description === "string" && spec.description.includes("重载"),
        `"${key}" description must tell the user the change needs a plugin reload`,
      );
    }
  });

  it("does not declare unrecognized host capabilities", () => {
    for (const field of ["capabilities", "sensitiveCapabilities"]) {
      const declared = manifest[field];
      if (declared === undefined) continue;
      assert.ok(Array.isArray(declared), `manifest.${field} must be an array when present`);
      for (const cap of declared) {
        assert.ok(
          RECOGNIZED_CAPABILITIES.has(cap),
          `manifest.${field} declares unrecognized capability "${cap}" — the host gates only network.fetch and resource.*`,
        );
      }
    }
  });
});
