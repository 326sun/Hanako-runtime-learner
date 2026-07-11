import fs from "fs";
import path from "path";

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_POLL_MS = 10;
const STALE_LOCK_MS = 30_000;

function pause(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* synchronous fallback */ }
  }
}

/**
 * Serialize a short, synchronous read-modify-write critical section across
 * Node processes. Atomic rename prevents torn files; this lock prevents lost
 * updates caused by two otherwise-valid whole-file snapshots racing to rename.
 *
 * The callback must remain synchronous. Keeping the critical section free of
 * awaits is deliberate: no lock holder can be suspended behind host I/O.
 */
export function withDataLock(baseDir, name, fn, {
  timeoutMs = LOCK_TIMEOUT_MS,
  staleMs = STALE_LOCK_MS,
} = {}) {
  fs.mkdirSync(baseDir, { recursive: true });
  const safeName = String(name || "state").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const lockFile = path.join(baseDir, `.${safeName}.lock`);
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      try {
        return fn();
      } finally {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(lockFile); } catch {}
      }
    } catch (err) {
      lastError = err;
      // Only a failed create may be retried. Errors thrown by the protected
      // callback are real operation errors and must propagate unchanged.
      // Windows can surface a transient EPERM while another process closes or
      // unlinks a lock that we are concurrently trying to create. The unlink
      // can win before existsSync runs, so an existence check turns that normal
      // contention window into a flaky hard failure. Retry EPERM through the
      // same bounded acquisition deadline; a persistent ACL/path error still
      // fails deterministically as a lock-acquisition timeout.
      const contended = err?.code === "EEXIST" || err?.code === "EPERM";
      if (!contended) throw err;
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > staleMs) {
          fs.unlinkSync(lockFile);
          continue;
        }
      } catch { /* a competing releaser/reclaimer won; retry */ }
      pause(LOCK_POLL_MS);
    }
  }
  throw new Error(`data lock acquisition timed out for ${safeName}: ${lastError?.message || "unknown"}`);
}
