export function createOnloadTimer(ctx = {}, { now = () => performance.now() } = {}) {
  const debug = typeof ctx?.log?.debug === "function" ? ctx.log.debug.bind(ctx.log) : null;
  const startedAt = now();
  let lastAt = startedAt;
  const marks = [];

  function mark(name) {
    const current = now();
    const entry = {
      name,
      ms: current - lastAt,
      totalMs: current - startedAt,
    };
    marks.push(entry);
    lastAt = current;
    if (debug) {
      debug(`runtime-learner: onload timing ${name} ${entry.ms.toFixed(2)}ms total=${entry.totalMs.toFixed(2)}ms`);
    }
    return entry;
  }

  return {
    mark,
    summary() {
      return {
        totalMs: lastAt - startedAt,
        marks: marks.map((entry) => ({ ...entry })),
      };
    },
  };
}
