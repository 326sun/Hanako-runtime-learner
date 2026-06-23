import fs from "fs";
import { readJsonlTailLines } from "./jsonl-utils.js";
import { normalizeSessionTarget } from "./helpers.js";

export function appendJsonl(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf-8");
}

/** Batch-append entries to multiple JSONL files in one pass. */
export function appendJsonlBatch(entries) {
  for (const [file, rows] of Object.entries(entries)) {
    if (!rows || !rows.length) continue;
    const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.appendFileSync(file, lines, "utf-8");
  }
}

async function pruneJsonlTail(file, { maxEntries = 500 } = {}) {
  if (!Number.isFinite(maxEntries) || maxEntries <= 0) return;
  try {
    if (!fs.existsSync(file)) return;
    const stat = await fs.promises.stat(file);
    // Heuristic: assume average JSONL line <= 4 KB, capped at file size.
    const tailBytes = Math.min(stat.size, Math.max(64 * 1024, 4 * 1024 * maxEntries));
    const start = Math.max(0, stat.size - tailBytes);
    const buffer = Buffer.alloc(tailBytes);
    const fd = await fs.promises.open(file, "r");
    try {
      await fd.read(buffer, 0, tailBytes, start);
    } finally {
      await fd.close();
    }
    let text = buffer.toString("utf-8");
    if (start > 0 && text[0] !== "\n") {
      const firstNewline = text.indexOf("\n");
      if (firstNewline !== -1) text = text.slice(firstNewline + 1);
    }
    const lines = text.split("\n").filter(Boolean);
    if (lines.length > maxEntries) {
      await fs.promises.writeFile(file, `${lines.slice(-maxEntries).join("\n")}\n`, "utf-8");
    }
  } catch {}
}

export function readRecentJsonlTail(file, { days = 1, tailBytes = 64 * 1024, maxLines = 500 } = {}) {
  const cutoff = Date.now() - days * 86_400_000;
  const rows = [];
  const lines = readJsonlTailLines(file, { maxLines, initialBytes: tailBytes, maxBytes: tailBytes });
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (new Date(row.date).getTime() >= cutoff) rows.push(row);
    } catch {}
  }
  return rows;
}

export function createActivityLogger(file, {
  maxEntries = 500,
  pruneIntervalMs = 60_000,
} = {}) {
  let lastPruneAt = 0;
  return {
    log(event = {}) {
      const session = normalizeSessionTarget(event, event.session, event.sessionTarget);
      const entry = {
        date: new Date().toISOString(),
        sessionId: session.sessionId,
        sessionRef: session.sessionRef,
        sessionPath: session.sessionPath,
        type: event.type || "unknown",
        summary: event.summary || "",
        detail: event.detail || null,
      };
      try {
        appendJsonl(file, entry);
        const now = Date.now();
        if (now - lastPruneAt >= pruneIntervalMs) {
          lastPruneAt = now;
          pruneJsonlTail(file, { maxEntries }).catch(() => {});
        }
      } catch {}
    },
    readRecent(days = 1) {
      return readRecentJsonlTail(file, { days });
    },
    pruneNow() {
      lastPruneAt = Date.now();
      return pruneJsonlTail(file, { maxEntries });
    },
  };
}
