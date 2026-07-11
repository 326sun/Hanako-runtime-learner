import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendEvent, archiveEventLog, readEvents, verifyEventLog } from "../lib/event-log.js";

describe("event log archive", () => {
  it("preserves the hash chain and makes sparse old filtered events reachable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "event-archive-"));
    for (let i = 0; i < 15; i++) {
      appendEvent(dir, {
        type: i === 1 ? "feedback.memory_injected" : "proposal.created",
        entityType: "pattern",
        entityId: i === 1 ? "old-sparse" : `p${i}`,
        summary: `event ${i}`,
      });
    }
    const archived = archiveEventLog(dir, { segmentEvents: 5, keepActiveEvents: 5 });
    assert.equal(archived.archived, 5);
    assert.equal(archived.active, 10);
    assert.equal(verifyEventLog(dir).ok, true);
    const sparse = readEvents(dir, { type: "feedback.memory_injected", limit: 10 });
    assert.equal(sparse.length, 1);
    assert.equal(sparse[0].entityId, "old-sparse");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
