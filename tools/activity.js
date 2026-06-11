import path from "path";
import { learnerDir as resolveLearnerDir } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";
import { readRecentJsonlTail } from "../lib/activity-log.js";

const ACTIVITY_LOG = path.join(resolveLearnerDir(), "activity_log.jsonl");

const tool = defineTool({
  name: "self_learning_activity",
  description: "View recent self-learning activity timeline: pattern discoveries, error detections, proposal creation, model advisor runs, and session summaries.",
  parameters: {
    type: "object",
    properties: {
      days: { type: "number", description: "Days to look back, default 1" },
      limit: { type: "number", description: "Maximum entries, default 50" },
    },
    required: [],
  },
  async execute(input = {}) {
    const days = input.days || 1;
    const limit = input.limit || 50;
    const activities = readRecentJsonlTail(ACTIVITY_LOG, { days }).slice(0, limit);

    if (activities.length === 0) {
      return JSON.stringify({
        ok: true,
        count: 0,
        days,
        activities: [],
        message: `No learning activities recorded in the last ${days} day(s).`,
      }, null, 2);
    }

    const byType = {};
    for (const a of activities) byType[a.type] = (byType[a.type] || 0) + 1;

    return JSON.stringify({
      ok: true,
      count: activities.length,
      days,
      byType,
      activities: activities.map((a) => ({
        date: a.date,
        type: a.type,
        summary: a.summary,
        detail: a.detail || null,
      })),
    }, null, 2);
  },
});

export const { name, description, parameters, execute } = tool;
