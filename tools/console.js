import { learnerDir as resolveLearnerDir } from "../lib/common.js";
import { ensureConsoleSession, buildSnapshot } from "../lib/console-session.js";
import { createSessionMessenger } from "../lib/session-messenger.js";

export const name = "self_learning_console";

export const description = "Open the Runtime Self-Learning console: a plugin-private session whose transcript collects recent activity and pending proposals, surfaced inline as a native chat card. Requires a Hanako host that supports plugin private sessions; otherwise returns a plain-text status.";

// Opening the console creates or updates a plugin-private Hanako session.  It
// does not touch the user's workspace, but it is still a host-side mutation and
// therefore must not be advertised as read-only to Hanako's session gate.
export const sessionPermission = {
  kind: "review",
  describeSideEffect: () => ({
    kind: "plugin_private_session_write",
    summary: "Create or refresh the Runtime Self-Learning private console session.",
    ruleId: "runtime-learner-console-session",
  }),
};

export const parameters = {
  type: "object",
  properties: {
    days: { type: "number", description: "Days of activity to include in the snapshot, default 1" },
    limit: { type: "number", description: "Maximum activity entries in the snapshot, default 20" },
  },
};

export async function execute(input = {}, ctx) {
  const dataDir = ctx?.dataDir || resolveLearnerDir();

  const session = await ensureConsoleSession(ctx);
  if (!session) {
    return {
      content: [{ type: "text", text: "当前 Hanako 宿主不支持插件私有会话，自学习控制台暂不可用。" }],
      details: { ok: false, reason: "chat_surface_unavailable" },
    };
  }

  const snapshot = buildSnapshot(dataDir, {}, input);
  const messenger = createSessionMessenger(ctx);
  const sent = await messenger.send(session, snapshot, { retries: 1, warnOnFailure: false });
  if (!sent) {
    return {
      content: [{ type: "text", text: "自学习控制台会话已创建，但内容发送失败，请稍后重试。" }],
      details: { ok: false, reason: "console_send_failed", sessionId: session.sessionId },
    };
  }

  const card = {
    type: "chat.surface",
    pluginId: ctx.pluginId,
    sessionId: session.sessionId,
    sessionRef: { sessionId: session.sessionId, ...(session.sessionPath ? { sessionPath: session.sessionPath } : {}) },
    title: "自学习控制台",
    description: "Runtime Self-Learning 控制台（插件私有会话）",
    mode: "transcript",
  };

  return {
    content: [{ type: "text", text: "已更新自学习控制台。" }],
    details: { ok: true, sessionId: session.sessionId, card },
  };
}
