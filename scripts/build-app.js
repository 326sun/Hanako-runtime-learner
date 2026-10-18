import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-app", "hanako-runtime-learner");
fs.mkdirSync(out, { recursive: true });
await esbuild.build({ entryPoints: [path.join(root, "v2", "entry.js")], outfile: path.join(out, "index.js"),
  bundle: true, platform: "node", format: "esm", target: "node24", sourcemap: false, logLevel: "warning" });
for (const file of ["manifest.json", "README.md", "assets/icon.svg", "THIRD_PARTY_NOTICES.md", "licenses/HANA-SDK-APACHE-2.0.txt"]) {
  const to = path.join(out, file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(root, "app", "hanako-runtime-learner", file), to);
}
fs.copyFileSync(path.join(root, "LICENSE"), path.join(out, "LICENSE"));
fs.copyFileSync(path.join(root, "lib", "plugin-process-runner-child.js"), path.join(out, "plugin-process-runner-child.js"));
// Bundle all runtime SDK code. No host/node_modules lookup or author SDK tree
// belongs in the installed package.
console.log(`v2 App built: ${out}`);
