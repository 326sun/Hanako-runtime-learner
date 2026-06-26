# v5.1.0 验收记录（内部安装候选 / install smoke candidate）

日期：2026-06-26

> **这是一个内部安装冒烟候选版本，不是 GitHub Release。** release freeze 持续：
> 未 tag、未创建 GitHub Release、未上传 asset。本记录用于支撑「在真实 Hanako 上
> 做安装/加载冒烟」前的候选态验收。版本号 `5.0.0 → 5.1.0`（仅 package.json /
> package-lock / manifest 同步，无运行逻辑改动、无新增功能）。

## 范围

`5.1.0` 在已冻结的 v5.0 API 表面之上，仅追加一批**实验性、默认关闭或只读、零副作用、
未接入主流程**的能力，外加 M1 的正式 defer。冻结的接口、安全边界、治理链与人工确认
规则**全部不变**（见 [API_FREEZE.md](API_FREEZE.md)）。

| 模块 | 内容 | 默认 | 副作用 |
|---|---|---|---|
| M5 / M5b | feedback 信号 + 只读 `feedback_summary` 诊断 | `feedbackSignalsEnabled: true` | 仅本地 event-log 计数，无决策消费 |
| M5c | adaptive threshold DESIGN GATE（纸面） | — | 无代码 |
| M5d | adaptive threshold 最小实现（纯函数、recommendation-only） | `adaptiveThresholdsEnabled: false` | 无（不改 config、不 apply、无人 import） |
| M4a | 只读 agent graph 骨架 | — | 无（不 import fs/child_process、未接入） |
| M4b | 只读 `agent_graph_preview` 诊断入口 | — | 无（不写 event-log/config/patterns/memory） |

## Deferred

- **M1 本地 embedding**：正式 defer（Route C），非通过、非完成，证据保留于
  [BLOCKERS.md](BLOCKERS.md) BLK-1 / [M1_BLOCKER_RESOLUTION_PLAN.md](M1_BLOCKER_RESOLUTION_PLAN.md)。
- **M5 完整自适应自动调参 / M4 真实执行**：明确不在范围内。

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run check` | passed |
| `npm test` | 827 tests · 822 passed · 5 skipped · 0 failed · 0 cancelled |
| `npm run build` | passed（dist 13 文件 / 8 工具） |
| `npm run complexity:check` | OK |
| `npm run benchmark` | passed |
| `npm run perf` | passed |
| `npm run release:check` | ready / Score 100 |

`npm audit --omit=dev` → 0 漏洞。

## 候选态结论

工程意义上 main 为「最终安装前候选态」，无代码 blocker。最终安装前剩余的唯一实质步骤为
**维护者授权下的真实 Hanako v0.345.x GUI 安装/加载冒烟**（装 dist zip、启用、确认
`self_learning_*` 工具加载、跑只读 `feedback_summary` / `agent_graph_preview`、无 failed
诊断）。完整审计见 [FINAL_INSTALL_READINESS.md](FINAL_INSTALL_READINESS.md)。
