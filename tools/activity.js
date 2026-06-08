import fs from "fs";
import path from "path";
import { learnerDir as resolveLearnerDir } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";

const ACTIVITY_LOG = path.join(resolveLearnerDir(), "activity_log.jsonl");

function readRecentActivity(days = 1) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  try {
    if (!fs.existsSync(ACTIVITY_LOG)) return [];
    const TAIL_BYTES = 64 * 1024;
    const stat = fs.statSync(ACTIVITY_LOG);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(stat.size, TAIL_BYTES));
    const fd = fs.openSync(ACTIVITY_LOG, "r");
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    const lines = buf.toString("utf-8").split("\n").filter(Boolean);
    if (start > 0 && lines.length > 0) lines.shift();
    const rows = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]);
        if (new Date(row.date).getTime() >= cutoff) rows.push(row);
      } catch {}
    }
    return rows; // newest-first from reverse iteration
  } catch {}
  return [];
}

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
    const activities = readRecentActivity(days).slice(0, limit);

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
    for (const a of activities) {
      byType[a.type] = (byType[a.type] || 0) + 1;
    }

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
