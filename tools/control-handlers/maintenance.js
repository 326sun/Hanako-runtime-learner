// Maintenance / config / skill-lifecycle control handlers (S2.P2c split —
// subsystem-simplify-v5.1.6).
//
// Extracted verbatim from tools/control.js. These handlers mutate local plugin
// state (config, skill file, memfs, policy profile, trusted-script fingerprint).
// They own NO permission/side-effect decisions — control.js keeps the action
// dispatch, the *_ACTIONS classification sets, describeControlSideEffect and
// sessionPermission.
//
// buildSkill/regenerateSkill are exported (not just used internally) because
// three handlers that remain in tools/control.js — approve, reject, and
// run_model_advisor — also call regenerateSkill. Per the S2.P1 ownership
// findings (subsystem-simplify-v5.1.6-S2-P1.md, "Deviation Note"), control.js
// re-imports regenerateSkill from here rather than each module keeping its own
// copy of buildSkillMdFromPatterns/writeSkillIfChanged wiring.

import fs from "fs";
import path from "path";
import { DEFAULT_CONFIG, writeJson, buildSkillMdFromPatterns, mergeConfig } from "../../lib/common.js";
import { writeSkillIfChanged } from "../../lib/skill-lifecycle.js";
import { generateMemFS } from "../../lib/memfs.js";
import { applyPolicyProfile } from "../../lib/policy-profiles.js";
import { extractAndSaveCredentials, sanitizeCredentialPatch } from "../../lib/credentials.js";
import { validateConfigPatch } from "../../lib/validation-gate.js";
import { projectScriptsFingerprint } from "../../lib/project-script-trust.js";
import { appendEvent } from "../../lib/event-log.js";
import { redactConfig } from "../control-summaries.js";

const MAX_SKILL_HISTORY = 20;

export function buildSkill(patterns, config, learnerDir) {
  return buildSkillMdFromPatterns(patterns, config, { dataDir: learnerDir });
}

export function regenerateSkill(pathsValue, patterns, config) {
  return writeSkillIfChanged(
    pathsValue.skillPath,
    buildSkill(patterns, config, pathsValue.learnerDir),
    pathsValue.historyDir,
    { keep: MAX_SKILL_HISTORY },
  );
}

export const maintenanceHandlers = {
  set_config(input, p, config, patterns) {
    fs.mkdirSync(p.learnerDir, { recursive: true });
    fs.mkdirSync(p.historyDir, { recursive: true });
    const patch = {};
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = input[key];
    }
    const sanitisedPatch = sanitizeCredentialPatch(patch);
    const validation = validateConfigPatch(sanitisedPatch, config);
    if (!validation.ok) {
      const failures = validation.checks.filter((c) => c.status === "fail").map((c) => c.name).join(", ");
      throw new Error(`config validation failed: ${failures}`);
    }
    extractAndSaveCredentials(patch);
    const next = mergeConfig(config, sanitisedPatch);
    writeJson(p.configPath, next);
    regenerateSkill(p, patterns, next);
    return JSON.stringify({ ok: true, config: redactConfig(next), validation }, null, 2);
  },

  rollback(input, p, config) {
    const history = fs.readdirSync(p.historyDir).filter((n) => n.endsWith("-SKILL.md")).sort();
    if (!history.length) throw new Error("no skill history to roll back");
    const target = input.id ? history.find((n) => n.includes(input.id)) : history.at(-1);
    if (!target) throw new Error(`snapshot not found: ${input.id}`);
    const src = path.join(p.historyDir, target);
    fs.copyFileSync(src, p.skillPath);
    appendEvent(p.learnerDir, { type: "skill.rolled_back", entityType: "skill", entityId: target, summary: `Rolled back skill to ${target}` });
    return JSON.stringify({ ok: true, snapshot: target }, null, 2);
  },

  regenerate_skill(input, p, config, patterns) {
    const result = regenerateSkill(p, patterns, config);
    appendEvent(p.learnerDir, { type: "skill.regenerated", entityType: "skill", entityId: "SKILL.md", summary: result.changed ? "Skill regenerated (content changed)" : "Skill unchanged" });
    return JSON.stringify({ ok: true, changed: result.changed, snapshotPath: result.snapshotPath }, null, 2);
  },

  regenerate_memfs(input, p, config, patterns) {
    const result = generateMemFS(p.learnerDir, { patterns, config });
    return JSON.stringify({ ok: true, ...result }, null, 2);
  },

  set_policy_profile(input, p, config, patterns) {
    const profileName = input.governanceProfile || input.id || "balanced";
    const result = applyPolicyProfile(config, profileName);
    if (!result.ok) throw new Error(result.error);
    writeJson(p.configPath, result.config);
    appendEvent(p.learnerDir, { type: "policy.applied", entityType: "config", entityId: "governanceProfile", summary: `Applied governance profile: ${result.profile}`, data: { profile: result.profile, changed: result.changed } });
    regenerateSkill(p, patterns, result.config);
    return JSON.stringify({ ok: true, profile: result.profile, changed: result.changed, config: result.config, nextAction: "doctor" }, null, 2);
  },

  trust_project_scripts(input, p, config) {
    const wsRoot = input.workspaceRoot ? path.resolve(input.workspaceRoot) : process.cwd();
    const fingerprint = projectScriptsFingerprint(wsRoot);
    if (!Object.keys(fingerprint.scripts).length) {
      throw new Error("no scripts found in package.json at " + wsRoot);
    }
    const current = mergeConfig(config);
    const next = mergeConfig(current, {
      autoActionCommands: {
        ...(current.autoActionCommands || {}),
        allowProjectScripts: true,
        projectScripts: { scriptsHash: fingerprint.scriptsHash },
      },
    });
    writeJson(p.configPath, next);
    appendEvent(p.learnerDir, {
      type: "trust.project_scripts_approved",
      entityType: "config",
      entityId: "projectScripts",
      summary: `Trusted project scripts hash: ${fingerprint.scriptsHash.slice(0, 16)} at ${fingerprint.packageJsonPath}`,
      data: { scriptsHash: fingerprint.scriptsHash, packageJsonPath: fingerprint.packageJsonPath, scriptNames: Object.keys(fingerprint.scripts) },
    });
    return JSON.stringify({ ok: true, scriptsHash: fingerprint.scriptsHash, packageJsonPath: fingerprint.packageJsonPath, scripts: fingerprint.scripts, nextAction: "npm test or npm run check can now execute automatically" }, null, 2);
  },
};
