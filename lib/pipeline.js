/**
 * pipeline — shared post-flush processing used by observer.js and index.js.
 * Eliminates the duplicated prune→persist→refresh→advisor sequence.
 */

/**
 * Run the standard post-flush pipeline: auto-approve → prune → persist →
 * skill refresh → model advisor. Optional hooks allow the two call sites
 * (observer flushTurn and index.js recordUsage) to insert their own
 * pre/post steps.
 *
 * @param {object} opts
 * @param {import("./pattern-detector.js").PatternDetector} opts.detector
 * @param {(sessionPath?: string, cachedAll?: any[]) => { count: number, allPatterns: any[] }} opts.autoApprovePatterns
 * @param {() => void} opts.persistPatterns
 * @param {(force?: boolean, sessionPath?: string, cachedAll?: any[]) => void} opts.refreshSkill
 * @param {(reason: string, sessionPath?: string, allPatterns?: any[]) => Promise<void>} opts.maybeRunModelAdvisor
 * @param {string} opts.reason — "turn" / "usage" / "startup"
 * @param {string} [opts.sessionPath]
 * @param {Array<() => void>} [opts.before] — hooks to run before the main pipeline
 * @param {Array<() => void>} [opts.after]  — hooks to run after (fire-and-forget)
 * @param {object} [opts.ctx] — plugin context for logging
 */
export function runPostFlushPipeline({
  detector,
  autoApprovePatterns,
  persistPatterns,
  refreshSkill,
  maybeRunModelAdvisor,
  reason,
  sessionPath = null,
  before = [],
  after = [],
  ctx = null,
}) {
  try {
    for (const hook of before) hook();
  } catch (err) {
    ctx?.log?.warn?.(`runtime-learner: pipeline before-hook failed: ${err.message}`);
  }

  try {
    autoApprovePatterns(sessionPath);
    detector.pruneMemory();
    const allPatterns = detector.all();
    persistPatterns();
    refreshSkill(false, sessionPath, allPatterns);
    maybeRunModelAdvisor(reason, sessionPath, allPatterns).catch(() => {});
  } catch (err) {
    ctx?.log?.warn?.(`runtime-learner: pipeline failed: ${err.message}`);
  }

  for (const hook of after) {
    try { hook(); } catch {}
  }
}
