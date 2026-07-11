import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { entityFileNames, resolveEntityFilePath } from "../lib/entity-file.js";

describe("entity file identity", () => {
  it("adds an original-id hash so lossy slugs cannot collide", () => {
    assert.notEqual(entityFileNames("a:b").current, entityFileNames("a/b").current);
  });

  it("reads a legacy slug only when the stored entity id matches", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entity-file-"));
    const legacy = path.join(dir, entityFileNames("a:b").legacy);
    fs.writeFileSync(legacy, JSON.stringify({ id: "a:b" }), "utf-8");
    assert.equal(resolveEntityFilePath(dir, "a:b"), legacy);
    assert.notEqual(resolveEntityFilePath(dir, "a/b"), legacy);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
