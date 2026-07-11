import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { parseToolResult } from "./_test-utils.js";

function writePinnedMemory(home, agent, content) {
  const agentDir = path.join(home, "agents", agent);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "pinned-memory.json"), JSON.stringify({
    version: 1,
    items: [{ id: "pin", content }],
  }), "utf-8");
}

test("self_learning_search binds official memory to the invoking Agent", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "search-official-memory-"));
  const previousHome = process.env.HANA_HOME;
  try {
    process.env.HANA_HOME = home;
    fs.mkdirSync(path.join(home, "self-learning"), { recursive: true });
    writePinnedMemory(home, "hanako", "Shared review workflow for Hanako.");
    writePinnedMemory(home, "yolo-paper", "Shared review workflow for Yolo paper.");

    const searchTool = await import(`../tools/search.js?official-project-${Date.now()}`);
    const result = parseToolResult(await searchTool.execute({
      query: "shared review workflow",
      project: "unrelated-project-name",
      limit: 5,
    }, { agentId: "hanako" }));

    assert.equal(result.ok, true);
    assert.ok(result.officialMemory.length >= 1);
    assert.equal(result.officialMemoryStats.lastResultCount, result.officialMemory.length);
    assert.ok(result.officialMemoryStats.lastSearchMs >= 0);
    assert.deepEqual([...new Set(result.officialMemory.map((entry) => entry.agent))], ["hanako"]);
  } finally {
    if (previousHome === undefined) delete process.env.HANA_HOME;
    else process.env.HANA_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
