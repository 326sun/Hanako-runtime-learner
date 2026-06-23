/**
 * Integration test for tools/control.js credential decryption.
 *
 * Bug: control.js `execute` loaded config via loadLearnerConfig() but never
 * called mergeCredentials(), so a manual `run_model_advisor` on a private
 * endpoint read the on-disk placeholder ("(stored in credentials.enc)") instead
 * of the real, encrypted API key. With the placeholder now rejected as a key,
 * the advisor would report "api key missing" even though the key IS stored.
 * After the fix, execute decrypts credentials so the advisor uses the real key.
 *
 * We exercise it with zero patterns: resolveAdvisorConfig must pass the key gate,
 * then runModelAdvisor short-circuits at "no candidate patterns" BEFORE any
 * network call — so a successful decrypt surfaces as that benign reason.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `control-creds-${process.pid}-${Date.now()}`));
const savedHanaHome = process.env.HANA_HOME;
process.env.HANA_HOME = tmpHome;

let control;
let saveCredentials;
let loadCredentials;
let CREDENTIAL_PLACEHOLDER;
const learnerDir = path.join(tmpHome, "self-learning");

before(async () => {
  fs.mkdirSync(learnerDir, { recursive: true });
  ({ saveCredentials, loadCredentials, CREDENTIAL_PLACEHOLDER } = await import("../lib/credentials.js"));
  control = await import("../tools/control.js");
  // Real key lives only in the encrypted store; runtime-config.json keeps the placeholder.
  saveCredentials({ modelAdvisorApiKey: "sk-real-encrypted-key" });
  fs.writeFileSync(path.join(learnerDir, "runtime-config.json"), JSON.stringify({
    modelAdvisorEnabled: true,
    modelAdvisorSource: "private",
    modelAdvisorBaseUrl: "https://api.example.com",
    modelAdvisorModel: "small-1",
    modelAdvisorApiKey: CREDENTIAL_PLACEHOLDER,
    modelAdvisorMinIntervalMinutes: 60,
    minAdvisorNewPatterns: 0,
  }), "utf-8");
  fs.writeFileSync(path.join(learnerDir, "patterns.json"), "[]", "utf-8");
});

after(() => {
  if (savedHanaHome === undefined) delete process.env.HANA_HOME;
  else process.env.HANA_HOME = savedHanaHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("control.js run_model_advisor credential decryption", () => {
  it("decrypts the stored API key so the advisor gets past the key gate (no 401, no placeholder)", async () => {
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; throw new Error("network must not be reached with zero patterns"); };

    const rawResult = await control.execute({ action: "run_model_advisor" }, { pluginDir: tmpHome });
    const rawText = rawResult?.content?.[0]?.text ?? (typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult));
    const out = JSON.parse(rawText);

    // With the real key decrypted, resolveAdvisorConfig passes the key gate and
    // runModelAdvisor short-circuits at "no candidate patterns" (no network).
    // Without decryption the placeholder is rejected → "api key missing".
    assert.equal(out.ok, false);
    assert.match(out.error, /candidate/i);
    assert.doesNotMatch(out.error, /api key/i);
    assert.equal(fetched, false);
  });

  it("does not persist credentials from a rejected set_config patch", async () => {
    const beforeKey = loadCredentials().modelAdvisorApiKey;
    await assert.rejects(
      () => control.execute({
        action: "set_config",
        modelAdvisorApiKey: "sk-should-not-save",
        minInjectScore: "bad",
      }, { pluginDir: tmpHome }),
      /config validation failed/,
    );
    assert.equal(loadCredentials().modelAdvisorApiKey, beforeKey);
  });
});
