/**
 * Unit tests for lib/credentials.js — encryption, migration, merge.
 * Run: node --test tests/credentials.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

// Before importing, we need to ensure we have a clean test data dir.
// The credentials module reads from learnerDir(), so we'll test the pure
// functions (encrypt/decrypt round-trip is internal but testable through
// saveCredentials/loadCredentials).

import {
  loadCredentials,
  saveCredentials,
  mergeCredentials,
  extractAndSaveCredentials,
  detectPlaintextCredentials,
  panelCredentialsToStore,
  CREDENTIAL_PLACEHOLDER,
  SENSITIVE_KEYS,
} from "../lib/credentials.js";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `credentials-test-${process.pid}-${Date.now()}`));
const oldHanaHome = process.env.HANA_HOME;

before(() => {
  process.env.HANA_HOME = tmpHome;
});

after(() => {
  if (oldHanaHome === undefined) delete process.env.HANA_HOME;
  else process.env.HANA_HOME = oldHanaHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("SENSITIVE_KEYS", () => {
  it("covers modelAdvisorApiKey", () => {
    assert.ok(SENSITIVE_KEYS.has("modelAdvisorApiKey"));
  });
  it("covers semanticEmbeddingApiKey", () => {
    assert.ok(SENSITIVE_KEYS.has("semanticEmbeddingApiKey"));
  });
  it("does not include non-sensitive keys", () => {
    assert.equal(SENSITIVE_KEYS.has("modelAdvisorEnabled"), false);
    assert.equal(SENSITIVE_KEYS.has("learnFromUsage"), false);
  });
});

describe("panelCredentialsToStore · capture API keys typed into the settings panel", () => {
  it("returns real panel-provided credential values to be encrypted", () => {
    const out = panelCredentialsToStore({ modelAdvisorApiKey: "sk-typed-in-panel" });
    assert.deepEqual(out, { modelAdvisorApiKey: "sk-typed-in-panel" });
  });

  it("ignores blank, placeholder, and masked values (nothing to capture)", () => {
    assert.deepEqual(panelCredentialsToStore({ modelAdvisorApiKey: "" }), {});
    assert.deepEqual(panelCredentialsToStore({ modelAdvisorApiKey: "   " }), {});
    assert.deepEqual(panelCredentialsToStore({ modelAdvisorApiKey: CREDENTIAL_PLACEHOLDER }), {});
    assert.deepEqual(panelCredentialsToStore({ modelAdvisorApiKey: "***redacted" }), {});
  });

  it("ignores non-sensitive keys and a missing/invalid panel object", () => {
    assert.deepEqual(panelCredentialsToStore({ modelAdvisorEnabled: true, learnFromUsage: false }), {});
    assert.deepEqual(panelCredentialsToStore(null), {});
    assert.deepEqual(panelCredentialsToStore(undefined), {});
    assert.deepEqual(panelCredentialsToStore("nope"), {});
  });

  it("captures both sensitive keys when both are provided, trimming whitespace", () => {
    const out = panelCredentialsToStore({
      modelAdvisorApiKey: "  sk-a  ",
      semanticEmbeddingApiKey: "sk-b",
      modelAdvisorBaseUrl: "https://x",
    });
    assert.deepEqual(out, { modelAdvisorApiKey: "sk-a", semanticEmbeddingApiKey: "sk-b" });
  });

  it("extracts values from a v0.341+ method-based config store via getAll()", () => {
    const store = {
      getAll: () => ({ modelAdvisorApiKey: "  sk-method  ", semanticEmbeddingApiKey: "sk-embed", learnFromUsage: true }),
    };
    assert.deepEqual(panelCredentialsToStore(store), {
      modelAdvisorApiKey: "sk-method",
      semanticEmbeddingApiKey: "sk-embed",
    });
  });

  it("tolerates a method-based store whose getAll() returns nothing", () => {
    assert.deepEqual(panelCredentialsToStore({ getAll: () => null }), {});
    assert.deepEqual(panelCredentialsToStore({ getAll: () => undefined }), {});
  });
});

describe("credentials round-trip", () => {
  it("saves and loads a single credential", () => {
    saveCredentials({ modelAdvisorApiKey: "sk-test-roundtrip-key" });
    const creds = loadCredentials();
    assert.equal(creds.modelAdvisorApiKey, "sk-test-roundtrip-key");
  });

  it("saves and loads multiple credentials", () => {
    saveCredentials({
      modelAdvisorApiKey: "sk-advisor-key",
      semanticEmbeddingApiKey: "sk-embedding-key",
    });
    const creds = loadCredentials();
    assert.equal(creds.modelAdvisorApiKey, "sk-advisor-key");
    assert.equal(creds.semanticEmbeddingApiKey, "sk-embedding-key");
  });

  it("ignores non-sensitive keys in saveCredentials", () => {
    saveCredentials({ modelAdvisorApiKey: "sk-key", notSensitive: "plain-text" });
    const creds = loadCredentials();
    assert.equal(creds.modelAdvisorApiKey, "sk-key");
    assert.equal("notSensitive" in creds, false);
  });

  it("clears credentials when saving empty entries", () => {
    saveCredentials({ modelAdvisorApiKey: "sk-key" });
    saveCredentials({});
    const creds = loadCredentials();
    assert.equal(Object.keys(creds).length, 0);
  });
});

describe("mergeCredentials", () => {
  it("merges encrypted credentials into config", () => {
    saveCredentials({ modelAdvisorApiKey: "sk-encrypted-key" });
    const config = mergeCredentials({
      modelAdvisorApiKey: "",
      modelAdvisorEnabled: false,
    });
    assert.equal(config.modelAdvisorApiKey, "sk-encrypted-key");
    assert.equal(config.modelAdvisorEnabled, false);
  });

  it("preserves non-sensitive config keys", () => {
    saveCredentials({ modelAdvisorApiKey: "sk-key" });
    const config = mergeCredentials({
      modelAdvisorApiKey: "",
      learnFromUsage: true,
      minInjectScore: 8,
    });
    assert.equal(config.learnFromUsage, true);
    assert.equal(config.minInjectScore, 8);
  });

  it("returns original config when no credentials exist", () => {
    saveCredentials({});
    const config = mergeCredentials({ learnFromUsage: true });
    assert.equal(config.learnFromUsage, true);
  });
});

describe("detectPlaintextCredentials", () => {
  it("detects plaintext keys in config", () => {
    const plain = detectPlaintextCredentials({
      modelAdvisorApiKey: "sk-plaintext-key",
      semanticEmbeddingApiKey: "",
    });
    assert.deepStrictEqual(plain, ["modelAdvisorApiKey"]);
  });

  it("ignores placeholder values", () => {
    const plain = detectPlaintextCredentials({
      modelAdvisorApiKey: "(stored in credentials.enc)",
      semanticEmbeddingApiKey: "***",
    });
    assert.equal(plain.length, 0);
  });

  it("ignores empty strings", () => {
    const plain = detectPlaintextCredentials({
      modelAdvisorApiKey: "",
      semanticEmbeddingApiKey: "",
    });
    assert.equal(plain.length, 0);
  });
});

describe("extractAndSaveCredentials", () => {
  it("extracts sensitive keys and returns sanitised patch", () => {
    saveCredentials({});
    const sanitised = extractAndSaveCredentials({
      modelAdvisorApiKey: "sk-new-key",
      modelAdvisorEnabled: true,
      minInjectScore: 10,
    });
    assert.equal(sanitised.modelAdvisorApiKey, "(stored in credentials.enc)");
    assert.equal(sanitised.modelAdvisorEnabled, true);
    assert.equal(sanitised.minInjectScore, 10);
    const creds = loadCredentials();
    assert.equal(creds.modelAdvisorApiKey, "sk-new-key");
  });

  it("does not modify patch with no sensitive keys", () => {
    const sanitised = extractAndSaveCredentials({
      modelAdvisorEnabled: false,
      minInjectScore: 5,
    });
    assert.equal(sanitised.modelAdvisorEnabled, false);
    assert.equal(sanitised.minInjectScore, 5);
  });

  it("preserves credentials omitted from a partial patch", () => {
    saveCredentials({ modelAdvisorApiKey: "advisor-old", semanticEmbeddingApiKey: "embedding-keep" });
    extractAndSaveCredentials({ modelAdvisorApiKey: "advisor-new" });
    assert.deepEqual(loadCredentials(), {
      modelAdvisorApiKey: "advisor-new",
      semanticEmbeddingApiKey: "embedding-keep",
    });
  });

  it("isolates credential stores by host-provided dataDir", () => {
    const one = fs.mkdtempSync(path.join(os.tmpdir(), "credentials-one-"));
    const two = fs.mkdtempSync(path.join(os.tmpdir(), "credentials-two-"));
    saveCredentials({ modelAdvisorApiKey: "one" }, { dataDir: one });
    saveCredentials({ modelAdvisorApiKey: "two" }, { dataDir: two });
    assert.equal(loadCredentials({ dataDir: one }).modelAdvisorApiKey, "one");
    assert.equal(loadCredentials({ dataDir: two }).modelAdvisorApiKey, "two");
    assert.ok(fs.existsSync(path.join(one, "credentials.enc")));
    assert.ok(fs.existsSync(path.join(two, "credentials.enc")));
    fs.rmSync(one, { recursive: true, force: true });
    fs.rmSync(two, { recursive: true, force: true });
  });
});
