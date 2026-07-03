# 设计目标完成矩阵

当前版本：`5.1.8`（在 v5.0 冻结表面上追加默认关闭/只读的实验能力，外加 model advisor 可观测性补强、v5.1.1 全面审计加固、v5.1.3 的 profile 安全闸门修复与设置面板即时生效、v5.1.4 的性能/复杂度治理收口、v5.1.5 的入口/控制面结构收敛、v5.1.6 的文档统计修正、v5.1.7 的子系统级精简计划，以及 v5.1.8 的 usage evidence provenance 与 doctor 降噪补丁；默认边界与安全闸门不变）

## 总体状态

| 目标 | 状态 | 说明 |
|---|---|---|
| 本地学习闭环 | 完成 | 观察、学习、注入、治理链路完整。 |
| 保守自动化边界 | 完成 | R4 / 外部副作用维持冻结。 |
| 事务化写入 | 完成 | R2 写动作受事务、验证和回滚保护。 |
| 可审计治理 | 完成 | proposal / review / doctor / event log 全部可追溯。 |
| 性能护栏 | 完成 | `benchmark` + `perf` 已固定。 |
| 发布门 | 完成 | `release:check` 维持本地就绪度检查。 |
| 自包含发布包 | 完成 | M0 引入 esbuild 构建，release zip 无 runtime dependencies。 |
| 默认关闭 LLM extraction | 完成 | M2 worker 默认关闭，输出只进入 proposal/review。 |
| 后台任务调度 | 完成 | M3-lite 使用 Hanako `task:*` bus，旧宿主安全降级。 |

## 发布验证矩阵

| 项目 | 预期 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 950 个测试，945 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 无阈值越界 |
| `npm run release:check` | Score 100 |

## 未完成项

v5.1.6 当前仍未发布完整的 M1 本地 vector index；语义检索、agent task/graph/resume 与 adaptive thresholds 已有可选或受治理约束的实现路径，但默认关闭、只读或 recommendation-only，不改变保守自动化边界。
