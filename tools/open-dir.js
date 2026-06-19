import { execFile } from "child_process";
import fs from "fs";
import { learnerDir as resolveLearnerDir } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";

export function openDirectoryCommand(dataDir, platform = process.platform) {
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", dataDir], options: { windowsHide: true } };
  if (platform === "darwin") return { command: "open", args: [dataDir], options: {} };
  return { command: "xdg-open", args: [dataDir], options: {} };
}

const tool = defineTool({
  name: "self_learning_open_dir",
  description: "Open the self-learning data directory in the system file manager, so you can browse all logs, patterns, and activity records.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    const dataDir = resolveLearnerDir();
    if (!fs.existsSync(dataDir)) {
      return JSON.stringify({ ok: false, error: `Data directory not found: ${dataDir}` });
    }

    return new Promise((resolve) => {
      const spec = openDirectoryCommand(dataDir);
      execFile(spec.command, spec.args, spec.options, (err) => {
        const files = fs.readdirSync(dataDir).filter(f => !f.startsWith("."));
        if (err) {
          resolve(JSON.stringify({
            ok: false,
            error: `Failed to open directory: ${err.message}`,
            path: dataDir,
            files: files.slice(0, 20),
            fileCount: files.length,
            command: spec.command,
            args: spec.args,
            hint: `You can manually open: ${dataDir}`,
          }));
        } else {
          resolve(JSON.stringify({
            ok: true,
            path: dataDir,
            files: files.slice(0, 20),
            fileCount: files.length,
          }));
        }
      });
    });
  },
});

export const { name, description, parameters, execute } = tool;
