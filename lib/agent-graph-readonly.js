/**
 * agent-graph-readonly — v5.1 M4a experimental READ-ONLY agent graph skeleton.
 *
 * A deliberately inert planning/diagnostic graph. It walks six read-only nodes
 * — Observe → Plan → Policy → Verify → Learn → Finalize — and emits a plan/report
 * ONLY. It performs:
 *   - NO execution, repair, or rollback;
 *   - NO file writes, config changes, or shell/process calls;
 *   - NO memory writes, NO auto-apply, NO adaptive auto-tuning.
 *
 * It is a pure module (this file imports nothing — no fs, no child_process) and
 * is wired into no runtime path. Use it as an importable pure function or a
 * read-only diagnostic. Every action it surfaces is stamped `readonly: true`,
 * and the Policy node rejects any node that declares a side effect or is an
 * execute/repair/rollback/human-approval type.
 */

export const READONLY_NODES = Object.freeze({
  OBSERVE: "Observe",
  PLAN: "Plan",
  POLICY: "Policy",
  VERIFY: "Verify",
  LEARN: "Learn",
  FINALIZE: "Finalize",
});

export const READONLY_NODE_ORDER = Object.freeze([
  READONLY_NODES.OBSERVE,
  READONLY_NODES.PLAN,
  READONLY_NODES.POLICY,
  READONLY_NODES.VERIFY,
  READONLY_NODES.LEARN,
  READONLY_NODES.FINALIZE,
]);

// Node types this graph will never run. Compared after normalization
// (lowercased, trailing "Node" stripped).
export const FORBIDDEN_NODE_TYPES = Object.freeze([
  "execute",
  "repair",
  "rollback",
  "humanapproval",
  "scope",
  "apply",
]);

const RISK_RANK = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeType(type) {
  return String(type || "").trim().replace(/node$/i, "").toLowerCase();
}

function isForbiddenType(type) {
  return FORBIDDEN_NODE_TYPES.includes(normalizeType(type));
}

function validRiskTier(tier) {
  return /^R[0-4]$/.test(String(tier || "")) ? String(tier) : null;
}

function maxTier(tiers) {
  return tiers.reduce((hi, t) => (RISK_RANK[t] > RISK_RANK[hi] ? t : hi), "R0");
}

// Build a soft-failed report without ever throwing.
function failSoft(error, partial = {}) {
  return {
    ok: false,
    status: "failed-soft",
    readonly: true,
    nodes: partial.nodes || [],
    observations: partial.observations || null,
    plan: partial.plan || { nodes: [] },
    policy: partial.policy || { ok: true, rejected: [], reasons: [] },
    verify: partial.verify || { ok: false, structureValid: false, riskFlags: [] },
    learn: partial.learn || { summary: "", facts: [] },
    risk: partial.risk || { tiers: {}, maxTier: "R0", summary: "no risk computed" },
    humanReviewRequired: true,
    report: partial.report || null,
    sideEffects: [],
    errors: [error],
  };
}

// --- Nodes (each is pure: reads its input, returns a value; mutates nothing) ---

// Observe: snapshot the read-only context. Never mutates the caller's object.
function observe(context) {
  return clone(context) || {};
}

// Plan: turn declared plan nodes into inspected action descriptors. Every
// descriptor is stamped readonly:true — this graph will not execute any of them.
function plan(rawPlan) {
  const nodes = rawPlan.nodes.map((n, index) => {
    const node = n && typeof n === "object" ? n : {};
    const type = node.type || node.name || `node-${index}`;
    return {
      index,
      type,
      title: node.title || type,
      readonly: true, // graph stamp: inspected, never executed
      declaredSideEffect: node.sideEffect === true,
      declaredReadonly: node.readonly,
      riskTier: validRiskTier(node.riskTier) || "R1",
    };
  });
  return { nodes };
}

// Policy: reject any node that would have a side effect or is a forbidden
// execute/repair/rollback/human-approval type. Read-only: only inspects.
function policy(planned) {
  const rejected = [];
  for (const node of planned.nodes) {
    if (isForbiddenType(node.type)) {
      rejected.push({ index: node.index, type: node.type, reason: `forbidden-node-type:${normalizeType(node.type)}` });
    } else if (node.declaredSideEffect) {
      rejected.push({ index: node.index, type: node.type, reason: "side-effect-forbidden" });
    } else if (node.declaredReadonly === false) {
      rejected.push({ index: node.index, type: node.type, reason: "non-readonly" });
    }
  }
  return { ok: rejected.length === 0, rejected, reasons: rejected.map((r) => r.reason) };
}

// Verify: check plan STRUCTURE and collect risk flags. Never runs the plan.
function verify(planned) {
  const riskFlags = [];
  let structureValid = Array.isArray(planned.nodes);
  for (const node of planned.nodes) {
    if (!node || typeof node.type !== "string" || !node.type) structureValid = false;
    if (RISK_RANK[node.riskTier] >= RISK_RANK.R3) {
      riskFlags.push({ index: node.index, type: node.type, tier: node.riskTier });
    }
  }
  return { ok: structureValid, structureValid, riskFlags };
}

// Learn: produce a learning SUMMARY only. Writes no memory, returns text+facts.
function learn(observations, planned, policyResult) {
  const facts = [];
  if (observations && observations.summary) facts.push(`context: ${String(observations.summary).slice(0, 200)}`);
  facts.push(`inspected ${planned.nodes.length} planned node(s)`);
  if (policyResult.rejected.length) facts.push(`policy rejected ${policyResult.rejected.length} node(s)`);
  return {
    summary: `Read-only review of ${planned.nodes.length} planned node(s); ${policyResult.rejected.length} rejected. No actions executed, no memory written.`,
    facts,
  };
}

function riskSummary(planned) {
  const tiers = {};
  for (const node of planned.nodes) {
    tiers[node.riskTier] = (tiers[node.riskTier] || 0) + 1;
  }
  const top = maxTier(planned.nodes.map((n) => n.riskTier).concat("R0"));
  return { tiers, maxTier: top, summary: `max risk ${top} across ${planned.nodes.length} planned node(s)` };
}

/**
 * Run the read-only agent graph over a read-only context summary + a proposed
 * plan to inspect. Returns a plan/report. Never executes, writes, or mutates.
 *
 * @param {object} input  { context: {...readonly...}, plan: { nodes: [...] } }
 * @returns {object} report (always readonly:true, sideEffects always [])
 */
export function runReadonlyAgentGraph(input) {
  // Empty input → fail-soft.
  if (!input || typeof input !== "object" || !input.context || typeof input.context !== "object") {
    return failSoft("empty-input");
  }

  const trace = [];
  const mark = (name, status) => trace.push({ name, status });

  const observations = observe(input.context);
  mark(READONLY_NODES.OBSERVE, "ok");

  // Malformed plan → fail-soft (but still no throw, still no side effects).
  const rawPlan = input.plan;
  const planNodesOk = rawPlan && typeof rawPlan === "object" && Array.isArray(rawPlan.nodes)
    && rawPlan.nodes.every((n) => n && typeof n === "object");
  if (!planNodesOk) {
    return failSoft("malformed-plan", {
      nodes: trace.concat([{ name: READONLY_NODES.VERIFY, status: "failed-soft" }]),
      observations,
      verify: { ok: false, structureValid: false, riskFlags: [] },
    });
  }

  const planned = plan(rawPlan);
  mark(READONLY_NODES.PLAN, "ok");

  const policyResult = policy(planned);
  mark(READONLY_NODES.POLICY, "ok");

  const verifyResult = verify(planned);
  mark(READONLY_NODES.VERIFY, "ok");

  const learnResult = learn(observations, planned, policyResult);
  mark(READONLY_NODES.LEARN, "ok");

  const risk = riskSummary(planned);
  const rejected = !policyResult.ok;
  const humanReviewRequired = rejected || verifyResult.riskFlags.length > 0 || RISK_RANK[risk.maxTier] >= RISK_RANK.R3;

  const report = {
    readonly: true,
    status: rejected ? "rejected" : "completed",
    plannedNodeCount: planned.nodes.length,
    rejectedNodeCount: policyResult.rejected.length,
    risk,
    humanReviewRequired,
    learningSummary: learnResult.summary,
    note: "Diagnostic only — no actions were executed and nothing was written.",
  };
  mark(READONLY_NODES.FINALIZE, "ok");

  return {
    ok: !rejected,
    status: rejected ? "rejected" : "completed",
    readonly: true,
    nodes: trace,
    observations,
    plan: planned,
    policy: policyResult,
    verify: verifyResult,
    learn: learnResult,
    risk,
    humanReviewRequired,
    report,
    sideEffects: [],
    errors: [],
  };
}
