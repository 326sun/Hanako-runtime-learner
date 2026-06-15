import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryIndex } from "../lib/memory-index.js";

describe("MemoryIndex", () => {
  it("filters candidates with requireAnyToken before scoring", () => {
    const index = new MemoryIndex().rebuild([
      { id: "weak", desc: "alpha" },
      { id: "strong", desc: "alpha beta" },
    ]);

    const results = index.search(["alpha"], { requireAnyToken: ["beta"] });

    assert.deepEqual(results.map((r) => r.id), ["strong"]);
  });

  it("removes postings when documents are removed", () => {
    const index = new MemoryIndex().rebuild([
      { id: "one", desc: "alpha beta" },
    ]);

    index.remove("one");

    assert.deepEqual(index.search("alpha"), []);
    assert.equal(index.size, 0);
  });
});
