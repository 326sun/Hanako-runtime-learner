# v5.1.1 验收记录（model advisor 可观测性补强 / 非 GitHub Release）

日期：2026-06-27

> **不是 GitHub Release。** release freeze 持续：未 tag、未创建 GitHub Release、未上传
> asset、未安装。版本号 `5.1.0 → 5.1.1`（package.json / package-lock / manifest 同步）。

## 范围

在已冻结的 v5.0 API 表面之上，仅对 model advisor 的「静默失败」做**可见性补强**，不改
official 架构、不新增工具、不引入网络副作用。背景：official 模式在 Hanako `v0.345.x` 上
凭证链由宿主侧自洽（utility 模型缺省回退主聊天模型），根因不在凭证缺失，而在 advisor
跳过/失败时无声无息。

| 模块 | 内容 | 默认 | 副作用 |
|---|---|---|---|
| advisor status | `maybeRun` 三出口（success/skipped/error）写 `model_advisor_status.json`；纯函数 `buildAdvisorStatus()` 记账 `consecutiveFailures` | — | 仅本地状态文件 |
| doctor 诊断 | `advisor_never_run`(info) / `advisor_error`(瞬时 warning，连续 ≥3 → high) / `advisor_skipped`(config warning，良性 info)；禁用时静默 | — | 只读诊断 |

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run check` | passed |
| `npm test` | 838 tests · 833 passed · 5 skipped · 0 failed · 0 cancelled |
| `npm run build` | passed（dist 13 文件 / 8 工具） |
| `npm run release:check` | ready / Score 100 |

## 结论

代码 + 测试在工作目录与 dist 中一致，release-readiness 门禁恢复 `ready`。仍处 freeze：
未 tag / 未 Release / 未传 asset / 未安装。安装与发布留待维护者授权。
