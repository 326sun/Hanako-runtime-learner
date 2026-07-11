import crypto from "crypto";
import fs from "fs";
import path from "path";

import { safeFileSlug } from "./json-io.js";

export function entityFileNames(value, { fallback = "entity", max = 180 } = {}) {
  const raw = String(value || fallback);
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  const prefix = safeFileSlug(raw, fallback, Math.max(1, max - hash.length - 1));
  return {
    current: `${prefix}-${hash}.json`,
    legacy: `${safeFileSlug(raw, fallback, max)}.json`,
  };
}

export function entityFilePath(dir, value, options = {}) {
  return path.join(dir, entityFileNames(value, options).current);
}

export function resolveEntityFilePath(dir, value, { idField = "id", ...options } = {}) {
  const names = entityFileNames(value, options);
  const current = path.join(dir, names.current);
  if (fs.existsSync(current)) return current;
  const legacy = path.join(dir, names.legacy);
  try {
    const parsed = JSON.parse(fs.readFileSync(legacy, "utf-8"));
    if (parsed?.[idField] === value) return legacy;
  } catch {}
  return current;
}

export function cleanupMatchingLegacyEntityFile(dir, value, { idField = "id", ...options } = {}) {
  const names = entityFileNames(value, options);
  if (names.current === names.legacy) return;
  const legacy = path.join(dir, names.legacy);
  try {
    const parsed = JSON.parse(fs.readFileSync(legacy, "utf-8"));
    if (parsed?.[idField] === value) fs.rmSync(legacy, { force: true });
  } catch {}
}
