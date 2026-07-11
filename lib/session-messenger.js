import { normalizeSessionTarget, sessionIdentityKey } from "./helpers.js";

const WORK_STATUS_COOLDOWN_MS = 15 * 60_000;

function canSendSessionMessage(ctx) {
  if (!ctx?.bus?.request) return false;
  const capability = ctx.bus.getCapability?.("session:send");
  if (capability && capability.available === false) return false;
  if (!capability && !ctx.bus.hasHandler?.("session:send")) return false;
  return true;
}

function sessionSendSupportsContext(ctx) {
  try {
    const capability = ctx?.bus?.getCapability?.("session:send");
    return !!capability?.inputSchema?.properties?.context;
  } catch {
    return false;
  }
}

function proposalContext(proposal) {
  return {
    beforeUser: [{
      label: "self_learning_proposal",
      text: JSON.stringify({
        id: proposal.id,
        type: proposal.type || null,
        risk: proposal.risk || null,
        title: proposal.title || null,
        reason: proposal.reason || null,
        triggerPatternIds: (proposal.triggerPatternIds || []).slice(0, 8),
      }).slice(0, 2000),
    }],
  };
}

export function formatProposalNotification(proposal) {
  return [
    "Runtime Self-Learning 发现一个可改进点，需要你决定是否应用：",
    "",
    `提案 ID: ${proposal.id}`,
    `风险: ${proposal.risk || "unknown"}`,
    `类型: ${proposal.type || "unknown"}`,
    `标题: ${proposal.title || proposal.reason || "Untitled proposal"}`,
    "",
    "回复“查看提案 <ID>”可以看详情；回复“应用提案 <ID>”或“拒绝提案 <ID>”让我处理。",
    "说明：code_patch 不会由插件自动写入代码，应用它表示让我按提案修改文件、测试并安装。",
  ].join("\n");
}

function pruneCooldownMap(map, now, cooldownMs) {
  if (!map) return;
  for (const [id, timestamp] of map) {
    if (now - timestamp >= cooldownMs) map.delete(id);
  }
}

function buildSessionSendPayload(sessionTarget, text, context, ctx) {
  const target = normalizeSessionTarget(sessionTarget);
  if (!target.sessionId && !target.sessionRef && !target.sessionPath) return null;
  const payload = { text };
  if (target.sessionId) payload.sessionId = target.sessionId;
  if (target.sessionRef) payload.sessionRef = target.sessionRef;
  if (target.sessionPath) payload.sessionPath = target.sessionPath;
  if (context && sessionSendSupportsContext(ctx)) payload.context = context;
  return payload;
}

export function createSessionMessenger(ctx, {
  proposalNotifiedIds = new Map(),
  statusNotifiedAt = new Map(),
} = {}) {
  const send = async (sessionTarget, text, { retries = 3, context = null, warnOnFailure = true } = {}) => {
    if (!text || !canSendSessionMessage(ctx)) return false;
    const payload = buildSessionSendPayload(sessionTarget, text, context, ctx);
    if (!payload) return false;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const result = await ctx.bus.request("session:send", payload);
        if (result?.ok === false) throw new Error(result.error || "session_send_rejected");
        return true;
      } catch (err) {
        if (err.message === "session_busy" && attempt < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        if (warnOnFailure) {
          ctx.log.warn?.(`runtime-learner: session message failed: ${err.message}`);
        }
        return false;
      }
    }
    return false;
  };

  const notifyProposalReview = async (sessionTarget, proposals = [], config = {}, { cooldownMs = 2 * 60 * 60_000, sessionKey = null } = {}) => {
    const target = normalizeSessionTarget(sessionTarget);
    const key = sessionKey || sessionIdentityKey(target);
    if (!config.proposalChatNotificationsEnabled || key === "unknown" || proposals.length === 0) return;
    const now = Date.now();
    pruneCooldownMap(proposalNotifiedIds, now, cooldownMs);

    for (const proposal of proposals) {
      if (!proposal?.id) continue;
      const lastNotified = proposalNotifiedIds.get(proposal.id) || 0;
      if (now - lastNotified < cooldownMs) continue;
      const sent = await send(target, formatProposalNotification(proposal), {
        retries: 3,
        context: proposalContext(proposal),
        warnOnFailure: true,
      });
      if (sent) {
        proposalNotifiedIds.set(proposal.id, now);
      } else {
        ctx.log.warn?.(`runtime-learner: proposal notification NOT sent for ${proposal.id} (session=${key}, canSend=${canSendSessionMessage(ctx)})`);
      }
    }
  };

  const notifyWorkStatus = async (sessionTarget, config = {}, detail = "", { sessionKey = null, cooldownMs = WORK_STATUS_COOLDOWN_MS } = {}) => {
    const target = normalizeSessionTarget(sessionTarget);
    const key = sessionKey || sessionIdentityKey(target);
    if (!config.workStatusEnabled || key === "unknown") return;
    const now = Date.now();
    const last = statusNotifiedAt.get(key) || 0;
    if (now - last < cooldownMs) return;
    const text = `${config.workStatusText || "正在自我整理学习"}${detail ? `：${detail}` : ""}`;
    const sent = await send(target, text, { retries: 1, warnOnFailure: false });
    if (sent) statusNotifiedAt.set(key, now);
  };

  return {
    canSend: () => canSendSessionMessage(ctx),
    send,
    notifyProposalReview,
    notifyWorkStatus,
  };
}
