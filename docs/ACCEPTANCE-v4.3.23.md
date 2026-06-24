# v4.3.23 验收记录

## 版本目标

`v4.3.23` 在 `v4.3.22` 的自学习控制台版本基础上，引入 v4.x LTS 的复杂度治理基础设施，并完成 C-001（`tools/control.js`）低风险拆分。本版目标是让复杂度预算、复杂度债务和发布门形成可审计闭环，同时不放宽运行时安全边界。

## 实现范围

- 新增 `lib/complexity.js` 作为复杂度预算单一事实源，扫描 `lib/`、`scripts/`、`tests/`、`tools/` 的 LOC、import/export 数和 TODO/FIXME 标记。
- 新增 `scripts/complexity-check.js` 与 `scripts/complexity-report.js`，分别提供 hard-limit 门禁与 `docs/COMPLEXITY_REPORT.md` 报告生成。
- 新增 `docs/COMPLEXITY_BUDGET.md` 与 `docs/COMPLEXITY_DEBT.md`，把 v4.x LTS 的复杂度预算、软警告和 deferred 项写入文档。
- `lib/release-readiness.js` 新增 `complexity.within_budget` 检查项，作为发布就绪度的一部分，保持本地 in-process 检查，无新增外部副作用。
- C-001 低风险拆分：抽出 `tools/control-parameters.js`、`tools/control-summaries.js`、`tools/control-handlers/skill-policy.js`、`tools/control-handlers/events.js`，降低 `tools/control.js` 热点复杂度。
- C-004 公共面收敛：`lib/json-io.js` 对外导出面从 17 收敛到 15。
- 新增 characterization tests，覆盖 control parameters、summaries、redaction、handlers 与 release-readiness complexity gate。

## 边界确认

| 项目 | 结论 |
|---|---|
| 运行时依赖 | 未新增 |
| 安全策略 | 未放宽 |
| `execute` / `sessionPermission` / `*_ACTIONS` / `describeControlSideEffect` | 未改语义边界 |
| 自动放行 / 网络 / 发布 / 外部副作用能力 | 未新增 |
| 高风险 control handler 迁移 | deferred，不纳入本版 |

## 验收结果

| 项目 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 665 个测试，665 通过，0 跳过 |
| `npm run complexity:check` | 通过，0 violation，3 soft warning |
| `npm run complexity:report` | 通过，生成 `docs/COMPLEXITY_REPORT.md` |
| `npm run release:check` | Score 100 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 通过，无阈值越界 |

## 本版确认项

1. 复杂度预算成为发布门的一部分，`complexity.within_budget` 可在 `release:check` 中审计。
2. 复杂度治理只读取本地源码并生成本地报告，不引入网络、凭证、外部写入或发布动作。
3. `tools/control.js` 的低风险拆分保持参数 schema、摘要输出、脱敏行为和 handler 行为回归稳定。
4. `docs/COMPLEXITY_DEBT.md` 明确记录 C-001 中高风险/低收益部分为 deferred，避免为了追求 LOC 指标扩大重构风险。
5. README、CHANGELOG、设计矩阵、package/manifest/package-lock 版本号同步至 `4.3.23`。

## 结论

`v4.3.23` 满足当前 release gate，可作为 v4.x LTS 的复杂度治理正式版准备发布。实际 tag、GitHub Release 与合并动作仍应由维护者在 PR 审查通过后显式执行。
