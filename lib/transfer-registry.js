import fs from "fs";
import path from "path";
import { safeFileSlug, writeJson } from "./common.js";
import { validateCrossProjectCandidate } from "./cross-project-scope.js";

export const TRANSFER_STATUSES = Object.freeze({
  CANDIDATE: "transferred_candidate",
  MANUAL_CONFIRM: "manual_confirm",
  VALIDATION_PENDING: "validation_pending",
  VALIDATED: "validated",
  VALIDATION_FAILED: "validation_failed",
  EXPIRED: "expired",
  REJECTED: "rejected",
});

function now() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function safeTransferCandidateId(id) {
  return safeFileSlug(id, "transfer_candidate");
}

function transferRegistryDir(baseDir) {
  return path.join(baseDir, "cross_project_transfers");
}

function transferCandidatePath(baseDir, candidateId) {
  return path.join(transferRegistryDir(baseDir), `${safeTransferCandidateId(candidateId)}.json`);
}

const atomicWriteJson = writeJson;

function normalizeDecision(decision = {}) {
  if (decision.decision === "reject") return TRANSFER_STATUSES.REJECTED;
  if (decision.decision === "manual_confirm") return TRANSFER_STATUSES.MANUAL_CONFIRM;
  return TRANSFER_STATUSES.CANDIDATE;
}

export function summarizeTransferCandidate(record = {}) {
  const validationEvents = record.validationHistory || [];
  const latestValidation = validationEvents.at(-1) || null;
  return {
    id: record.id || record.candidate?.id || null,
    status: record.status || null,
    rule: record.candidate?.rule || record.rule || null,
    sourceMemoryId: record.candidate?.sourceMemoryId || null,
    sourceProjectId: record.candidate?.sourceProjectId || null,
    targetProjectId: record.candidate?.targetProjectId || null,
    riskTier: record.candidate?.riskTier || null,
    confidence: record.candidate?.confidence ?? null,
    validationStatus: record.validation?.status || null,
    validationPasses: record.validation?.passes || 0,
    validationFailures: record.validation?.failures || 0,
    latestValidationStatus: latestValidation?.status || null,
    manualPromotionEligible: !!record.promotion?.manualPromotionEligible,
    autoPromotionBlocked: record.promotion?.autoPromotionBlocked !== false,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function createTransferRegistryRecord(candidate = {}, options = {}) {
  if (!candidate?.id) throw new Error("transfer candidate id missing");
  const decision = options.decision || validateCrossProjectCandidate(candidate, options.validationOptions || {});
  const status = options.status || normalizeDecision(decision);
  const timestamp = options.createdAt || now();
  return {
    schemaVersion: 1,
    id: candidate.id,
    status,
    candidate: clone(candidate),
    decision: clone(decision),
    validation: {
      required: candidate.validation?.required !== false,
      commands: candidate.validation?.commands || [],
      status: status === TRANSFER_STATUSES.REJECTED ? TRANSFER_STATUSES.REJECTED : "pending",
      passes: 0,
      failures: 0,
      lastValidatedAt: null,
    },
    validationHistory: [],
    promotion: {
      manualPromotionEligible: false,
      autoPromotionBlocked: candidate.transfer?.cannotAutoPromote !== false,
      requiredBeforePromotion: [
        "target project validation must pass",
        "new target-project evidence must be recorded",
        "manual promotion review is required before any SKILL write",
      ],
      reason: "transferred memory cannot auto-promote across projects",
    },
    lifecycle: [{ at: timestamp, event: "registered", status, reason: options.reason || decision.reason || decision.reason?.join?.("; ") || "registered transfer candidate" }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function saveTransferCandidateRecord(baseDir, record = {}) {
  if (!baseDir) throw new Error("baseDir missing");
  if (!record.id) throw new Error("transfer candidate record id missing");
  const next = { ...clone(record), persistedAt: now() };
  const file = transferCandidatePath(baseDir, next.id);
  atomicWriteJson(file, next);
  return { ok: true, path: file, summary: summarizeTransferCandidate(next) };
}

export function registerTransferCandidate(baseDir, candidate = {}, options = {}) {
  const record = createTransferRegistryRecord(candidate, options);
  const saved = saveTransferCandidateRecord(baseDir, record);
  return { ok: record.status !== TRANSFER_STATUSES.REJECTED, record, saved };
}

export function loadTransferCandidateRecord(baseDir, candidateId) {
  try {
    return JSON.parse(fs.readFileSync(transferCandidatePath(baseDir, candidateId), "utf-8"));
  } catch {
    return null;
  }
}

export function listTransferCandidateRecords(baseDir, { status = null, targetProjectId = null, sourceProjectId = null, limit = 50 } = {}) {
  let files = [];
  try {
    files = fs.readdirSync(transferRegistryDir(baseDir)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const records = [];
  for (const file of files) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(transferRegistryDir(baseDir), file), "utf-8"));
      if (status && record.status !== status) continue;
      if (targetProjectId && record.candidate?.targetProjectId !== targetProjectId) continue;
      if (sourceProjectId && record.candidate?.sourceProjectId !== sourceProjectId) continue;
      records.push(record);
    } catch {}
  }
  return records
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, Math.max(0, Number(limit || 50)));
}

function normalizeValidationStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pass", "passed", "success", "succeeded", "ok", "validated"].includes(value)) return "passed";
  if (["fail", "failed", "error", "rejected"].includes(value)) return "failed";
  throw new Error(`unsupported validation status: ${status}`);
}

function promotionReadiness(record) {
  const validationPassed = (record.validation?.passes || 0) > 0;
  const hasTargetEvidence = (record.validationHistory || []).some((event) => event.status === "passed" && (event.evidence?.length || event.commands?.length || event.summary));
  const manualPromotionEligible = validationPassed && hasTargetEvidence && record.status === TRANSFER_STATUSES.VALIDATED;
  return {
    manualPromotionEligible,
    autoPromotionBlocked: true,
    requiredBeforePromotion: manualPromotionEligible
      ? ["manual promotion review is still required before SKILL write"]
      : ["target project validation must pass", "new target-project evidence must be recorded", "manual promotion review is required before any SKILL write"],
    reason: manualPromotionEligible
      ? "target validation passed; candidate may enter manual skill promotion review"
      : "candidate still lacks target validation evidence",
  };
}

export function recordTransferValidation(baseDir, candidateId, result = {}) {
  const record = loadTransferCandidateRecord(baseDir, candidateId);
  if (!record) throw new Error(`transfer candidate not found: ${candidateId}`);
  if ([TRANSFER_STATUSES.EXPIRED, TRANSFER_STATUSES.REJECTED].includes(record.status)) {
    throw new Error(`transfer candidate is not validatable: ${record.status}`);
  }
  const status = normalizeValidationStatus(result.status || result.result || (result.ok ? "passed" : "failed"));
  const timestamp = result.at || now();
  const event = {
    at: timestamp,
    status,
    summary: result.summary || (status === "passed" ? "target validation passed" : "target validation failed"),
    commands: result.commands || record.validation?.commands || [],
    evidence: result.evidence || [],
    verifier: result.verifier || "target_project_validation",
  };
  record.validationHistory = [...(record.validationHistory || []), event];
  record.validation = {
    ...(record.validation || {}),
    status,
    passes: (record.validation?.passes || 0) + (status === "passed" ? 1 : 0),
    failures: (record.validation?.failures || 0) + (status === "failed" ? 1 : 0),
    lastValidatedAt: timestamp,
  };
  record.status = status === "passed" ? TRANSFER_STATUSES.VALIDATED : TRANSFER_STATUSES.VALIDATION_FAILED;
  record.promotion = promotionReadiness(record);
  record.lifecycle = [...(record.lifecycle || []), { at: timestamp, event: "validation_recorded", status: record.status, reason: event.summary }];
  record.updatedAt = timestamp;
  const saved = saveTransferCandidateRecord(baseDir, record);
  return { ok: status === "passed", record, saved };
}

export function expireTransferCandidate(baseDir, candidateId, { reason = "expired by policy", at = now() } = {}) {
  const record = loadTransferCandidateRecord(baseDir, candidateId);
  if (!record) throw new Error(`transfer candidate not found: ${candidateId}`);
  record.status = TRANSFER_STATUSES.EXPIRED;
  record.validation = { ...(record.validation || {}), status: TRANSFER_STATUSES.EXPIRED };
  record.promotion = { ...(record.promotion || {}), manualPromotionEligible: false, autoPromotionBlocked: true, reason };
  record.lifecycle = [...(record.lifecycle || []), { at, event: "expired", status: TRANSFER_STATUSES.EXPIRED, reason }];
  record.updatedAt = at;
  const saved = saveTransferCandidateRecord(baseDir, record);
  return { ok: true, record, saved };
}
