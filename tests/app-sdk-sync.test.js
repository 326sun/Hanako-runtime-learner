import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "node_modules/@hana/app-sdk/package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "app/hanako-runtime-learner/manifest.json"), "utf8"));
function filesUnder(dir, base = dir) {
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...filesUnder(full, base));
    else if (entry.isFile()) rows.push(path.relative(base, full));
  }
  return rows;
}

describe("Hana App SDK release baseline", () => {
  it("pins generated SDK mirror and package to Hana 1.3.6-beta", () => {
    assert.equal(pkg.version, "1.3.6-beta");
    assert.equal(manifest.minAppVersion, "1.1.0");
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    assert.equal(lock.packages["node_modules/@hana/app-sdk"].version, pkg.version);
    assert.equal(lock.packages["node_modules/@hana/app-sdk"].resolved, "file:vendor/hana-app-sdk.tgz");
  });

  it("keeps the generated source mirror file set identical to the pinned package", () => {
    const packageDist = path.join(root, "node_modules/@hana/app-sdk/dist");
    const mirror = path.join(root, "app/hanako-runtime-learner/sdk");
    const expected = filesUnder(packageDist).filter((file) => file !== "THIRD_PARTY_NOTICES.txt").sort();
    const actual = filesUnder(mirror).filter((file) => file !== "THIRD_PARTY_NOTICES.txt").sort();
    assert.deepEqual(actual, expected);
    for (const rel of expected) {
      const a = createHash("sha256").update(fs.readFileSync(path.join(packageDist, rel))).digest("hex");
      const b = createHash("sha256").update(fs.readFileSync(path.join(mirror, rel))).digest("hex");
      assert.equal(b, a, `stale SDK mirror file: ${rel}`);
    }
  });
});
