import { normalizeSeenIds } from "./helpers.js";

export function createSeenIdStore(initialIds = [], {
  cap = 5000,
  flushIntervalMs = 10_000,
  persist = () => {},
  now = () => Date.now(),
} = {}) {
  const ids = new Set(normalizeSeenIds(initialIds, { cap }));
  let dirty = false;
  let lastFlushAt = 0;

  const evictIfNeeded = () => {
    if (ids.size <= cap) return;
    const toRemove = Math.ceil(cap * 0.2);
    const iter = ids.values();
    for (let i = 0; i < toRemove; i += 1) ids.delete(iter.next().value);
  };

  return {
    has(id) {
      return !!id && ids.has(id);
    },
    add(id) {
      if (!id || ids.has(id)) return false;
      ids.add(id);
      evictIfNeeded();
      dirty = true;
      return true;
    },
    flush(force = false) {
      if (!dirty) return false;
      const timestamp = now();
      if (!force && timestamp - lastFlushAt < flushIntervalMs) return false;
      persist([...ids]);
      dirty = false;
      lastFlushAt = timestamp;
      return true;
    },
    values() {
      return [...ids];
    },
  };
}
