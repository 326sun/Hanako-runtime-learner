import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSessionMessenger, formatProposalNotification } from "../lib/session-messenger.js";

function makeCtx({ available = true } = {}) {
  const sent = [];
  return {
    sent,
    bus: {
      getCapability(name) {
        if (name !== "session:send") return null;
        return { available, inputSchema: { properties: { context: {} } } };
      },
      async request(name, payload) {
        assert.equal(name, "session:send");
        sent.push(payload);
        return { ok: true };
      },
    },
    log: { warn() {}, debug() {} },
  };
}

describe("session messenger", () => {
  test("formats proposal notifications with the proposal id", () => {
    const text = formatProposalNotification({ id: "proposal-1", type: "code_patch", risk: "high", title: "Fix" });
    assert.match(text, /proposal-1/);
    assert.match(text, /code_patch/);
  });

  test("sends proposal notifications with invisible context when available", async () => {
    const ctx = makeCtx();
    const messenger = createSessionMessenger(ctx, { proposalNotifiedIds: new Map() });
    await messenger.notifyProposalReview("session.md", [{ id: "p1", type: "code_patch", risk: "high", title: "Fix" }], {
      proposalChatNotificationsEnabled: true,
    });
    assert.equal(ctx.sent.length, 1);
    assert.equal(ctx.sent[0].sessionPath, "session.md");
    assert.ok(ctx.sent[0].context.beforeUser[0].text.includes("p1"));
  });

  test("prefers stable session identifiers when available", async () => {
    const ctx = makeCtx();
    const messenger = createSessionMessenger(ctx, { proposalNotifiedIds: new Map() });
    await messenger.notifyProposalReview(
      { sessionId: "sess-123", sessionRef: { tabId: "tab-7" }, sessionPath: "legacy.md" },
      [{ id: "p2", type: "code_patch", risk: "high", title: "Fix" }],
      { proposalChatNotificationsEnabled: true },
      { sessionKey: "sid:sess-123" },
    );
    assert.equal(ctx.sent.length, 1);
    assert.equal(ctx.sent[0].sessionId, "sess-123");
    assert.deepEqual(ctx.sent[0].sessionRef, { tabId: "tab-7" });
    assert.equal(ctx.sent[0].sessionPath, "legacy.md");
  });

  test("does not send when session:send is unavailable", async () => {
    const ctx = makeCtx({ available: false });
    const messenger = createSessionMessenger(ctx);
    await messenger.notifyWorkStatus("session.md", { workStatusEnabled: true }, "done");
    assert.equal(ctx.sent.length, 0);
  });
});
