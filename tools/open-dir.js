import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { learnerDir as resolveLearnerDir } from "../lib/common.js";
import { defineTool } from "../lib/hana-runtime-compat.js";

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
      const cmd = process.platform === "win32"
        ? `explorer "${dataDir}"`
        : process.platform === "darwin"
          ? `open "${dataDir}"`
          : `xdg-open "${dataDir}"`;

      exec(cmd, (err) => {
        if (err) {
          resolve(JSON.stringify({
            ok: false,
            error: `Failed to open directory: ${err.message}`,
            path: dataDir,
            hint: `You can manually open: ${dataDir}`,
          }));
        } else {
          const files = fs.readdirSync(dataDir).filter(f => !f.startsWith("."));
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
