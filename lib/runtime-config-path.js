/**
 * Runtime config file location + one-time migration.
 *
 * Hanako v0.341+ hands the plugin a host-managed data directory via
 * `ctx.dataDir` and *also* owns `<dataDir>/config.json` for its own plugin
 * config store (core/plugin-config.ts persists it as
 * `{ schemaVersion, global, agents, sessions }`). This plugin maintains its own
 * flat runtime config; if it kept using `config.json` the two writers would
 * clobber each other in the same file. So the plugin's private config lives in
 * `runtime-config.json` and `config.json` is reserved for the host.
 *
 * On older hosts `ctx.dataDir` was the legacy `HANA_HOME/self-learning` dir and
 * the plugin's flat config sat in `config.json` there. `migrateRuntimeConfigFile`
 * moves that legacy flat file to `runtime-config.json` exactly once, and never
 * touches a `config.json` that is in the host's `{global,...}` shape.
 */
import fs from "fs";
import path from "path";

export const RUNTIME_CONFIG_FILENAME = "runtime-config.json";
const HOST_CONFIG_FILENAME = "config.json";

export function runtimeConfigPath(dataDir) {
  return path.join(dataDir, RUNTIME_CONFIG_FILENAME);
}

// Mirror the host's own shape detection (core/plugin-config.ts normalizeState):
// a config.json with any of these top-level keys belongs to the host store.
function isHostConfigShape(parsed) {
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && ("global" in parsed || "agents" in parsed || "sessions" in parsed || "schemaVersion" in parsed);
}

/**
 * Idempotent one-time migration of the legacy flat `config.json` to
 * `runtime-config.json`. Returns `{ migrated, reason }`. Never throws and never
 * clobbers a host-owned `config.json`.
 */
export function migrateRuntimeConfigFile(dataDir) {
  if (!dataDir) return { migrated: false, reason: "no-data-dir" };
  const newPath = path.join(dataDir, RUNTIME_CONFIG_FILENAME);
  const legacyPath = path.join(dataDir, HOST_CONFIG_FILENAME);
  if (fs.existsSync(newPath)) return { migrated: false, reason: "already-migrated" };
  if (!fs.existsSync(legacyPath)) return { migrated: false, reason: "no-legacy-file" };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
  } catch {
    // Unreadable/corrupt legacy file: leave it in place and let loadConfig start
    // a fresh runtime-config.json (it has its own corrupt-file handling).
    return { migrated: false, reason: "legacy-unreadable" };
  }

  if (isHostConfigShape(parsed)) {
    // config.json is the Hanako host's plugin config store — never move it.
    return { migrated: false, reason: "host-owned-config" };
  }

  // Legacy flat plugin config: move it to the private filename so config.json is
  // free for the host store. rename is atomic on the same volume (always the
  // case here — same directory); copy+remove is a defensive fallback.
  try {
    fs.renameSync(legacyPath, newPath);
    return { migrated: true, reason: "moved-legacy-flat-config" };
  } catch {
    try {
      fs.writeFileSync(newPath, `${JSON.stringify(parsed, null, 2)}\n`);
      fs.rmSync(legacyPath, { force: true });
      return { migrated: true, reason: "copied-legacy-flat-config" };
    } catch {
      return { migrated: false, reason: "migration-failed" };
    }
  }
}
