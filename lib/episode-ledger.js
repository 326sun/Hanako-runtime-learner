import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createHash } from "node:crypto";
import { withDataLock } from "./state-lock.js";

const idHash = (value) => createHash("sha256").update(String(value || "")).digest("hex");
export const episodeIdForTask = (taskId) => `episode:${idHash(taskId)}`;
const episodePath = (dir) => path.join(dir, "episodes.jsonl");
const MAX_LEDGER_BYTES = 32 * 1024 * 1024;

export function createEpisodeRecord(experience, { now = new Date().toISOString() } = {}) {
  if (!experience || typeof experience.taskId !== "string" || !experience.taskId) throw new Error("experience.taskId is required");
  const episode = {
    schemaVersion: 2,
    id: episodeIdForTask(experience.taskId),
    date: experience.date || now,
    occurredAt: experience.date || now,
    ingestedAt: now,
    source: { kind: "experience_log", id: `experience:${idHash(experience.taskId)}`, file: "experience_log.jsonl" },
    taskRefHash: idHash(experience.taskId),
    sessionKeyHash: experience.sessionId || experience.sessionRef || experience.sessionPath ? idHash(experience.sessionId || JSON.stringify(experience.sessionRef || experience.sessionPath)) : null,
    project: String(experience.scope?.project || experience.project || "general").slice(0, 64),
    taskType: String(experience.taskType || "general").slice(0, 64),
    resultStatus: String(experience.resultStatus || "unknown").slice(0, 32),
    toolCategories: Array.isArray(experience.toolsUsed) ? experience.toolsUsed.filter((name) => typeof name === "string").slice(0, 32).map((name) => name.slice(0, 96)) : [],
    correction: !!experience.userExplicitCorrection,
    errorType: experience.errorType && experience.errorType !== "none" ? String(experience.errorType).slice(0, 64) : null,
    evidenceHash: idHash(`${experience.taskId}\n${experience.taskSummary || ""}\n${experience.correction || ""}`),
  };
  return episode;
}

export function recordEpisode(dir, experience, { maxBytes = MAX_LEDGER_BYTES, ...options } = {}) {
  const episode = createEpisodeRecord(experience, options);
  fs.mkdirSync(dir, { recursive: true });
  withDataLock(dir, "episode-ledger", () => {
    const file = episodePath(dir);
    fs.appendFileSync(file, `${JSON.stringify(episode)}\n`, "utf8");
    if (fs.statSync(file).size <= maxBytes) return;
    const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    let output = rows.map((row) => JSON.stringify(row)).join("\n");
    while (Buffer.byteLength(output) > maxBytes && rows.length > 1) {
      rows.shift(); output = rows.map((row) => JSON.stringify(row)).join("\n");
    }
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, output ? `${output}\n` : "", "utf8");
    fs.renameSync(temporary, file);
  });
  return episode;
}

export async function readEpisodes(dir, { ids = [], limit = 200, project = null } = {}) {
  const file = episodePath(dir);
  if (!fs.existsSync(file)) return [];
  const wanted = new Set((ids || []).filter((id) => typeof id === "string" && id));
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  const stream = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  const latest = new Map(), matched = new Map();
  for await (const line of stream) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (!row?.id || (project && ![project, "general", "global"].includes(row.project || "general"))) continue;
      if (wanted.size) {
        if (wanted.has(row.id) || wanted.has(`experience:${row.taskRefHash}`)) matched.set(row.id, row);
      } else {
        latest.delete(row.id);
        latest.set(row.id, row);
        if (latest.size > cap) latest.delete(latest.keys().next().value);
      }
    } catch { /* ignore a partial final line or damaged row */ }
  }
  return wanted.size ? [...matched.values()].slice(-cap).reverse() : [...latest.values()].reverse();
}

export async function episodesForEvidence(dir, evidence = [], options = {}) {
  const ids = [...new Set((evidence || []).map((row) => row?.id).filter(Boolean))];
  return readEpisodes(dir, { ...options, ids });
}
