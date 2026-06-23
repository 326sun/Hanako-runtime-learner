import { normalizeToolName, preferencePatternId } from "./helpers.js";

export function createToolEndHandlers({ detector, runtimeState, persistPatterns, refreshSkill, ctx }) {
  const toolEndHandlers = new Map();

  toolEndHandlers.set("pin_memory", (event, sessionHandle) => {
    try {
      const args = event.args || event.input || {};
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (content && content.length < 500) {
        const pid = preferencePatternId(content);
        const now = new Date().toISOString();
        const existing = detector.patterns.get(pid);
        if (existing) {
          existing.count = (existing.count || 1) + 1;
          existing.score = (existing.score || 0) + 2;
          existing.lastSeen = now;
        } else {
          detector.patterns.set(pid, {
            id: pid,
            type: "preference",
            knowledgeTier: "durable",
            status: "approved",
            desc: content,
            fix: content,
            count: 1,
            score: 5,
            firstSeen: now,
            lastSeen: now,
            context: { taskType: "general", categories: ["记忆操作"] },
          });
        }
        detector.invalidate();
        persistPatterns();
        refreshSkill(false, sessionHandle);
        ctx.log.info("runtime-learner: ingested pin_memory as durable preference");
      }
    } catch (err) {
      ctx.log.warn(`runtime-learner: pin_memory ingestion skipped: ${err.message}`);
    }
  });

  toolEndHandlers.set("self_learning_search", (event, sessionHandle) => {
    try {
      const raw = event.result;
      if (raw == null) return;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      const results = Array.isArray(parsed?.results) ? parsed.results : [];
      const ids = results.map(r => r.id).filter(Boolean);

      if (ids.length > 0) {
        let touched = 0;
        for (const id of ids) {
          const stored = detector.patterns.get(id);
          if (stored) {
            stored.lastSearchedAt = new Date().toISOString();
            touched += 1;
          }
        }
        if (touched > 0) {
          persistPatterns();
          ctx.log.info(`runtime-learner: search exposed ${touched} pattern(s)`);
        }
      }

      const wfResults = results.filter(r => r.type === "workflow" && r.id);
      if (wfResults.length > 0 && sessionHandle) {
        const searches = wfResults.map(r => {
          const stored = detector.patterns.get(r.id);
          return { patternId: r.id, tools: stored?.tools || [] };
        }).filter(s => s.tools.length > 0);
        if (searches.length > 0) {
          runtimeState.pendingAdoptionChecks.set(sessionHandle, { searches, remaining: 3 });
        }
      }
    } catch (err) {
      ctx.log.warn(`runtime-learner: feedback loop skipped: ${err.message}`);
    }
  });

  return {
    toolEndHandlers,
    handleToolEnd(event, sessionHandle) {
      const handler = toolEndHandlers.get(normalizeToolName(event.toolName || event.name));
      if (handler) handler(event, sessionHandle);
    },
  };
}
