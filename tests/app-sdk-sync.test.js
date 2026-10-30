import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "node_modules/@hana/app-sdk/package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "app/hanako-runtime-learner/manifest.json"), "utf8"));
describe("Hana App SDK release baseline", () => {
  it("pins the installed SDK package to Hana 1.3.6-beta", () => {
    assert.equal(pkg.version, "1.3.6-beta");
    assert.equal(manifest.minAppVersion, "1.1.0");
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    assert.equal(lock.packages["node_modules/@hana/app-sdk"].version, pkg.version);
    assert.equal(lock.packages["node_modules/@hana/app-sdk"].resolved, "file:vendor/hana-app-sdk.tgz");
  });

  it("bundles the pinned SDK into the App without a generated source mirror or external packages", async () => {
    // The installable App is bundled from v2/entry.js. app/*/sdk is an ignored
    // authoring artifact, so a clean checkout must not need it to build.
    const result = await build({
      absWorkingDir: root, entryPoints: ["v2/entry.js"], bundle: true,
      platform: "node", format: "esm", target: "node24",
      write: false, metafile: true, logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile.inputs).map((file) => file.replace(/\\/g, "/"));
    assert.ok(inputs.some((file) => file.startsWith("node_modules/@hana/app-sdk/dist/")), "bundle must include the pinned SDK");
    assert.ok(!inputs.some((file) => file.startsWith("app/hanako-runtime-learner/sdk/")), "bundle must not use an authoring mirror");
    const outputs = Object.values(result.metafile.outputs);
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].entryPoint, "v2/entry.js");
    assert.ok(outputs[0].exports.includes("default"));
    assert.ok(outputs[0].bytes > 0);
    const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
    for (const dependency of outputs[0].imports) {
      assert.ok(dependency.external && builtins.has(dependency.path.replace(/^node:/, "")),
        `unexpected runtime dependency: ${dependency.path}`);
    }
  });
});
