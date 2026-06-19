# v3 到 v4 迁移说明

v4 的核心变化不是“功能更多”，而是“边界更清晰、治理更完整、发布更可控”。

## 迁移重点

### 1. 学习结果不再直接等价于生效结果

v4 引入了 proposal、review、validation、doctor、audit 这条完整治理链。原本偏直接的学习写入路径被拆成“学习”和“应用”两步。

### 2. 自动动作有了正式的风险分级

v4 对动作明确区分 R0-R4：

- R0 / R1：只读或低风险
- R2：工作区内可回滚写入
- R3：需要人工确认
- R4：永不自动执行

### 3. 数据与审计面更完整

新增或强化了：

- `event_log.jsonl`
- `action_feedback.jsonl`
- `memfs/`
- release readiness 检查

## 对使用者的影响

1. 默认行为更保守。
2. 某些以前“看起来会自动做”的动作现在需要 review 或验证。
3. 发布前需要跑正式发布门。

## 对开发者的影响

1. 插件动作不能再绕开命令策略。
2. 配置 patch 必须通过统一校验链。
3. 任何高风险扩展都必须先落文档，再进实现。

## 建议迁移步骤

1. 升级代码。
2. 保留原有 `self-learning` 数据目录。
3. 运行 `self_learning_control action=status` 确认数据目录和版本。
4. 运行 `self_learning_doctor` 清理积压告警。
5. 如需发布，执行 `npm run release:check`。
