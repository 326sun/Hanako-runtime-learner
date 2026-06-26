# 设计目标完成矩阵

当前版本：`5.1.0`（内部安装候选；在 v5.0 冻结表面上追加默认关闭/只读的实验能力，未发布）

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
| `npm test` | 773 个测试，768 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 无阈值越界 |
| `npm run release:check` | Score 100 |

## 未完成项

v5.0.0 当前剩余未完成阶段仅为明确排除的后续阶段：M1 本地 embedding / vector index、M4 Agent 编排、M5 adaptive thresholds。本次发布不进入这些阶段。
