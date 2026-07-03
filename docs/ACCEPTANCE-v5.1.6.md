# v5.1.6 验收记录（文档统计修正发布）

日期：2026-07-03

> 本版本在已发布的 `v5.1.5` 之上修正发布文档中的测试统计漂移。
> 版本号 `5.1.5 → 5.1.6`（package.json / package-lock / manifest 同步）。

## 范围

1. **测试统计修正**：将 v5.1.5 文档中的 `943 tests · 938 passed · 5 skipped`
   校正为当前真实本地结果 `943 tests · 943 passed · 0 skipped`。
2. **版本元数据同步**：同步 package、package-lock、manifest、README、设计目标矩阵与 changelog 到 `5.1.6`。
3. **不移动既有 tag**：保留已发布的 `v5.1.5` tag 语义，使用 `v5.1.6` 作为干净补丁发布。

## 关键结果

| 项 | 结果 |
|---|---|
| package / lock / manifest | `5.1.6` |
| README version badge | `5.1.6` |
| README test badge | `943/943` |
| 测试统计 | `943 tests · 943 passed · 0 skipped · 0 failed` |
| release zip | `release/hanako-runtime-learner-dist.zip`，自包含 dist |

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run build` | passed（dist 13 files / release zip generated） |
| `npm run check` | passed |
| `npm test` | 943 tests · 943 passed · 0 skipped · 0 failed |
| `npm run complexity:check` | passed（2 soft warnings / 0 structural warnings / 0 hard violations） |
| `npm run release:check` | ready / Score 100 |

## 结论

`v5.1.6` 是文档统计修正补丁发布，避免移动已存在的 `v5.1.5` tag。完整发布门通过后可创建 `v5.1.6` tag、GitHub Release 并上传 release zip asset。
