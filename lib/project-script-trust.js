import fs from "fs";
import path from "path";
import crypto from "crypto";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function projectScriptName(command = "") {
  const normalized = String(command || "").trim();
  if (/^npm\s+test\b/i.test(normalized)) return "test";
  const match = normalized.match(/^npm\s+run\s+([a-zA-Z0-9:_-]+)\b/i);
  return match ? match[1] : null;
}

export function isProjectScriptCommand(command = "") {
  return projectScriptName(command) !== null;
}

export function packageJsonPath(workspaceRoot = process.cwd()) {
  return path.join(path.resolve(workspaceRoot || process.cwd()), "package.json");
}

export function readPackageScripts(workspaceRoot = process.cwd()) {
  const pkg = readJson(packageJsonPath(workspaceRoot), {});
  const scripts = pkg && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? pkg.scripts : {};
  return Object.fromEntries(Object.entries(scripts).filter(([, value]) => typeof value === "string"));
}

export function hashPackageScripts(scripts = {}) {
  return crypto.createHash("sha256").update(stableJson(scripts)).digest("hex");
}

export function projectScriptsFingerprint(workspaceRoot = process.cwd()) {
  const scripts = readPackageScripts(workspaceRoot);
  return { packageJsonPath: packageJsonPath(workspaceRoot), scripts, scriptsHash: hashPackageScripts(scripts) };
}

function trustedHashes(policy = {}) {
  const trust = policy?.commands?.projectScripts || policy?.projectScripts || {};
  return new Set([
    ...(Array.isArray(trust.trustedHashes) ? trust.trustedHashes : []),
    ...(trust.scriptsHash ? [trust.scriptsHash] : []),
    ...(policy?.commands?.trustedProjectScriptHashes || []),
  ].map(String).filter(Boolean));
}

export function validateProjectScriptTrust(command, { cwd = process.cwd(), policy = {} } = {}) {
  const scriptName = projectScriptName(command);
  if (!scriptName) return { ok: true, projectScript: false };
  if (policy?.commands?.allowProjectScripts !== true) {
    return { ok: false, projectScript: true, decision: "reject", reason: "project npm scripts require explicit project-script permission" };
  }
  const fingerprint = projectScriptsFingerprint(cwd);
  if (!fingerprint.scripts[scriptName]) {
    return { ok: false, projectScript: true, decision: "reject", reason: `package.json script not found: ${scriptName}`, ...fingerprint, scriptName };
  }
  const hashes = trustedHashes(policy);
  if (hashes.size === 0) {
    return { ok: false, projectScript: true, decision: "manual_confirm", reason: "project scripts hash has not been approved", ...fingerprint, scriptName };
  }
  if (!hashes.has(fingerprint.scriptsHash)) {
    return { ok: false, projectScript: true, decision: "manual_confirm", reason: "package.json scripts changed since approval", ...fingerprint, scriptName };
  }
  return { ok: true, projectScript: true, decision: "allow", reason: "project scripts hash trusted", ...fingerprint, scriptName };
}
