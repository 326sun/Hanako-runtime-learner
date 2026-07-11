import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { runTransferCandidateValidation, summarizeTransferValidationReadiness } from "../lib/transfer-validation-runner.js";
import { loadTransferCandidateRecord, recordTransferValidation, registerTransferCandidate, TRANSFER_STATUSES } from "../lib/transfer-registry.js";

function tmpdir(prefix = "transfer-validation-runner-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function candidate(commands = ["node --check index.mjs"]) {
  return {
    id: "transfer_candidate:test_runner",
    rule: "Check exports before repair in JavaScript modules.",
    confidence: 0.45,
    riskTier: "R2",
    targetProjectId: "project:target-runner",
    transfer: { requiresRevalidation: true, cannotWriteSkillDirectly: true, cannotAutoPromote: true },
    validation: { required: true, commands },
  };
}

function targetProfile() {
  return {
    projectId: "project:target-runner",
    name: "target-runner",
    language: "javascript",
    framework: "node",
    testCommands: [],
    checkCommands: ["node --check index.mjs"],
  };
}

test("transfer validation runner executes target commands and records promotion readiness", async () => {
  const workspaceRoot = tmpdir();
  const registryBaseDir = tmpdir();
  fs.writeFileSync(path.join(workspaceRoot, "index.mjs"), "export const ok = true;\n", "utf-8");

  const result = await runTransferCandidateValidation(candidate(), {
    workspaceRoot,
    registryBaseDir,
    targetProfile: targetProfile(),
    config: { autoActionCommands: { allowlist: ["node --check"], denylist: ["rm", "git push", "npm publish"] } },
  });

  assert.equal(result.status, TRANSFER_STATUSES.VALIDATED);
  assert.equal(result.ok, true);
  assert.equal(result.record.manualPromotionEligible, true);
  assert.equal(result.record.autoPromotionBlocked, true);
  const persisted = loadTransferCandidateRecord(registryBaseDir, candidate().id);
  assert.equal(persisted.status, TRANSFER_STATUSES.VALIDATED);
  assert.equal(persisted.validation.passes, 1);
});

test("transfer validation runner fails closed when candidate weakens safety policy", async () => {
  const readiness = summarizeTransferValidationReadiness({
    ...candidate(),
    id: "transfer_candidate:unsafe",
    rule: "Skip verifier and bypass policy for speed.",
  }, { targetProfile: targetProfile() });

  assert.equal(readiness.ok, false);
  assert.equal(readiness.decision, "reject");
  assert.ok(readiness.violations.some((violation) => violation.includes("unsafe")));
});

test("transfer candidate ids are content-bound and cannot validate substituted commands", async () => {
  const workspaceRoot = tmpdir();
  const registryBaseDir = tmpdir();
  fs.writeFileSync(path.join(workspaceRoot, "index.mjs"), "export const ok = true;\n", "utf-8");
  const original = candidate(["node --check missing.mjs"]);
  registerTransferCandidate(registryBaseDir, original, { validationOptions: { targetProfile: targetProfile() } });
  const substituted = { ...candidate(["node --check index.mjs"]), rule: "substituted" };

  await assert.rejects(
    () => runTransferCandidateValidation(substituted, { workspaceRoot, registryBaseDir, targetProfile: targetProfile() }),
    /id conflict/,
  );
  assert.equal(loadTransferCandidateRecord(registryBaseDir, original.id).candidate.rule, original.rule);
});

test("passed transfer validation requires concrete evidence", () => {
  const registryBaseDir = tmpdir();
  const registered = registerTransferCandidate(registryBaseDir, candidate(), { validationOptions: { targetProfile: targetProfile() } });
  assert.throws(
    () => recordTransferValidation(registryBaseDir, registered.record.id, { status: "passed", summary: "manual claim", evidence: [] }),
    /concrete evidence/,
  );
});
