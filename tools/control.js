import fs from "fs";
import path from "path";
import { DEFAULT_CONFIG, readJson, writeJson, loadLearnerConfig, decoratePatterns, buildSkillMdFromPatterns, mergeConfig } from "../lib/common.js";
import { runModelAdvisor } from "../lib/model-advisor.js";
import { mergeAdvisorSuggestions } from "../lib/advisor-insights.js";
import { listProposals, readProposal, rejectProposal, previewProposalDiff, verifyProposalReviewBinding } from "../lib/proposals.js";
import { applyProposalSafely } from "../lib/proposal-apply-safe.js";
import { validateConfigPatch, validateProposal } from "../lib/validation-gate.js";
import { enqueueReviewForProposal, listReviews, readReview, reviewPanel, updateReviewStatus } from "../lib/review-queue.js";
import { appendEvent } from "../lib/event-log.js";
import { recordMemoryClosed, recordInjectionRevoked, wasRecentlyInjected, summarizeFeedback } from "../lib/feedback-signals.js";
import { writeSkillIfChanged } from "../lib/skill-lifecycle.js";
import { runDoctorFromDisk, formatReport } from "./doctor.js";
import { generateMemFS } from "../lib/memfs.js";
import { applyPolicyProfile } from "../lib/policy-profiles.js";
import { extractAndSaveCredentials, mergeCredentials, sanitizeCredentialPatch } from "../lib/credentials.js";
import { runSkillPromotionLoop } from "../lib/skill-promotion-loop.js";
import { projectScriptsFingerprint } from "../lib/project-script-trust.js";
import { exportReleaseReadiness, formatReleaseReadinessReport } from "../lib/release-readiness.js";
import { resolveProjectRoot } from "../lib/project-root.js";
import { normalizeSessionTarget } from "../lib/helpers.js";
import { toolPaths, readPluginVersion } from "./_shared.js";
import { validationNextAction, reviewPanelNextActions } from "./control-summaries.js";
import { CONTROL_PARAM_PROPERTIES } from "./control-parameters.js";
import { statusHandlers } from "./control-handlers/status.js";
import { skillPolicyHandlers } from "./control-handlers/skill-policy.js";
import { eventHandlers } from "./control-handlers/events.js";
import { agentTaskHandlers } from "./control-handlers/agent-tasks.js";
import { auditHandlers } from "./control-handlers/audit.js";
import { transferHandlers } from "./control-handlers/transfer.js";
import { controlNeedsConfig, controlNeedsPatterns, describeControlSideEffect } from "./control-action-registry.js";

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


const HANDLERS = {
  // Status read-model handler lives in control-handlers/status.js (S2.P2a split).
  ...statusHandlers,

  // Read-only diagnostic (M5b): surface the local feedback signal tallies.
  // Pure read — no file writes, no thresholds, no adaptive suggestions, and
  // nothing here participates in any current decision. Observation only.
  feedback_summary(input, p) {
    const n = Number(input.sinceDays);
    const sinceDays = Number.isFinite(n) && n > 0 ? n : 30;
    const { counts, injectedIdTotal } = summarizeFeedback(p.learnerDir, { sinceDays });
    return { ok: true, sinceDays, ...counts, injectedIdTotal };
  },

  // Read-only diagnostic entry (M4b): run the experimental read-only agent graph
  // (lib/agent-graph-readonly.js) over a caller-supplied context + plan and return
  // its report. Pure: it executes no node side effect, writes no event-log /
  // config / patterns / memory, runs no shell, and never auto-applies. Forbidden
  // (Execute/Repair/Rollback/HumanApproval/Apply) and side-effecting nodes are
  // rejected by the graph's Policy node. See docs/AGENT_GRAPH_READONLY.md.
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

  // Agent-task handlers (agent_graph_preview, list/show/approve/reject/cancel/
  // resume_agent_task) live in control-handlers/agent-tasks.js (C-001 split).
  ...agentTaskHandlers,

  // Cross-project transfer handlers live in control-handlers/transfer.js
  // (S11.P2 split): list/show/register/record/expire transfer candidates.
  ...transferHandlers,

  // Audit/benchmark handlers (run_benchmarks, export_audit_bundle,
  // generate_audit_dashboard) live in control-handlers/audit.js (C-001 split).
  ...auditHandlers,

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
    const report = runDoctorFromDisk(p.learnerDir, { manifestPath: path.join(p.pluginDir, "manifest.json"), fast: input.fast === true });
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

function parseJsonObject(text) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function sessionFileTarget(ctx = {}) {
  const target = {};
  if (typeof ctx.sessionId === "string" && ctx.sessionId.trim()) target.sessionId = ctx.sessionId;
  if (ctx.sessionRef && typeof ctx.sessionRef === "object") target.sessionRef = ctx.sessionRef;
  if (typeof ctx.sessionPath === "string" && ctx.sessionPath.trim()) target.sessionPath = ctx.sessionPath;
  return Object.keys(target).length ? target : null;
}

function fileExists(filePath) {
  return typeof filePath === "string" && path.isAbsolute(filePath) && fs.existsSync(filePath);
}

function controlOutputFiles(action, payload = {}) {
  if (!payload || typeof payload !== "object") return [];
  if (action === "run_benchmarks") {
    return ["benchmark-report.md", "benchmark-report.json"]
      .map((name) => path.join(payload.outputDir || "", name))
      .filter(fileExists);
  }
  if (action === "export_audit_bundle" || action === "generate_audit_dashboard") {
    return [payload.mdPath, payload.jsonPath].filter(fileExists);
  }
  if (action === "release_readiness") {
    return ["release-readiness.md", "release-readiness.json"]
      .map((name) => path.join(payload.outputDir || "", name))
      .filter(fileExists);
  }
  return [];
}

function stageControlOutputFiles(input = {}, resultText, ctx = {}) {
  if (typeof ctx?.stageFile !== "function") return [];
  const target = sessionFileTarget(ctx);
  if (!target) return [];
  const payload = parseJsonObject(resultText);
  const files = controlOutputFiles(input.action, payload);
  const staged = [];
  for (const filePath of files) {
    try {
      const stagedFile = ctx.stageFile({
        ...target,
        filePath,
        label: path.basename(filePath),
      });
      staged.push({
        ok: true,
        filePath,
        label: path.basename(filePath),
        file: stagedFile?.file || null,
        mediaItem: stagedFile?.mediaItem || null,
      });
    } catch (error) {
      staged.push({
        ok: false,
        filePath,
        label: path.basename(filePath),
        error: error?.message || String(error),
      });
    }
  }
  return staged;
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
  const handler = HANDLERS[input.action];
  if (!handler) throw new Error(`unknown action: ${input.action}`);
  const config = controlNeedsConfig(input.action)
    ? loadLearnerConfig(p.configPath, { persist: true })
    : null;
  const patterns = controlNeedsPatterns(input.action)
    ? readJson(p.patternsPath, [])
    : null;
  const result = await handler(input, p, config, patterns, ctx);
  if (typeof result === "string") {
    const stagedFiles = stageControlOutputFiles(input, result, ctx);
    const mediaItems = stagedFiles.map((item) => item.mediaItem).filter(Boolean);
    return {
      content: [{ type: "text", text: result }],
      ...(stagedFiles.length ? { details: { stagedFiles, ...(mediaItems.length ? { media: { items: mediaItems } } : {}) } } : {}),
    };
  }
  if (result && typeof result === "object" && result.content) {
    return result;
  }
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
}
