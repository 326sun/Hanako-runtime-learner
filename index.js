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
import { DEFAULT_CONFIG, learnerDir, readJson, writeJson, buildSkillMdFromPatterns, cleanupTempFiles, mergeConfig, applyPanelConfig } from "./lib/common.js";
import { definePlugin } from "./lib/hana-runtime-compat.js";
import { runtimeConfigPath, migrateRuntimeConfigFile } from "./lib/runtime-config-path.js";
import { createAdvisorRunner } from "./lib/model-advisor.js";
import { createExtractionRunner } from "./lib/llm-extraction-worker.js";
import { buildSkillPatchProposal } from "./lib/proposals.js";
import { applyProposalSafely } from "./lib/proposal-apply-safe.js";
import { buildRepeatedCodePatchProposals } from "./lib/advisor-insights.js";
import { summarizeUsageEntry, updateUsageSummary, snapshotHostCapabilities } from "./lib/usage-pipeline.js";
import { usageDedupKey, absorbDiskPatternState, normalizeSessionTarget, sessionIdentityKey } from "./lib/helpers.js";
import { PatternDetector } from "./lib/pattern-detector.js";
import { createObserver } from "./lib/observer.js";
import { snapshotSkill, pruneSkillBackups, skipObservedLine } from "./lib/skill-lifecycle.js";
import { isProposalReviewApproved } from "./lib/review-queue.js";
import { runPostFlushPipeline } from "./lib/pipeline.js";
import { mergeCredentials, detectPlaintextCredentials, saveCredentials, loadCredentials, panelCredentialsToStore } from "./lib/credentials.js";
import { createActivityLogger } from "./lib/activity-log.js";
import { createJsonlRetentionPruner } from "./lib/log-retention.js";
import { createSessionMessenger } from "./lib/session-messenger.js";
import { createSeenIdStore } from "./lib/seen-id-store.js";

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
    CONFIG_FILE: runtimeConfigPath(DATA_DIR),
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


/**
 * Load config from disk, merging with defaults. Returns { config, source }:
 *   - source="file": normal load from config.json
 *   - source="corrupt": config.json had a JSON syntax error, renamed to .corrupt.bak
 *   - source="default": no config file existed, wrote DEFAULT_CONFIG
 * The caller should notify the user when source !== "file".
 */
function loadConfig(paths) {
  try {
    if (fs.existsSync(paths.CONFIG_FILE)) {
      const raw = fs.readFileSync(paths.CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return { config: mergeConfig(parsed), source: "file" };
    }
  } catch (e) {
    // Only move the file aside on JSON parse errors — a disk I/O error
    // (EACCES, EIO, etc.) should not rename and overwrite valid user config.
    if (e instanceof SyntaxError) {
      try { fs.renameSync(paths.CONFIG_FILE, `${paths.CONFIG_FILE}.corrupt.${Date.now()}.bak`); } catch {}
      // Fall through to write DEFAULT_CONFIG and signal the caller.
      try { writeJson(paths.CONFIG_FILE, DEFAULT_CONFIG); } catch {}
      return { config: mergeConfig(), source: "corrupt" };
    }
  }
  try { writeJson(paths.CONFIG_FILE, DEFAULT_CONFIG); } catch {}
  return { config: mergeConfig(), source: "default" };
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

// patterns.json retention is intentionally NOT handled here. It used to read
// + rewrite the file on disk, but the in-memory detector re-persists its full
// set on the next flush. Retention is centralised in PatternDetector.pruneMemory().

/* ── Plugin lifecycle ── */

export default definePlugin({
  async onload(ctx, { register }) {
    try {
    const paths = createRuntimePaths(ctx.dataDir);
    const {
      DATA_DIR,
      EXPERIENCE_LOG,
      ERROR_LOG,
      USAGE_SEEN_FILE,
      CAPABILITIES_FILE,
      PATTERNS_FILE,
      TURNS_FILE,
      EPISODES_FILE,
      CONFIG_FILE,
      HISTORY_DIR,
    } = paths;
    const { logActivity, pruneDataFiles } = createRuntimeLoggers(paths);
    runtimeState.logActivity = logActivity;
    ensureDir(paths);

    // v0.341+: the host owns <dataDir>/config.json for its plugin config store.
    // Move our legacy flat config.json (from older hosts) to runtime-config.json
    // exactly once so the two writers never clobber each other. Host-shaped
    // config.json is left untouched. See lib/runtime-config-path.js.
    try {
      const migration = migrateRuntimeConfigFile(DATA_DIR);
      if (migration.migrated) {
        ctx.log.info(`runtime-learner: migrated legacy config.json to runtime-config.json (${migration.reason})`);
      }
    } catch { /* migration is best-effort; loadConfig falls back to defaults */ }

    let { config, source: configSource } = loadConfig(paths);

    // Bridge the Hanako settings panel into the runtime config. v0.341+: ctx.config
    // is a method-based store (getAll/setMany); applyPanelConfig handles both old
    // and new API transparently. The panel is authoritative for the settings it
    // exposes — see applyPanelConfig.
    const preBridge = JSON.stringify(config);
    config = applyPanelConfig(config, ctx.config);
    let configNeedsPersist = JSON.stringify(config) !== preBridge;

    // Capture any API key the user typed into a settings-panel credential field.
    // applyPanelConfig deliberately drops credential keys (they must never live
    // in config.json plaintext), so route real panel-entered credentials into
    // the encrypted store here — mergeCredentials() below then picks them up.
    // Merge with the existing store so keys set via set_config aren't clobbered.
    try {
      const panelCreds = panelCredentialsToStore(ctx.config);
      if (Object.keys(panelCreds).length > 0) {
        saveCredentials({ ...loadCredentials(), ...panelCreds });
        ctx.log.info(`runtime-learner: captured ${Object.keys(panelCreds).length} settings-panel credential(s) into the encrypted store`);
      }
    } catch {}

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
        for (const key of plaintextKeys) config[key] = "(stored in credentials.enc)";
        configNeedsPersist = true;
        ctx.log.info(`runtime-learner: migrated ${plaintextKeys.length} plaintext credential(s) to encrypted store`);
      }
    } catch {}

    // Persist the bridged (and credential-sanitised) config so config.json on
    // disk mirrors the panel for the runtime and the control tools alike. At
    // this point config holds only credential placeholders, never plaintext.
    if (configNeedsPersist) { try { writeJson(CONFIG_FILE, config); } catch {} }

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
          detector.restore([...merged.values()]);
          ctx.log.info(`runtime-learner: absorbed ${added} disk pattern(s)`);
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
    const resolveSessionTarget = (sessionHandle) => runtimeState.sessionTargets.get(sessionHandle) || sessionHandle;
    const notifyProposalReview = (sessionHandle, proposals = [], options = {}) => (
      messenger.notifyProposalReview(resolveSessionTarget(sessionHandle), proposals, config, { ...options, sessionKey: sessionHandle })
    );
    const notifyWorkStatus = (sessionHandle, detail = "") => (
      messenger.notifyWorkStatus(resolveSessionTarget(sessionHandle), config, detail, { sessionKey: sessionHandle })
    );

    const refreshSkill = (force = false, sessionHandle = null, cachedAll = null) => {
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
            applyProposalSafely(DATA_DIR, proposal.id, {
              configPath: CONFIG_FILE,
              requireReview: !!config.requireReviewForAutoApply,
              allowedSkillRoots: [ctx.pluginDir],
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
          const sessionTarget = normalizeSessionTarget(resolveSessionTarget(sessionHandle));
          logActivity({
            type: "proposal_created",
            summary: `Created ${created} high-risk code improvement proposal(s) for review`,
            sessionId: sessionTarget.sessionId,
            sessionRef: sessionTarget.sessionRef,
            sessionPath: sessionTarget.sessionPath,
          });
        }
        void notifyProposalReview(sessionHandle, proposals);
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

    // v5.0 M2: LLM pattern extraction runner. Gated by llmExtractionEnabled
    // (default false → no-op). Synchronously enqueues candidates then fires an
    // async background tick; output is review-only pattern_candidate proposals.
    const extractionRunner = createExtractionRunner({
      getConfig: () => config,
      dataDir: DATA_DIR,
      ctx,
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
    const autoApprovePatterns = (sessionHandle = null, cachedAll = null) => {
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
        const sessionTarget = normalizeSessionTarget(resolveSessionTarget(sessionHandle));
        logActivity({
          type: "auto_approved",
          summary: `Auto-approved ${count} high-confidence pattern(s)`,
          sessionId: sessionTarget.sessionId,
          sessionRef: sessionTarget.sessionRef,
          sessionPath: sessionTarget.sessionPath,
        });
        ctx.log.info(`runtime-learner: auto-approved ${count} pattern(s)`);
        detector.invalidate();
        return { count, allPatterns: detector.all() };
      }
      return { count, allPatterns };
    };

    const recordUsage = (entry, sessionHandle = null) => {
      if (!config.learnFromUsage) return;
      const session = normalizeSessionTarget(sessionHandle, entry?.attribution, entry?.source?.actor, entry?.session);
      const summaryEntry = summarizeUsageEntry(entry, session);
      const dedupKey = usageDedupKey(entry, summaryEntry);
      if (dedupKey && !seenIds.add(dedupKey)) return;
      try {
        updateUsageSummary(summaryEntry, path.join(DATA_DIR, "usage_summary.json"));
        persistSeenIds();
        const usageChanges = detector.ingestUsage?.(summaryEntry) || [];
        for (const change of usageChanges) {
          if (!change.isNew) continue;
          logActivity({
            type: "usage_pattern_discovered",
            summary: `New usage pattern: ${change.pattern.desc}`,
            sessionId: session.sessionId,
            sessionRef: session.sessionRef,
            sessionPath: session.sessionPath,
          });
          runtimeState.sessionActivityCount += 1;
        }
        runPostFlushPipeline({
          detector,
          autoApprovePatterns,
          persistPatterns,
          refreshSkill,
          maybeRunModelAdvisor: advisorRunner.maybeRun,
          maybeRunExtraction: extractionRunner.maybeRun,
          reason: "usage",
          // Use the identity key (sid:/sref:/path) so resolveSessionTarget hits
          // the sessionTargets map the observer populated under the same key and
          // round-trips the full target. Passing the raw sessionPath misses the
          // map whenever sessionId/sessionRef exist and silently drops them.
          sessionHandle: sessionIdentityKey(session),
          ctx,
          learnerDir: DATA_DIR,
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
        for (const entry of result?.entries || []) recordUsage(entry, entry.attribution || entry.source?.actor || entry.session || null);
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
      maybeRunExtraction: extractionRunner.maybeRun,

      logActivity,
      recordUsage,
      configRef,
      ctx,
      paths: { DATA_DIR, TURNS_FILE, EPISODES_FILE, EXPERIENCE_LOG, ERROR_LOG, CONFIG_FILE },
      MAX_SESSIONS,
    });

    observer.subscribe(ctx.bus, config);

    runtimeState.detector = detector;
    runtimeState.sessions = sessions;
    runtimeState.unsub = () => observer.unsubscribe();
    runtimeState.persistPatterns = flushPersist;
    runtimeState.refreshSkill = refreshSkill;

    // Register disposable cleanup via the host's register() callback (v0.341+).
    if (typeof register === "function") {
      register(() => { try { observer.unsubscribe(); } catch {} });
      register(() => { try { persistSeenIds(true); } catch {} });
      register(() => { try { flushPersist(); } catch {} });
    }

    // Config fallback notification: let the user know when their config was
    // corrupt or missing and the plugin reverted to defaults.
    if (configSource !== "file") {
      const reason = configSource === "corrupt"
        ? "config.json was corrupt (JSON syntax error) — renamed to .corrupt.bak and reverted to defaults"
        : "config.json was missing — wrote DEFAULT_CONFIG";
      logActivity({
        type: "config_fallback",
        summary: reason,
      });
      ctx.log.warn(`runtime-learner: ${reason}`);
    }

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
