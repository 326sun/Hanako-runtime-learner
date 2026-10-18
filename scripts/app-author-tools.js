import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function runAppAuthorTool(tool, args) {
  const hostRoot = process.env.HANA_APP_TOOLS_ROOT;
  if (!hostRoot) throw new Error("Set HANA_APP_TOOLS_ROOT to the installed Hana server directory containing APPS.md and scripts/.");
  const script = path.join(hostRoot, "scripts", tool);
  if (!fs.existsSync(script)) throw new Error(`Official author tool missing: ${script}`);
  const embeddedNode = path.join(hostRoot, process.platform === "win32" ? "hana-server.exe" : "node");
  const result = spawnSync(fs.existsSync(embeddedNode) ? embeddedNode : process.execPath, [script, ...args],
    { cwd: projectRoot, stdio: "inherit", env: { ...process.env, HANA_ROOT: hostRoot }, windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
