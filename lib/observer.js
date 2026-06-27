/**
 * SessionObserver — event subscription and turn lifecycle for Runtime Self-Learning.
 * Extracted from index.js to reduce plugin entry size and enable independent testing.
 *
 * Responsibilities:
 *   - Event bus subscription (session/message/tool/error events)
 *   - SessionTurn lifecycle (getTurn, flushTurn)
 *   - Tool-end semantic handlers (pin_memory → preference, self_learning_search → adoption)
 *   - Experience/error/turn JSONL logging
 *
 * Post-flush processing (auto-approve, sync, persist, skill refresh, model advisor) is
 * delegated to the onTurnComplete callback provided by the plugin entry.
 */

import path from "path";
import fs from "fs";
import { SessionTurn } from "./session-turn.js";
import {
  normalizeToolName,
  safeText,
  classifyTask,
  classifyError,
  extractCorrectionFromUserText,
  normalizeSessionTarget,
  sessionIdentityKey,
} from "./helpers.js";
import { appendJsonlBatch } from "./activity-log.js";
import { readJson } from "./common.js";
import { inferScope } from "./scope.js";
import { runPostFlushPipeline } from "./pipeline.js";
import { processAdoptionCheck } from "./observer-adoption.js";
import { createToolEndHandlers } from "./observer-tool-handlers.js";
import { uniqueSortedToolCategories } from "./pattern-detector-utils.js";

// ── Inlined from observer-utils.js ──

const SUCCESS_STOP_REASONS = new Set(["stop", "end_turn"]);

const HANDLED_EVENT_TYPES = new Set([
  "session_user_message",
  "user_message",
  "message_start",
  "message_update",
  "tool_execution_start",
  "tool_execution_end",
  "message_end",
  "assistantMessageEvent",
]);

function resultStatus(turn, stopReason) {
  if (turn.errors.length > 0) return "partial";
  if (stopReason && !SUCCESS_STOP_REASONS.has(stopReason)) return "partial";
  return "success";
}

function extractToolError(event) {
  const raw = event?.error || event?.result?.error || event?.result?.message || event?.message;
  const msg = typeof raw === "string" ? raw : raw?.message || "";
  const tool = normalizeToolName(event?.toolName || event?.name) || "tool";
  return msg ? `${tool}: ${safeText(msg)}` : `${tool}: failed`;
}

function messageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return safeText(message.content, 1000);
  if (typeof message.text === "string") return safeText(message.text, 1000);
  if (Array.isArray(message.content)) {
    return safeText(message.content.map((part) => part?.text || part?.content || "").join(" "), 1000);
  }
  return "";
}

function extractAssistantText(event) {
  return messageText(event?.message);
}

/**
 * @param {object} deps
 * @param {import("./pattern-detector.js").PatternDetector} deps.detector
 * @param {Map<string, SessionTurn>} deps.sessions
 * @param {object} deps.runtimeState — mutable state shared with plugin entry
 * @param {() => void} deps.persistPatterns
 * @param {(force?: boolean, sessionHandle?: string|object, cachedAll?: any[]) => void} deps.refreshSkill
 * @param {(sessionHandle?: string|object, cachedAll?: any[]) => { count: number, allPatterns: any[] }} deps.autoApprovePatterns
 * @param {() => void} deps.syncDiskStatus
 * @param {() => Promise<void>} deps.pruneDataFiles
 * @param {(reason: string, sessionHandle?: string|object, allPatterns?: any[]) => Promise<void>} deps.maybeRunModelAdvisor
 * @param {boolean} [deps.skipPrune]
 * @param {(event: object) => void} deps.logActivity
 * @param {(entry: object, sessionHandle?: string|object) => void} deps.recordUsage
 * @param {{ current: object }} deps.configRef — mutable config reference
 * @param {object} deps.ctx — plugin context for logging
 * @param {object} deps.paths — { DATA_DIR, TURNS_FILE, EXPERIENCE_LOG, ERROR_LOG, CONFIG_FILE }
 * @param {number} deps.MAX_SESSIONS
 */
export function createObserver(deps) {
  const {
    detector,
    sessions,
    runtimeState,
    persistPatterns,
    refreshSkill,
    autoApprovePatterns,
    syncDiskStatus,
    pruneDataFiles,
    maybeRunModelAdvisor,
    maybeRunExtraction,
    skipPrune = false,
    logActivity,
    recordUsage,
    configRef,
    ctx,
    paths,
    MAX_SESSIONS,
  } = deps;

  // ── Config reload with mtime cache: skip disk read when unchanged ──
  let _configMtime = 0;

  function reloadConfigIfStale() {
    try {
      const mtime = fs.statSync(paths.CONFIG_FILE).mtimeMs;
      if (mtime !== _configMtime) {
        _configMtime = mtime;
        configRef.current = { ...configRef.current, ...readJson(paths.CONFIG_FILE, {}) };
        detector.setConfig(configRef.current);
      }
    } catch {
      // File missing or unreadable — skip, keep current config
    }
  }

  // ── Turn lifecycle ──

  function getTurn(sessionTarget) {
    const target = normalizeSessionTarget(sessionTarget);
    const key = sessionIdentityKey(target);
    let turn = sessions.get(key);
    if (!turn) {
      turn = new SessionTurn(key, target);
      sessions.set(key, turn);
    } else {
      turn.setSessionTarget(target);
    }
    // Evict oldest by lastTouched if over capacity. Linear scan over ≤MAX_SESSIONS
    // entries is O(1) in practice and avoids the old O(n log n) sort.
    while (sessions.size > MAX_SESSIONS) {
      let oldestKey = null;
      let oldestTs = Infinity;
      for (const [k, v] of sessions) {
        if (v.lastTouched < oldestTs) { oldestTs = v.lastTouched; oldestKey = k; }
      }
      if (oldestKey) sessions.delete(oldestKey);
      else break;
    }
    return turn;
  }

  function flushTurn(sessionHandle, event = {}) {
    const key = sessionHandle || "unknown";
    const turn = sessions.get(key);
    if (!turn) return;
    const sessionPath = turn.sessionPath || null;
    const sessionId = turn.sessionTarget?.sessionId || null;
    const sessionRef = turn.sessionTarget?.sessionRef || null;

    const stopReason = event?.message?.stopReason ?? turn.stopReason ?? null;
    const finalError = safeText(event?.message?.errorMessage || event?.message?.error?.message || event?.error);
    if (finalError) turn.addError(finalError);
    turn.assistantText = extractAssistantText(event) || turn.assistantText;
    turn.stopReason = stopReason;

    if (turn.tools.length === 0 && turn.errors.length === 0 && !turn.assistantText) {
      sessions.delete(key);
      return;
    }

    // Concatenate all user messages before correction detection so that
    // cross-message weak signals (e.g. "改成这样" in msg 1 + "下次记住" in msg 2)
    // are scored together rather than independently. Truncate to 2000 chars to
    // bound memory for long-running sessions.
    const allUserText = turn.userTexts.slice(-8).join(" ").slice(0, 2000);
    const correction = extractCorrectionFromUserText(allUserText) || "";
    const tools = [...turn.tools];
    const date = new Date().toISOString();
    const taskId = `${path.basename(key)}:${Date.now()}`;
    const taskType = classifyTask(tools);
    // Infer the activity scope (project / taskType) so learned patterns are
    // bounded to where they apply. project is derived from the session/workspace
    // path; it falls back to "general" (unscoped) when no project is discernible.
    const scope = inferScope({ sessionPath, userText: allUserText, taskType });
    const exp = {
      date,
      taskId,
      sessionId,
      sessionRef,
      sessionPath,
      taskType,
      project: scope.project,
      scope,
      userIntent: turn.userTexts.at(-1) || "",
      taskSummary: tools.length ? `tools: ${tools.join(" -> ")}` : "assistant turn without tool use",
      toolsUsed: tools,
      toolCallCount: turn.toolCallCount,
      resultStatus: resultStatus(turn, stopReason),
      stopReason,
      userFeedback: correction ? "correction" : "unknown",
      userExplicitCorrection: !!correction,
      errorType: turn.errors.length ? classifyError(turn.errors[0]) : "none",
      failurePoint: turn.errors.length ? turn.errors[0] : "none",
      correction,
      impactLevel: turn.errors.length ? 2 : 1,
      repeatability: tools.length >= 2 ? "medium" : "low",
      oneOff: false,
      skillCandidate: false,
      suggestedSkill: null,
      notes: "",
    };

    // Pre-build error entries (used for both batch write and detector)
    const errorEntries = [];
    for (const errMsg of turn.errors) {
      errorEntries.push({
        date, taskId, sessionId, sessionRef, sessionPath, taskType: exp.taskType, scope,
        errorType: classifyError(errMsg), errorDesc: safeText(errMsg, 200),
        severity: stopReason === "error" ? 4 : 2, tool: tools.at(-1) || null,
      });
    }

    // Write logs — batch all JSONL appends into one call
    try {
      const batch = {};
      batch[paths.TURNS_FILE] = [{ date, sessionId, sessionRef, sessionPath, tools, errors: turn.errors, stopReason, correction }];
      batch[paths.EXPERIENCE_LOG] = [exp];
      if (paths.EPISODES_FILE) {
        batch[paths.EPISODES_FILE] = [{
          id: taskId, date, sessionId, sessionRef, sessionPath, scope, tools, taskType,
          hasCorrection: !!correction, resultStatus: exp.resultStatus, summary: exp.taskSummary,
        }];
      }
      if (errorEntries.length) batch[paths.ERROR_LOG] = errorEntries;
      appendJsonlBatch(batch);
    } catch (err) {
      ctx.log.warn(`runtime-learner: write logs failed: ${err.message}`);
    }

    // Ingest errors from the pre-built entries
    for (const ee of errorEntries) {
      try {
        const { isNew } = detector.ingestError(ee);
        if (isNew) {
          logActivity({
            type: "error_discovered",
            summary: `New error pattern: ${ee.errorType} — ${ee.errorDesc}`,
            sessionId,
            sessionRef,
            sessionPath,
          });
          runtimeState.sessionActivityCount += 1;
        }
      } catch (err) {
        ctx.log.warn(`runtime-learner: ingest error failed: ${err.message}`);
      }
    }

    // Ingest experience
    const newPatterns = detector.ingest(exp);

    // Positive feedback: successful turn without correction → boost workflow
    if (exp.resultStatus === "success" && !correction && tools.length >= 2) {
      const uniqueCats = uniqueSortedToolCategories(tools);
      if (uniqueCats.length >= 2) {
        const wfId = `workflow:${uniqueCats.join("→")}`;
        const wf = detector.patterns.get(wfId);
        if (wf) {
          wf.bonus = (wf.bonus || 0) + 1;
          wf.score = (wf.score || 0) + 1;
          wf.lastSuccessAt = date;
          wf.successCount = (wf.successCount || 0) + 1;
          detector.invalidate();
        }
      }
    }

    for (const np of newPatterns) {
      logActivity({
        type: "pattern_discovered",
        summary: `New ${np.type} pattern: ${np.desc}`,
        sessionId,
        sessionRef,
        sessionPath,
      });
      runtimeState.sessionActivityCount += 1;
      ctx.log.info(`runtime-learner: discovered ${np.type} pattern: ${np.desc}`);
    }

    if (newPatterns.length > 0 || correction) {
      const parts = [];
      if (newPatterns.length > 0) parts.push(`${newPatterns.length} new pattern(s) detected`);
      if (correction) parts.push(`user correction captured`);
      logActivity({
        type: "turn_complete",
        summary: `Turn completed: ${tools.join(" -> ") || "no tools"}${parts.length ? ` — ${parts.join(", ")}` : ""}`,
        sessionId,
        sessionRef,
        sessionPath,
        detail: newPatterns.map((p) => p.desc).join("; ") || null,
      });
    }

    // ── Post-flush processing ──

    runPostFlushPipeline({
      detector,
      autoApprovePatterns,
      persistPatterns,
      refreshSkill,
      maybeRunModelAdvisor,
      maybeRunExtraction,
      reason: "turn",
      sessionHandle: key,
      before: [reloadConfigIfStale, syncDiskStatus],
      after: [() => pruneDataFiles().catch(() => {})],
      ctx,
      learnerDir: paths.DATA_DIR,
      config: configRef.current,
      skipPrune,
    });

    // Adoption check
    processAdoptionCheck({
      sessionHandle: key,
      runtimeState,
      detector,
      tools,
      persistPatterns,
      refreshSkill,
      ctx,
    });

    sessions.delete(key);
  }

  // ── Tool-end semantic handlers ──

  const { handleToolEnd } = createToolEndHandlers({ detector, runtimeState, persistPatterns, refreshSkill, ctx });

  // ── Subscribe / unsubscribe ──

  let unsubs = [];

  function subscribe(ctxBus, config) {
    unsubs = [];

    // Main event subscription
    try {
      unsubs.push(ctxBus.subscribe((event, sessionMeta) => {
        if (!event?.type) return;
        // Only materialise a SessionTurn for events we actually consume.
        // Unhandled event types used to allocate (and retain, up to MAX_SESSIONS)
        // a turn that never flushed.
        if (!HANDLED_EVENT_TYPES.has(event.type)) return;
        const sessionTarget = normalizeSessionTarget(sessionMeta, event);
        const sessionKey = sessionIdentityKey(sessionTarget);
        runtimeState.sessionTargets?.set(sessionKey, sessionTarget);
        const turn = getTurn(sessionTarget);

        if (event.type === "session_user_message") {
          turn.addUserText(messageText(event.message));
          return;
        }

        if (event.type === "user_message" || event.type === "message_start") {
          if (event.message?.role === "user") turn.addUserText(messageText(event.message));
          return;
        }

        if (event.type === "message_update") {
          const sub = event.assistantMessageEvent;
          // Once the 1000-char cap is reached, appending is a no-op (the slice
          // discards everything new), so skip the per-delta normalization work.
          if (sub?.type === "text_delta" && turn.assistantText.length < 1000) {
            turn.assistantText = safeText(`${turn.assistantText} ${sub.delta || ""}`, 1000);
          }
          return;
        }

        if (event.type === "tool_execution_start") {
          turn.markToolStart(event.toolName || event.name);
          return;
        }

        if (event.type === "tool_execution_end") {
          turn.markToolEnd(event.toolName || event.name);
          if (event.isError) { turn.addError(extractToolError(event)); return; }

          handleToolEnd(event, sessionKey);
          return;
        }

        // Only flush the turn when the assistant has truly finished its response,
        // not on every intermediate message_end (e.g. after each tool call in a
        // multi-step reply).  Intermediate messages have stopReason "tool_calls"
        // or no stopReason; terminal messages have "stop", "end_turn", "length",
        // or "error".
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const sr = event.message?.stopReason;
          if (sr && sr !== "tool_calls") {
            flushTurn(sessionKey, event);
          }
          return;
        }

        if (event.type === "assistantMessageEvent") {
          const ame = event.assistantMessageEvent || {};
          // toolName tracking is handled by tool_execution_start — do NOT call
          // addTool here to avoid double-counting the same tool invocation.
          if (ame.toolError) turn.addError(ame.toolError);
          if (ame.type === "done" || ame.type === "complete") flushTurn(sessionKey, event);
        }
      }));
    } catch (err) {
      ctx.log.warn(`runtime-learner: EventBus subscribe failed: ${err.message}`);
    }

    // LLM usage subscription
    try {
      if (config.learnFromUsage) {
        unsubs.push(ctxBus.subscribe((event, sessionMeta) => {
          if (event?.type === "llm_usage" && event.entry) {
            const sessionTarget = normalizeSessionTarget(sessionMeta, event.entry, event);
            const sessionKey = sessionIdentityKey(sessionTarget);
            runtimeState.sessionTargets?.set(sessionKey, sessionTarget);
            recordUsage(event.entry, sessionTarget);
          }
        }, { types: ["llm_usage"] }));
      }
    } catch (err) {
      ctx.log.warn(`runtime-learner: usage subscribe failed: ${err.message}`);
    }
  }

  function unsubscribe() {
    for (const unsub of unsubs) {
      try { unsub?.(); } catch {}
    }
    unsubs = [];
  }

  return { subscribe, unsubscribe };
}
