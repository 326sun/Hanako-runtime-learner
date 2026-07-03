import path from "path";
import {
  countJsonl,
  decoratePatterns,
  readJson,
  readJsonlSample,
  summarizeSessionRows,
} from "../lib/common.js";
import { eventSummary } from "../lib/event-log.js";
import { readMemFSIndex } from "../lib/memfs.js";
import { listProposals } from "../lib/proposals.js";
import { listReviews } from "../lib/review-queue.js";
import { toolPaths, loadConfig, loadPatterns } from "./_shared.js";

const LOG_FILES = {
  experience: "experience_log.jsonl",
  error: "error_log.jsonl",
  turns: "turns.jsonl",
  activity: "activity_log.jsonl",
};

function loadLogSnapshot(file, { cutoff = null, maxLines = 5000 } = {}) {
  const sample = readJsonlSample(file, { cutoff, maxLines });
  return {
    path: file,
    count: countJsonl(file),
    rows: sample.rows,
    coverage: sample.coverage,
    sessions: summarizeSessionRows(sample.rows),
  };
}

export function loadRuntimeSnapshot(ctx, {
  includePatterns = true,
  includeDecorated = false,
  includeProposals = false,
  includeReviews = false,
  includeLogs = false,
  includeFacts = false,
  includeManifest = false,
  includeEvents = false,
  includeMemfs = false,
  logCutoff = null,
  logMaxLines = 5000,
  proposalLimit = 50,
  reviewLimit = 50,
} = {}) {
  const paths = toolPaths(ctx);
  const config = loadConfig(paths.configPath);
  const snapshot = {
    paths,
    config,
  };

  if (includePatterns || includeDecorated) {
    snapshot.patterns = loadPatterns(paths.patternsPath);
  }

  if (includeDecorated) {
    snapshot.decoratedPatterns = decoratePatterns(snapshot.patterns || [], config);
  }

  if (includeProposals) {
    snapshot.proposals = listProposals(paths.learnerDir, { limit: proposalLimit });
  }

  if (includeReviews) {
    snapshot.reviews = listReviews(paths.learnerDir, { limit: reviewLimit });
  }

  if (includeLogs) {
    snapshot.logs = {};
    for (const [key, name] of Object.entries(LOG_FILES)) {
      snapshot.logs[key] = loadLogSnapshot(path.join(paths.learnerDir, name), {
        cutoff: logCutoff,
        maxLines: logMaxLines,
      });
    }
  }

  if (includeFacts) {
    snapshot.facts = readJson(path.join(paths.learnerDir, "facts.json"), []) || [];
  }

  if (includeManifest) {
    const manifestPath = ctx?.pluginDir
      ? path.join(ctx.pluginDir, "manifest.json")
      : path.join(paths.pluginDir, "manifest.json");
    snapshot.manifest = readJson(manifestPath, null);
    snapshot.manifestPath = manifestPath;
  }

  if (includeEvents) {
    snapshot.events = eventSummary(paths.learnerDir);
  }

  if (includeMemfs) {
    snapshot.memfsIndex = readMemFSIndex(paths.learnerDir);
  }

  return snapshot;
}
