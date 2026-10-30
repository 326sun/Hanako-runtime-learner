# 设计目标完成矩阵

## v6.2.0（可追溯分层长期记忆工作版）

| 目标 | 状态 | 说明 |
|---|---|---|
| Episode 来源链 | 工作版实现 | episode 摘要、hashed episode ID、evidence/sourceRefs 和 provenance 查询；不保存原始会话正文。 |
| 时态事实 | 继承并增强 | validFrom/validTo/learnedAt、supersession 和当前事实准入。 |
| 核心/归档分层 | 工作版实现 | core 自动提示、archive 显式检索；分层不绕过审核。 |
| 多信号检索 | 工作版实现 | BM25、多查询 RRF、实体/关系、字符 n-gram；不是神经 embedding。 |
| Graphiti/Mem0/Letta 直接依赖 | 不引入 | 仅移植机制，保持本地 App 低依赖和可审计。 |
| 官方长期记忆评测 | 未完成 | 未完整运行 LongMemEval/LoCoMo。 |

## v6.1.0（长期记忆升级工作版）

| 目标 | 状态 | 说明 |
|---|---|---|
| 用户可管理长期记忆 | 实现于独立工作版 | 工具支持查看、搜索、修改、逻辑删除及修订追溯。 |
| 记忆分类和时间更新 | 实现于独立工作版 | 类别字段与事实有效期、版本替代关系。 |
| 长记忆检索和提示 | 实现于独立工作版 | Gate-first CJK BM25 + 别名/摘要 + 多查询 RRF；无 embedding/LLM 语义保证。 |
| 导入与导出 | 实现于独立工作版 | 版本化 JSON、预览 token 绑定、冲突可见、逐项审核。 |
| 存储/索引替换 | 未实施 | 保留 JSON + BM25；需另行版本实现与迁移。 |
| 生产安装/真实对话验收 | 未实施 | v6.1 未安装到生产实例。详见 [ACCEPTANCE-v6.1.0.md](ACCEPTANCE-v6.1.0.md)。 |

v5.1.11 追加 HanaAgent 1.1.24-beta 的 Pi 回合边界、工具结果和任务调度适配；具体证据与限制见 [HANA_1.1_COMPATIBILITY.md](HANA_1.1_COMPATIBILITY.md)。

当前版本：`5.1.11`（在 v5.0 冻结表面上追加默认关闭/只读的实验能力，完成 v5.1.7 子系统精简、v5.1.8 usage evidence/doctor 降噪，并在 v5.1.10 收口 Agent 隔离、生命周期、模型凭证、embedding、提案恢复、跨进程状态锁、发布证据与 Hanako v0.374.3 预览版兼容性；默认边界与安全闸门不变）

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
| `npm test` | 1001 个测试，996 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 无阈值越界 |
| `npm run release:check` | Score 100 |

## 未完成项

v5.1.11 当前仍未发布完整的 M1 本地 vector index；语义检索、agent task/graph/resume 与 adaptive thresholds 已有可选或受治理约束的实现路径，但默认关闭、只读或 recommendation-only，不改变保守自动化边界。
