#!/usr/bin/env node
/**
 * build.js — v5.0 M0 esbuild packager (plan §6).
 *
 * Source of truth stays index.js + lib/** + tools/** (tested, audited). This
 * produces dist/ as the publishable plugin root: a single bundled dist/index.js
 * plus the runtime siblings the host loads directly, then a release zip whose
 * root IS the plugin (drag-in, no npm install).
 *
 * The child process runner is forked by path at runtime, so it is copied
 * verbatim beside the bundle (never inlined). The bundle's import.meta.url then
 * resolves the fork target to dist/plugin-process-runner-child.js.
 */

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { verifyDistStructure, verifyZipRoot, REQUIRED_TOOL_FILES } from "../lib/dist-verify.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const RELEASE = path.join(ROOT, "release");
const ZIP_NAME = "hanako-runtime-learner-dist.zip";

// Copied verbatim beside the bundle (relative source path → dist filename).
const COPY_FILES = [
  ["manifest.json", "manifest.json"],
  ["README.md", "README.md"],
  ["LICENSE", "LICENSE"],
  ["lib/plugin-process-runner-child.js", "plugin-process-runner-child.js"],
];

function collectFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(abs, base, out);
    else out.push({ name: path.relative(base, abs).split(path.sep).join("/"), abs });
  }
  return out;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

// Minimal, dependency-free zip writer (deflate). Entry names are the dist-root
// relative paths, so the archive root is the plugin itself.
function writeZip(zipPath, entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, abs } of entries) {
    const data = fs.readFileSync(abs);
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12); // 1980-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, deflated);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(deflated.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...local, centralBuf, eocd]));
}

async function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(RELEASE, { recursive: true });

  // Multiple entry points: the main plugin plus each host-loaded tool. With no
  // code-splitting, esbuild emits each entry as an independent, self-contained
  // bundle (lib/** inlined), preserving the source layout under dist/ via
  // outbase — so the host still discovers tools at dist/tools/<name>.js.
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, "index.js"), ...REQUIRED_TOOL_FILES.map((t) => path.join(ROOT, t))],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outdir: DIST,
    outbase: ROOT,
    sourcemap: false,
    metafile: true,
    packages: "bundle",
    loader: { ".wasm": "copy" },
    assetNames: "assets/[name]",
    logLevel: "warning",
  });

  // metafile is written OUTSIDE dist (audit only); the zip never ships it.
  fs.writeFileSync(path.join(RELEASE, "esbuild-meta.json"), JSON.stringify(result.metafile, null, 2));

  for (const [from, to] of COPY_FILES) {
    const src = path.join(ROOT, from);
    if (!fs.existsSync(src)) throw new Error(`build: missing source file to copy: ${from}`);
    fs.copyFileSync(src, path.join(DIST, to));
  }

  const distCheck = verifyDistStructure(DIST);
  if (!distCheck.ok) throw new Error(`build: dist self-check failed:\n- ${distCheck.problems.join("\n- ")}`);

  const entries = collectFiles(DIST);
  const zipPath = path.join(RELEASE, ZIP_NAME);
  writeZip(zipPath, entries);
  const zipCheck = verifyZipRoot(entries.map((e) => e.name));
  if (!zipCheck.ok) throw new Error(`build: zip root self-check failed:\n- ${zipCheck.problems.join("\n- ")}`);

  const bundleBytes = fs.statSync(path.join(DIST, "index.js")).size;
  console.log(`build ok · dist/ ${entries.length} files · bundle ${(bundleBytes / 1024).toFixed(1)}kB · zip → ${path.relative(ROOT, zipPath)}`);
}

build().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
