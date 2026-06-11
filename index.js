/**
 * Runtime Self-Learning plugin for Hanako.
 *
 * Three layers:
 * 1. Observe: capture real Hanako runtime events per session.
 * 2. Learn: detect repeated workflows, errors, and explicit user corrections.
 * 3. Inject: update this plugin's self-learning skill with conservative hints.
 *
 * v0.6.0: Added activity log for user-visible learning timeline.
 */

import fs from "fs";
import path from "path";
import { DEFAULT_CONFIG, learnerDir, readJson, writeJson, buildSkillMdFromPatterns, cleanupTempFiles } from "./lib/common.js";
import { definePlugin } from "./lib/hana-runtime-compat.js";
import { createAdvisorRunner } from "./lib/model-advisor.js";
import { applyProposal, buildSkillPatchProposal } from "./lib/proposals.js";
import { buildRepeatedCodePatchProposals } from "./lib/advisor-insights.js";
import { summarizeUsageEntry, updateUsageSummary, snapshotHostCapabilities } from "./lib/usage-pipeline.js";
import { usageDedupKey, absorbDiskPatternState } from "./lib/helpers.js";
import { PatternDetector } from "./lib/pattern-detector.js";
import { createObserver } from "./lib/observer.js";
import { snapshotSkill, pruneSkillBackups, skipObservedLine } from "./lib/skill-lifecycle.js";
import { isProposalReviewApproved } from "./lib/review-queue.js";
import { runPostFlushPipeline } from "./lib/pipeline.js";
import { mergeCredentials, detectPlaintextCredentials, saveCredentials } from "./lib/credentials.js";
import { createActivityLogger } from "./lib/activity-log.js";
import { createJsonlRetentionPruner } from "./lib/log-retention.js";
import { createSessionMessenger } from "./lib/session-messenger.js";
import { createSeenIdStore } from "./lib/seen-id-store.js";

const DATA_DIR = learnerDir();
const EXPERIENCE_LOG = path.join(DATA_DIR, "experience_log.jsonl");
const ERROR_LOG = path.join(DATA_DIR, "error_log.jsonl");
const USAGE_SEEN_FILE = path.join(DATA_DIR, "usage_seen.json");
const CAPABILITIES_FILE = path.join(DATA_DIR, "host_capabilities.json");
const PATTERNS_FILE = path.join(DATA_DIR, "patterns.json");
const TURNS_FILE = path.join(DATA_DIR, "turns.jsonl");
const EPISODES_FILE = path.join(DATA_DIR, "episodes.jsonl");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const ACTIVITY_LOG = path.join(DATA_DIR, "activity_log.jsonl");
const HISTORY_DIR = path.join(DATA_DIR, "skill_history");
const MAX_SESSIONS = 64;
const SKILL_REFRESH_MIN_MS = 10_000;
const MAX_SKILL_HISTORY = 20;
const MAX_ACTIVITY_ENTRIES = 500;
const LOG_RETENTION_DAYS = 30;
const CODE_PROPOSAL_MIN_COUNT = 3;

const runtimeState = {
  detector: null,
  sessions: null,
  unsub: null,
  persistPatterns: null,
  persistSeenIds: null,
  refreshSkill: null,
  statusNotifiedAt: new Map(),
  advisorSkipReasons: new Map(), // reason → timestampMs, TTL 30 min
  proposalNotifiedIds: new Map(), // proposalId → lastNotifiedAt timestamp
  sessionStart: null,
  sessionActivityCount: 0,
  pendingAdoptionChecks: new Map(),
};


function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "proposals"), { recursive: true });
  // Clean up orphan .tmp files from crashed writeJson calls.
  try { cleanupTempFiles(DATA_DIR); } catch { /* best-effort at startup */ }
}


function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (e) {
    // Only move the file aside on JSON parse errors — a disk I/O error
    // (EACCES, EIO, etc.) should not rename and overwrite valid user config.
    if (e instanceof SyntaxError) {
      try { fs.renameSync(CONFIG_FILE, `${CONFIG_FILE}.corrupt.${Date.now()}.bak`); } catch {}
    }
  }
  try { writeJson(CONFIG_FILE, DEFAULT_CONFIG); } catch {}
  return { ...DEFAULT_CONFIG };
}

/* ── Activity log + retention ── */

const activity = createActivityLogger(ACTIVITY_LOG, { maxEntries: MAX_ACTIVITY_ENTRIES });
const logActivity = (event) => activity.log(event);
const pruneDataFiles = createJsonlRetentionPruner(
  [EXPERIENCE_LOG, TURNS_FILE, EPISODES_FILE, ERROR_LOG, ACTIVITY_LOG],
  { retentionDays: LOG_RETENTION_DAYS }
);

// patterns.json retention is intentionally NOT handled here. It used to read
// + rewrite the file on disk, but the in-memory detector re-persists its full
// set on the next flush. Retention is centralised in PatternDetector.pruneMemory().

/* ── Plugin lifecycle ── */

export default definePlugin({
  async onload(ctx, { register }) {
    try {
    ensureDir();

    let config = loadConfig();

    // One-time migration: move any plaintext API keys from old config.json into
    // the encrypted credentials store. After migration the config file is
    // rewritten with placeholder values so the keys never persist in plaintext.
    try {
      const plaintextKeys = detectPlaintextCredentials(config);
      if (plaintextKeys.length > 0) {
        const toEncrypt = {};
        for (const key of plaintextKeys) toEncrypt[key] = config[key];
        saveCredentials(toEncrypt);
        // Rewrite config with sanitised values
        const sanitised = { ...config };
        for (const key of plaintextKeys) sanitised[key] = "(stored in credentials.enc)";
        try { writeJson(CONFIG_FILE, sanitised); } catch {}
        ctx.log.info(`runtime-learner: migrated ${plaintextKeys.length} plaintext credential(s) to encrypted store`);
      }
    } catch {}

    // Merge encrypted credentials on top of the config — the encrypted store
    // is the canonical source for API keys.
    config = mergeCredentials(config);

    const seenIds = createSeenIdStore(readJson(USAGE_SEEN_FILE, []), {
      cap: 5000,
      persist: (ids) => writeJson(USAGE_SEEN_FILE, ids),
    });
    const persistSeenIds = (force = false) => {
      try { seenIds.flush(force); } catch {}
    };
    runtimeState.persistSeenIds = () => persistSeenIds(true);
    const detector = new PatternDetector(config);

    // One-time migration: mark legacy preferences as durable knowledge.
    try {
      const patterns = readJson(PATTERNS_FILE, []);
      let migrated = 0;
      for (const p of patterns) {
        if (p.type === "preference" && !p.knowledgeTier) {
          p.knowledgeTier = "durable";
          migrated += 1;
        }
      }
      if (migrated > 0) {
        writeJson(PATTERNS_FILE, patterns);
        ctx.log.info(`runtime-learner: migrated ${migrated} preferences to durable tier`);
      }
    } catch {}

    const sessions = new Map();
    let lastSkillRefresh = 0;
    runtimeState.sessionStart = new Date().toISOString();
    runtimeState.sessionActivityCount = 0;

    // Sync disk status into in-memory detector (control.js may approve/reject)
    // Called once per flush cycle instead of on every persist.
    // Uses mtime cache: only re-reads patterns.json when it was modified by control.js.
    let _patternsMtime = 0;
    const syncDiskStatus = () => {
      try {
        if (!fs.existsSync(PATTERNS_FILE)) return;
        const mtime = fs.statSync(PATTERNS_FILE).mtimeMs;
        if (mtime === _patternsMtime) return; // no change, skip
        _patternsMtime = mtime;
        const disk = readJson(PATTERNS_FILE, []);
        if (!disk.length) return;
        // Reconcile each disk pattern into its in-memory twin. The per-pattern
        // merge rules (manual approve/reject, durable promotion, autoApproved
        // clearing, and a newer advisor-distilled fix from control.js's manual
        // run_model_advisor) live in absorbDiskPatternState so they are unit
        // tested independently of the plugin lifecycle.
        for (const p of disk) {
          if (!p.id) continue;
          const stored = detector.patterns.get(p.id);
          if (!stored) continue;
          if (absorbDiskPatternState(stored, p)) detector.invalidate();
        }
      } catch {}
    };

    const persistPatternsNow = () => {
      syncDiskStatus();
      writeJson(PATTERNS_FILE, [...detector.patterns.values()].map(p => ({ ...p })));
      try { _patternsMtime = fs.statSync(PATTERNS_FILE).mtimeMs; } catch {}
    };

    // Debounced persist: coalesce the many flush/usage writes in a busy session
    // into at most one disk write per ~1.5s. onunload force-flushes via
    // runtimeState.persistPatterns so nothing is lost on shutdown.
    let _persistTimer = null;
    const persistPatterns = () => {
      if (_persistTimer) return;
      _persistTimer = setTimeout(() => {
        _persistTimer = null;
        try { persistPatternsNow(); }
        catch (err) { ctx.log.warn(`runtime-learner: persist failed: ${err.message}`); }
      }, 1500);
      _persistTimer.unref?.();
    };
    const flushPersist = () => {
      if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
      persistPatternsNow();
    };

    const messenger = createSessionMessenger(ctx, {
      proposalNotifiedIds: runtimeState.proposalNotifiedIds,
      statusNotifiedAt: runtimeState.statusNotifiedAt,
    });
    const notifyProposalReview = (sessionPath, proposals = [], options = {}) => (
      messenger.notifyProposalReview(sessionPath, proposals, config, options)
    );
    const notifyWorkStatus = (sessionPath, detail = "") => (
      messenger.notifyWorkStatus(sessionPath, config, detail)
    );

    const refreshSkill = (force = false, sessionPath = null, cachedAll = null) => {
      const now = Date.now();
      if (!force && now - lastSkillRefresh < SKILL_REFRESH_MIN_MS) return;
      const allPatterns = cachedAll || detector.all();
      const skillDir = path.join(ctx.pluginDir, "skills", "self-learning");
      fs.mkdirSync(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, "SKILL.md");
      const content = buildSkillMdFromPatterns(allPatterns, config, {
        turnCount: detector.turnCount,
        dataDir: DATA_DIR,
      });
      let current = null;
      try { current = fs.readFileSync(skillPath, "utf-8"); } catch {}
      if (skipObservedLine(current) !== skipObservedLine(content)) {
        snapshotSkill(skillPath, HISTORY_DIR, { keep: MAX_SKILL_HISTORY });
        const triggerPatternIds = allPatterns.filter(p => p.injectable).slice(0, 8).map(p => p.id);
        const proposal = buildSkillPatchProposal({
          learnerDir: DATA_DIR,
          skillPath,
          content,
          triggerPatternIds,
        });
        if (proposal.autoApply && proposal.status !== "applied") {
          if (config.requireReviewForAutoApply && !isProposalReviewApproved(DATA_DIR, proposal.id)) {
            ctx.log.info(`runtime-learner: queued ${proposal.id} for review before auto-apply (strict review mode)`);
          } else {
            applyProposal(DATA_DIR, proposal.id, {
              configPath: CONFIG_FILE,
              requireReview: !!config.requireReviewForAutoApply,
            });
            pruneSkillBackups(skillDir, { keep: MAX_SKILL_HISTORY });
          }
        }
      }
      const { proposals, created } = buildRepeatedCodePatchProposals({
        learnerDir: DATA_DIR, patterns: allPatterns, minCount: CODE_PROPOSAL_MIN_COUNT,
      });
      if (proposals.length > 0) {
        if (created > 0) {
          logActivity({ type: "proposal_created", summary: `Created ${created} high-risk code improvement proposal(s) for review`, sessionPath });
        }
        void notifyProposalReview(sessionPath, proposals);
      }
      lastSkillRefresh = now;
    };

    const advisorRunner = createAdvisorRunner({
      getConfig: () => config,
      detector,
      refreshSkill,
      logActivity,
      runtimeState,
      ctx,
      notifyProposalReview,
      notifyWorkStatus,
      dataDir: DATA_DIR,
      usageSummaryFile: path.join(DATA_DIR, "usage_summary.json"),
      capabilitiesFile: CAPABILITIES_FILE,
    });

    try {
      if (fs.existsSync(PATTERNS_FILE)) {
        const saved = JSON.parse(fs.readFileSync(PATTERNS_FILE, "utf-8"));
        detector.restore(saved);
        ctx.log.info(`runtime-learner: restored ${saved.length} patterns`);
      }
    } catch (err) {
      ctx.log.warn(`runtime-learner: load failed: ${err.message}`);
    }

    try {
      const capabilities = snapshotHostCapabilities(ctx);
      writeJson(CAPABILITIES_FILE, capabilities);
    } catch (err) {
      ctx.log.warn(`runtime-learner: capability snapshot skipped: ${err.message}`);
    }
    // Data directory display in settings (set once at startup)
    const updateDataDirDisplay = () => {
      try { ctx.config?.update?.({ dataDirPath: DATA_DIR }); } catch {}
    };

    const autoApprovePatterns = (sessionPath = null, cachedAll = null) => {
      if (!config.autoApproveHighConfidence) return { count: 0, allPatterns: cachedAll || detector.all() };
      const allPatterns = cachedAll || detector.all();
      let count = 0;
      for (const p of allPatterns) {
        if (p.status === "pending" && p.injectable && p.type !== "preference") {
          const stored = detector.patterns.get(p.id);
          if (stored && stored.status === "pending") {
            stored.status = "approved";
            stored.autoApproved = true;
            stored.reviewedAt = new Date().toISOString();
            count += 1;
          }
        }
      }
      if (count > 0) {
        logActivity({ type: "auto_approved", summary: `Auto-approved ${count} high-confidence pattern(s)`, sessionPath });
        ctx.log.info(`runtime-learner: auto-approved ${count} pattern(s)`);
        detector.invalidate();
        return { count, allPatterns: detector.all() };
      }
      return { count, allPatterns };
    };

    const recordUsage = (entry, sessionPath = null) => {
      if (!config.learnFromUsage) return;
      const summaryEntry = summarizeUsageEntry(entry, sessionPath);
      const dedupKey = usageDedupKey(entry, summaryEntry);
      if (dedupKey && !seenIds.add(dedupKey)) return;
      try {
        updateUsageSummary(summaryEntry);
        persistSeenIds();
        const usageChanges = detector.ingestUsage?.(summaryEntry) || [];
        for (const change of usageChanges) {
          if (!change.isNew) continue;
          logActivity({
            type: "usage_pattern_discovered",
            summary: `New usage pattern: ${change.pattern.desc}`,
            sessionPath,
          });
          runtimeState.sessionActivityCount += 1;
        }
        runPostFlushPipeline({
          detector,
          autoApprovePatterns,
          persistPatterns,
          refreshSkill,
          maybeRunModelAdvisor: advisorRunner.maybeRun,
          reason: "usage",
          sessionPath,
          ctx,
          config,
        });
      } catch (err) {
        ctx.log.warn(`runtime-learner: usage record skipped: ${err.message}`);
      }
    };

    try {
      const usageCapability = ctx.bus.getCapability?.("usage:list");
      if (config.learnFromUsage && (usageCapability?.available || ctx.bus.hasHandler?.("usage:list"))) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const result = await ctx.bus.request("usage:list", { since, limit: 50 });
        for (const entry of result?.entries || []) recordUsage(entry, entry.attribution?.sessionPath || null);
        persistSeenIds(true); // flush now so a hard kill won't re-count on next start
        ctx.log.info(`runtime-learner: bootstrapped ${result?.entries?.length || 0} usage records`);
      }
    } catch (err) {
      ctx.log.warn(`runtime-learner: usage bootstrap skipped: ${err.message}`);
    }

    // ── Observer setup (extracted to lib/observer.js) ──

    const configRef = { current: config };

    const observer = createObserver({
      detector,
      sessions,
      runtimeState,
      persistPatterns,
      refreshSkill,
      autoApprovePatterns,
      syncDiskStatus,
      pruneDataFiles,
      maybeRunModelAdvisor: advisorRunner.maybeRun,

      logActivity,
      recordUsage,
      configRef,
      ctx,
      paths: { TURNS_FILE, EPISODES_FILE, EXPERIENCE_LOG, ERROR_LOG, CONFIG_FILE },
      MAX_SESSIONS,
    });

    observer.subscribe(ctx.bus, config);

    runtimeState.detector = detector;
    runtimeState.sessions = sessions;
    runtimeState.unsub = () => observer.unsubscribe();
    runtimeState.persistPatterns = flushPersist;
    runtimeState.refreshSkill = refreshSkill;

    // Session startup activity entry
    logActivity({
      type: "session_start",
      summary: `Self-learning runtime started with ${detector.all().length} existing patterns`,
    });

    try {
      syncDiskStatus();
      const { allPatterns } = autoApprovePatterns();
      flushPersist();
      pruneDataFiles().catch(() => {});
      refreshSkill(true, null, allPatterns);
      advisorRunner.maybeRun("startup", null, allPatterns).catch(() => {});
    } catch (err) {
      ctx.log.warn(`runtime-learner: initial refresh failed: ${err.message}`);
    }

    ctx.log.info("runtime-learner: started three-layer self-learning runtime");

    updateDataDirDisplay();
    } catch (err) {
      try { ctx.log.error(`runtime-learner: onload failed: ${err.message}`); } catch {}
    }
  },

  async onunload() {
    logActivity({
      type: "session_end",
      summary: `Self-learning session ended. ${runtimeState.sessionActivityCount} activities this session. ${runtimeState.detector?.all()?.length || 0} total patterns.`,
    });
    const safeCall = (fn) => { try { fn(); } catch {} };
    if (runtimeState.unsub) safeCall(runtimeState.unsub);
    if (runtimeState.persistSeenIds) safeCall(runtimeState.persistSeenIds);
    if (runtimeState.persistPatterns) safeCall(runtimeState.persistPatterns);
    if (runtimeState.refreshSkill) safeCall(() => runtimeState.refreshSkill(true));
    runtimeState.detector = null;
    runtimeState.sessions = null;
    runtimeState.unsub = null;
    runtimeState.persistPatterns = null;
    runtimeState.persistSeenIds = null;
    runtimeState.refreshSkill = null;
    runtimeState.statusNotifiedAt.clear();
    runtimeState.advisorSkipReasons.clear();
    runtimeState.pendingAdoptionChecks.clear();
    runtimeState.proposalNotifiedIds.clear();
  },
});
