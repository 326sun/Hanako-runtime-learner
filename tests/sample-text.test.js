import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_TEXT_CAPABILITY,
  busSampleAvailable,
  extractFirstJson,
  sampleTextViaBus,
} from "../lib/sample-text.js";

describe("sample-text shared helpers (extracted from model-advisor)", () => {
  it("exposes the official host sampling capability id", () => {
    assert.equal(SAMPLE_TEXT_CAPABILITY, "model:sample-text");
  });

  describe("busSampleAvailable", () => {
    it("is false when there is no bus or no request fn", () => {
      assert.equal(busSampleAvailable(null), false);
      assert.equal(busSampleAvailable({}), false);
      assert.equal(busSampleAvailable({ bus: {} }), false);
    });

    it("uses getCapability and honours available:false", () => {
      const ctx = { bus: { request() {}, getCapability: () => ({ available: false }) } };
      assert.equal(busSampleAvailable(ctx), false);
      const ctx2 = { bus: { request() {}, getCapability: () => ({ available: true }) } };
      assert.equal(busSampleAvailable(ctx2), true);
    });

    it("falls back to hasHandler when getCapability returns nothing", () => {
      const ctx = {
        bus: { request() {}, getCapability: () => null, hasHandler: (n) => n === SAMPLE_TEXT_CAPABILITY },
      };
      assert.equal(busSampleAvailable(ctx), true);
    });

    it("swallows getCapability/hasHandler throwing and returns false", () => {
      const ctx = {
        bus: { request() {}, getCapability() { throw new Error("boom"); }, hasHandler() { throw new Error("boom"); } },
      };
      assert.equal(busSampleAvailable(ctx), false);
    });
  });

  describe("extractFirstJson", () => {
    it("parses a clean JSON object", () => {
      assert.deepEqual(extractFirstJson('{"a":1}'), { a: 1 });
    });

    it("extracts the first embedded JSON object from surrounding prose", () => {
      assert.deepEqual(extractFirstJson('here you go: {"type":"none"} thanks'), { type: "none" });
    });

    it("tolerates markdown-fenced JSON", () => {
      assert.deepEqual(extractFirstJson('```json\n{"ok":true}\n```'), { ok: true });
    });

    it("returns null for empty or non-JSON input", () => {
      assert.equal(extractFirstJson(""), null);
      assert.equal(extractFirstJson("no json here"), null);
      assert.equal(extractFirstJson("{not valid"), null);
    });
  });

  describe("sampleTextViaBus", () => {
    it("requests the capability with messages/maxTokens/timeout and normalizes the result", async () => {
      const calls = [];
      const ctx = {
        pluginId: "hanako-runtime-learner",
        bus: {
          request(type, payload, opts) {
            calls.push({ type, payload, opts });
            return { text: "  hello  ", model: "util-1" };
          },
        },
      };
      const out = await sampleTextViaBus(ctx, {
        operation: "test-op",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 123,
        timeout: 9000,
      });
      assert.equal(out.text, "  hello  ");
      assert.equal(out.model, "util-1");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].type, SAMPLE_TEXT_CAPABILITY);
      assert.equal(calls[0].payload.operation, "test-op");
      assert.deepEqual(calls[0].payload.messages, [{ role: "user", content: "hi" }]);
      assert.equal(calls[0].payload.maxTokens, 123);
      assert.equal(calls[0].payload.pluginId, "hanako-runtime-learner");
      assert.equal(calls[0].opts.timeout, 9000);
    });

    it("reads text from content/output_text fallbacks", async () => {
      const ctx = { bus: { request: () => ({ content: "via-content" }) } };
      const out = await sampleTextViaBus(ctx, { operation: "o", messages: [], maxTokens: 1 });
      assert.equal(out.text, "via-content");
    });

    it("throws on an empty response", async () => {
      const ctx = { bus: { request: () => ({ text: "   " }) } };
      await assert.rejects(
        () => sampleTextViaBus(ctx, { operation: "o", messages: [], maxTokens: 1 }),
        /empty response/,
      );
    });
  });
});
