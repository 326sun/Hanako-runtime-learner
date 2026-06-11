import path from "path";
import { nowIso, readJson, writeJson as writeJsonFile } from "./common.js";

const CANDIDATE_FILE = "skill_candidates.json";
const ACTIVE_FILE = "active_skills.json";

export { nowIso } from "./common.js";

function jsonPath(learnerDir, fileName) {
  return path.join(learnerDir, fileName);
}

function writeStore(file, value) {
  writeJsonFile(file, value);
  return value;
}

function normalizeStore(raw = {}) {
  const items = Array.isArray(raw) ? raw : Array.isArray(raw.candidates) ? raw.candidates : [];
  return {
    schemaVersion: 1,
    generatedAt: raw.generatedAt || null,
    candidates: items.filter((item) => item && item.id),
  };
}

export function skillCandidateStorePath(learnerDir) {
  return jsonPath(learnerDir, CANDIDATE_FILE);
}

export function activeSkillRegistryPath(learnerDir) {
  return jsonPath(learnerDir, ACTIVE_FILE);
}

export function loadSkillCandidates(learnerDir) {
  return normalizeStore(readJson(skillCandidateStorePath(learnerDir), { schemaVersion: 1, candidates: [] }));
}

export function saveSkillCandidates(learnerDir, store) {
  const normalized = normalizeStore(store);
  normalized.generatedAt = nowIso();
  return writeStore(skillCandidateStorePath(learnerDir), normalized);
}

export function loadActiveSkills(learnerDir) {
  const raw = readJson(activeSkillRegistryPath(learnerDir), { schemaVersion: 1, skills: [] });
  return {
    schemaVersion: 1,
    generatedAt: raw.generatedAt || null,
    skills: Array.isArray(raw.skills) ? raw.skills.filter((item) => item && item.id) : [],
  };
}

export function saveActiveSkills(learnerDir, registry) {
  const normalized = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    skills: Array.isArray(registry.skills) ? registry.skills.filter((item) => item && item.id) : [],
  };
  return writeStore(activeSkillRegistryPath(learnerDir), normalized);
}
