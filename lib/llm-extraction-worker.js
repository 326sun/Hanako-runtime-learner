/**
 * llm-extraction-worker — v5.0 M2 orchestration (plan §5.5 / §5.10).
 *
 * Two halves with a strict boundary:
 *   - enqueueCandidates(): SYNCHRONOUS. Called from the flush path. Only ever
 *     writes pending jobs to the queue — never awaits the model.
 *   - runExtractionTick(): ASYNCHRONOUS background consumer. Claims queued jobs,
 *     samples the host model, and routes any valid extraction into a review-only
 *     pattern_candidate proposal. Fail-soft throughout; never throws.
 *
 * Hard invariant: an extraction NEVER writes patterns/facts directly. Its only
 * output is a proposal → review-queue → validation-gate item awaiting human or
 * policy approval.
 */

import path from "path";
import { knowledgeTier } from "./common.js";
import { readJson, writeJson } from "./json-io.js";
import { legacyRiskForTier } from "./action-types.js";
import { busSampleAvailable } from "./sample-text.js";
import { ALLOWED_KINDS } from "./llm-extraction-schema.js";
import { enqueueJob, claimNextJob, completeJob, failJob, pruneTerminal } from "./llm-extraction-queue.js";
import { extractFromJob } from "./llm-extractor.js";
import { upsertProposal } from "./proposals.js";

// Privacy boundary mirrors lib/model-advisor.js: preference patterns carry the
// rawest user text (corrections, pinned memory) and durable knowledge is the
// user's settled rules — neither is ever sent to the model. Only the tool-shaped
// workflow/error/usage patterns are eligible for distillation.
const ELIGIBLE_KINDS = new Set(ALLOWED_KINDS.filter((k) => k !== "preference"));

function extractionStateFile(dataDir) {
  return path.join(dataDir, "llm_extraction_state.json");
}

function evidenceIdsFor(pattern) {
  const ids = (Array.isArray(pattern.evidence) ? pattern.evidence : [])
    .map((e) => e?.hash)
    .filter((h) => typeof h === "string" && h.trim());
  // Patterns without attached evidence (e.g. usage patterns) still trace to
  // their own stable id, so a candidate always has non-empty provenance.
  return ids.length > 0 ? ids : [`pattern:${pattern.id}`];
}

/**
 * Pick eligible patterns and shape them into extraction candidates. Pure: no IO.
 */
export function selectExtractionCandidates(patterns = [], { limit = 12 } = {}) {
  const out = [];
  for (const pattern of patterns) {
    if (!pattern?.id) continue;
    if (!ELIGIBLE_KINDS.has(pattern.type)) continue;
    if (pattern.status === "rejected") continue;
    if (knowledgeTier(pattern) === "durable") continue;
    out.push({
      kind: pattern.type,
      evidenceIds: evidenceIdsFor(pattern),
      summary: [pattern.desc, pattern.fix].filter(Boolean).join(" — "),
      scope: pattern.scope || {},
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Synchronously enqueue eligible candidates. No-op (and writes nothing) when
 * llmExtractionEnabled is false — the on-disk state then matches v4 exactly.
 */
export function enqueueCandidates(dataDir, config = {}, patterns = [], { now = new Date().toISOString() } = {}) {
  if (!config.llmExtractionEnabled) return { enqueued: 0 };
  const limit = Math.max(1, Number(config.llmExtractionMaxJobsPerRun || 5)) * 3;
  const candidates = selectExtractionCandidates(patterns, { limit });
  let enqueued = 0;
  for (const candidate of candidates) {
    try {
      if (enqueueJob(dataDir, candidate, { now }).enqueued) enqueued += 1;
    } catch { /* malformed candidate never blocks the flush path */ }
  }
  return { enqueued };
}

/** Map a validated extraction + its source job into a review-only proposal. */
export function extractionToProposal(extraction, job) {
  return {
    id: `pattern_candidate:${job.evidenceHash}`,
    type: "pattern_candidate",
    source: "llm",
    kind: extraction.type,
    title: `LLM 候选模式（${extraction.type}）：${extraction.desc || job.evidenceHash}`,
    desc: extraction.desc || "",
    generalization: extraction.generalization || "",
    evidenceIds: extraction.evidenceIds,
    confidence: extraction.confidence,
    suggestedRiskTier: extraction.suggestedRiskTier,
    risk: legacyRiskForTier(extraction.suggestedRiskTier),
    autoApply: false,
    reason: "LLM 从脱敏交互摘要中归纳的候选模式，待人审或策略批准后方可采纳。",
    scope: job.scope || {},
    jobId: job.id,
    createdAt: new Date().toISOString(),
  };
}

let _inFlight = false;

function rateLimited(dataDir, config, now) {
  const minMs = Math.max(1, Number(config.llmExtractionMinIntervalMinutes || 30)) * 60_000;
  const state = readJson(extractionStateFile(dataDir), {});
  return !!(state.lastRunAt && Date.parse(now) - Date.parse(state.lastRunAt) < minMs);
}

/**
 * Background consumer. Claims up to llmExtractionMaxJobsPerRun jobs, samples the
 * host model, and routes valid extractions into pattern_candidate proposals.
 * Returns a summary; never throws.
 */
export async function runExtractionTick(ctx, { config = {}, dataDir, now = new Date().toISOString() } = {}) {
  if (!config.llmExtractionEnabled) return { ok: false, skipped: "disabled" };
  if (!busSampleAvailable(ctx)) return { ok: false, skipped: "unavailable" };
  if (rateLimited(dataDir, config, now)) return { ok: false, skipped: "rate_limited" };
  if (_inFlight) return { ok: false, skipped: "in_flight" };
  _inFlight = true;

  const maxJobs = Math.max(1, Number(config.llmExtractionMaxJobsPerRun || 5));
  const maxAttempts = Math.max(1, Number(config.llmExtractionMaxAttempts || 3));
  const timeoutMs = Math.max(1000, Number(config.llmExtractionTimeoutMs || 15000));
  const minConfidence = Number(config.llmExtractionMinConfidence ?? 0.72);
  let processed = 0;
  let proposalsCreated = 0;

  try {
    for (let i = 0; i < maxJobs; i++) {
      const job = claimNextJob(dataDir, { now });
      if (!job) break;
      processed += 1;
      let result;
      try {
        result = await extractFromJob(ctx, job, { timeoutMs, minConfidence });
      } catch {
        result = { ok: false, reason: "sample_failed", retriable: true };
      }
      if (result.ok) {
        try {
          upsertProposal(dataDir, extractionToProposal(result.extraction, job));
          proposalsCreated += 1;
          completeJob(dataDir, job.id, { status: "done", now });
        } catch (err) {
          // Proposal write failed — keep the job retriable rather than losing it.
          failJob(dataDir, job.id, { error: `proposal_write: ${err?.message || err}`, maxAttempts, now });
        }
      } else if (result.reason === "none") {
        completeJob(dataDir, job.id, { status: "done", lastError: null, now });
      } else if (result.retriable) {
        failJob(dataDir, job.id, { error: result.reason, maxAttempts, now });
      } else {
        completeJob(dataDir, job.id, { status: "discarded", lastError: result.reason, now });
      }
    }
    try { pruneTerminal(dataDir); } catch {}
    try { writeJson(extractionStateFile(dataDir), { lastRunAt: now }); } catch {}
    return { ok: true, processed, proposalsCreated };
  } catch (err) {
    ctx?.log?.debug?.(`runtime-learner: llm extraction tick error: ${err?.message || err}`);
    return { ok: false, processed, proposalsCreated, error: String(err?.message || err) };
  } finally {
    _inFlight = false;
  }
}

/**
 * Factory mirroring createAdvisorRunner: a gated maybeRun(reason, sessionHandle,
 * allPatterns) that synchronously enqueues candidates then fires the async tick.
 * No-op when llmExtractionEnabled is false. The trigger is opportunistic in M2;
 * M3-lite migrates it to a host task:* schedule.
 */
export function createExtractionRunner({ getConfig, dataDir, ctx }) {
  async function maybeRun(_reason, _sessionHandle = null, allPatterns = null) {
    const config = getConfig();
    if (!config.llmExtractionEnabled) return { ok: false, skipped: "disabled" };
    try {
      const patterns = allPatterns || [];
      enqueueCandidates(dataDir, config, patterns);
      return await runExtractionTick(ctx, { config, dataDir });
    } catch (err) {
      ctx?.log?.debug?.(`runtime-learner: llm extraction maybeRun error: ${err?.message || err}`);
      return { ok: false, error: String(err?.message || err) };
    }
  }
  return { maybeRun };
}
