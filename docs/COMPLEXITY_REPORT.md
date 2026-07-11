# Complexity Report

> 自动生成，请勿手工编辑。运行 `npm run complexity:report` 刷新。
> 预算与规则见 [COMPLEXITY_BUDGET.md](COMPLEXITY_BUDGET.md)，债务清单见 [COMPLEXITY_DEBT.md](COMPLEXITY_DEBT.md)。

Generated at: 2026-07-10T08:12:25.101Z
Scan scope: lib, scripts, tests, tools
Status: within budget

## 摘要

| 指标 | 当前值 | hard limit | soft target |
|---|---|---|---|
| 文件数 | 259 | - | - |
| lib 模块数 | 109 | 118 | 105 |
| 总 LOC | 37475 | - | - |
| 总代码 LOC | 31033 | - | - |
| 单文件最大 LOC | 614 | 900 | 600 |
| 单文件最大 imports | 19 | 35 | 20 |
| 单文件最大 exports | 18 | 25 | 18 |
| TODO/FIXME 总数 | 0 | 40 | 10 |
| soft 警告数 | 3 | - | 0 |
| 结构规则警告数 | 0 | - | 0 |
| hard 违规数 | 0 | 0 | - |

## Top 10 最大文件 (LOC)

| 文件 | LOC | 代码 LOC |
|---|---|---|
| tests/runtime-e2e.test.js | 614 | 501 |
| index.js | 611 | 500 |
| tests/common.test.js | 582 | 481 |
| tools/doctor.js | 507 | 423 |
| tests/observer.test.js | 489 | 392 |
| lib/observer.js | 463 | 342 |
| tests/doctor.test.js | 456 | 409 |
| tools/search.js | 437 | 358 |
| lib/pattern-detector.js | 422 | 288 |
| lib/release-readiness.js | 415 | 382 |

## Top 10 import 最多文件

| 文件 | imports |
|---|---|
| index.js | 19 |
| tools/control.js | 18 |
| tests/runtime-e2e.test.js | 15 |
| tests/action-runtime.test.js | 14 |
| tests/review-governance.test.js | 14 |
| tests/agent-resume.test.js | 12 |
| tools/control-handlers/audit.js | 12 |
| tools/doctor.js | 12 |
| tools/search.js | 12 |
| lib/action-executor.js | 11 |

## Top 10 export 最多文件

| 文件 | exports |
|---|---|
| lib/json-io.js | 18 |
| lib/proposals.js | 16 |
| lib/helpers.js | 15 |
| lib/host-tasks.js | 15 |
| lib/scoring.js | 12 |
| lib/agent-controller-nodes.js | 11 |
| lib/action-types.js | 10 |
| lib/complexity.js | 10 |
| lib/llm-extraction-queue.js | 10 |
| tools/search.js | 10 |

## TODO / FIXME 统计

总计 0 处，分布于 0 个文件。

## Soft target 警告

以下项目超出 soft target 但仍在 hard limit 内，是优先治理对象（参见 COMPLEXITY_DEBT.md）。

- tests/runtime-e2e.test.js has 614 LOC > soft target 600
- index.js has 611 LOC > soft target 600
- lib module count 109 > soft target 105

