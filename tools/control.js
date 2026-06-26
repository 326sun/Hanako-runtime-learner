import fs from "fs";
import path from "path";
import { DEFAULT_CONFIG, readJson, writeJson, loadLearnerConfig, decoratePatterns, buildSkillMdFromPatterns, mergeConfig } from "../lib/common.js";
import { runModelAdvisor } from "../lib/model-advisor.js";
import { mergeAdvisorSuggestions } from "../lib/advisor-insights.js";
import { listProposals, readProposal, rejectProposal, previewProposalDiff, verifyProposalReviewBinding } from "../lib/proposals.js";
import { applyProposalSafely } from "../lib/proposal-apply-safe.js";
import { validateConfigPatch, validateProposal } from "../lib/validation-gate.js";
import { enqueueReviewForProposal, listReviews, readReview, reviewPanel, updateReviewStatus } from "../lib/review-queue.js";
import { readEvents, appendEvent, replayEventState } from "../lib/event-log.js";
import { recordMemoryClosed, recordInjectionRevoked, wasRecentlyInjected, summarizeFeedback } from "../lib/feedback-signals.js";
import { writeSkillIfChanged } from "../lib/skill-lifecycle.js";
import { runDoctorFromDisk, formatReport } from "./doctor.js";
import { generateMemFS } from "../lib/memfs.js";
import { loadFacts } from "../lib/facts.js";
import { applyPolicyProfile } from "../lib/policy-profiles.js";
import { buildAuditBundle, exportAuditBundle } from "../lib/audit-bundle.js";
import { buildAuditDashboard, exportAuditDashboard } from "../lib/audit-dashboard.js";
import { extractAndSaveCredentials, mergeCredentials, sanitizeCredentialPatch } from "../lib/credentials.js";
import { listAgentTaskStates, readAgentTaskBundle } from "../lib/agent-task-store.js";
import { approveAgentTask, cancelAgentTask, rejectAgentTask, resumeAgentTask } from "../lib/agent-resume.js";
import { expireTransferCandidate, listTransferCandidateRecords, loadTransferCandidateRecord, recordTransferValidation, registerTransferCandidate, summarizeTransferCandidate } from "../lib/transfer-registry.js";
import { runBenchmarkCorpus } from "../lib/benchmark-corpus.js";
import { loadActiveSkills, loadSkillCandidates, runSkillPromotionLoop } from "../lib/skill-promotion-loop.js";
import { projectScriptsFingerprint } from "../lib/project-script-trust.js";
import { exportReleaseReadiness, formatReleaseReadinessReport } from "../lib/release-readiness.js";
import { resolveProjectRoot } from "../lib/project-root.js";
import { normalizeSessionTarget } from "../lib/helpers.js";
import { toolPaths } from "./_shared.js";
import { countByStatus, summarizeDecoratedPatterns, countWaitingAgentTasks, validationNextAction, reviewPanelNextActions } from "./control-summaries.js";
import { CONTROL_PARAM_PROPERTIES } from "./control-parameters.js";
import { skillPolicyHandlers } from "./control-handlers/skill-policy.js";
import { eventHandlers } from "./control-handlers/events.js";

const MAX_SKILL_HISTORY = 20;

function buildSkill(patterns, config, learnerDir) {
  return buildSkillMdFromPatterns(patterns, config, { dataDir: learnerDir });
}

function regenerateSkill(pathsValue, patterns, config) {
  return writeSkillIfChanged(
    pathsValue.skillPath,
    buildSkill(patterns, config, pathsValue.learnerDir),
    pathsValue.historyDir,
    { keep: MAX_SKILL_HISTORY },
  );
}

const SENSITIVE_CONFIG_KEYS = new Set(["modelAdvisorApiKey", "semanticEmbeddingApiKey"]);

function redactConfig(config = {}) {
  const safeConfig = { ...config };
  for (const key of Object.keys(safeConfig)) {
    if (SENSITIVE_CONFIG_KEYS.has(key) && safeConfig[key]) safeConfig[key] = "***";
  }
  return safeConfig;
}

function readPluginVersion(pluginDir) {
  try { return JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf-8")).version; } catch { return "unknown"; }
}

const HANDLERS = {
  status(input, p, config, patterns) {
    const decorated = decoratePatterns(patterns, config);
    const patternSummary = summarizeDecoratedPatterns(decorated);
    let history = [];
    try { history = fs.readdirSync(p.historyDir).filter((n) => n.endsWith("-SKILL.md")).sort(); } catch {}
    const proposalCounts = countByStatus(listProposals(p.learnerDir, { limit: 0 }));
    const reviewCounts = countByStatus(listReviews(p.learnerDir, { limit: 0 }));
    const agentTasks = listAgentTaskStates(p.learnerDir, { limit: 1000 });
    const transferCounts = countByStatus(listTransferCandidateRecords(p.learnerDir, { limit: 1000 }));
    return JSON.stringify({
      config: redactConfig(config),
      patterns: patternSummary.total,
      injectable: patternSummary.injectable,
      pending: patternSummary.pending,
      approved: patternSummary.approved,
      rejected: patternSummary.rejected,
      historySnapshots: history.length,
      proposals: { pending: proposalCounts.pending || 0, applied: proposalCounts.applied || 0, rejected: proposalCounts.rejected || 0, dir: p.proposalsDir },
      reviews: { queued: reviewCounts.queued || 0, blocked: reviewCounts.blocked || 0, approved: reviewCounts.approved || 0 },
      agentTasks: { total: agentTasks.length, waiting: countWaitingAgentTasks(agentTasks) },
      transferCandidates: {
        total: Object.values(transferCounts).reduce((s, n) => s + n, 0),
        pending: transferCounts.transferred_candidate || 0, validated: transferCounts.validated || 0, failed: transferCounts.validation_failed || 0,
      },
      skillPromotion: { candidates: loadSkillCandidates(p.learnerDir).candidates.length, active: loadActiveSkills(p.learnerDir).skills.length },
      dataDir: p.learnerDir,
    }, null, 2);
  },

  // Read-only diagnostic (M5b): surface the local feedback signal tallies.
  // Pure read — no file writes, no thresholds, no adaptive suggestions, and
  // nothing here participates in any current decision. Observation only.
  feedback_summary(input, p) {
    const n = Number(input.sinceDays);
    const sinceDays = Number.isFinite(n) && n > 0 ? n : 30;
    const { counts, injectedIdTotal } = summarizeFeedback(p.learnerDir, { sinceDays });
    return { ok: true, sinceDays, ...counts, injectedIdTotal };
  },

  list(input, p, config, patterns) {
    return JSON.stringify(decoratePatterns(patterns, config).slice(0, 20).map((pat) => ({
      id: pat.id, type: pat.type, desc: pat.desc, count: pat.count, score: pat.score,
      decayedScore: pat.decayedScore, status: pat.status, knowledgeTier: pat.knowledgeTier, injectable: pat.injectable,
      fix: pat.fix || null, lastSeen: pat.lastSeen, scope: pat.scope, context: pat.context ? { taskType: pat.context.taskType } : null,
      evidencePreview: pat.evidence?.[0]?.quote || null,
    })), null, 2);
  },

  approve(input, p, config, patterns) {
    const id = input.id || input.proposalId;
    if (!id) throw new Error("id is required for approve");
    let idx = patterns.findIndex((pat) => pat.id === id);
    if (idx === -1) throw new Error(`pattern not found: ${id}`);
    patterns[idx] = { ...patterns[idx], status: "approved", reviewedAt: new Date().toISOString() };
    writeJson(p.patternsPath, patterns);
    appendEvent(p.learnerDir, { type: "pattern.approved", entityType: "pattern", entityId: id, summary: `Approved pattern: ${patterns[idx].desc}` });
    regenerateSkill(p, patterns, config);
    return JSON.stringify({ ok: true, id, status: "approved" }, null, 2);
  },

  reject(input, p, config, patterns) {
    const id = input.id || input.proposalId;
    if (!id) throw new Error("id is required for reject");
    let idx = patterns.findIndex((pat) => pat.id === id);
    if (idx === -1) throw new Error(`pattern not found: ${id}`);
    patterns[idx] = { ...patterns[idx], status: "rejected", reviewedAt: new Date().toISOString() };
    writeJson(p.patternsPath, patterns);
    appendEvent(p.learnerDir, { type: "pattern.rejected", entityType: "pattern", entityId: id, summary: `Rejected pattern: ${patterns[idx].desc}` });
    // Feedback signals (M5, instrumentation only, fail-soft): the user closed a
    // memory; if it had been injected, its injection is now revoked.
    if (config.feedbackSignalsEnabled !== false) {
      recordMemoryClosed(p.learnerDir, { patternId: id, actor: "user", reason: "rejected" });
      if (wasRecentlyInjected(p.learnerDir, id)) recordInjectionRevoked(p.learnerDir, { patternId: id, reason: "rejected" });
    }
    regenerateSkill(p, patterns, config);
    return JSON.stringify({ ok: true, id, status: "rejected" }, null, 2);
  },

  set_config(input, p, config, patterns) {
    fs.mkdirSync(p.learnerDir, { recursive: true });
    fs.mkdirSync(p.historyDir, { recursive: true });
    const patch = {};
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = input[key];
    }
    const sanitisedPatch = sanitizeCredentialPatch(patch);
    const validation = validateConfigPatch(sanitisedPatch, config);
    if (!validation.ok) {
      const failures = validation.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ");
      throw new Error(`config validation failed: ${failures}`);
    }
    extractAndSaveCredentials(patch);
    const next = mergeConfig(config, sanitisedPatch);
    writeJson(p.configPath, next);
    regenerateSkill(p, patterns, next);
    return JSON.stringify({ ok: true, config: redactConfig(next), validation }, null, 2);
  },

  rollback(input, p, config) {
    const history = fs.readdirSync(p.historyDir).filter((n) => n.endsWith("-SKILL.md")).sort();
    if (!history.length) throw new Error("no skill history to roll back");
    const target = input.id ? history.find((n) => n.includes(input.id)) : history.at(-1);
    if (!target) throw new Error(`snapshot not found: ${input.id}`);
    const src = path.join(p.historyDir, target);
    fs.copyFileSync(src, p.skillPath);
    appendEvent(p.learnerDir, { type: "skill.rolled_back", entityType: "skill", entityId: target, summary: `Rolled back skill to ${target}` });
    return JSON.stringify({ ok: true, snapshot: target }, null, 2);
  },

  regenerate_skill(input, p, config, patterns) {
    const result = regenerateSkill(p, patterns, config);
    appendEvent(p.learnerDir, { type: "skill.regenerated", entityType: "skill", entityId: "SKILL.md", summary: result.changed ? "Skill regenerated (content changed)" : "Skill unchanged" });
    return JSON.stringify({ ok: true, changed: result.changed, snapshotPath: result.snapshotPath }, null, 2);
  },

  regenerate_memfs(input, p, config, patterns) {
    const result = generateMemFS(p.learnerDir, { patterns, config });
    return JSON.stringify({ ok: true, ...result }, null, 2);
  },

  async run_model_advisor(input, p, config, patterns, ctx) {
    // Decrypt sensitive keys (API keys) just for the advisor — the only control
    // handler that consumes a credential. config.json holds a placeholder, so
    // without this a private-endpoint advisor call would send the literal
    // placeholder as a bearer token and 401. Scoped to this handler so the
    // decrypted secret never reaches handlers that persist config (set_config,
    // set_policy_profile) and leak it back to disk in plaintext.
    const advisorConfig = mergeCredentials(config);
    const result = await runModelAdvisor({ config: advisorConfig, patterns, usage: readJson(p.usageSummaryPath, null), capabilities: readJson(p.capabilitiesPath, null), reason: "manual", ctx, dataDir: p.learnerDir });
    if (!result.ok) return JSON.stringify({ ok: false, error: result.reason || "advisor skipped" }, null, 2);
    const { merged } = mergeAdvisorSuggestions(new Map(patterns.map((pat) => [pat.id, pat])), result.advice);
    if (merged > 0) writeJson(p.patternsPath, patterns);
    appendEvent(p.learnerDir, { type: "model_advisor.ran", entityType: "advisor", entityId: "manual", summary: `Manual advisor run: ${result.advice?.suggestions?.length || 0} suggestions, ${merged} merged` });
    regenerateSkill(p, patterns, config);
    return JSON.stringify({ ok: true, suggestions: result.advice?.suggestions?.length || 0, merged }, null, 2);
  },

  list_proposals(input, p) {
    const proposals = listProposals(p.learnerDir, { status: input.status || null, limit: input.limit || 50 });
    return JSON.stringify({ ok: true, proposals, nextAction: "show_proposal or preview_proposal" }, null, 2);
  },

  show_proposal(input, p) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    const proposal = readProposal(p.learnerDir, input.proposalId || input.id);
    if (!proposal) throw new Error(`proposal not found: ${input.proposalId || input.id}`);
    return JSON.stringify(proposal, null, 2);
  },

  apply_proposal(input, p, config) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    if (config.governanceProfile === "conservative") {
      throw new Error("conservative profile requires review-first flow: approve_review then apply_review");
    }
    const applied = applyProposalSafely(p.learnerDir, input.proposalId || input.id, {
      configPath: p.configPath,
      requireReview: !!config.requireReviewForAutoApply,
      allowedSkillRoots: [p.pluginDir],
    });
    return JSON.stringify({ ok: true, proposal: applied, nextAction: "verify_event_log or export_audit_bundle" }, null, 2);
  },

  reject_proposal(input, p) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    const rejected = rejectProposal(p.learnerDir, input.proposalId || input.id, input.reason || "");
    return JSON.stringify({ ok: true, proposal: rejected, nextAction: "review_panel" }, null, 2);
  },

  review_panel(input, p) {
    const report = runDoctorFromDisk(p.learnerDir);
    const panel = reviewPanel(p.learnerDir, { proposals: listProposals(p.learnerDir, { limit: 100 }), doctorReport: report });
    return JSON.stringify({ ...panel, recommendedNextActions: reviewPanelNextActions(panel) }, null, 2);
  },

  preview_proposal(input, p, config) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    const proposal = readProposal(p.learnerDir, input.proposalId || input.id);
    if (!proposal) throw new Error(`proposal not found: ${input.proposalId || input.id}`);
    const preview = previewProposalDiff(proposal, { configPath: p.configPath });
    enqueueReviewForProposal(p.learnerDir, proposal, { configPath: p.configPath, config });
    appendEvent(p.learnerDir, { type: "proposal.previewed", entityType: "proposal", entityId: proposal.id, summary: `Previewed proposal: ${proposal.id}` });
    return JSON.stringify({ ...preview, nextAction: "validate_proposal, then approve_review or reject_review" }, null, 2);
  },

  validate_proposal(input, p, config) {
    if (!input.proposalId && !input.id) throw new Error("proposalId is required");
    const proposal = readProposal(p.learnerDir, input.proposalId || input.id);
    if (!proposal) throw new Error(`proposal not found: ${input.proposalId || input.id}`);
    const validation = validateProposal(proposal, { config, doctorReport: runDoctorFromDisk(p.learnerDir) });
    const review = enqueueReviewForProposal(p.learnerDir, proposal, { configPath: p.configPath, config });
    if (review) updateReviewStatus(p.learnerDir, review.id, validation.ok ? "queued" : "blocked", { validation });
    appendEvent(p.learnerDir, { type: "proposal.validated", entityType: "proposal", entityId: proposal.id, summary: `Validated proposal: ${proposal.id}`, data: { ok: validation.ok } });
    return JSON.stringify({ ...validation, nextAction: validationNextAction(validation) }, null, 2);
  },

  approve_review(input, p) {
    const reviewId = input.id || (input.proposalId ? `review:${input.proposalId}` : null);
    if (!reviewId) throw new Error("id or proposalId is required");
    const review = readReview(p.learnerDir, reviewId);
    if (!review) throw new Error(`review not found: ${reviewId}`);
    const proposal = readProposal(p.learnerDir, review.proposalId);
    if (!proposal) throw new Error(`proposal not found: ${review.proposalId}`);
    const binding = verifyProposalReviewBinding(proposal, review);
    if (!binding.ok) throw new Error(binding.error);
    const next = updateReviewStatus(p.learnerDir, reviewId, "approved");
    return JSON.stringify({ ok: true, review: next, nextAction: "apply_review" }, null, 2);
  },

  reject_review(input, p) {
    const reviewId = input.id || (input.proposalId ? `review:${input.proposalId}` : null);
    if (!reviewId) throw new Error("id or proposalId is required");
    const next = updateReviewStatus(p.learnerDir, reviewId, "rejected", { reason: input.reason || "" });
    return JSON.stringify({ ok: true, review: next, nextAction: "reject_proposal or review_panel" }, null, 2);
  },

  apply_review(input, p) {
    const reviewId = input.id || (input.proposalId ? `review:${input.proposalId}` : null);
    if (!reviewId) throw new Error("id or proposalId is required");
    const review = readReview(p.learnerDir, reviewId);
    if (!review) throw new Error(`review not found: ${reviewId}`);
    if (review.status !== "approved") throw new Error(`review must be approved before apply: ${reviewId}`);
    const proposal = readProposal(p.learnerDir, review.proposalId);
    if (!proposal) throw new Error(`proposal not found: ${review.proposalId}`);
    const binding = verifyProposalReviewBinding(proposal, review);
    if (!binding.ok) throw new Error(binding.error);
    const applied = applyProposalSafely(p.learnerDir, review.proposalId, { configPath: p.configPath, requireReview: true, allowedSkillRoots: [p.pluginDir] });
    return JSON.stringify({ ok: true, reviewId, proposal: applied, nextAction: "verify_event_log or export_audit_bundle" }, null, 2);
  },

  list_reviews(input, p) {
    const reviews = listReviews(p.learnerDir, { limit: input.limit || 50 });
    return JSON.stringify({ ok: true, reviews, nextAction: "show_proposal then preview_proposal" }, null, 2);
  },

  // Event-log read-only handlers live in control-handlers/events.js
  // (C-001 HANDLERS split — events domain): list_events, event_summary, verify_event_log.
  ...eventHandlers,

  list_agent_tasks(input, p) {
    const tasks = listAgentTaskStates(p.learnerDir, { limit: input.limit || 50 });
    return JSON.stringify({ ok: true, tasks, nextAction: "show_agent_task" }, null, 2);
  },

  show_agent_task(input, p) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const bundle = readAgentTaskBundle(p.learnerDir, taskId);
    if (!bundle) throw new Error(`agent task not found: ${taskId}`);
    return JSON.stringify({ ok: true, ...bundle, nextAction: bundle.summary.pendingApprovals > 0 ? "approve_agent_task or reject_agent_task" : "resume_agent_task" }, null, 2);
  },

  approve_agent_task(input, p) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const approved = approveAgentTask(p.learnerDir, taskId, { requestId: input.requestId || null, reason: input.reason || "approved through self_learning_control" });
    return JSON.stringify({ ok: true, taskId, requestId: approved.requestId, state: approved.state.state, nextAction: "resume_agent_task" }, null, 2);
  },

  reject_agent_task(input, p) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const rejected = rejectAgentTask(p.learnerDir, taskId, { requestId: input.requestId || null, reason: input.reason || "rejected through self_learning_control" });
    return JSON.stringify({ ok: true, taskId, requestId: rejected.requestId, state: rejected.state.state, nextAction: "show_agent_task" }, null, 2);
  },

  cancel_agent_task(input, p) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const cancelled = cancelAgentTask(p.learnerDir, taskId, { requestId: input.requestId || null, reason: input.reason || "cancelled through self_learning_control" });
    return JSON.stringify({ ok: true, taskId, state: cancelled.state.state, nextAction: "show_agent_task" }, null, 2);
  },

  async resume_agent_task(input, p, config) {
    const taskId = input.taskId || input.id;
    if (!taskId) throw new Error("taskId is required");
    const resumed = await resumeAgentTask(p.learnerDir, taskId, { learnerDir: p.learnerDir, config, workspaceRoot: p.pluginDir });
    return JSON.stringify({ ok: resumed.ok, taskId, state: resumed.state.state, traceEvents: resumed.trace?.events?.length || 0, nextAction: resumed.state.state === "waiting_for_human" ? "show_agent_task then approve_agent_task or reject_agent_task" : "show_agent_task" }, null, 2);
  },

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

  async run_benchmarks(input, p, config) {
    const outputDir = input.benchmarkOutputDir || path.join(p.learnerDir, "benchmark-runs", new Date().toISOString().replace(/[:.]/g, "-"));
    const root = resolveProjectRoot(input, p, { requireBenchmarkCorpus: true });
    if (!root.ok) {
      appendEvent(p.learnerDir, { type: "benchmark.unavailable", entityType: "benchmark", entityId: path.basename(outputDir), summary: "Benchmark corpus unavailable in runtime package", data: { outputDir, reason: root.reason, checked: root.checked } });
      return JSON.stringify({ ok: false, status: "unavailable", outputDir, reason: root.reason, checked: root.checked, nextAction: "provide projectRoot/sourceRoot or install from a source checkout with .source-root.json" }, null, 2);
    }
    const result = await runBenchmarkCorpus({
      projectRoot: root.projectRoot,
      benchmarkRoot: path.join(root.projectRoot, "benchmarks"),
      ids: input.benchmarkId || input.id ? [input.benchmarkId || input.id] : [],
      outputDir,
    }, { pluginDir: root.projectRoot, learnerDir: p.learnerDir, config });
    appendEvent(p.learnerDir, { type: "benchmark.ran", entityType: "benchmark", entityId: path.basename(outputDir), summary: `Ran benchmark corpus: ${result.runs?.length || 0} scenario(s), ok=${result.ok}`, data: { outputDir, projectRoot: root.projectRoot, projectRootSource: root.source, metrics: result.metrics, regressions: result.regressions || [] } });
    return JSON.stringify({ ok: result.ok, outputDir, projectRoot: root.projectRoot, projectRootSource: root.source, metrics: result.metrics, regressions: result.regressions || [], nextAction: "review benchmark-report.md" }, null, 2);
  },

  run_skill_promotion_loop(input, p, config) {
    const result = runSkillPromotionLoop(p.learnerDir, {
      promotionThreshold: input.minInjectCount || 3, minSuccess: input.minInjectCount || 5,
      activeSuccess: Math.max(Number(input.minInjectCount || 5) + 2, 3), halfLifeDays: input.decayHalfLifeDays || config.decayHalfLifeDays || 30,
    });
    appendEvent(p.learnerDir, { type: "skill_promotion.loop_ran", entityType: "skill_promotion", entityId: "skill_candidates", summary: `Ran skill promotion loop: candidates=${result.counts?.candidates || 0}, active=${result.counts?.active || 0}`, data: { counts: result.counts, events: result.events } });
    return JSON.stringify({ ok: result.ok, counts: result.counts, autoSkillFileWriteBlocked: result.autoSkillFileWriteBlocked, nextAction: "list_skill_candidates or export_audit_bundle" }, null, 2);
  },

  // Skill-promotion & policy read-only handlers live in control-handlers/skill-policy.js
  // (C-001 HANDLERS split pilot): list_skill_candidates, list_active_skills, list_policy_profiles.
  ...skillPolicyHandlers,

  doctor(input, p) {
    const report = runDoctorFromDisk(p.learnerDir);
    return input.format === "json" ? JSON.stringify(report, null, 2) : formatReport(report);
  },

  set_policy_profile(input, p, config, patterns) {
    const profileName = input.governanceProfile || input.id || "balanced";
    const result = applyPolicyProfile(config, profileName);
    if (!result.ok) throw new Error(result.error);
    writeJson(p.configPath, result.config);
    appendEvent(p.learnerDir, { type: "policy.applied", entityType: "config", entityId: "governanceProfile", summary: `Applied governance profile: ${result.profile}`, data: { profile: result.profile, changed: result.changed } });
    regenerateSkill(p, patterns, result.config);
    return JSON.stringify({ ok: true, profile: result.profile, changed: result.changed, config: result.config, nextAction: "doctor" }, null, 2);
  },

  export_audit_bundle(input, p, config, patterns) {
    const proposals = listProposals(p.learnerDir, { limit: 500 });
    const reviews = listReviews(p.learnerDir, { limit: 500 });
    const events = readEvents(p.learnerDir, { limit: input.limit || 5000 });
    const facts = loadFacts(p.learnerDir);
    const doctorReport = runDoctorFromDisk(p.learnerDir);
    const transferCandidates = listTransferCandidateRecords(p.learnerDir, { limit: 500 });
    const version = readPluginVersion(p.pluginDir);
    const bundle = buildAuditBundle({ version, config, patterns, facts, proposals, reviews, events, eventSummary: replayEventState(events), doctor: doctorReport, transferCandidates });
    const written = exportAuditBundle(p.learnerDir, bundle);
    appendEvent(p.learnerDir, { type: "audit.exported", entityType: "audit", entityId: path.basename(written.dir), summary: "Exported local audit bundle", data: { dir: written.dir, doctorStatus: doctorReport.status } });
    return JSON.stringify({ ok: true, ...written, summary: bundle.summary, nextAction: "review audit-report.md" }, null, 2);
  },

  generate_audit_dashboard(input, p) {
    const root = resolveProjectRoot(input, p, { requireBenchmarkCorpus: true });
    const version = readPluginVersion(root.ok ? root.projectRoot : p.pluginDir);
    const benchmarkRunsDir = input.benchmarkRunsDir || path.join(p.learnerDir, "benchmark-runs");
    const dashboard = buildAuditDashboard(p.learnerDir, { version, limit: input.limit || 50, benchmarkRunsDir, benchmarkReportPath: input.benchmarkReportPath });
    if (!dashboard.benchmark?.available && root.ok) dashboard.benchmark.sourceProjectRoot = root.projectRoot;
    const written = exportAuditDashboard(p.learnerDir, dashboard, { name: input.id || undefined, version });
    appendEvent(p.learnerDir, { type: "audit.dashboard_generated", entityType: "audit_dashboard", entityId: path.basename(written.dir), summary: `Generated audit dashboard: posture=${written.safetyPosture}`, data: { dir: written.dir, summary: written.summary, recommendations: written.recommendations } });
    return JSON.stringify({ ok: true, ...written, nextAction: "review dashboard.md or export_audit_bundle" }, null, 2);
  },

  trust_project_scripts(input, p, config) {
    const wsRoot = input.workspaceRoot ? path.resolve(input.workspaceRoot) : process.cwd();
    const fingerprint = projectScriptsFingerprint(wsRoot);
    if (!Object.keys(fingerprint.scripts).length) {
      throw new Error("no scripts found in package.json at " + wsRoot);
    }
    const current = mergeConfig(config);
    const next = mergeConfig(current, {
      autoActionCommands: {
        ...(current.autoActionCommands || {}),
        allowProjectScripts: true,
        projectScripts: { scriptsHash: fingerprint.scriptsHash },
      },
    });
    writeJson(p.configPath, next);
    appendEvent(p.learnerDir, {
      type: "trust.project_scripts_approved",
      entityType: "config",
      entityId: "projectScripts",
      summary: `Trusted project scripts hash: ${fingerprint.scriptsHash.slice(0, 16)} at ${fingerprint.packageJsonPath}`,
      data: { scriptsHash: fingerprint.scriptsHash, packageJsonPath: fingerprint.packageJsonPath, scriptNames: Object.keys(fingerprint.scripts) },
    });
    return JSON.stringify({ ok: true, scriptsHash: fingerprint.scriptsHash, packageJsonPath: fingerprint.packageJsonPath, scripts: fingerprint.scripts, nextAction: "npm test or npm run check can now execute automatically" }, null, 2);
  },

  release_readiness(input, p) {
    const outputDir = input.releaseOutputDir || path.join(p.learnerDir, "release-readiness", new Date().toISOString().replace(/[:.]/g, "-"));
    const root = resolveProjectRoot(input, p, { requireReleaseArtifacts: true });
    if (!root.ok) {
      const unavailable = { ok: false, status: "unavailable", outputDir, reason: root.reason, checked: root.checked, nextAction: "provide projectRoot/sourceRoot for the source checkout; release readiness is not meaningful in a trimmed runtime package" };
      appendEvent(p.learnerDir, { type: "release.readiness_unavailable", entityType: "release", entityId: "runtime-package", summary: "Release readiness unavailable in runtime package", data: unavailable });
      return JSON.stringify(unavailable, null, 2);
    }
    const result = exportReleaseReadiness(root.projectRoot, outputDir, { minBenchmarkScenarios: input.minInjectCount || 16 });
    appendEvent(p.learnerDir, { type: "release.readiness_checked", entityType: "release", entityId: result.summary.version, summary: `Release readiness checked: status=${result.summary.status}, score=${result.summary.score}`, data: { outputDir, projectRoot: root.projectRoot, projectRootSource: root.source, failedChecks: result.summary.failedChecks } });
    if (input.format === "json") return JSON.stringify({ ok: result.summary.ok, outputDir, projectRoot: root.projectRoot, projectRootSource: root.source, summary: result.summary, checks: result.checks, nextAction: result.summary.nextAction }, null, 2);
    return formatReleaseReadinessReport(result);
  },

  async diagnose_bus(input, p, config, patterns, ctx) {
    const diag = {
      hasBus: !!ctx?.bus, hasRequest: typeof ctx?.bus?.request === "function",
      hasGetCapability: typeof ctx?.bus?.getCapability === "function",
      hasHasHandler: typeof ctx?.bus?.hasHandler === "function",
      sessionSendCap: null, sampleTextCap: null, sessionSendTest: null,
    };
    try { diag.sessionSendCap = ctx?.bus?.getCapability?.("session:send") || null; } catch (e) { diag.sessionSendCap = { error: e.message }; }
    try { diag.sampleTextCap = ctx?.bus?.getCapability?.("model:sample-text") || null; } catch (e) { diag.sampleTextCap = { error: e.message }; }
    try {
      const target = normalizeSessionTarget(input);
      if (target.sessionId || target.sessionRef || target.sessionPath) {
        const payload = { text: "[self-evolve diagnostic] session:send test" };
        if (target.sessionId) payload.sessionId = target.sessionId;
        if (target.sessionRef) payload.sessionRef = target.sessionRef;
        if (target.sessionPath) payload.sessionPath = target.sessionPath;
        const r = await ctx.bus.request("session:send", payload);
        diag.sessionSendTest = { ok: true, payload, result: r };
      } else diag.sessionSendTest = { skipped: "no session target provided in input" };
    } catch (e) { diag.sessionSendTest = { ok: false, error: e.message, stack: e.stack?.slice(0, 300) }; }
    return JSON.stringify(diag, null, 2);
  },
};
export const name = "self_learning_control";

export const description = "Review and control the runtime self-learning engine: list patterns, approve/reject hints, update injection config, or roll back the generated skill.";

const READ_ONLY_CONTROL_ACTIONS = new Set([
  "status", "list", "list_proposals", "show_proposal", "review_panel", "list_reviews",
  "list_events", "event_summary", "verify_event_log", "list_agent_tasks", "show_agent_task",
  "list_transfer_candidates", "show_transfer_candidate", "list_skill_candidates", "list_active_skills",
  "doctor", "list_policy_profiles", "diagnose_bus", "feedback_summary",
]);

const EXTERNAL_MODEL_ACTIONS = new Set([
  "run_model_advisor",
]);

const FILE_OUTPUT_ACTIONS = new Set([
  "run_benchmarks",
  "export_audit_bundle",
  "generate_audit_dashboard",
  "release_readiness",
]);

const REVIEW_QUEUE_ACTIONS = new Set([
  "preview_proposal",
  "validate_proposal",
]);

const LOCAL_STATE_MUTATION_ACTIONS = new Set([
  "approve", "reject", "set_config", "rollback", "regenerate_skill", "regenerate_memfs",
  "apply_proposal", "reject_proposal", "approve_review", "reject_review", "apply_review",
  "approve_agent_task", "reject_agent_task", "cancel_agent_task", "resume_agent_task",
  "register_transfer_candidate", "record_transfer_validation", "expire_transfer_candidate",
  "run_skill_promotion_loop", "set_policy_profile", "trust_project_scripts",
]);

function describeControlSideEffect(input = {}) {
  const action = typeof input.action === "string" ? input.action : "unknown";
  if (READ_ONLY_CONTROL_ACTIONS.has(action)) {
    return {
      kind: "read",
      summary: `Read runtime learner state for control action: ${action}.`,
      ruleId: `runtime-learner-control-${action}`,
    };
  }
  if (FILE_OUTPUT_ACTIONS.has(action)) {
    return {
      kind: "plugin_output",
      summary: `Generate runtime learner audit, benchmark, or release-readiness output for action: ${action}.`,
      ruleId: `runtime-learner-control-${action}`,
    };
  }
  if (REVIEW_QUEUE_ACTIONS.has(action)) {
    return {
      kind: "plugin_state_mutation",
      summary: `Update runtime learner review queue or event log while preparing proposal review action: ${action}.`,
      ruleId: `runtime-learner-control-${action}`,
    };
  }
  if (EXTERNAL_MODEL_ACTIONS.has(action)) {
    return {
      kind: "external_model_or_benchmark_run",
      summary: `Run runtime learner analysis that may call configured model/network providers: ${action}.`,
      ruleId: `runtime-learner-control-${action}`,
    };
  }
  return {
    kind: LOCAL_STATE_MUTATION_ACTIONS.has(action) ? "plugin_state_mutation" : "external_side_effect",
    summary: `Mutate runtime learner governance, memory, proposals, skills, approvals, configuration, or external state: ${action}.`,
    ruleId: `runtime-learner-control-${action}`,
  };
}

export const sessionPermission = {
  kind: "external_side_effect",
  describeSideEffect: describeControlSideEffect,
};

export const parameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: Object.keys(HANDLERS),
      description: "Control action to run.",
    },
    ...CONTROL_PARAM_PROPERTIES,
  },
  required: ["action"],
};

export async function execute(input = {}, ctx) {
  const p = toolPaths(ctx);
  const config = loadLearnerConfig(p.configPath, { persist: true });
  const patterns = readJson(p.patternsPath, []);
  const handler = HANDLERS[input.action];
  if (!handler) throw new Error(`unknown action: ${input.action}`);
  const result = await handler(input, p, config, patterns, ctx);
  if (typeof result === "string") {
    return { content: [{ type: "text", text: result }] };
  }
  if (result && typeof result === "object" && result.content) {
    return result;
  }
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
}
