import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { resolveOfficialUtilityAdvisorConfig } from "../lib/official-utility-model.js";

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "official-utility-model-"));
  const oldHome = process.env.HANA_HOME;
  process.env.HANA_HOME = home;
  try {
    fs.mkdirSync(path.join(home, "user"), { recursive: true });
    return fn(home);
  } finally {
    if (oldHome === undefined) delete process.env.HANA_HOME;
    else process.env.HANA_HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function writePrefs(home, prefs) {
  fs.writeFileSync(path.join(home, "user", "preferences.json"), JSON.stringify(prefs, null, 2), "utf-8");
}

function writeAddedModels(home, text) {
  fs.writeFileSync(path.join(home, "added-models.yaml"), text, "utf-8");
}

test("official utility config reads provider credentials from a structurally valid added-models.yaml", () => withHome((home) => {
  writePrefs(home, { utility_model: "openai/gpt-small" });
  writeAddedModels(home, `
providers:
  openai:
    api_key: sk-test
    base_url: https://api.example.com
    api: openai-completions
models:
  - id: openai/gpt-small
`);

  const result = resolveOfficialUtilityAdvisorConfig();
  assert.equal(result.ok, true);
  assert.equal(result.config.modelAdvisorResolvedProvider, "openai");
  assert.equal(result.config.modelAdvisorApiKey, "sk-test");
  assert.equal(result.config.modelAdvisorBaseUrl, "https://api.example.com");
  assert.equal(result.config.modelAdvisorModel, "gpt-small");
}));

test("official utility config fails closed when provider credentials use unsupported YAML block scalars", () => withHome((home) => {
  writePrefs(home, { utility_model: "openai/gpt-small" });
  writeAddedModels(home, `
providers:
  openai:
    api_key: |
      sk-test
    base_url: https://api.example.com
    api: openai-completions
`);

  const result = resolveOfficialUtilityAdvisorConfig();
  assert.equal(result.ok, false);
  assert.match(result.reason, /credentials are incomplete/);
}));

test("official utility config does not mistake model entries for providers", () => withHome((home) => {
  writePrefs(home, { utility_model: "openai/gpt-small" });
  writeAddedModels(home, `
models:
  openai:
    api_key: sk-from-model-section
    base_url: https://wrong.example.com
providers:
  anthropic:
    api_key: sk-other
    base_url: https://api.other.example.com
    api: openai-completions
`);

  const result = resolveOfficialUtilityAdvisorConfig();
  assert.equal(result.ok, false);
  assert.match(result.reason, /credentials are incomplete/);
}));

test("official utility config rejects sequence-style providers instead of guessing", () => withHome((home) => {
  writePrefs(home, { utility_model: "openai/gpt-small" });
  writeAddedModels(home, `
providers:
  - id: openai
    api_key: sk-test
    base_url: https://api.example.com
`);

  const result = resolveOfficialUtilityAdvisorConfig();
  assert.equal(result.ok, false);
  assert.match(result.reason, /credentials are incomplete/);
}));
