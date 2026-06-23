import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { parseToolResult } from "./_test-utils.js";

function mkDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

test("self_learning_search reads runtime-config.json instead of host-owned config.json", async () => {
  const dataDir = mkDataDir("runtime-config-search-");
  try {
    writeJson(path.join(dataDir, "patterns.json"), []);
    writeJson(path.join(dataDir, "config.json"), {
      schemaVersion: 1,
      global: { officialMemoryBridgeEnabled: true, officialMemoryBridgeMaxResults: 9 },
      agents: {},
      sessions: {},
    });
    writeJson(path.join(dataDir, "runtime-config.json"), {
      officialMemoryBridgeEnabled: false,
      officialMemoryBridgeMaxResults: 1,
    });

    const searchTool = await import(`../tools/search.js?runtime-config-search-${Date.now()}`);
    const result = parseToolResult(await searchTool.execute({ query: "anything", limit: 5 }, { dataDir }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.officialMemory, []);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("self_learning_doctor reads runtime-config.json instead of host-owned config.json", async () => {
  const dataDir = mkDataDir("runtime-config-doctor-");
  try {
    writeJson(path.join(dataDir, "patterns.json"), []);
    writeJson(path.join(dataDir, "config.json"), {
      schemaVersion: 1,
      global: { governanceProfile: "balanced", semanticSearchEnabled: true },
      agents: {},
      sessions: {},
    });
    writeJson(path.join(dataDir, "runtime-config.json"), {
      governanceProfile: "balanced",
      autoInjectHighConfidence: true,
      autoApproveHighConfidence: true,
      includePendingPreferences: false,
      includeUsageInAdvisorPrompt: false,
      requireReviewForAutoApply: false,
      proposalChatNotificationsEnabled: false,
      workStatusEnabled: false,
      modelAdvisorEnabled: false,
      semanticSearchEnabled: false,
    });

    const doctorTool = await import(`../tools/doctor.js?runtime-config-doctor-${Date.now()}`);
    const report = doctorTool.runDoctorFromDisk(dataDir);

    assert.equal(report.status, "good");
    assert.ok(!report.issues.some((issue) => issue.type === "policy_inconsistent"));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
