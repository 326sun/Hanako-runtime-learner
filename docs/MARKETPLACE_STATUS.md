# 未上架原因与新投稿材料

核查日期：2026-10-18。

## 已核实

- 旧市场 [liliMozi/OH-Plugins PR #14](https://github.com/liliMozi/OH-Plugins/pull/14) 是作者在 2026-06-11 提交的 v4.3.0-lts 收录请求，当前仍为 open、未合并。
- PR 的公开页面显示 No reviews；API 未返回维护者的评审或拒绝理由。无法据此断言代码、安全或质量审核失败。
- 现行 Global 市场为 [liliMozi/hana-marketplace](https://github.com/liliMozi/hana-marketplace)。核查 registry.json 与 approvals.json 时均无 hanako-runtime-learner；搜索该仓库也没有找到同名投稿。
- [现行贡献指南](https://github.com/liliMozi/hana-marketplace/blob/main/CONTRIBUTING.md) 要求新 App 使用 manifestVersion 2。只发布自己仓库的 Release 或只有登记、没有批准记录，都不会自动上架。
- Global 和中国大陆市场独立审核发布，Global 收录不自动同步国内源。本次未获得国内源的单独投稿规则或审核记录。

## 新版投稿需要

1. 在 `326sun/Hanako-runtime-learner` 发布正式 `v6.0.0` Release，不能是 draft 或 prerelease。
2. 同时上传官方打包器产出的 `app-hanako-runtime-learner-6.0.0.zip` 与匹配的 `.entry.json`。二者必须在同一 Release，不能用 GitHub 自动生成的 Source code ZIP。
3. 向 `liliMozi/hana-marketplace` 提新 PR，追加 registry 登记和 approvals 的 tag/SHA-256；不要编辑生成的 index.v2.json。
4. 介绍、图标、纯工具调用示例、自测范围、5 项权限用途与已知差异均随 PR 提供。维护者审核合并后，还需市场发布 Action 成功。

本次已经在 `release-v2/submission/` 准备登记和批准记录的追加片段、Release 说明与 PR 正文。它们是待提交材料，不代表维护者批准。没有上传 Release、提新 PR、关闭旧 PR 或向维护者发消息。
