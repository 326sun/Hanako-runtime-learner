# 验收报告

## 版本信息

改造前：
1. package version: 2.1.0
2. npm test: 447 pass, 0 fail
3. npm run check: 通过

改造后：
1. package version: 4.0.0-lts
2. npm test: 538 pass, 0 fail
3. npm run check: 通过

## 本版目标

实现 Hanako-runtime-learner v4.0 LTS：
在明确安全边界内，系统能够自动观察任务、识别风险、生成计划、执行低中风险动作、验证结果、失败回滚、总结经验，并把被验证有效的经验逐步沉淀为可控技能。

## 新增能力

| 版本 | 能力 | 模块 |
|---|---|---|
| v2.2 | Review Queue 与 Executor 打通 | proposal-execution.js, review-executor.js |
| v2.3 | Diff Preview + Scope Gate | scope-gate.js, impact-analyzer.js |
| v2.4 | Repair Engine 强化 | repair-classifier.js, repair-strategies.js |
| v2.5 | Task Decomposition Runtime | task-decomposition.js, task-graph.js, task-executor.js |
| v2.6 | Reflexion Memory | reflexion-memory.js |
| v2.7 | Skill Promotion Pipeline | skill-promotion.js |
| v2.8 | Model Router | model-router.js |
| v3.0 | Agent Controller | agent-controller.js |
| v3.1 | Sandbox Execution Environment | sandbox-runner.js, sandbox-policy.js, command-allowlist.js, filesystem-boundary.js |
| v3.2 | Audit Dashboard | dashboard-data.js, audit-summary.js, execution-timeline.js, risk-report.js |
| v3.3 | Cross-project Memory Transfer | project-profile.js, memory-transfer.js, cross-project-scope.js |
| v3.4 | Action Marketplace | action-registry.js, action-loader.js |
| v3.5 | Benchmark Suite | evaluation-runner.js, evaluation-metrics.js |

## 新增文件

**lib/** (19 个新模块)
- lib/reflexion-memory.js
- lib/skill-promotion.js
- lib/model-router.js
- lib/agent-controller.js
- lib/sandbox-policy.js
- lib/command-allowlist.js
- lib/filesystem-boundary.js
- lib/sandbox-runner.js
- lib/dashboard-data.js
- lib/audit-summary.js
- lib/execution-timeline.js
- lib/risk-report.js
- lib/project-profile.js
- lib/memory-transfer.js
- lib/cross-project-scope.js
- lib/action-registry.js
- lib/action-loader.js
- lib/evaluation-runner.js
- lib/evaluation-metrics.js

**tests/** (13 个新测试文件)
- tests/reflexion-memory.test.js
- tests/skill-promotion.test.js
- tests/model-router.test.js
- tests/agent-controller.test.js
- tests/sandbox-policy.test.js
- tests/command-allowlist.test.js
- tests/filesystem-boundary.test.js
- tests/sandbox-runner.test.js
- tests/audit-dashboard.test.js
- tests/cross-project-transfer.test.js
- tests/action-marketplace.test.js
- tests/benchmark-suite.test.js

## 修改文件

- lib/action-executor.js（集成 scope-gate 和 repair-classifier）
- lib/proposal-execution.js（处理 scope gate queued/rejected 状态）
- lib/agent-controller.js（扩展状态转换规则）
- package.json（版本号、check/test 脚本更新）
- CHANGELOG.md

## 安全边界

- R4 永不自动执行
- 外部副作用永不自动执行
- 删除、发布、发消息、改密钥永不自动执行
- 自动写入必须 sandbox + transaction + rollback
- 自动执行必须 verifier
- repair 最多一次
- retry 最多一次
- scope 不明确时人工确认
- 多候选时人工确认
- 权重学习不能绕过 policy gate
- skill 晋升必须有 evidence

## 自动执行边界

| 动作类型 | 策略 |
|---|---|
| 只读分析 | 自动 |
| 运行测试 | 自动 |
| 生成报告 | 自动 |
| 小范围补丁 | 事务保护下自动 |
| 大范围重构 | 默认人工确认 |
| 修改安全门禁 | 人工确认，且需要额外校验 |
| 删除文件 | 默认禁止，除非明确人工确认 |
| push/tag/release | 永不自动 |
| 发消息、发邮件 | 永不自动 |
| 修改密钥、凭据、付款信息 | 永不自动 |

## 失败回滚验证

- R2 写入动作具备事务保护
- 验证失败自动触发回滚
- repair 失败后自动回滚
- scope gate 拒绝后不回滚（未执行）
- 回滚记录进入审计跟踪

## 已知限制

- Reflexion Memory 的 insight 提取基于规则启发式，未接入语义模型
- Cross-project Transfer 的 rewriteRequired 仅支持 test_command 和 skill_candidate
- Sandbox 的网络限制依赖底层命令白名单，不强制网络隔离
- Benchmark Suite 目前为框架级实现，未包含大量真实场景 case

## 下一版本建议

v4.0 是 LTS 最终稳定版。后续维护路线：
- v4.1：修 bug、补测试、优化性能、完善文档
- v4.2：增加更多 provider adapter、项目类型 profile、action plugin
- v4.3：更严格审计日志、策略锁定、只读模式、离线模式、团队审批流
