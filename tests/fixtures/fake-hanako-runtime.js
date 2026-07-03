export class FakeEventBus {
  constructor({ handlers = {}, capabilities = {} } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.capabilities = new Map(Object.entries(capabilities));
    this.subscriptions = [];
    this.requests = [];
  }

  subscribe(callback, options = {}) {
    const entry = {
      callback,
      types: Array.isArray(options.types) ? new Set(options.types) : null,
    };
    this.subscriptions.push(entry);
    return () => {
      const index = this.subscriptions.indexOf(entry);
      if (index !== -1) this.subscriptions.splice(index, 1);
    };
  }

  emit(event, sessionPath = "sessions/runtime-e2e.jsonl") {
    for (const sub of [...this.subscriptions]) {
      if (!sub.types || sub.types.has(event?.type)) sub.callback(event, sessionPath);
    }
  }

  async request(name, payload) {
    this.requests.push({ name, payload });
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`EventBus request unavailable: ${name}`);
    return handler(payload);
  }

  hasHandler(name) {
    return this.handlers.has(name);
  }

  getCapability(name) {
    if (this.capabilities.has(name)) return this.capabilities.get(name);
    if (this.handlers.has(name)) return { available: true };
    return null;
  }
}

export function createFakeRuntimeContext({
  pluginDir,
  dataDir = null,
  bus = new FakeEventBus(),
  configValues = {},
  sessionId = "fake-session-1",
  sessionRef = null,
  sessionPath = "sessions/runtime-e2e.jsonl",
} = {}) {
  const logs = [];
  const configUpdates = [];
  const configStore = { ...configValues };
  const stageFiles = [];
  const effectiveSessionRef = sessionRef || { sessionId };
  const fileLabel = (filePath) => String(filePath || "file").split(/[\\/]/).pop() || "file";
  return {
    pluginDir,
    ...(dataDir ? { dataDir } : {}),
    sessionId,
    sessionRef: effectiveSessionRef,
    sessionPath,
    bus,
    logs,
    configUpdates,
    stageFiles,
    log: {
      info: (message) => logs.push({ level: "info", message }),
      warn: (message) => logs.push({ level: "warn", message }),
      error: (message) => logs.push({ level: "error", message }),
      debug: (message) => logs.push({ level: "debug", message }),
    },
    config: {
      getAll: () => ({ ...configStore }),
      setMany: (value = {}) => {
        Object.assign(configStore, value);
        configUpdates.push(value);
      },
      update: (value) => configUpdates.push(value),
      set: (value) => configUpdates.push(value),
    },
    stageFile(entry = {}) {
      const fileId = `fake-session-file-${stageFiles.length + 1}`;
      const record = {
        fileId,
        sessionId,
        sessionRef: effectiveSessionRef,
        sessionPath,
        ...entry,
        label: entry.label || fileLabel(entry.filePath),
      };
      stageFiles.push(record);
      return {
        file: record,
        mediaItem: {
          type: "session_file",
          fileId,
          label: record.label,
          filePath: record.filePath,
          sessionId: record.sessionId,
          sessionRef: record.sessionRef,
          sessionPath: record.sessionPath,
        },
      };
    },
    resources: {
      read: async () => { throw new Error("Fake runtime resources.read is not implemented"); },
      search: async () => { throw new Error("Fake runtime resources.search is not implemented"); },
      materialize: async () => { throw new Error("Fake runtime resources.materialize is not implemented"); },
      watch: async () => { throw new Error("Fake runtime resources.watch is not implemented"); },
      subscribe: async () => { throw new Error("Fake runtime resources.subscribe is not implemented"); },
    },
  };
}

export function emitSuccessfulTurn(bus, sessionPath, { userText = "do the task", tools = [] } = {}) {
  bus.emit({ type: "user_message", message: { role: "user", content: userText } }, sessionPath);
  for (const toolName of tools) {
    bus.emit({ type: "tool_execution_start", toolName }, sessionPath);
    bus.emit({ type: "tool_execution_end", toolName, isError: false, result: { ok: true } }, sessionPath);
  }
  bus.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: "done" } }, sessionPath);
}

export function emitCorrectionTurn(bus, sessionPath, userText) {
  bus.emit({ type: "user_message", message: { role: "user", content: userText } }, sessionPath);
  bus.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: "记住了" } }, sessionPath);
}

export function emitErrorTurn(bus, sessionPath, { userText = "read the missing file", toolName = "read", error = "ENOENT: no such file or directory" } = {}) {
  bus.emit({ type: "user_message", message: { role: "user", content: userText } }, sessionPath);
  bus.emit({ type: "tool_execution_start", toolName }, sessionPath);
  bus.emit({ type: "tool_execution_end", toolName, isError: true, error: { message: error } }, sessionPath);
  bus.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", content: "failed" } }, sessionPath);
}
