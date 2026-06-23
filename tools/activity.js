import path from "path";
import { learnerDir as resolveLearnerDir } from "../lib/common.js";
import { readRecentJsonlTail } from "../lib/activity-log.js";

export const name = "self_learning_activity";

export const description = "View recent self-learning activity timeline: pattern discoveries, error detections, proposal creation, model advisor runs, and session summaries.";

export const sessionPermission = { readOnly: true };

export const parameters = {
  type: "object",
  properties: {
    days: { type: "number", description: "Days to look back, default 1" },
    limit: { type: "number", description: "Maximum entries, default 50" },
  },
};

export async function execute(input = {}, ctx) {
  const dataDir = ctx?.dataDir || resolveLearnerDir();
  const activityLog = path.join(dataDir, "activity_log.jsonl");
  const days = input.days || 1;
  const limit = input.limit || 50;
  const activities = readRecentJsonlTail(activityLog, { days }).slice(0, limit);

  const byType = {};
  for (const a of activities) byType[a.type] = (byType[a.type] || 0) + 1;

  const result = {
    ok: true,
    count: activities.length,
    days,
    byType,
    activities: activities.map((a) => ({
      date: a.date,
      type: a.type,
      sessionKey: a.sessionKey || null,
      sessionId: a.sessionId || null,
      sessionPath: a.sessionPath || null,
      summary: a.summary,
      detail: a.detail || null,
    })),
  };
  if (activities.length === 0) {
    result.message = `No learning activities recorded in the last ${days} day(s).`;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    details: result,
  };
}
