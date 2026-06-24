# v4.3.23 验收记录

## 版本目标

`v4.3.23` 在 `v4.3.22` 自学习控制台基础上，补齐 v4.x LTS 的复杂度治理门：把维护期预算写成可机读规则、发布门检查和可审计文档，同时拆分控制面热点文件，降低后续维护风险。该版本不新增自动化能力。

## 实现

- `lib/complexity.js`：定义复杂度扫描、hard limit、soft target、报告构建和预算判定。
- `scripts/complexity-check.js` / `scripts/complexity-report.js`：新增本地门禁与报告生成脚本，均只依赖 Node 内置模块。
- `lib/release-readiness.js`：发布门新增 `complexity.within_budget` 检查，默认测试基线同步到 665。
- `docs/COMPLEXITY_BUDGET.md`：记录 v4.x LTS 复杂度预算、模块新增规则和预算调整流程。
- `docs/COMPLEXITY_DEBT.md` / `docs/COMPLEXITY_REPORT.md`：登记 soft target 债务并生成当前复杂度快照。
- `tools/control-parameters.js`、`tools/control-summaries.js`、`tools/control-handlers/*`：从 `tools/control.js` 抽出参数解析、摘要格式化和部分控制面 handler，保留行为特征回归覆盖。

## 验收结果

| 项目 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 665 个测试，660 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 通过，无阈值越界 |
| `npm run complexity:check` | 通过，0 hard violations |
| `npm run release:check` | Score 100 |

## 本版确认项

1. 复杂度治理扫描范围限定为 `lib/`、`scripts/`、`tests/`、`tools/` 下的 JS/CJS/MJS 文件。
2. hard limit 超出会阻断 `complexity:check` 和 `release:check`；soft target 只登记债务，不阻断发布。
3. `docs/COMPLEXITY_BUDGET.md` 与 `lib/complexity.js` 中的预算数值保持一致。
4. `tools/control.js` 已拆分到 602 LOC，仍仅略高于 600 LOC soft target，登记在复杂度债务中。
5. README、INSTALL、CHANGELOG、ARCHITECTURE、设计目标矩阵、package/manifest/lockfile 版本均同步到 `4.3.23`。
6. 自动化边界未放宽：新增的是本地静态治理与文档/测试，不执行 `git tag`、`git push`、`npm publish` 或外部副作用。

## 结论

`v4.3.23` 满足当前 release gate，作为 v4.x LTS 的复杂度治理与发布门加固版本发布。
