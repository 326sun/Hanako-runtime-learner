export function processAdoptionCheck({ sessionHandle, runtimeState, detector, tools, persistPatterns, refreshSkill, ctx }) {
  const pending = runtimeState.pendingAdoptionChecks.get(sessionHandle);
  if (!pending) return;

  pending.remaining -= 1;
  pending.adoptedIds = pending.adoptedIds || new Set();
  let adopted = 0;
  for (const search of pending.searches) {
    if (search.tools.length === 0) continue;
    const matchCount = search.tools.filter((tool) => tools.includes(tool)).length;
    if (matchCount >= Math.ceil(search.tools.length * 0.5)) {
      const stored = detector.patterns.get(search.patternId);
      if (stored && !pending.adoptedIds.has(search.patternId)) {
        stored.bonus = (stored.bonus || 0) + 3;
        stored.score = (stored.score || 0) + 3;
        stored.lastAdoptedAt = new Date().toISOString();
        pending.adoptedIds.add(search.patternId);
        adopted += 1;
        ctx.log.info(`runtime-learner: adopted workflow ${search.patternId}, score +3`);
      }
    }
  }
  if (adopted > 0) {
    detector.invalidate();
    persistPatterns();
    refreshSkill(true, sessionHandle);
  }
  if (pending.remaining <= 0) {
    let degraded = 0;
    for (const search of pending.searches) {
      if (!search.patternId || pending.adoptedIds.has(search.patternId)) continue;
      const stored = detector.patterns.get(search.patternId);
      if (stored && (stored.score || 0) > 1) {
        stored.bonus = Math.max(0, (stored.bonus || 0) - 1);
        stored.score = Math.max(1, (stored.score || 0) - 1);
        degraded += 1;
      }
    }
    if (degraded > 0) {
      detector.invalidate();
      persistPatterns();
      refreshSkill(true, sessionHandle);
      ctx.log.info(`runtime-learner: adoption window closed, degraded ${degraded} unadopted workflow(s)`);
    }
    runtimeState.pendingAdoptionChecks.delete(sessionHandle);
  }
}
