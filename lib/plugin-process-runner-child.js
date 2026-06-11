import { pathToFileURL } from "node:url";

function cloneForIpc(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

async function run(payload = {}) {
  const { modulePath, exportName, actionPlan, context, definition } = payload;
  if (!modulePath) throw new Error("plugin modulePath is required");
  const module = await import(pathToFileURL(modulePath).href);
  const fn = module[exportName] || module.default;
  if (typeof fn !== "function") throw new Error(`plugin module does not export function: ${exportName}`);
  const result = await fn(actionPlan || {}, context || {}, definition || {});
  return cloneForIpc(result);
}

process.on("message", async (payload) => {
  try {
    const result = await run(payload);
    if (process.send) process.send({ ok: true, result });
    process.exit(0);
  } catch (err) {
    if (process.send) {
      process.send({
        ok: false,
        error: err?.message || String(err),
        stack: err?.stack || null,
      });
    }
    process.exit(1);
  }
});
