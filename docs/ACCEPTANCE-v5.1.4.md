# v5.1.4 验收记录（性能护栏 + 简化治理收口）

日期：2026-07-03

> 本版本在已发布的 `v5.1.3` 之上收口性能计划 P6-P10 与简化计划 S1-S6。
> 版本号 `5.1.3 → 5.1.4`（package.json / package-lock / manifest 同步）。

## 范围

1. **性能护栏**：observer 热路径、patterns dirty-sync、audit/event 缓存、
   advisor/extraction 可观测性与开发工具改进。
2. **简化治理**：`index.js` onload 阶段化、复杂度扫描纳入入口文件、测试文件拆分、
   C-005/C-006 债务台账收口。
3. **复杂度预算决策**：`libModuleCount` hard 110→118、soft 95→105，恢复
   headroom，并固化“新建文件是最后手段”的治理规则。

## 关键结果

| 项 | 结果 |
|---|---|
| `index.js` onload | 552 行单函数 → 27 行阶段链 + 17 个具名阶段函数 |
| lib 模块数预算 | 107 / hard 118 / soft 105 |
| soft warnings | 5，全部有 `COMPLEXITY_DEBT.md` 台账锚点 |
| release zip | `release/hanako-runtime-learner-dist.zip`，自包含 dist |

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run build` | passed（dist 13 files / release zip generated） |
| `npm run check` | passed |
| `npm test` | 938 tests · 933 passed · 5 skipped · 0 failed |
| `npm run benchmark` | passed（17/17 scenarios） |
| `npm run perf` | passed（all metrics within thresholds） |
| `npm run release:check` | ready / Score 100 |
| `npm audit --audit-level=high` | found 0 vulnerabilities |

## 结论

代码、文档、发布包和发布门一致，`v5.1.4` 满足当前 release gate，可作为
`v5.1.3` 之后的性能与复杂度治理维护发布。
