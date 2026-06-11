import fs from "fs";
import path from "path";
import { DEFAULT_CONFIG, readJson, writeJson, loadLearnerConfig, decoratePatterns, buildSkillMdFromPatterns } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";
import { runModelAdvisor } from "../lib/model-advisor.js";
import { mergeAdvisorSuggestions } from "../lib/advisor-insights.js";
import { applyProposal, listProposals, readProposal, rejectProposal, previewProposalDiff, verifyProposalReviewBinding } from "../lib/proposals.js";
import { validateConfigPatch, validateProposal } from "../lib/validation-gate.js";
import { enqueueReviewForProposal, listReviews, readReview, reviewPanel, updateReviewStatus } from "../lib/review-queue.js";
import { readEvents, appendEvent, replayEventState, verifyEventLog } from "../lib/event-log.js";
import { writeSkillIfChanged } from "../lib/skill-lifecycle.js";
import { runDoctorFromDisk, formatReport } from "./doctor.js";
import { generateMemFS } from "../lib/memfs.js";
import { loadFacts } from "../lib/facts.js";
import { applyPolicyProfile, listPolicyProfiles } from "../lib/policy-profiles.js";
import { buildAuditBundle, exportAuditBundle } from "../lib/audit-bundle.js";
import { buildAuditDashboard, exportAuditDashboard } from "../lib/audit-dashboard.js";
import { extractAndSaveCredentials } from "../lib/credentials.js";
import { listAgentTaskStates, readAgentTaskBundle } from "../lib/agent-task-store.js";
import { approveAgentTask, cancelAgentTask, rejectAgentTask, resumeAgentTask } from "../lib/agent-resume.js";
import { expireTransferCandidate, listTransferCandidateRecords, loadTransferCandidateRecord, recordTransferValidation, registerTransferCandidate, summarizeTransferCandidate } from "../lib/transfer-registry.js";
import { runBenchmarkCorpus } from "../lib/benchmark-corpus.js";
import { loadActiveSkills, loadSkillCandidates, runSkillPromotionLoop } from "../lib/skill-promotion-loop.js";
import { projectScriptsFingerprint } from "../lib/project-script-trust.js";
import { exportReleaseReadiness, formatReleaseReadinessReport } from "../lib/release-readiness.js";
import { toolPaths } from "./_shared.js";

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

function countByStatus(rows = [], field = "status") {
  const counts = {};
  for (const row of rows) {
    const key = row?.[field] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function validationNextAction(validation) {
  return validation?.ok
    ? "approve_review then apply_review"
    : "fix proposal or reject_proposal";
}

function reviewPanelNextActions(panel = {}) {
  const actions = [];
  const blocked = panel.counts?.blockedReviews || 0;
  const pending = panel.counts?.pendingReviews || 0;
  if (blocked > 0) actions.push("validate blocked reviews, then fix or reject them");
  if (pending > 0) actions.push("preview queued reviews, then approve_review or reject_review");
  if (panel.counts?.pendingProposals > 0) actions.push("validate_proposal for pending proposals not yet reviewed");
  if (!actions.length) actions.push("no review action needed");
  return actions;
}

const HANDLERS = {
  status(input, p, config, patterns) {
    const decorated = decoratePatterns(patterns, config);
    let history = [];
    try { history = fs.readdirSync(p.historyDir).filter((n) => n.endsWith("-SKILL.md")).sort(); } catch {}
    const proposalCounts = countByStatus(listProposals(p.learnerDir, { limit: 0 }));
    const reviewCounts = countByStatus(listReviews(p.learnerDir, { limit: 0 }));
    const agentTasks = listAgentTaskStates(p.learnerDir, { limit: 1000 });
    const transferCounts = countByStatus(listTransferCandidateRecords(p.learnerDir, { limit: 1000 }));
    return JSON.stringify({
      config: redactConfig(config),
      patterns: decorated.length,
      injectable: decorated.filter((x) => x.injectable).length,
      pending: decorated.filter((x) => x.status === "pending").length,
      approved: decorated.filter((x) => x.status === "approved").length,
      rejected: decorated.filter((x) => x.status === "rejected").length,
      historySnapshots: history.length,
      proposals: { pending: proposalCounts.pending || 0, applied: proposalCounts.applied || 0, rejected: proposalCounts.rejected || 0, dir: p.proposalsDir },
      reviews: { queued: reviewCounts.queued || 0, blocked: reviewCounts.blocked || 0, approved: reviewCounts.approved || 0 },
      agentTasks: { total: agentTasks.length, waiting: agentTasks.filter((t) => t.state === "waiting_for_human").length },
      transferCandidates: {
        total: Object.values(transferCounts).reduce((s, n) => s + n, 0),
        pending: transferCounts.transferred_candidate || 0, validated: transferCounts.validated || 0, failed: transferCounts.validation_failed || 0,
      },
      skillPromotion: { candidates: loadSkillCandidates(p.learnerDir).candidates.length, active: loadActiveSkills(p.learnerDir).skills.length },
      dataDir: p.learnerDir,
    }, null, 2);
  },

  list(input, p, config, patterns) {
    return JSON.stringify(decoratePatterns(patterns, config).slice(0, 20).map((pat) => ({
      id: pat.id, type: pat.type, desc: pat.desc, count: pat.count, score: pat.score,
      decayedScore: pat.decayedScore, status: pat.status, knowledgeTier: pat.knowledgeTier, injectable: pat.injectable,
      fix: pat.fix || null, lastSeen: pat.lastSeen, scope: pat.scope, context: pat.context ? { taskType: pat.context.taskType } : null,
      evidencePreview: (pat.evidence || []).slice(0, 1).map((e) => e.quote).join(" ") || null,
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
    const sanitisedPatch = extractAndSaveCredentials(patch);
    const validation = validateConfigPatch(sanitisedPatch, config);
    if (!validation.ok) {
      const failures = validation.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ");
      throw new Error(`config validation failed: ${failures}`);
    }
    const next = { ...config, ...sanitisedPatch };
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
    const result = await runModelAdvisor({ config, patterns, usage: readJson(p.usageSummaryPath, null), capabilities: readJson(p.capabilitiesPath, null), reason: "manual", ctx });
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
    const applied = applyProposal(p.learnerDir, input.proposalId || input.id, {
      configPath: p.configPath,
      requireReview: !!config.requireReviewForAutoApply,
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
    const applied = applyProposal(p.learnerDir, review.proposalId, { configPath: p.configPath, requireReview: true });
    return JSON.stringify({ ok: true, reviewId, proposal: applied, nextAction: "verify_event_log or export_audit_bundle" }, null, 2);
  },

  list_reviews(input, p) {
    const reviews = listReviews(p.learnerDir, { limit: input.limit || 50 });
    return JSON.stringify({ ok: true, reviews, nextAction: "show_proposal then preview_proposal" }, null, 2);
  },

  list_events(input, p) {
    return JSON.stringify({ ok: true, events: readEvents(p.learnerDir, { limit: input.limit || 50, entityId: input.id || null }) }, null, 2);
  },

  event_summary(input, p) {
    const events = readEvents(p.learnerDir, { limit: input.limit || 5000, entityId: input.id || null });
    return JSON.stringify({ ok: true, summary: replayEventState(events) }, null, 2);
  },

  verify_event_log(input, p) {
    const result = verifyEventLog(p.learnerDir);
    return JSON.stringify({ ...result, nextAction: result.ok ? "export_audit_bundle or continue" : "inspect event_log.jsonl and restore from trusted backup" }, null, 2);
  },

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
    const result = await runBenchmarkCorpus({
      benchmarkRoot: path.join(p.pluginDir, "benchmarks"),
      ids: input.benchmarkId || input.id ? [input.benchmarkId || input.id] : [],
      outputDir,
    }, { pluginDir: p.pluginDir, learnerDir: p.learnerDir, config });
    appendEvent(p.learnerDir, { type: "benchmark.ran", entityType: "benchmark", entityId: path.basename(outputDir), summary: `Ran benchmark corpus: ${result.runs?.length || 0} scenario(s), ok=${result.ok}`, data: { outputDir, metrics: result.metrics, regressions: result.regressions || [] } });
    return JSON.stringify({ ok: result.ok, outputDir, metrics: result.metrics, regressions: result.regressions || [], nextAction: "review benchmark-report.md" }, null, 2);
  },

  run_skill_promotion_loop(input, p, config) {
    const result = runSkillPromotionLoop(p.learnerDir, {
      promotionThreshold: input.minInjectCount || 3, minSuccess: input.minInjectCount || 5,
      activeSuccess: Math.max(Number(input.minInjectCount || 5) + 2, 3), halfLifeDays: input.decayHalfLifeDays || config.decayHalfLifeDays || 30,
    });
    appendEvent(p.learnerDir, { type: "skill_promotion.loop_ran", entityType: "skill_promotion", entityId: "skill_candidates", summary: `Ran skill promotion loop: candidates=${result.counts?.candidates || 0}, active=${result.counts?.active || 0}`, data: { counts: result.counts, events: result.events } });
    return JSON.stringify({ ok: result.ok, counts: result.counts, autoSkillFileWriteBlocked: result.autoSkillFileWriteBlocked, nextAction: "list_skill_candidates or export_audit_bundle" }, null, 2);
  },

  list_skill_candidates(input, p) {
    const store = loadSkillCandidates(p.learnerDir);
    const candidates = store.candidates.slice(0, input.limit || 50).map((c) => ({ id: c.id, status: c.status, rule: c.rule, evidence: c.evidence, scope: c.scope, updatedAt: c.updatedAt }));
    return JSON.stringify({ ok: true, candidates, nextAction: "run_skill_promotion_loop or list_active_skills" }, null, 2);
  },

  list_active_skills(input, p) {
    const registry = loadActiveSkills(p.learnerDir);
    return JSON.stringify({ ok: true, skills: registry.skills.slice(0, input.limit || 50), nextAction: "export_audit_bundle" }, null, 2);
  },

  doctor(input, p) {
    const report = runDoctorFromDisk(p.learnerDir);
    return input.format === "json" ? JSON.stringify(report, null, 2) : formatReport(report);
  },

  list_policy_profiles(input, p, config) {
    return JSON.stringify({ ok: true, profiles: listPolicyProfiles(), current: config.governanceProfile || "balanced" }, null, 2);
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
    const version = readPluginVersion(p.pluginDir);
    const dashboard = buildAuditDashboard(p.learnerDir, { version, limit: input.limit || 50 });
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
    const next = {
      ...config,
      commands: {
        ...(config.commands || {}),
        allowProjectScripts: true,
        projectScripts: { scriptsHash: fingerprint.scriptsHash },
      },
    };
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
    const result = exportReleaseReadiness(p.pluginDir, outputDir, { minBenchmarkScenarios: input.minInjectCount || 16 });
    appendEvent(p.learnerDir, { type: "release.readiness_checked", entityType: "release", entityId: result.summary.version, summary: `Release readiness checked: status=${result.summary.status}, score=${result.summary.score}`, data: { outputDir, failedChecks: result.summary.failedChecks } });
    if (input.format === "json") return JSON.stringify({ ok: result.summary.ok, outputDir, summary: result.summary, checks: result.checks, nextAction: result.summary.nextAction }, null, 2);
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
      if (input.sessionPath) { const r = await ctx.bus.request("session:send", { sessionPath: input.sessionPath, text: "[self-evolve diagnostic] session:send test" }); diag.sessionSendTest = { ok: true, result: r }; }
      else diag.sessionSendTest = { skipped: "no sessionPath provided in input" };
    } catch (e) { diag.sessionSendTest = { ok: false, error: e.message, stack: e.stack?.slice(0, 300) }; }
    return JSON.stringify(diag, null, 2);
  },
};
const tool = defineTool({
  name: "self_learning_control",
  description: "Review and control the runtime self-learning engine: list patterns, approve/reject hints, update injection config, or roll back the generated skill.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: Object.keys(HANDLERS),
        description: "Control action to run.",
      },
      id: { type: "string", description: "Pattern id for approve/reject." },
      proposalId: { type: "string", description: "Proposal id for show/apply/reject proposal actions." },
      taskId: { type: "string", description: "Agent task id for agent task show/approve/reject/resume actions." },
      candidateId: { type: "string", description: "Cross-project transfer candidate id for transfer registry actions." },
      benchmarkId: { type: "string", description: "Optional benchmark scenario id for run_benchmarks." },
      benchmarkOutputDir: { type: "string", description: "Optional output directory for benchmark reports." },
      releaseOutputDir: { type: "string", description: "Optional output directory for release readiness reports." },
      candidate: { type: "object", description: "Cross-project transfer candidate object for register_transfer_candidate." },
      validationStatus: { type: "string", enum: ["passed", "failed"], description: "Target validation status for record_transfer_validation." },
      evidence: { type: "array", items: { type: "string" }, description: "Validation evidence lines for transfer registry actions." },
      requestId: { type: "string", description: "Approval request id for agent task approval actions." },
      reason: { type: "string", description: "Optional reason for proposal rejection." },
      status: { type: "string", description: "Optional proposal status filter: pending, applied, or rejected." },
      format: { type: "string", enum: ["text", "json"], description: "Output format for the doctor action. Default text." },
      governanceProfile: { type: "string", enum: ["conservative", "balanced", "autonomous"], description: "Governance policy profile to apply." },
      limit: { type: "number", description: "Maximum number of events/reviews to return for list actions." },
      autoInjectHighConfidence: { type: "boolean" },
      autoApproveHighConfidence: { type: "boolean" },
      minInjectScore: { type: "number" },
      minInjectCount: { type: "number" },
      decayHalfLifeDays: { type: "number" },
      includePendingPreferences: { type: "boolean" },
      learnFromUsage: { type: "boolean" },
      includeUsageInAdvisorPrompt: { type: "boolean" },
      officialMemoryBridgeEnabled: { type: "boolean" },
      officialMemoryBridgeMaxResults: { type: "number" },
      durableMemoryMaxCount: { type: "number" },
      largeUsageTokenThreshold: { type: "number" },
      officialUtilityModelDisplay: { type: "string" },
      modelAdvisorEnabled: { type: "boolean" },
      modelAdvisorSource: { type: "string", enum: ["official", "private", "off"] },
      modelAdvisorBaseUrl: { type: "string" },
      modelAdvisorApiKey: { type: "string" },
      modelAdvisorModel: { type: "string" },
      modelAdvisorMaxTokens: { type: "number" },
      modelAdvisorMinIntervalMinutes: { type: "number" },
      workStatusEnabled: { type: "boolean" },
      workStatusText: { type: "string" },
      proposalChatNotificationsEnabled: { type: "boolean" },
      requireReviewForAutoApply: { type: "boolean" },
      semanticSearchEnabled: { type: "boolean" },
      semanticEmbeddingBaseUrl: { type: "string" },
      semanticEmbeddingApiKey: { type: "string" },
      semanticEmbeddingModel: { type: "string" },
      semanticCacheMaxEntries: { type: "number" },
    },
    required: ["action"],
  },
  async execute(input = {}, ctx) {
    const p = toolPaths(ctx);
    const config = loadLearnerConfig(p.configPath, { persist: true });
    const patterns = readJson(p.patternsPath, []);
    const handler = HANDLERS[input.action];
    if (!handler) throw new Error(`unknown action: ${input.action}`);
    return await handler(input, p, config, patterns, ctx);
  },
});

export const { name, description, parameters, execute } = tool;
