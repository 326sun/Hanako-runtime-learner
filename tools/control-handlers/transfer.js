// Cross-project transfer control handlers (S11.P2 split -- transfer domain).
//
// Extracted verbatim from tools/control.js. These handlers take (input, p) and
// drive the transfer candidate registry. They own NO permission/side-effect
// decisions: control.js keeps the action dispatch, the *_ACTIONS classification
// sets, describeControlSideEffect and sessionPermission. Moving them here removes
// transfer-registry imports from control.js (import-budget relief).

import {
  expireTransferCandidate,
  listTransferCandidateRecords,
  loadTransferCandidateRecord,
  recordTransferValidation,
  registerTransferCandidate,
  summarizeTransferCandidate,
} from "../../lib/transfer-registry.js";

export const transferHandlers = {
  list_transfer_candidates(input, p) {
    const records = listTransferCandidateRecords(p.learnerDir, { status: input.status || null, limit: input.limit || 50 });
    return JSON.stringify({ ok: true, candidates: records.map(summarizeTransferCandidate), nextAction: "show_transfer_candidate or record_transfer_validation" }, null, 2);
  },

  show_transfer_candidate(input, p) {
    const candidateId = input.candidateId || input.id;
    if (!candidateId) throw new Error("candidateId is required");
    const record = loadTransferCandidateRecord(p.learnerDir, candidateId);
    if (!record) throw new Error(`transfer candidate not found: ${candidateId}`);
    const summary = summarizeTransferCandidate(record);
    return JSON.stringify({ ok: true, summary, record, nextAction: summary.status === "transferred_candidate" || summary.status === "manual_confirm" ? "record_transfer_validation or expire_transfer_candidate" : "review promotion readiness" }, null, 2);
  },

  register_transfer_candidate(input, p) {
    if (!input.candidate || typeof input.candidate !== "object") throw new Error("candidate object is required");
    const registered = registerTransferCandidate(p.learnerDir, input.candidate);
    return JSON.stringify({ ok: registered.ok, summary: summarizeTransferCandidate(registered.record), nextAction: "record_transfer_validation" }, null, 2);
  },

  record_transfer_validation(input, p) {
    const candidateId = input.candidateId || input.id;
    if (!candidateId) throw new Error("candidateId is required");
    const recorded = recordTransferValidation(p.learnerDir, candidateId, {
      status: input.validationStatus || input.status || "passed",
      summary: input.reason || "target validation recorded through self_learning_control",
      evidence: input.evidence || [],
    });
    return JSON.stringify({ ok: recorded.ok, summary: summarizeTransferCandidate(recorded.record), nextAction: recorded.ok ? "manual skill promotion review" : "fix target issue or expire_transfer_candidate" }, null, 2);
  },

  expire_transfer_candidate(input, p) {
    const candidateId = input.candidateId || input.id;
    if (!candidateId) throw new Error("candidateId is required");
    const expired = expireTransferCandidate(p.learnerDir, candidateId, { reason: input.reason || "expired through self_learning_control" });
    return JSON.stringify({ ok: true, summary: summarizeTransferCandidate(expired.record), nextAction: "list_transfer_candidates" }, null, 2);
  },
};

export function countTransferCandidatesByStatus(learnerDir, { limit = 1000 } = {}) {
  const counts = {};
  const records = listTransferCandidateRecords(learnerDir, { limit });
  for (const record of records) {
    const key = record?.status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
