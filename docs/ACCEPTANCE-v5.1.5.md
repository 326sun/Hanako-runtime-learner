# v5.1.5 验收记录（结构收敛维护发布）

日期：2026-07-03

> 本版本在已发布的 `v5.1.4` 之上完成下一步结构收敛计划 N0-N6。
> 版本号 `5.1.4 → 5.1.5`（package.json / package-lock / manifest 同步）。

## 范围

1. **README 能力状态精确化**：将 M1/M4/M5 叙述改为 shipped / optional /
   default-off / review-gated / recommendation-only 状态矩阵。
2. **control action registry**：`tools/control.js` 的 action side-effect、
   config/pattern loading 分类迁入 `tools/control-action-registry.js`。
3. **runtime wiring 聚合**：`index.js` 抽出 `runtime-live-config` 与
   `runtime-skill-refresh` 两个聚合模块。
4. **结构性复杂度规则**：新增 report-only structural warnings，当前不阻断发布。
5. **安装/升级 smoke**：已用 GitHub Release v5.1.4 zip 验证下载、SHA256、
   解包、真实插件目录升级与只读工具 smoke。

## 关键结果

| 项 | 结果 |
|---|---|
| `index.js` | 838 LOC / 27 imports → 588 LOC / 19 imports |
| `tools/control.js` | 627 LOC / 31 imports → 533 LOC / 32 imports |
| soft warnings | 5 → 2 |
| structural warnings | 0 |
| lib 模块数 | 109 / hard 118 / soft 105 |
| release zip | `release/hanako-runtime-learner-dist.zip`，自包含 dist |
| release zip SHA256 | `44A53715E21DE5C0B468AB08FF46B53C2A2F1D424C4DE2778257A117DB7A5884` |

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run build` | passed（dist 13 files / release zip generated） |
| `npm run check` | passed |
| `npm test` | 943 tests · 938 passed · 5 skipped · 0 failed |
| `npm run benchmark` | passed（17/17 scenarios） |
| `npm run perf` | passed（all metrics within thresholds） |
| `npm run complexity:check` | passed（2 soft warnings / 0 structural warnings / 0 hard violations） |
| `npm run release:check` | ready / Score 100 |
| `npm audit --audit-level=high` | found 0 vulnerabilities |

## 结论

`v5.1.5` 是结构收敛维护发布。完整发布门已通过，可创建 tag、GitHub Release
并上传 release zip asset。
