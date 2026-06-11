import fs from "fs";
import path from "path";
import { safeFileSlug } from "./common.js";
import { readActionFeedback } from "./action-runtime.js";
import { loadActiveSkills, loadSkillCandidates, nowIso, saveActiveSkills, saveSkillCandidates } from "./skill-promotion-store.js";
import { absorbFeedback, mergeCandidate, transitionCandidate, upsertActiveSkill } from "./skill-promotion-decision.js";

export {
  activeSkillRegistryPath,
  loadActiveSkills,
  loadSkillCandidates,
  saveActiveSkills,
  saveSkillCandidates,
  skillCandidateStorePath,
} from "./skill-promotion-store.js";

// ── Inlined from skill-reflexion-cluster.js ──

const REFLEXION_FILE = "reflexion_memory.jsonl";

function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, "utf-8"); } catch { return []; }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}

function readReflexions(learnerDir) {
  return readJsonl(path.join(learnerDir, REFLEXION_FILE)).filter((row) => row && row.id);
}

function clusterKey(reflexion = {}) {
  return [
    reflexion.taskType || "general",
    reflexion.actionType || "unknown_action",
    reflexion.failure?.errorType || reflexion.errorType || "unknown_error",
    reflexion.rootCause || "unknown_root_cause",
  ].map((part) => String(part || "").trim()).join("|");
}

function clusterReflexions(reflexions, { promotionThreshold = 3 } = {}) {
  const clusters = new Map();
  for (const reflexion of reflexions) {
    const key = clusterKey(reflexion);
    const existing = clusters.get(key) || { clusterId: `cluster:${key}`, items: [], key };
    existing.items.push(reflexion);
    existing.taskType = reflexion.taskType || existing.taskType;
    existing.actionType = reflexion.actionType || existing.actionType;
    existing.errorType = reflexion.failure?.errorType || reflexion.errorType || existing.errorType;
    existing.rootCause = reflexion.rootCause || existing.rootCause;
    existing.futureStrategy = reflexion.futureStrategy || existing.futureStrategy;
    existing.scope = { ...(existing.scope || {}), ...(reflexion.scope || {}) };
    clusters.set(key, existing);
  }
  return [...clusters.values()].map((cluster) => ({
    ...cluster,
    promotionCandidate: cluster.items.length >= Number(promotionThreshold || 3),
  }));
}

// ── Inlined from skill-candidate-factory.js ──

function slug(value) {
  return safeFileSlug(value, "unknown", 80).replace(/^_+|_+$/g, "") || "unknown";
}

function createSkillCandidateFromCluster(cluster = {}, { scope = {} } = {}) {
  if (!cluster.promotionCandidate) return null;
  const errorType = cluster.errorType || "unknown_error";
  const actionType = cluster.actionType || "unknown_action";
  const before = Array.isArray(cluster.futureStrategy?.beforePatch) ? cluster.futureStrategy.beforePatch : [];
  const after = Array.isArray(cluster.futureStrategy?.afterPatch) ? cluster.futureStrategy.afterPatch : [];
  return {
    id: `skill_candidate:${slug(actionType)}:${slug(errorType)}`,
    rule: `Before ${errorType} repair, ${before.join("; ") || "check the root cause"}; after repair, ${after.join("; ") || "run verification"}.`,
    source: "reflexion_cluster",
    actionType,
    errorType,
    scope: { ...scope, ...(cluster.scope || {}), taskTypes: [cluster.taskType || "general"].filter(Boolean) },
    confidence: Math.min(0.95, 0.55 + cluster.items.length * 0.1),
    evidence: {
      failureCount: cluster.items.length,
      successCount: 0,
      regressionCount: 0,
      reflexionIds: cluster.items.map((item) => item.id).filter(Boolean),
      feedbackIds: [],
      errorType,
    },
    tokenCost: 0,
  };
}

export function runSkillPromotionLoop(learnerDir, options = {}) {
  const {
    promotionThreshold = 3,
    minSuccess = 5,
    activeSuccess = 7,
    maxRegression = 0,
    feedbackLimit = 200,
    dryRun = false,
    allowSkillFileWrite = false,
    now = Date.now(),
  } = options;
  if (!learnerDir) return { ok: false, status: "failed", error: "learnerDir missing" };

  const reflexions = readReflexions(learnerDir);
  const clusters = clusterReflexions(reflexions, { promotionThreshold });
  const promotableClusters = clusters.filter((cluster) => cluster.promotionCandidate);
  const store = loadSkillCandidates(learnerDir);
  const byId = new Map(store.candidates.map((candidate) => [candidate.id, candidate]));
  const events = [];

  for (const cluster of promotableClusters) {
    const incoming = createSkillCandidateFromCluster(cluster, { scope: { errorType: cluster.errorType } });
    if (!incoming) continue;
    incoming.errorType = cluster.errorType;
    const existing = byId.get(incoming.id);
    const merged = mergeCandidate(existing, incoming, { now });
    byId.set(merged.id, merged);
    events.push({ type: existing ? "candidate.updated_from_cluster" : "candidate.created_from_cluster", candidateId: merged.id, clusterId: cluster.clusterId });
  }

  const feedbackRows = readActionFeedback(learnerDir, { limit: feedbackLimit });
  const nextCandidates = [];
  let activeRegistry = loadActiveSkills(learnerDir);

  for (const candidate of byId.values()) {
    const absorbed = absorbFeedback(candidate, feedbackRows);
    if (absorbed.consumed > 0) events.push({ type: "candidate.feedback_absorbed", candidateId: candidate.id, count: absorbed.consumed });
    const transitioned = transitionCandidate(absorbed.candidate, { minSuccess, activeSuccess, maxRegression, now, halfLifeDays: options.halfLifeDays, removeDecayedBelow: options.removeDecayedBelow });
    if (transitioned.beforeStatus !== transitioned.candidate.status || transitioned.decision !== "keep_candidate") {
      events.push({ type: "candidate.transition", candidateId: transitioned.candidate.id, from: transitioned.beforeStatus, to: transitioned.candidate.status, decision: transitioned.decision, reason: transitioned.reason });
    }
    if (transitioned.candidate.status === "active") {
      activeRegistry = upsertActiveSkill(activeRegistry, transitioned.candidate);
      events.push({ type: "active_skill.registered", candidateId: transitioned.candidate.id });
    }
    if (transitioned.candidate.status !== "removed") nextCandidates.push(transitioned.candidate);
    else events.push({ type: "candidate.removed", candidateId: transitioned.candidate.id });
  }

  const nextStore = { schemaVersion: 1, generatedAt: nowIso(now), candidates: nextCandidates.sort((a, b) => String(a.id).localeCompare(String(b.id))) };
  const nextActive = { ...activeRegistry, generatedAt: nowIso(now) };
  if (!dryRun) {
    saveSkillCandidates(learnerDir, nextStore);
    saveActiveSkills(learnerDir, nextActive);
  }

  return {
    ok: true,
    status: "completed",
    dryRun,
    allowSkillFileWrite,
    autoSkillFileWriteBlocked: allowSkillFileWrite !== true,
    counts: {
      reflexions: reflexions.length,
      clusters: clusters.length,
      promotableClusters: promotableClusters.length,
      candidates: nextStore.candidates.length,
      staged: nextStore.candidates.filter((item) => item.status === "staged").length,
      active: nextStore.candidates.filter((item) => item.status === "active").length,
      decayed: nextStore.candidates.filter((item) => item.status === "decayed").length,
      activeRegistry: nextActive.skills.length,
    },
    candidates: nextStore.candidates,
    activeSkills: nextActive.skills,
    events,
  };
}
