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

const RESTART_REQUIRED_REASONS = {
  learnFromUsage: "observer usage subscription is established during onload",
};

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

  it("requires every reloadRequired field to be explicitly justified", () => {
    const actual = Object.entries(props)
      .filter(([, spec]) => spec?.reloadRequired === true)
      .map(([key]) => key)
      .sort();
    const expected = Object.keys(RESTART_REQUIRED_REASONS).sort();
    assert.deepEqual(actual, expected, "reloadRequired fields must be reviewed against onload-bound runtime behavior");
    for (const key of actual) {
      assert.ok(RESTART_REQUIRED_REASONS[key], `missing reloadRequired reason for ${key}`);
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

  it("keeps usage access under permissions instead of capabilities", () => {
    assert.ok(Array.isArray(manifest.permissions), "manifest.permissions must be an array");
    assert.ok(manifest.permissions.includes("usage.read"), "usage.read must stay declared under manifest.permissions");
    for (const field of ["capabilities", "sensitiveCapabilities"]) {
      assert.ok(
        !(manifest[field] || []).includes("usage.read"),
        `usage.read is not a ${field} entry in the current host schema`,
      );
    }
  });

  it("declares read-only dev scenarios for the host dev loop", () => {
    const scenarios = manifest.dev?.scenarios;
    assert.ok(Array.isArray(scenarios), "manifest.dev.scenarios must be an array");
    assert.ok(scenarios.length >= 3, "manifest.dev.scenarios should cover the main read-only smoke paths");
    assert.deepEqual(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length, "dev scenario ids must be unique");
    const invoked = new Set();
    for (const scenario of scenarios) {
      assert.ok(typeof scenario.id === "string" && scenario.id, "dev scenario id is required");
      assert.ok(Array.isArray(scenario.steps) && scenario.steps.length > 0, `dev scenario ${scenario.id} needs steps`);
      const invokeStep = scenario.steps.find((step) => step.invokeTool);
      assert.ok(invokeStep, `dev scenario ${scenario.id} needs an invokeTool step`);
      assert.ok(typeof invokeStep.invokeTool.name === "string" && invokeStep.invokeTool.name, `dev scenario ${scenario.id} needs a tool name`);
      invoked.add(invokeStep.invokeTool.name);
    }
    assert.ok(invoked.has("self_learning_stats"), "dev scenarios should cover self_learning_stats");
    assert.ok(invoked.has("self_learning_doctor"), "dev scenarios should cover self_learning_doctor");
    assert.ok(invoked.has("self_learning_control"), "dev scenarios should cover self_learning_control status");
  });
});
