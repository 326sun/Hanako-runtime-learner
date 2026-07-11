import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { execute as executeSearch } from "../tools/search.js";

test("self_learning_search supports an explicit localhost HTTP embedding endpoint", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-semantic-http-"));
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const input = JSON.parse(body).input || [];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: input.map(() => ({ embedding: [1, 0] })) }));
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    fs.writeFileSync(path.join(dataDir, "runtime-config.json"), JSON.stringify({
      semanticSearchEnabled: true,
      semanticEmbeddingBaseUrl: `http://127.0.0.1:${port}`,
      semanticEmbeddingModel: "local-test",
      officialMemoryBridgeEnabled: false,
    }), "utf-8");
    fs.writeFileSync(path.join(dataDir, "patterns.json"), JSON.stringify([{
      id: "workflow:semantic-http",
      type: "workflow",
      status: "approved",
      score: 20,
      count: 5,
      desc: "semantic localhost search",
      scope: { project: "general", taskType: "general" },
      lastSeen: new Date().toISOString(),
    }]), "utf-8");

    const result = await executeSearch({ query: "semantic localhost", limit: 5 }, { dataDir, agentId: "hana" });
    assert.equal(requests, 1);
    assert.match(result.details.strategy, /^rrf\(/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
