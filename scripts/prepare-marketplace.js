import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { projectRoot } from "./app-author-tools.js";
const dir = path.join(projectRoot, "release-v2");
const entry = JSON.parse(fs.readFileSync(path.join(dir, "app-hanako-runtime-learner-6.0.0.entry.json"), "utf8"));
const zip = fs.readFileSync(path.join(dir, "app-hanako-runtime-learner-6.0.0.zip"));
assert.equal(entry.kind, "app"); assert.equal(entry.id, "hanako-runtime-learner"); assert.equal(entry.version, "6.0.0");
assert.equal(entry.archive.size, zip.length);
assert.equal(entry.archive.sha256, crypto.createHash("sha256").update(zip).digest("hex"));
const out = path.join(dir, "submission"); fs.mkdirSync(out, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);
write("registry.addition.json", { kind: "app", id: entry.id, repository: "326sun/Hanako-runtime-learner", publisher: entry.publisher });
const storeReadme = fs.readFileSync(path.join(projectRoot, "app", entry.id, "README.md"), "utf8")
  .replace("v6.0.0 当前为本地候选，尚未上传远端 Release。", "v6.0.0 安装包在作者仓库的正式 Release 提供。")
  .replace("## 使用\n", "## 使用\n\n设置入口：Hana 左下角齿轮 → 应用 → 自学习。支持模型整理、LLM 抽取、自动注入及治理选项；模型使用 Hana 的工具模型。\n");
write("approvals.addition.json", { kind: "app", id: entry.id, tag: "v6.0.0", sha256: entry.archive.sha256, readme: storeReadme });
fs.copyFileSync(path.join(projectRoot, "app", entry.id, "assets", "icon.svg"), path.join(dir, "icon.svg"));
fs.writeFileSync(path.join(dir, "app-hanako-runtime-learner-6.0.0.zip.sha256"), `${entry.archive.sha256}  app-hanako-runtime-learner-6.0.0.zip\n`);
for (const [target, template] of [["PR.md", "MARKETPLACE_SUBMISSION.md"], ["RELEASE.md", "RELEASE-v6.0.0.md"]]) {
  fs.copyFileSync(path.join(projectRoot, "docs", template), path.join(out, target));
}
console.log(`Prepared market submission materials: ${out}`);
