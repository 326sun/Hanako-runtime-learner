/**
 * sample-text — shared access to Hanako's official host-side utility-model
 * sampling capability (`model:sample-text`, Hanako ≥ 0.305).
 *
 * The host resolves the configured utility model and its credentials itself; no
 * provider credentials ever pass through this plugin. Both the model advisor
 * (lib/model-advisor.js) and the v5 LLM pattern extractor (lib/llm-extractor.js)
 * share this single capability-probe + sampling + JSON-extraction surface so the
 * two never drift apart (v5 plan §5.2 / #12).
 */

export const SAMPLE_TEXT_CAPABILITY = "model:sample-text";

/**
 * True when the host exposes a usable `model:sample-text` capability. Prefers
 * the declarative getCapability().available flag, then falls back to a
 * hasHandler() probe. Any probe error degrades to false (treat as unavailable).
 */
export function busSampleAvailable(ctx) {
  const bus = ctx?.bus;
  if (!bus || typeof bus.request !== "function") return false;
  try {
    const cap = bus.getCapability?.(SAMPLE_TEXT_CAPABILITY);
    if (cap) return cap.available !== false;
  } catch {}
  try {
    if (bus.hasHandler?.(SAMPLE_TEXT_CAPABILITY)) return true;
  } catch {}
  return false;
}

/**
 * Best-effort extraction of the first JSON object from a model response.
 * Accepts a clean JSON string, JSON embedded in prose, or markdown-fenced JSON.
 * Returns the parsed value, or null when nothing parseable is found.
 */
export function extractFirstJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Sample text from the host utility model over the EventBus capability.
 * @param {object} ctx — plugin context (must have ctx.bus.request)
 * @param {object} opts
 * @param {string} opts.operation — host-facing operation label
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {number} opts.maxTokens
 * @param {number} [opts.timeout=30000] — request timeout in ms
 * @returns {Promise<{text:string, model:string}>}
 * @throws when the host returns an empty response
 */
export async function sampleTextViaBus(ctx, { operation, messages, maxTokens, timeout = 30_000 }) {
  const result = await ctx.bus.request(
    SAMPLE_TEXT_CAPABILITY,
    { operation, messages, maxTokens },
    { timeout },
  );
  const text = result?.text ?? result?.content ?? result?.output_text ?? "";
  if (!String(text).trim()) throw new Error("model:sample-text returned an empty response");
  return { text: String(text), model: result?.model || result?.modelId || "official-utility" };
}
