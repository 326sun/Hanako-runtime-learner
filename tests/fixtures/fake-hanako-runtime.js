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

export function createFakeRuntimeContext({ pluginDir, bus = new FakeEventBus() } = {}) {
  const logs = [];
  const configUpdates = [];
  return {
    pluginDir,
    bus,
    logs,
    configUpdates,
    log: {
      info: (message) => logs.push({ level: "info", message }),
      warn: (message) => logs.push({ level: "warn", message }),
      error: (message) => logs.push({ level: "error", message }),
      debug: (message) => logs.push({ level: "debug", message }),
    },
    config: {
      update: (value) => configUpdates.push(value),
      set: (value) => configUpdates.push(value),
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
