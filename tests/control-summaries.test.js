/**
 * Unit tests for tools/control-summaries.js — pure summary/formatting helpers
 * extracted from tools/control.js (C-001 phase 3a).
 * Run: node --test tests/control-summaries.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countByStatus,
  summarizeDecoratedPatterns,
  countWaitingAgentTasks,
  validationNextAction,
  reviewPanelNextActions,
} from "../tools/control-summaries.js";

describe("countByStatus", () => {
  it("returns an empty object for an empty array", () => {
    assert.deepEqual(countByStatus([]), {});
  });

  it("returns an empty object when called with no arguments", () => {
    assert.deepEqual(countByStatus(), {});
  });

  it("counts mixed statuses", () => {
    const rows = [
      { status: "pending" },
      { status: "applied" },
      { status: "pending" },
      { status: "rejected" },
    ];
    assert.deepEqual(countByStatus(rows), { pending: 2, applied: 1, rejected: 1 });
  });

  it("buckets missing/empty status under 'unknown'", () => {
    const rows = [{ status: "pending" }, {}, { status: "" }, null];
    assert.deepEqual(countByStatus(rows), { pending: 1, unknown: 3 });
  });

  it("supports counting by an alternate field", () => {
    const rows = [{ state: "a" }, { state: "b" }, { state: "a" }];
    assert.deepEqual(countByStatus(rows, "state"), { a: 2, b: 1 });
  });
});

describe("summarizeDecoratedPatterns", () => {
  it("returns a zeroed summary for an empty array", () => {
    assert.deepEqual(summarizeDecoratedPatterns([]), {
      total: 0, injectable: 0, pending: 0, approved: 0, rejected: 0,
    });
  });

  it("aggregates totals, injectable flag, and per-status counts", () => {
    const patterns = [
      { injectable: true, status: "pending" },
      { injectable: false, status: "approved" },
      { injectable: true, status: "rejected" },
      { injectable: true, status: "pending" },
      { status: "other" }, // counts toward total only
    ];
    assert.deepEqual(summarizeDecoratedPatterns(patterns), {
      total: 5, injectable: 3, pending: 2, approved: 1, rejected: 1,
    });
  });
});

describe("countWaitingAgentTasks", () => {
  it("returns 0 for an empty array", () => {
    assert.equal(countWaitingAgentTasks([]), 0);
  });

  it("counts only tasks waiting_for_human among a mix of states", () => {
    const tasks = [
      { state: "waiting_for_human" },
      { state: "pending" },
      { state: "done" },
      { state: "waiting_for_human" },
      { state: "running" },
    ];
    assert.equal(countWaitingAgentTasks(tasks), 2);
  });

  it("returns 0 when no task is waiting_for_human", () => {
    assert.equal(countWaitingAgentTasks([{ state: "pending" }, { state: "done" }]), 0);
  });
});

describe("validationNextAction", () => {
  it("recommends the approve/apply path when validation is ok", () => {
    assert.equal(validationNextAction({ ok: true }), "approve_review then apply_review");
  });

  it("recommends fix/reject when validation is not ok", () => {
    assert.equal(validationNextAction({ ok: false }), "fix proposal or reject_proposal");
  });

  it("treats missing/undefined validation as not ok", () => {
    assert.equal(validationNextAction(undefined), "fix proposal or reject_proposal");
    assert.equal(validationNextAction({}), "fix proposal or reject_proposal");
  });
});

describe("reviewPanelNextActions", () => {
  it("returns the no-op action when there is nothing to do", () => {
    assert.deepEqual(reviewPanelNextActions(), ["no review action needed"]);
    assert.deepEqual(reviewPanelNextActions({ counts: {} }), ["no review action needed"]);
  });

  it("surfaces blocked reviews", () => {
    const actions = reviewPanelNextActions({ counts: { blockedReviews: 2 } });
    assert.deepEqual(actions, ["validate blocked reviews, then fix or reject them"]);
  });

  it("surfaces pending reviews", () => {
    const actions = reviewPanelNextActions({ counts: { pendingReviews: 1 } });
    assert.deepEqual(actions, ["preview queued reviews, then approve_review or reject_review"]);
  });

  it("surfaces pending proposals", () => {
    const actions = reviewPanelNextActions({ counts: { pendingProposals: 3 } });
    assert.deepEqual(actions, ["validate_proposal for pending proposals not yet reviewed"]);
  });

  it("combines all branches in order when all are present", () => {
    const actions = reviewPanelNextActions({
      counts: { blockedReviews: 1, pendingReviews: 1, pendingProposals: 1 },
    });
    assert.deepEqual(actions, [
      "validate blocked reviews, then fix or reject them",
      "preview queued reviews, then approve_review or reject_review",
      "validate_proposal for pending proposals not yet reviewed",
    ]);
  });
});
