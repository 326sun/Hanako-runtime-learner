import { execFile } from "child_process";
import fs from "fs";
import { learnerDir as resolveLearnerDir } from "../lib/common.js";

export function openDirectoryCommand(dataDir, platform = process.platform) {
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", dataDir], options: { windowsHide: true } };
  if (platform === "darwin") return { command: "open", args: [dataDir], options: {} };
  return { command: "xdg-open", args: [dataDir], options: {} };
}

export const name = "self_learning_open_dir";

export const description = "Open the self-learning data directory in the system file manager, so you can browse all logs, patterns, and activity records.";

export const sessionPermission = {
  kind: "external_side_effect",
  describeSideEffect: () => ({
    kind: "open_system_file_manager",
    summary: "Open the runtime learner data directory in the system file manager.",
    ruleId: "runtime-learner-open-dir",
  }),
};

export const parameters = {
  type: "object",
  properties: {},
};

export async function execute(input, ctx) {
  const dataDir = ctx?.dataDir || resolveLearnerDir();
  if (!fs.existsSync(dataDir)) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Data directory not found: ${dataDir}` }) }] };
  }

  return new Promise((resolve) => {
    const spec = openDirectoryCommand(dataDir);
    execFile(spec.command, spec.args, spec.options, (err) => {
      const files = fs.readdirSync(dataDir).filter(f => !f.startsWith("."));
      const result = err
        ? { ok: false, error: `Failed to open directory: ${err.message}`, path: dataDir, files: files.slice(0, 20), fileCount: files.length, hint: `You can manually open: ${dataDir}` }
        : { ok: true, path: dataDir, files: files.slice(0, 20), fileCount: files.length };
      resolve({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result });
    });
  });
}
