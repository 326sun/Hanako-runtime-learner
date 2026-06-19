# 审计面说明

Runtime Self-Learning 的审计面分成三类：事件链、可读汇总、可导出审计包。

## 事件链

`event_log.jsonl` 是追加写日志，记录以下关键状态变更：

- 提案创建、验证、应用、拒绝
- review 创建、批准、拒绝、应用
- doctor 关键告警
- 自动动作执行、验证、回滚

事件链设计目标：

1. 可回放
2. 可校验
3. 不依赖 UI 才能理解

## 仪表板

`audit-dashboard.js` 会把分散状态整合成一份可读视图，通常包含：

- proposal / review 当前状态
- doctor 汇总
- 作用域泄漏、证据缺失、积压情况
- 自动动作结果与失败原因

## 审计包

执行：

```text
self_learning_control action=export_audit_bundle
```

会生成导出物，通常包括：

- `audit-bundle.json`
- `audit-report.md`

导出时会对明显敏感信息做脱敏，例如 API Key、token、password、secret。

## 冻结要求

v4.x LTS 期间审计面必须满足：

1. 高风险变更必须留下结构化记录。
2. 失败和回滚不能被静默吞掉。
3. 导出能力只读，不产生新的外部副作用。
