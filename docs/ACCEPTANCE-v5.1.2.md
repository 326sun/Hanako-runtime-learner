# v5.1.2 验收记录（全面审计加固 / 非 GitHub Release）

日期：2026-06-28

> **不是 GitHub Release。** release freeze 持续：未 tag、未创建 GitHub Release、未上传
> asset、未安装。版本号 `5.1.1 → 5.1.2`（package.json / package-lock / manifest 同步）。

## 范围

在已冻结的 v5.0 API 表面之上，完成一轮 S1–S12 × 正确性/复杂度/性能三遍**全面审计**
（36 单元格），修复审计发现的中/低危逻辑问题并治理复杂度热点。不改 official 架构、
不新增工具、不引入网络副作用、不放宽任何安全边界。审计计划书与结论存于仓库外
`D:\openhanako\test-plans\`，逐格发现入 `test-plans\findings\`。

## 已修问题

| 严重度 | 模块 | 内容 |
|---|---|---|
| 中 | `lib/agent-controller.js` | step 异常会逃逸且不落 FAILED；现强制落 FAILED + 写 `state.crashed` audit + 持久化 |
| 中 | `tools/control.js` | `diagnose_bus` 带 session target 时按 target 区分 `external_side_effect` vs `read`，不再误声明只读 |
| 中 | `lib/release-readiness.js` | 测试数默认统一到 843，补 fixture，去除 README stale 误过 |
| 中 | `lib/dist-verify.js` | 新增 zip central directory root 校验（`verifyZipRoot`），杜绝错误 zip root 假绿 |
| 低 | `lib/sample-text.js` | `sampleTextViaBus()` 补传 `ctx.pluginId`，修正 usage attribution |
| 低 | `lib/agent-task-store.js` | 区分缺失文件（ENOENT/null）与损坏文件（throw corrupt） |

## 复杂度治理（等价重构，行为/导出面不变）

| 模块 | LOC | 拆出 |
|---|---|---|
| `lib/proposals.js` | 448 → 338 | `proposal-diff-preview.js` |
| `lib/observer.js` | 501 → 452 | `observer-adoption.js` |
| `lib/scope-gate.js` | 428 → 274 | `scope-diff-preview.js` |
| `lib/agent-controller.js` | 332 → 161 | `agent-controller-nodes.js` |
| `lib/audit-dashboard.js` | 308 → 196 | `audit-dashboard-render.js` |
| `tools/control.js` | 631 → 524（imports 34 → 30） | `control-handlers/transfer.js` |

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run check` | passed |
| `npm test` | 843 tests · 838 passed · 5 skipped · 0 failed · 0 cancelled |
| `npm run build` | passed（dist 13 文件 / 8 工具） |
| `npm run complexity:check` | OK（soft warnings 3 / 0 hard） |
| `npm run release:check` | ready / Score 100 |

## 结论

代码 + 测试在工作目录与 dist 中一致，release-readiness 门禁保持 `ready`。仍处 freeze：
未 tag / 未 Release / 未传 asset / 未安装。安装与发布留待维护者授权。
