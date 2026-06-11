# 验收报告 · v4.0.14 LTS

## 版本信息

改造前：
1. package version: `4.0.13-lts`
2. npm test: `483 passed`
3. npm run check: `passed`
4. npm run benchmark: `passed`, 11 scenarios

改造后：
1. package version: `4.0.14-lts`
2. npm test: `485 passed`
3. npm run check: `passed`
4. npm run benchmark: `passed`, 13 scenarios

## 本版目标

补齐 Agent Controller 的显式恢复分支：当 `VerifyNode` 或可恢复的 `ExecuteNode` 失败时，Controller 不再只能直接失败或进入人工中断，而是可以按图中的下一节点进入 `RepairNode` 或 `RollbackNode`。

## 新增能力

1. `AgentController` 识别恢复节点：
   - `RepairNode`
   - `RollbackNode`

2. `VerifyNode` 失败后可路由到显式恢复分支：
   - `VerifyNode -> RepairNode`
   - `VerifyNode -> RollbackNode`

3. `ExecuteNode` 的验证失败可延后到 `VerifyNode` 统一处理：
   - 避免 executor 已经返回 verification envelope 时，Controller 在 Execute 阶段过早人工中断。
   - 没有恢复分支时，仍会在 Verify 阶段进入人工中断。

4. `RepairNode` 支持两种修复来源：
   - executor 已经执行过的一次受控 repair 结果。
   - controller context 中显式传入的 `repairActionPlan` 或 `repairHandler`。

5. `RollbackNode` 支持两种回滚来源：
   - executor/plugin 已经生成的 rollback 记录。
   - controller context 中显式传入的 `rollbackHandler`。

6. Audit trace 新增恢复分支事件：

```text
node.recovery_branch
```

## 新增文件

```text
benchmarks/scenarios/controller/controller-repair-branch.json
benchmarks/scenarios/controller/controller-rollback-branch.json
docs/ACCEPTANCE-v4.0.14-LTS.md
```

## 修改文件

```text
lib/agent-controller.js
lib/evaluation-runner.js
tests/agent-controller.test.js
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
package.json
package-lock.json
manifest.json
```

## 新增测试

```text
agent controller routes failed verification to explicit rollback branch
agent controller routes failed verification to explicit repair branch
```

## Benchmark 新增场景

```text
controller.rollback_branch
controller.repair_branch
```

Benchmark corpus 从 11 个场景扩展到 13 个场景。

## 安全边界

本版没有扩大高风险自动化边界。

保持不变：

```text
R3/R4 不自动执行
外部副作用不自动执行
删除、发布、push、tag 不自动执行
写入动作仍必须经过 policy/scope/transaction/verification
repair 仍受一次受控修复原则约束
rollback 必须来自 executor 证据或显式 handler
```

## 自动执行边界

自动恢复只在图中显式声明恢复节点时触发：

```text
VerifyNode -> RepairNode
VerifyNode -> RollbackNode
ExecuteNode -> RepairNode
ExecuteNode -> RollbackNode
```

没有显式恢复节点时，失败验证仍然进入人工中断或失败状态。

## 失败回滚验证

`controller.rollback_branch` benchmark 会：

1. 写入一个语法错误文件。
2. 触发验证失败。
3. executor 回滚事务。
4. Controller 从 `VerifyNode` 路由到 `RollbackNode`。
5. `RollbackNode` 检查 rollback evidence。
6. 文件恢复到原内容。
7. Controller 完成任务。

## 已知限制

1. 这不是完整图调度器，只是线性图中的显式恢复分支。
2. `RepairNode` 目前依赖显式 `repairActionPlan` / `repairHandler`，还没有自动生成复杂修复计划。
3. `RollbackNode` 不会凭空重建事务对象，只接受 executor/plugin 的 rollback evidence 或显式 handler。
4. Controller 和 Skill Promotion 仍未完全打通。

## 下一版本建议

下一版建议做：

```text
v4.0.15 Skill Promotion End-to-End Loop
```

目标是把 reflexion、failure cluster、skill candidate、effectiveness tracking 和 decay 串成一条可验证闭环。
