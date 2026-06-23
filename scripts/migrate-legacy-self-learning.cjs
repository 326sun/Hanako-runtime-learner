#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const home = os.homedir();
const legacyDir = path.join(home, '.hanako', 'self-learning');
const targetDir = path.join(home, '.hanako', 'plugin-data', 'hanako-runtime-learner');
const dryRun = process.argv.includes('--dry-run');
const apply = process.argv.includes('--apply');
if (!dryRun && !apply) {
  console.error('Usage: node scripts/migrate-legacy-self-learning.cjs --dry-run|--apply');
  process.exit(2);
}

const now = new Date().toISOString();
const stamp = now.replace(/[:.]/g, '-');
const backupRoot = path.join(home, '.hanako', 'migration-backups', `hanako-runtime-learner-${stamp}`);

const jsonFilesMergeById = [
  'patterns.json',
  'facts.json',
  'skill_registry.json',
  'active_skills.json',
];
const jsonlFilesMergeByLineHash = [
  'experience_log.jsonl',
  'error_log.jsonl',
  'turns.jsonl',
  'activity_log.jsonl',
  'episodes.jsonl',
  'action_feedback.jsonl',
];
const jsonObjectPreferTarget = [
  'usage_seen.json',
  'host_capabilities.json',
  'usage_summary.json',
  'model_advice.json',
  'model_advice_state.json',
  'action_policy_weights.json',
  'embeddings_cache.json',
];
const dirsCopyMissing = [
  'proposals',
  'reviews',
  'skill_history',
  'audit',
  'audit-dashboard',
  'release-readiness',
  'benchmark-healthcheck',
  'benchmark-healthcheck-after-fix',
  'benchmark-healthcheck-direct-import',
  'benchmark-healthcheck-post-restart',
];

function exists(p) { return fs.existsSync(p); }
function ensureDir(p) { if (!dryRun) fs.mkdirSync(p, { recursive: true }); }
function readJson(file, fallback) {
  try { return exists(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch { return fallback; }
}
function writeJson(file, value) {
  ensureDir(path.dirname(file));
  if (!dryRun) fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function hashText(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function fileHash(file) {
  if (!exists(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function countLines(file) {
  if (!exists(file)) return 0;
  const text = fs.readFileSync(file, 'utf8');
  if (!text) return 0;
  return text.split(/\r?\n/).filter(Boolean).length;
}
function copyRecursive(src, dst) {
  if (!exists(src)) return;
  ensureDir(path.dirname(dst));
  if (!dryRun) fs.cpSync(src, dst, { recursive: true });
}
function backupPathFor(label) { return path.join(backupRoot, label); }
function backupCurrent() {
  if (dryRun) return;
  ensureDir(backupRoot);
  if (exists(legacyDir)) fs.cpSync(legacyDir, backupPathFor('legacy-self-learning'), { recursive: true });
  if (exists(targetDir)) fs.cpSync(targetDir, backupPathFor('target-plugin-data-before'), { recursive: true });
}
function patternRank(p) {
  const statusRank = { approved: 3, pending: 2, rejected: 1 }[p?.status] || 0;
  return [statusRank, Number(p?.count || 0), Number(p?.score || 0), Date.parse(p?.lastSeen || p?.reviewedAt || p?.updatedAt || p?.date || 0) || 0];
}
function compareRank(a, b) {
  const ar = patternRank(a), br = patternRank(b);
  for (let i = 0; i < ar.length; i++) if (ar[i] !== br[i]) return ar[i] - br[i];
  return 0;
}
function mergeById(rel) {
  const src = path.join(legacyDir, rel);
  const dst = path.join(targetDir, rel);
  const srcArr = readJson(src, []);
  const dstArr = readJson(dst, []);
  if (!Array.isArray(srcArr) && !Array.isArray(dstArr)) return { rel, skipped: true, reason: 'not-arrays' };
  const byId = new Map();
  let added = 0, replaced = 0, kept = 0;
  for (const item of Array.isArray(dstArr) ? dstArr : []) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of Array.isArray(srcArr) ? srcArr : []) {
    if (!item?.id) continue;
    const prev = byId.get(item.id);
    if (!prev) { byId.set(item.id, item); added++; continue; }
    if (rel === 'patterns.json') {
      if (compareRank(item, prev) > 0) { byId.set(item.id, { ...prev, ...item }); replaced++; }
      else kept++;
    } else {
      kept++;
    }
  }
  const out = [...byId.values()];
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  writeJson(dst, out);
  return { rel, source: Array.isArray(srcArr) ? srcArr.length : 0, targetBefore: Array.isArray(dstArr) ? dstArr.length : 0, targetAfter: out.length, added, replaced, kept };
}
function mergeJsonl(rel) {
  const src = path.join(legacyDir, rel);
  const dst = path.join(targetDir, rel);
  const srcLines = exists(src) ? fs.readFileSync(src, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const dstLines = exists(dst) ? fs.readFileSync(dst, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const seen = new Set(dstLines.map(hashText));
  const append = [];
  for (const line of srcLines) {
    const h = hashText(line);
    if (!seen.has(h)) { seen.add(h); append.push(line); }
  }
  if (append.length && !dryRun) {
    ensureDir(path.dirname(dst));
    const prefix = dstLines.length ? '\n' : '';
    fs.appendFileSync(dst, `${prefix}${append.join('\n')}\n`, 'utf8');
  }
  return { rel, source: srcLines.length, targetBefore: dstLines.length, appended: append.length, targetAfter: dstLines.length + append.length };
}
function mergeObjectFile(rel) {
  const src = path.join(legacyDir, rel);
  const dst = path.join(targetDir, rel);
  if (!exists(src)) return { rel, skipped: true, reason: 'missing-source' };
  if (!exists(dst)) {
    copyRecursive(src, dst);
    return { rel, action: 'copied-missing', sourceHash: fileHash(src) };
  }
  return { rel, action: 'kept-target', sourceHash: fileHash(src), targetHash: fileHash(dst) };
}
function copyDirMissing(rel) {
  const srcDir = path.join(legacyDir, rel);
  const dstDir = path.join(targetDir, rel);
  if (!exists(srcDir)) return { rel, skipped: true, reason: 'missing-source' };
  const copied = [];
  const conflicts = [];
  function walk(src, base='') {
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, ent.name);
      const r = path.join(base, ent.name);
      const d = path.join(dstDir, r);
      if (ent.isDirectory()) walk(s, r);
      else if (!exists(d)) { copyRecursive(s, d); copied.push(r); }
      else conflicts.push(r);
    }
  }
  walk(srcDir);
  return { rel, copied: copied.length, conflicts: conflicts.length };
}
function archiveLegacyEventLog(summary) {
  const src = path.join(legacyDir, 'event_log.jsonl');
  if (!exists(src)) return { skipped: true, reason: 'missing-source' };
  const archiveDir = path.join(targetDir, 'legacy-audit');
  const dst = path.join(archiveDir, `event_log.legacy-self-learning.${stamp}.jsonl`);
  copyRecursive(src, dst);
  const result = { archivedTo: dst, lines: countLines(src), sha256: fileHash(src) };
  summary.legacyEventLog = result;
  return result;
}
function eventWithoutHashes(event = {}) {
  const { hash, prevHash, ...rest } = event;
  return rest;
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}
function hashEvent(event = {}, prevHash = '') {
  return crypto.createHash('sha256').update(`${prevHash || ''}${JSON.stringify(canonicalize(eventWithoutHashes(event)))}`).digest('hex');
}
function lastEventHash(file) {
  if (!exists(file)) return '';
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]).hash || ''; } catch {}
  }
  return '';
}
function appendMigrationEvent(summary) {
  const file = path.join(targetDir, 'event_log.jsonl');
  const prevHash = lastEventHash(file);
  const base = {
    id: `evt_${hashText(`legacy-migration:${now}`).slice(0, 16)}`,
    date: now,
    actor: 'migration-script',
    type: 'data.migrated',
    entityType: 'data_dir',
    entityId: 'legacy-self-learning',
    summary: 'Merged legacy ~/.hanako/self-learning into host plugin-data directory',
    data: {
      legacyDir,
      targetDir,
      backupRoot,
      legacyEventLog: summary.legacyEventLog || null,
      patternMerge: summary.mergeById.find((x) => x.rel === 'patterns.json') || null,
      jsonlMerge: summary.mergeJsonl,
    },
  };
  const event = { ...base, prevHash, hash: hashEvent(base, prevHash) };
  if (!dryRun) {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  }
  return event;
}

function main() {
  if (!exists(legacyDir)) throw new Error(`Legacy dir missing: ${legacyDir}`);
  if (!exists(targetDir)) throw new Error(`Target dir missing: ${targetDir}`);
  const summary = {
    dryRun,
    now,
    legacyDir,
    targetDir,
    backupRoot,
    before: {
      legacyPatterns: readJson(path.join(legacyDir, 'patterns.json'), []).length || 0,
      targetPatterns: readJson(path.join(targetDir, 'patterns.json'), []).length || 0,
      legacyEvents: countLines(path.join(legacyDir, 'event_log.jsonl')),
      targetEvents: countLines(path.join(targetDir, 'event_log.jsonl')),
    },
    mergeById: [],
    mergeJsonl: [],
    objectFiles: [],
    copiedDirs: [],
  };
  backupCurrent();
  for (const rel of jsonFilesMergeById) summary.mergeById.push(mergeById(rel));
  for (const rel of jsonlFilesMergeByLineHash) summary.mergeJsonl.push(mergeJsonl(rel));
  for (const rel of jsonObjectPreferTarget) summary.objectFiles.push(mergeObjectFile(rel));
  for (const rel of dirsCopyMissing) summary.copiedDirs.push(copyDirMissing(rel));
  archiveLegacyEventLog(summary);
  summary.migrationEvent = appendMigrationEvent(summary);
  summary.after = {
    targetPatterns: dryRun ? '(dry-run)' : (readJson(path.join(targetDir, 'patterns.json'), []).length || 0),
    targetEvents: dryRun ? '(dry-run)' : countLines(path.join(targetDir, 'event_log.jsonl')),
  };
  if (!dryRun) {
    const reportDir = path.join(targetDir, 'migration-reports');
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, `legacy-self-learning-migration-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(summary, null, 2));
}

try { main(); }
catch (err) { console.error(err.stack || err.message); process.exit(1); }
