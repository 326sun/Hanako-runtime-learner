/**
 * Unit tests for absorbDiskPatternState — the reconcile rules used by the
 * plugin's syncDiskStatus to merge control.js's on-disk edits into the
 * authoritative in-memory pattern store without losing them on the next flush.
 * Run: node --test tests/disk-sync.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { absorbDiskPatternState } from "../lib/helpers.js";

describe("absorbDiskPatternState", () => {
  it("absorbs a strictly newer advisor-distilled fix onto a pending pattern", () => {
    const stored = { id: "error:x", status: "pending", fix: "old", advisorUpdatedAt: "2026-01-01T00:00:00Z" };
    const disk = { id: "error:x", status: "pending", fix: "new advice", advisorUpdatedAt: "2026-02-01T00:00:00Z" };
    const changed = absorbDiskPatternState(stored, disk);
    assert.equal(changed, true);
    assert.equal(stored.fix, "new advice");
    assert.equal(stored.advisorUpdatedAt, "2026-02-01T00:00:00Z");
  });

  it("absorbs an advisor fix when the in-memory pattern has no timestamp yet", () => {
    const stored = { id: "error:x", status: "pending", fix: "old" };
    const disk = { id: "error:x", status: "pending", fix: "new", advisorUpdatedAt: "2026-02-01T00:00:00Z" };
    assert.equal(absorbDiskPatternState(stored, disk), true);
    assert.equal(stored.fix, "new");
  });

  it("does not take an older or equal advisor fix", () => {
    const stored = { id: "error:x", status: "pending", fix: "current", advisorUpdatedAt: "2026-03-01T00:00:00Z" };
    const older = { id: "error:x", status: "pending", fix: "stale", advisorUpdatedAt: "2026-01-01T00:00:00Z" };
    assert.equal(absorbDiskPatternState(stored, older), false);
    assert.equal(stored.fix, "current");
    const equal = { id: "error:x", status: "pending", fix: "stale", advisorUpdatedAt: "2026-03-01T00:00:00Z" };
    assert.equal(absorbDiskPatternState(stored, equal), false);
    assert.equal(stored.fix, "current");
  });

  it("never overwrites the fix of a user-approved pattern", () => {
    const stored = { id: "error:x", status: "approved", fix: "blessed" };
    const disk = { id: "error:x", status: "approved", fix: "advisor wants this", advisorUpdatedAt: "2030-01-01T00:00:00Z" };
    const changed = absorbDiskPatternState(stored, disk);
    assert.equal(stored.fix, "blessed");
    // status already matches and no other field changed
    assert.equal(changed, false);
  });

  it("absorbs a manual approve with reviewedAt", () => {
    const stored = { id: "wf:x", status: "pending" };
    const disk = { id: "wf:x", status: "approved", reviewedAt: "2026-02-01T00:00:00Z" };
    assert.equal(absorbDiskPatternState(stored, disk), true);
    assert.equal(stored.status, "approved");
    assert.equal(stored.reviewedAt, "2026-02-01T00:00:00Z");
  });

  it("upgrades to durable but never downgrades", () => {
    const up = { id: "pref:x", status: "approved", knowledgeTier: "core" };
    assert.equal(absorbDiskPatternState(up, { id: "pref:x", status: "approved", knowledgeTier: "durable" }), true);
    assert.equal(up.knowledgeTier, "durable");

    const down = { id: "pref:x", status: "approved", knowledgeTier: "durable" };
    assert.equal(absorbDiskPatternState(down, { id: "pref:x", status: "approved", knowledgeTier: "core" }), false);
    assert.equal(down.knowledgeTier, "durable");
  });

  it("clears autoApproved when a manual approval outranks a machine one", () => {
    const stored = { id: "wf:x", status: "approved", autoApproved: true };
    const disk = { id: "wf:x", status: "approved" }; // no autoApproved → manual
    assert.equal(absorbDiskPatternState(stored, disk), true);
    assert.equal(stored.autoApproved, undefined);
  });

  it("ignores pending/rejected status transitions other than the supported ones", () => {
    const stored = { id: "wf:x", status: "approved" };
    // Disk says pending — we never downgrade an approved pattern back to pending.
    assert.equal(absorbDiskPatternState(stored, { id: "wf:x", status: "pending" }), false);
    assert.equal(stored.status, "approved");
  });

  it("is a no-op for null/undefined inputs", () => {
    assert.equal(absorbDiskPatternState(null, {}), false);
    assert.equal(absorbDiskPatternState({}, null), false);
  });
});
