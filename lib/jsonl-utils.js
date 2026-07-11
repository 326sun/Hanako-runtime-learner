import fs from "fs";

export function readJsonlTailSample(file, { maxLines = 200, initialBytes = 64 * 1024, maxBytes = 1024 * 1024 } = {}) {
  const wanted = Math.max(1, Number(maxLines) || 1);
  try {
    if (!fs.existsSync(file)) return { lines: [], complete: true, lineCount: 0 };
    const size = fs.statSync(file).size;
    if (size === 0) return { lines: [], complete: true, lineCount: 0 };
    let length = Math.min(size, Math.max(1024, Number(initialBytes) || 64 * 1024));
    const ceiling = Math.min(size, Math.max(length, Number(maxBytes) || 1024 * 1024));
    for (;;) {
      const start = Math.max(0, size - length);
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(file, "r");
      let startsAtLineBoundary = start === 0;
      try {
        if (start > 0) {
          const previous = Buffer.allocUnsafe(1);
          startsAtLineBoundary = fs.readSync(fd, previous, 0, 1, start - 1) === 1 && previous[0] === 10;
        }
        fs.readSync(fd, buffer, 0, length, start);
      } finally { fs.closeSync(fd); }
      let lines = buffer.toString("utf-8").split("\n");
      // Drop the leading partial line before filtering. If the window begins
      // exactly on a newline, the first item is empty; filtering first would
      // remove it and then shift away the first complete JSONL record.
      if (start > 0 && !startsAtLineBoundary && lines.length > 0) lines.shift();
      lines = lines.filter((line) => /[^\r]/.test(line));
      if (start === 0 || lines.length >= wanted || length >= ceiling) {
        return {
          lines: lines.slice(-wanted),
          complete: start === 0,
          lineCount: start === 0 ? lines.length : null,
        };
      }
      length = Math.min(size, length * 2, ceiling);
    }
  } catch {
    return { lines: [], complete: false, lineCount: null };
  }
}

export function readJsonlTailLines(file, options = {}) {
  return readJsonlTailSample(file, options).lines;
}
