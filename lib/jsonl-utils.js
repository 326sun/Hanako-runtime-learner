import fs from "fs";

export function readJsonlTailLines(file, { maxLines = 200, initialBytes = 64 * 1024, maxBytes = 1024 * 1024 } = {}) {
  const wanted = Math.max(1, Number(maxLines) || 1);
  try {
    if (!fs.existsSync(file)) return [];
    const size = fs.statSync(file).size;
    if (size === 0) return [];
    let length = Math.min(size, Math.max(1024, Number(initialBytes) || 64 * 1024));
    const ceiling = Math.min(size, Math.max(length, Number(maxBytes) || 1024 * 1024));
    for (;;) {
      const start = Math.max(0, size - length);
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(file, "r");
      try { fs.readSync(fd, buffer, 0, length, start); } finally { fs.closeSync(fd); }
      let lines = buffer.toString("utf-8").split("\n").filter(Boolean);
      if (start > 0 && lines.length > 0) lines.shift();
      if (start === 0 || lines.length >= wanted || length >= ceiling) return lines.slice(-wanted);
      length = Math.min(size, length * 2, ceiling);
    }
  } catch {
    return [];
  }
}

export function readJsonlTail(file, options = {}) {
  const rows = [];
  for (const line of readJsonlTailLines(file, options)) {
    try { rows.push(JSON.parse(line)); } catch {}
  }
  return rows;
}
