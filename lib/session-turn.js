import { normalizeToolName, safeText } from "./helpers.js";

export class SessionTurn {
  constructor(sessionKey, sessionTarget = null) {
    this.sessionKey = sessionKey || "unknown";
    // sessionPath holds a real filesystem locator or null — never a synthetic
    // identity key. When the host supplies sessionId/sessionRef, sessionKey is an
    // identity key (sid:/sref:); leaking that into sessionPath would pollute
    // scope inference and dedup payloads. A path-shaped key (legacy callers) is
    // still accepted as a path.
    this.sessionPath = sessionTarget?.sessionPath
      || (typeof sessionKey === "string" && !/^s(?:id|ref):/.test(sessionKey) ? sessionKey : null);
    this.sessionTarget = sessionTarget || null;
    this.startedAt = new Date().toISOString();
    this.lastTouched = Date.now();
    this.tools = [];
    this.pendingTools = new Map();
    this.toolCallCount = 0;
    this.errors = [];
    this.userTexts = [];
    this.assistantText = "";
    this.stopReason = null;
  }

  touch() {
    this.lastTouched = Date.now();
  }

  setSessionTarget(sessionTarget) {
    if (!sessionTarget || typeof sessionTarget !== "object") return;
    this.sessionTarget = {
      sessionId: sessionTarget.sessionId || this.sessionTarget?.sessionId || null,
      sessionRef: sessionTarget.sessionRef || this.sessionTarget?.sessionRef || null,
      sessionPath: sessionTarget.sessionPath || this.sessionTarget?.sessionPath || null,
    };
    if (this.sessionTarget.sessionPath) this.sessionPath = this.sessionTarget.sessionPath;
    this.touch();
  }

  addTool(toolName) {
    const name = normalizeToolName(toolName);
    if (!name) return;
    this.tools.push(name);
    this.toolCallCount += 1;
    this.touch();
  }

  markToolStart(toolName) {
    const name = normalizeToolName(toolName);
    if (!name) return;
    this.addTool(name);
    this.pendingTools.set(name, (this.pendingTools.get(name) || 0) + 1);
  }

  markToolEnd(toolName) {
    const name = normalizeToolName(toolName);
    if (!name) return;
    const pending = this.pendingTools.get(name) || 0;
    if (pending > 0) {
      if (pending === 1) this.pendingTools.delete(name);
      else this.pendingTools.set(name, pending - 1);
      this.touch();
      return;
    }
    this.addTool(name);
  }

  get pendingCount() {
    return this.pendingTools.size;
  }

  getPendingTools() {
    return new Map(this.pendingTools);
  }

  addError(message) {
    const text = safeText(message);
    if (text) this.errors.push(text);
    this.touch();
  }

  addUserText(text) {
    const clean = safeText(text, 300);
    if (clean) this.userTexts.push(clean);
    this.touch();
  }
}
