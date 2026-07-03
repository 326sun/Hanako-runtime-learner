import fs from "fs";

const jsonCache = new Map();

function fileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

export function clearFileCache(filePath = null) {
  if (filePath) jsonCache.delete(filePath);
  else jsonCache.clear();
}

export function fileCacheStats() {
  return { entries: jsonCache.size };
}

export function readJsonCached(filePath, fallback, { maxAgeMs = 0 } = {}) {
  const now = Date.now();
  const signature = fileSignature(filePath);
  const cached = jsonCache.get(filePath);
  if (cached && cached.signature === signature && (!maxAgeMs || now - cached.readAt <= maxAgeMs)) {
    return cached.value;
  }

  let value = fallback;
  try {
    if (fs.existsSync(filePath)) value = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    value = fallback;
  }
  jsonCache.set(filePath, { signature, readAt: now, value });
  return value;
}
