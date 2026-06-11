import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSeenIdStore } from "../lib/seen-id-store.js";

describe("createSeenIdStore", () => {
  test("deduplicates ids and force-flushes persisted state", () => {
    const writes = [];
    const store = createSeenIdStore(["a"], { persist: (ids) => writes.push(ids) });
    assert.equal(store.has("a"), true);
    assert.equal(store.add("a"), false);
    assert.equal(store.add("b"), true);
    assert.equal(store.flush(true), true);
    assert.deepEqual(writes, [["a", "b"]]);
  });

  test("throttles non-forced flushes", () => {
    const writes = [];
    let currentTime = 1000;
    const store = createSeenIdStore([], {
      flushIntervalMs: 10_000,
      now: () => currentTime,
      persist: (ids) => writes.push(ids),
    });
    store.add("a");
    assert.equal(store.flush(), false);
    currentTime += 10_000;
    assert.equal(store.flush(), true);
    assert.deepEqual(writes, [["a"]]);
  });

  test("caps persisted ids by evicting oldest entries", () => {
    const store = createSeenIdStore(["a", "b", "c"], { cap: 3, persist: () => {} });
    assert.equal(store.add("d"), true);
    assert.deepEqual(store.values(), ["b", "c", "d"]);
  });
});
