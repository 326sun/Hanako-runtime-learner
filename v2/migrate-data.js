import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function migrateLegacyData({ source, target, apply = false }) {
  const from = fs.realpathSync(path.resolve(source));
  const requestedTarget = path.resolve(target);
  let ancestor = path.dirname(requestedTarget);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const to = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, requestedTarget));
  const inside = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)); };
  if (inside(from, to) || inside(to, from)) throw new Error("Source and target must be separate directories");
  if (fs.existsSync(to) && (fs.lstatSync(to).isSymbolicLink() || fs.readdirSync(to).length)) throw new Error("Target must be absent or empty; existing App data will never be overwritten");
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.endsWith(".tmp") || entry.name.endsWith(".lock")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlinks are not accepted in a data migration");
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /\.(?:json|jsonl|md|enc)$/.test(entry.name)) {
        const stat = fs.statSync(full);
        files.push({ relative: path.relative(from, full), size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  };
  visit(from);
  if (!files.some((file) => ["patterns.json", "facts.json"].includes(file.relative))) throw new Error("Source has no patterns.json or facts.json; verify the legacy data directory");
  const result = { source: from, target: to, files: files.length, bytes: files.reduce((n, file) => n + file.size, 0), applied: false };
  if (!apply) return result;
  const stage = `${to}.migrating-${randomUUID()}`;
  fs.mkdirSync(stage, { recursive: true });
  try {
    for (const file of files) {
      const src = path.join(from, file.relative), dest = path.join(stage, file.relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const content = fs.readFileSync(src);
      if (file.relative.endsWith(".json")) JSON.parse(content.toString("utf8"));
      fs.writeFileSync(dest, content);
    }
    for (const file of files) {
      const stat = fs.statSync(path.join(from, file.relative));
      if (stat.size !== file.size || stat.mtimeMs !== file.mtimeMs) throw new Error("Legacy data changed during copying; disable v1 and retry");
    }
    if (fs.existsSync(to)) {
      if (fs.lstatSync(to).isSymbolicLink()) throw new Error("Target changed into a symlink; refusing migration");
      fs.rmdirSync(to); // only an empty target, never recursive
    }
    fs.renameSync(stage, to);
    return { ...result, applied: true };
  } finally {
    // stage is a unique sibling created by this function and checked above.
    if (fs.existsSync(stage) && path.dirname(stage) === path.dirname(to)) fs.rmSync(stage, { recursive: true, force: true });
  }
}
