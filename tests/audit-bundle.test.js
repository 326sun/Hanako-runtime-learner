/**
 * P8.D — export_audit_bundle stages/caps every governance data source
 * (facts, proposals, reviews, events, transfer candidates) by a single
 * caller-controlled `limit`, so a large audit history doesn't force the full
 * set into an explicit, one-off export.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execute as executeControl } from "../tools/control.js";
import { upsertProposal } from "../lib/proposals.js";
import { recordFact } from "../lib/facts.js";
import { parseToolResult } from "./_test-utils.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-bundle-test-"));

function seedProposal(learnerDir, i) {
  upsertProposal(learnerDir, {
    id: `proposal:seed-${i}`,
    type: "skill_patch",
    status: "pending",
    createdAt: new Date(Date.now() - i * 1000).toISOString(),
    content: `seed proposal ${i}`,
  });
}

function seedFact(learnerDir, i) {
  recordFact(learnerDir, {
    subject: `subject-${i}`,
    predicate: "prefers",
    object: `value-${i}`,
    scope: { project: "general" },
  });
}

describe("export_audit_bundle staged loading (P8.D)", () => {
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("caps proposals and facts by input.limit, and includes everything under the default", async () => {
    const learnerDir = path.join(tmpDir, "learner-1");
    fs.mkdirSync(learnerDir, { recursive: true });
    for (let i = 0; i < 10; i++) {
      seedProposal(learnerDir, i);
      seedFact(learnerDir, i);
    }

    const capped = parseToolResult(await executeControl(
      { action: "export_audit_bundle", limit: 3 },
      { pluginDir: process.cwd(), dataDir: learnerDir },
    ));
    assert.equal(capped.ok, true);
    const cappedBundle = JSON.parse(fs.readFileSync(capped.jsonPath, "utf-8"));
    assert.equal(cappedBundle.summary.proposals, 3, "proposals should be capped to input.limit");
    assert.equal(cappedBundle.summary.facts, 3, "facts should be capped to input.limit");

    const full = parseToolResult(await executeControl(
      { action: "export_audit_bundle" },
      { pluginDir: process.cwd(), dataDir: learnerDir },
    ));
    const fullBundle = JSON.parse(fs.readFileSync(full.jsonPath, "utf-8"));
    assert.equal(fullBundle.summary.proposals, 10, "default limit (500) should include all 10 seeded proposals");
    assert.equal(fullBundle.summary.facts, 10, "default limit (500) should include all 10 seeded facts");
  });
});
