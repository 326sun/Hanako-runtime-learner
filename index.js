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
import { learnerDir, readJson, writeJson, cleanupTempFiles } from "./lib/common.js";
import { definePlugin } from "./lib/hana-runtime-compat.js";
import { createAdvisorRunner } from "./lib/model-advisor.js";
import { createExtractionRunner } from "./lib/llm-extraction-worker.js";
import { summarizeUsageEntry, updateUsageSummary, snapshotHostCapabilities, usageBootstrapSince, usageBootstrapStatePath, recordUsageBootstrap } from "./lib/usage-pipeline.js";
import { usageDedupKey, absorbDiskPatternState, normalizeSessionTarget, sessionIdentityKey } from "./lib/helpers.js";
import { PatternDetector } from "./lib/pattern-detector.js";
import { createObserver } from "./lib/observer.js";
import { runPostFlushPipeline } from "./lib/pipeline.js";
import { createBudgetState } from "./lib/action-runtime.js";
import { createActivityLogger } from "./lib/activity-log.js";
import { createJsonlRetentionPruner } from "./lib/log-retention.js";
import { createSeenIdStore } from "./lib/seen-id-store.js";
import { setupBackgroundTasks } from "./lib/host-tasks.js";
import { createOnloadTimer } from "./lib/onload-timing.js";
import { createRuntimeConfigPath, loadRuntimeConfig, bridgePanelConfig, wireLiveConfigAndDisposal } from "./lib/runtime-live-config.js";
import { createSkillRefresh } from "./lib/runtime-skill-refresh.js";

const DEFAULT_DATA_DIR = learnerDir();

function createRuntimePaths(dataDir = DEFAULT_DATA_DIR) {
  const DATA_DIR = dataDir || DEFAULT_DATA_DIR;
  return {
    DATA_DIR,
    EXPERIENCE_LOG: path.join(DATA_DIR, "experience_log.jsonl"),
    ERROR_LOG: path.join(DATA_DIR, "error_log.jsonl"),
    USAGE_SEEN_FILE: path.join(DATA_DIR, "usage_seen.json"),
    CAPABILITIES_FILE: path.join(DATA_DIR, "host_capabilities.json"),
    PATTERNS_FILE: path.join(DATA_DIR, "patterns.json"),
    TURNS_FILE: path.join(DATA_DIR, "turns.jsonl"),
    EPISODES_FILE: path.join(DATA_DIR, "episodes.jsonl"),
    CONFIG_FILE: createRuntimeConfigPath(DATA_DIR),
    ACTIVITY_LOG: path.join(DATA_DIR, "activity_log.jsonl"),
    HISTORY_DIR: path.join(DATA_DIR, "skill_history"),
  };
}

const MAX_SESSIONS = 64;
const SKILL_REFRESH_MIN_MS = 10_000;
const MAX_SKILL_HISTORY = 20;
const MAX_ACTIVITY_ENTRIES = 500;
const LOG_RETENTION_DAYS = 30;
const CODE_PROPOSAL_MIN_COUNT = 3;

const noopBackground = async () => {};

const runtimeState = {
  detector: null,
  sessions: null,
  unsub: null,
  persistPatterns: null,
  persistSeenIds: null,
  refreshSkill: null,
  statusNotifiedAt: new Map(),
  sessionTargets: new Map(),
  advisorSkipReasons: new Map(), // reason → timestampMs, TTL 30 min
  proposalNotifiedIds: new Map(), // proposalId → lastNotifiedAt timestamp
  logActivity: null,
  sessionStart: null,
  sessionActivityCount: 0,
  pendingAdoptionChecks: new Map(),
};


function ensureDir(paths) {
  fs.mkdirSync(paths.DATA_DIR, { recursive: true });
  fs.mkdirSync(paths.HISTORY_DIR, { recursive: true });
  fs.mkdirSync(path.join(paths.DATA_DIR, "proposals"), { recursive: true });
  // Clean up orphan .tmp files from crashed writeJson calls.
  try { cleanupTempFiles(paths.DATA_DIR); } catch { /* best-effort at startup */ }
}


/* ── Activity log + retention ── */

function createRuntimeLoggers(paths) {
  const activity = createActivityLogger(paths.ACTIVITY_LOG, { maxEntries: MAX_ACTIVITY_ENTRIES });
  return {
    logActivity: (event) => activity.log(event),
    pruneDataFiles: createJsonlRetentionPruner(
      [paths.EXPERIENCE_LOG, paths.TURNS_FILE, paths.EPISODES_FILE, paths.ERROR_LOG, paths.ACTIVITY_LOG],
      { retentionDays: LOG_RETENTION_DAYS }
    ),
  };
}

function scheduleAfterOnload(ctx, label, fn, onloadTimer = null) {
  const timer = setTimeout(() => {
    try {
      Promise.resolve(fn()).catch((err) => {
        ctx.log.warn(`runtime-learner: ${label} skipped: ${err?.message || err}`);
      }).finally(() => {
        onloadTimer?.mark?.(`${label}_deferred`);
      });
    } catch (err) {
      ctx.log.warn(`runtime-learner: ${label} skipped: ${err?.message || err}`);
    }
  }, 0);
  timer.unref?.();
  return timer;
}

function scheduleCapabilitySnapshot(ctx, capabilitiesFile, onloadTimer = null) {
  return scheduleAfterOnload(ctx, "capability_snapshot", () => {
    const capabilities = snapshotHostCapabilities(ctx);
    writeJson(capabilitiesFile, capabilities);
  }, onloadTimer);
}

// patterns.json retention is intentionally NOT handled here. It used to read
// + rewrite the file on disk, but the in-memory detector re-persists its full
// set on the next flush. Retention is centralised in PatternDetector.pruneMemory().

/* ── Onload phases ──
 *
 * onload() runs these in strict sequence. Each phase reads and extends the
 * shared `rt` (runtime wiring) object and marks its onloadTimer checkpoint;
 * the boundaries follow the pre-existing timer marks, so the phase timing
 * output is unchanged. `rt` starts as { register, timer } and accumulates
 * the fields each phase documents below.
 */

/** Sets rt.paths / rt.logActivity / rt.pruneDataFiles; creates data dirs. */
function initPathsAndDirs(ctx, rt) {
  rt.paths = createRuntimePaths(ctx.dataDir);
  const { logActivity, pruneDataFiles } = createRuntimeLoggers(rt.paths);
  rt.logActivity = logActivity;
  rt.pruneDataFiles = pruneDataFiles;
  runtimeState.logActivity = logActivity;
  ensureDir(rt.paths);
  rt.timer.mark("paths_and_dirs");
}

/** Sets rt.seenIds / rt.persistSeenIds / rt.detector / rt.actionPipelineState / rt.actionBudgetState. */
function initDetectorState(ctx, rt) {
  const seenIds = createSeenIdStore(readJson(rt.paths.USAGE_SEEN_FILE, []), {
    cap: 5000,
    persist: (ids) => writeJson(rt.paths.USAGE_SEEN_FILE, ids),
  });
  rt.seenIds = seenIds;
  rt.persistSeenIds = (force = false) => {
    try { seenIds.flush(force); } catch {}
  };
  runtimeState.persistSeenIds = () => rt.persistSeenIds(true);
  rt.detector = new PatternDetector(rt.config);
  rt.timer.mark("detector_init");

  // P6.D: shared across every post-flush pipeline run this session so
  // back-to-back turns coalesce into a single in-flight auto-action run
  // instead of stacking up concurrent fire-and-forget calls, and so the
  // per-session action budget (maxAutoActionsPerSession) actually
  // accumulates instead of resetting on every flush.
  rt.actionPipelineState = { inFlight: false };
  rt.actionBudgetState = createBudgetState();
}

/** One-time migration: mark legacy preferences as durable knowledge. */
function migrateLegacyPreferences(ctx, rt) {
  try {
    const patterns = readJson(rt.paths.PATTERNS_FILE, []);
    let migrated = 0;
    for (const p of patterns) {
      if (p.type === "preference" && !p.knowledgeTier) {
        p.knowledgeTier = "durable";
        migrated += 1;
      }
    }
    if (migrated > 0) {
      writeJson(rt.paths.PATTERNS_FILE, patterns);
      ctx.log.info(`runtime-learner: migrated ${migrated} preferences to durable tier`);
    }
  } catch {}
}

/** Sets rt.sessions / rt.syncDiskStatus / rt.persistPatterns / rt.flushPersist / rt.noteDiskMtime. */
function initSessionsAndPersistence(ctx, rt) {
  const { PATTERNS_FILE } = rt.paths;
  const detector = rt.detector;

  rt.sessions = new Map();
  runtimeState.sessionStart = new Date().toISOString();
  runtimeState.sessionActivityCount = 0;

  // Sync disk status into in-memory detector (control.js may approve/reject)
  // Called once per flush cycle instead of on every persist.
  // Uses mtime cache: only re-reads patterns.json when it was modified by control.js.
  let _patternsMtime = 0;
  // For the restore phase: record the just-read file's mtime as "already seen".
  rt.noteDiskMtime = () => {
    try { _patternsMtime = fs.statSync(PATTERNS_FILE).mtimeMs; } catch {}
  };
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
      const merged = new Map(detector.patterns);
      let added = 0;
      for (const p of disk) {
        if (!p.id) continue;
        const stored = merged.get(p.id);
        if (!stored) {
          merged.set(p.id, { ...p });
          added += 1;
          continue;
        }
        if (absorbDiskPatternState(stored, p)) detector.invalidate();
      }
      if (added > 0) {
        // restore() is built for loading a trusted clean snapshot at onload and
        // marks the store clean as a side effect. Here `merged` is disk ∪
        // in-memory (a superset of what's actually on disk), so anything the
        // runtime learned this session but hadn't flushed yet would otherwise
        // be silently dropped on the next persist — re-dirty after restoring.
        detector.restore([...merged.values()]);
        detector.invalidate();
        ctx.log.info(`runtime-learner: absorbed ${added} disk pattern(s)`);
      }
    } catch {}
  };

  const persistPatternsNow = () => {
    syncDiskStatus();
    let currentMtime = 0;
    try { currentMtime = fs.statSync(PATTERNS_FILE).mtimeMs; } catch {}
    if (!detector.isDirty?.() && currentMtime === _patternsMtime) return false;
    const changed = writeJson(PATTERNS_FILE, [...detector.patterns.values()].map(p => ({ ...p })));
    try { _patternsMtime = fs.statSync(PATTERNS_FILE).mtimeMs; } catch {}
    detector.markClean?.();
    return changed;
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

  rt.syncDiskStatus = syncDiskStatus;
  rt.persistPatterns = persistPatterns;
  rt.flushPersist = flushPersist;
}

/** Sets rt.advisorRunner / rt.extractionRunner. */
function createModelRunners(ctx, rt) {
  rt.advisorRunner = createAdvisorRunner({
    getConfig: () => rt.config,
    detector: rt.detector,
    refreshSkill: rt.refreshSkill,
    logActivity: rt.logActivity,
    runtimeState,
    ctx,
    notifyProposalReview: rt.notifyProposalReview,
    notifyWorkStatus: rt.notifyWorkStatus,
    dataDir: rt.paths.DATA_DIR,
    usageSummaryFile: path.join(rt.paths.DATA_DIR, "usage_summary.json"),
    capabilitiesFile: rt.paths.CAPABILITIES_FILE,
  });

  // v5.0 M2: LLM pattern extraction runner. Gated by llmExtractionEnabled
  // (default false → no-op). Synchronously enqueues candidates then fires an
  // async background tick; output is review-only pattern_candidate proposals.
  rt.extractionRunner = createExtractionRunner({
    getConfig: () => rt.config,
    dataDir: rt.paths.DATA_DIR,
    ctx,
  });
}

/** Restores the detector's pattern store from patterns.json. */
function restorePatternsFromDisk(ctx, rt) {
  try {
    if (fs.existsSync(rt.paths.PATTERNS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(rt.paths.PATTERNS_FILE, "utf-8"));
      rt.detector.restore(saved);
      rt.noteDiskMtime();
      ctx.log.info(`runtime-learner: restored ${saved.length} patterns`);
    }
  } catch (err) {
    ctx.log.warn(`runtime-learner: load failed: ${err.message}`);
  }
  rt.timer.mark("patterns_restore");
}

/** Sets rt.autoApprovePatterns. */
function createAutoApprove(ctx, rt) {
  rt.autoApprovePatterns = (sessionHandle = null, cachedAll = null) => {
    if (!rt.config.autoApproveHighConfidence) return { count: 0, allPatterns: cachedAll || rt.detector.all() };
    const allPatterns = cachedAll || rt.detector.all();
    let count = 0;
    for (const p of allPatterns) {
      if (p.status === "pending" && p.injectable && p.type !== "preference") {
        const stored = rt.detector.patterns.get(p.id);
        if (stored && stored.status === "pending") {
          stored.status = "approved";
          stored.autoApproved = true;
          stored.reviewedAt = new Date().toISOString();
          count += 1;
        }
      }
    }
    if (count > 0) {
      const sessionTarget = normalizeSessionTarget(rt.resolveSessionTarget(sessionHandle));
      rt.logActivity({
        type: "auto_approved",
        summary: `Auto-approved ${count} high-confidence pattern(s)`,
        sessionId: sessionTarget.sessionId,
        sessionRef: sessionTarget.sessionRef,
        sessionPath: sessionTarget.sessionPath,
      });
      ctx.log.info(`runtime-learner: auto-approved ${count} pattern(s)`);
      rt.detector.invalidate();
      return { count, allPatterns: rt.detector.all() };
    }
    return { count, allPatterns };
  };
}

/** Sets rt.useScheduledBackground after trying to register host task:* schedules. */
async function setupBackground(ctx, rt) {
  let backgroundTasks = { ok: false, useLegacyPath: true };
  const currentPatterns = () => {
    try { return rt.detector.all(); } catch { return []; }
  };
  try {
    backgroundTasks = await setupBackgroundTasks({
      ctx,
      dataDir: rt.paths.DATA_DIR,
      config: rt.config,
      registerDispose: typeof rt.register === "function" ? rt.register : null,
      runAdvisor: async () => rt.advisorRunner.maybeRun("scheduled", null, currentPatterns()),
      runRetention: async () => {
        rt.syncDiskStatus();
        rt.detector.pruneMemory();
        const allPatterns = currentPatterns();
        rt.flushPersist();
        await rt.pruneDataFiles();
        rt.refreshSkill(false, null, allPatterns);
        return { ok: true, patterns: allPatterns.length };
      },
      runLlmExtraction: async () => rt.extractionRunner.maybeRun("scheduled", null, currentPatterns()),
    });
  } catch (err) {
    ctx.log.debug?.(`runtime-learner: background task setup skipped: ${err?.message || err}`);
    backgroundTasks = { ok: false, useLegacyPath: true };
  }
  rt.useScheduledBackground = backgroundTasks.ok && backgroundTasks.useLegacyPath === false;
  rt.timer.mark("background_setup");
}

/** Sets rt.recordUsage — the llm_usage ingestion + post-flush pipeline entry. */
function createRecordUsage(ctx, rt) {
  rt.recordUsage = (entry, sessionHandle = null) => {
    if (!rt.config.learnFromUsage) return;
    const session = normalizeSessionTarget(sessionHandle, entry?.attribution, entry?.source?.actor, entry?.session);
    const summaryEntry = summarizeUsageEntry(entry, session);
    const dedupKey = usageDedupKey(entry, summaryEntry);
    if (dedupKey && !rt.seenIds.add(dedupKey)) return;
    try {
      updateUsageSummary(summaryEntry, path.join(rt.paths.DATA_DIR, "usage_summary.json"));
      rt.persistSeenIds();
      const usageChanges = rt.detector.ingestUsage?.(summaryEntry) || [];
      for (const change of usageChanges) {
        if (!change.isNew) continue;
        rt.logActivity({
          type: "usage_pattern_discovered",
          summary: `New usage pattern: ${change.pattern.desc}`,
          sessionId: session.sessionId,
          sessionRef: session.sessionRef,
          sessionPath: session.sessionPath,
        });
        runtimeState.sessionActivityCount += 1;
      }
      runPostFlushPipeline({
        detector: rt.detector,
        autoApprovePatterns: rt.autoApprovePatterns,
        persistPatterns: rt.persistPatterns,
        refreshSkill: rt.refreshSkill,
        maybeRunModelAdvisor: rt.useScheduledBackground ? noopBackground : rt.advisorRunner.maybeRun,
        maybeRunExtraction: rt.useScheduledBackground ? noopBackground : rt.extractionRunner.maybeRun,
        reason: "usage",
        // Use the identity key (sid:/sref:/path) so resolveSessionTarget hits
        // the sessionTargets map the observer populated under the same key and
        // round-trips the full target. Passing the raw sessionPath misses the
        // map whenever sessionId/sessionRef exist and silently drops them.
        sessionHandle: sessionIdentityKey(session),
        ctx,
        learnerDir: rt.paths.DATA_DIR,
        config: rt.config,
        skipPrune: rt.useScheduledBackground,
        actionPipelineState: rt.actionPipelineState,
        budgetState: rt.actionBudgetState,
      });
    } catch (err) {
      ctx.log.warn(`runtime-learner: usage record skipped: ${err.message}`);
    }
  };
}

/** Replays recent usage entries from the host since the last bootstrap cursor. */
async function bootstrapUsage(ctx, rt) {
  try {
    const usageCapability = ctx.bus.getCapability?.("usage:list");
    if (rt.config.learnFromUsage && (usageCapability?.available || ctx.bus.hasHandler?.("usage:list"))) {
      const usageBootstrapFile = usageBootstrapStatePath(rt.paths.DATA_DIR);
      const since = usageBootstrapSince(usageBootstrapFile);
      const result = await ctx.bus.request("usage:list", { since, limit: 50 });
      const entries = result?.entries || [];
      for (const entry of entries) rt.recordUsage(entry, entry.attribution || entry.source?.actor || entry.session || null);
      recordUsageBootstrap(usageBootstrapFile, entries, { requestedSince: since });
      rt.persistSeenIds(true); // flush now so a hard kill won't re-count on next start
      ctx.log.info(`runtime-learner: bootstrapped ${entries.length} usage records since ${since}`);
    }
  } catch (err) {
    ctx.log.warn(`runtime-learner: usage bootstrap skipped: ${err.message}`);
  }
  rt.timer.mark("usage_bootstrap");
}

/** Sets rt.configRef / rt.observer and subscribes to the host EventBus. */
function subscribeObserver(ctx, rt) {
  rt.configRef = { current: rt.config };

  rt.observer = createObserver({
    detector: rt.detector,
    sessions: rt.sessions,
    runtimeState,
    persistPatterns: rt.persistPatterns,
    refreshSkill: rt.refreshSkill,
    autoApprovePatterns: rt.autoApprovePatterns,
    syncDiskStatus: rt.syncDiskStatus,
    pruneDataFiles: rt.useScheduledBackground ? noopBackground : rt.pruneDataFiles,
    maybeRunModelAdvisor: rt.useScheduledBackground ? noopBackground : rt.advisorRunner.maybeRun,
    maybeRunExtraction: rt.useScheduledBackground ? noopBackground : rt.extractionRunner.maybeRun,

    logActivity: rt.logActivity,
    recordUsage: rt.recordUsage,
    configRef: rt.configRef,
    ctx,
    paths: {
      DATA_DIR: rt.paths.DATA_DIR,
      TURNS_FILE: rt.paths.TURNS_FILE,
      EPISODES_FILE: rt.paths.EPISODES_FILE,
      EXPERIENCE_LOG: rt.paths.EXPERIENCE_LOG,
      ERROR_LOG: rt.paths.ERROR_LOG,
      CONFIG_FILE: rt.paths.CONFIG_FILE,
    },
    MAX_SESSIONS,
    skipPrune: rt.useScheduledBackground,
    actionPipelineState: rt.actionPipelineState,
    actionBudgetState: rt.actionBudgetState,
  });

  rt.observer.subscribe(ctx.bus, rt.config);
  rt.timer.mark("observer_subscribe");
}

/** Startup notifications + first sync/approve/persist/skill-refresh pass. */
function runInitialRefresh(ctx, rt) {
  // Config fallback notification: let the user know when their config was
  // corrupt or missing and the plugin reverted to defaults.
  if (rt.configSource !== "file") {
    const reason = rt.configSource === "corrupt"
      ? "config.json was corrupt (JSON syntax error) — renamed to .corrupt.bak and reverted to defaults"
      : "config.json was missing — wrote DEFAULT_CONFIG";
    rt.logActivity({
      type: "config_fallback",
      summary: reason,
    });
    ctx.log.warn(`runtime-learner: ${reason}`);
  }

  // Session startup activity entry
  rt.logActivity({
    type: "session_start",
    summary: `Self-learning runtime started with ${rt.detector.all().length} existing patterns`,
  });

  try {
    rt.syncDiskStatus();
    const { allPatterns } = rt.autoApprovePatterns();
    rt.flushPersist();
    if (!rt.useScheduledBackground) rt.pruneDataFiles().catch(() => {});
    rt.refreshSkill(true, null, allPatterns);
    if (!rt.useScheduledBackground) {
      scheduleAfterOnload(ctx, "startup_advisor", () => rt.advisorRunner.maybeRun("startup", null, allPatterns), rt.timer);
      scheduleAfterOnload(ctx, "startup_extraction", () => rt.extractionRunner.maybeRun("startup", null, allPatterns), rt.timer);
    }
  } catch (err) {
    ctx.log.warn(`runtime-learner: initial refresh failed: ${err.message}`);
  }
  rt.timer.mark("initial_refresh");
}

/* ── Plugin lifecycle ── */

export default definePlugin({
  async onload(ctx, { register }) {
    try {
      const rt = { register, timer: createOnloadTimer(ctx) };
      initPathsAndDirs(ctx, rt);
      loadRuntimeConfig(ctx, rt);
      bridgePanelConfig(ctx, rt);
      initDetectorState(ctx, rt);
      migrateLegacyPreferences(ctx, rt);
      initSessionsAndPersistence(ctx, rt);
      createSkillRefresh(ctx, rt, {
        runtimeState,
        minRefreshMs: SKILL_REFRESH_MIN_MS,
        maxSkillHistory: MAX_SKILL_HISTORY,
        codeProposalMinCount: CODE_PROPOSAL_MIN_COUNT,
      });
      createModelRunners(ctx, rt);
      restorePatternsFromDisk(ctx, rt);
      scheduleCapabilitySnapshot(ctx, rt.paths.CAPABILITIES_FILE, rt.timer);
      rt.timer.mark("capability_snapshot_scheduled");
      createAutoApprove(ctx, rt);
      await setupBackground(ctx, rt);
      createRecordUsage(ctx, rt);
      await bootstrapUsage(ctx, rt);
      subscribeObserver(ctx, rt);
      wireLiveConfigAndDisposal(ctx, rt, runtimeState);
      runInitialRefresh(ctx, rt);
      ctx.log.info("runtime-learner: started three-layer self-learning runtime");
      rt.timer.mark("complete");
    } catch (err) {
      try { ctx.log.error(`runtime-learner: onload failed: ${err.message}`); } catch {}
    }
  },

  async onunload(ctx = {}) {
    const logActivity = runtimeState.logActivity || createRuntimeLoggers(createRuntimePaths(ctx.dataDir)).logActivity;
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
    runtimeState.logActivity = null;
  },
});
