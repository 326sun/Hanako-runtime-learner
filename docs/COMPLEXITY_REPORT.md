# Complexity Report

> 自动生成，请勿手工编辑。运行 `npm run complexity:report` 刷新。
> 预算与规则见 [COMPLEXITY_BUDGET.md](COMPLEXITY_BUDGET.md)，债务清单见 [COMPLEXITY_DEBT.md](COMPLEXITY_DEBT.md)。

Generated at: 2026-06-28T12:29:20.691Z
Scan scope: lib, scripts, tests, tools
Status: within budget

## 摘要

| 指标 | 当前值 | hard limit | soft target |
|---|---|---|---|
| 文件数 | 221 | - | - |
| lib 模块数 | 104 | 110 | 95 |
| 总 LOC | 31750 | - | - |
| 总代码 LOC | 26292 | - | - |
| 单文件最大 LOC | 648 | 900 | 600 |
| 单文件最大 imports | 30 | 35 | 20 |
| 单文件最大 exports | 17 | 25 | 18 |
| TODO/FIXME 总数 | 0 | 40 | 10 |
| soft 警告数 | 3 | - | 0 |
| hard 违规数 | 0 | 0 | - |

## Top 10 最大文件 (LOC)

| 文件 | LOC | 代码 LOC |
|---|---|---|
| tests/pattern-detector.test.js | 648 | 556 |
| tests/common.test.js | 530 | 436 |
| tools/control.js | 525 | 445 |
| tools/doctor.js | 479 | 398 |
| tests/observer.test.js | 456 | 365 |
| lib/observer.js | 452 | 338 |
| lib/pattern-detector.js | 406 | 274 |
| tools/search.js | 397 | 322 |
| tests/runtime-e2e.test.js | 383 | 308 |
| lib/model-advisor.js | 381 | 310 |

## Top 10 import 最多文件

| 文件 | imports |
|---|---|
| tools/control.js | 30 |
| tests/runtime-e2e.test.js | 15 |
| tests/action-runtime.test.js | 14 |
| tests/review-governance.test.js | 14 |
| tests/agent-resume.test.js | 12 |
| tools/control-handlers/audit.js | 12 |
| lib/action-executor.js | 11 |
| lib/evaluation-runner.js | 11 |
| lib/observer.js | 11 |
| tests/agent-controller.test.js | 11 |

## Top 10 export 最多文件

| 文件 | exports |
|---|---|
| lib/helpers.js | 17 |
| lib/host-tasks.js | 15 |
| lib/json-io.js | 15 |
| lib/proposals.js | 15 |
| lib/agent-controller-nodes.js | 11 |
| lib/action-types.js | 10 |
| lib/llm-extraction-queue.js | 10 |
| lib/scoring.js | 10 |
| lib/credentials.js | 9 |
| lib/model-advisor.js | 9 |

## TODO / FIXME 统计

总计 0 处，分布于 0 个文件。

## Soft target 警告

以下项目超出 soft target 但仍在 hard limit 内，是优先治理对象（参见 COMPLEXITY_DEBT.md）。

- tests/pattern-detector.test.js has 648 LOC > soft target 600
- lib module count 104 > soft target 95
- tools/control.js has 30 imports > soft target 20

