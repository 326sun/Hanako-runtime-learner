import fs from "fs";
import path from "path";
import { learnerDir, readJson, writeJson } from "./common.js";
import { appendEvent } from "./event-log.js";

export function skillRegistryPath(baseDir = learnerDir()) {
  return path.join(baseDir, "skill_registry.json");
}

export function loadSkillRegistry(baseDir = learnerDir()) {
  return readJson(skillRegistryPath(baseDir), {}) || {};
}

export function saveSkillRegistry(baseDir, registry) {
  writeJson(skillRegistryPath(baseDir), registry);
  return registry;
}

export function updateSkillState(baseDir, skillPath, state = {}) {
  const registry = loadSkillRegistry(baseDir);
  const key = skillPath || "skills/self-learning/SKILL.md";
  const next = {
    status: "active",
    version: null,
    firstSeenAt: new Date().toISOString(),
    ...(registry[key] || {}),
    ...state,
    updatedAt: new Date().toISOString(),
  };
  registry[key] = next;
  saveSkillRegistry(baseDir, registry);
  appendEvent(baseDir, {
    type: `skill.${next.status || "updated"}`,
    entityType: "skill",
    entityId: key,
    summary: `Skill ${next.status || "updated"}: ${key}`,
    data: next,
  });
  return next;
}
