// Shared compat layer — keep in sync with hanako-supplement/<other-plugin>/lib/hana-runtime-compat.js
// See: https://github.com/326sun/hanako-runtime-learner / https://github.com/326sun/hanako-ui-beautify
export const HANA_BUS_SKIP = Symbol.for("hana.event-bus.skip");

export function definePlugin(lifecycle = {}) {
  return class HanaRuntimeCompatPlugin {
    async onload() {
      if (typeof lifecycle.onload === "function") {
        return lifecycle.onload(this.ctx, {
          register: (disposable) => {
            if (typeof this.register === "function") this.register(disposable);
          },
        });
      }
    }

    async onunload() {
      if (typeof lifecycle.onunload === "function") {
        return lifecycle.onunload(this.ctx);
      }
    }
  };
}

export function defineTool(tool = {}) {
  return {
    parameters: { type: "object", properties: {} },
    ...tool,
  };
}

export function defineBusHandler(handler = {}) {
  return handler;
}

export function requestBus(ctx, type, payload, options) {
  if (!ctx?.bus?.request) throw new Error(`EventBus request unavailable: ${type}`);
  return ctx.bus.request(type, payload, options);
}
