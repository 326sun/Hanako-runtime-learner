import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { runPluginFunctionInChild } from "../lib/plugin-process-runner.js";

test("plugin child process result marks implicit workspaceRoot fallback", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-process-runner-"));
  const modulePath = path.join(dir, "execute.js");
  fs.writeFileSync(
    modulePath,
    "export async function execute(_plan, context) { return { workspaceRootImplicit: context.pluginProcess.workspaceRootImplicit }; }\n",
    "utf-8",
  );

  try {
    const result = await runPluginFunctionInChild({
      modulePath,
      exportName: "execute",
      actionPlan: { plan: { actionType: "test" } },
      context: {},
      definition: { name: "test" },
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.workspaceRootImplicit, true);
    assert.match(result.warnings?.[0] || "", /workspaceRoot not supplied/);
    assert.equal(result.result.workspaceRootImplicit, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
