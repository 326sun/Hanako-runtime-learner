# 动作 API 冻结说明

本文档描述 v4.x LTS 期间对动作插件接口的冻结边界。目标是允许扩展动作能力，但不允许插件绕开风险分级、命令策略、事务和验证。

## 范围

动作接口覆盖以下内容：

- `action.json` 的声明结构
- `execute.js`、`verify.js`、`rollback.js` 的约定
- 动作计划的输入输出包络
- 运行时如何把动作纳入策略门和事务模型

## 动作计划包络

最小包络示例：

```json
{
  "id": "repair-once-001",
  "type": "execute_repair_once",
  "riskTier": "R2",
  "goal": "修复一次可验证的本地错误",
  "steps": [
    {
      "kind": "patch",
      "target": "src/example.js",
      "oldText": "old",
      "newText": "new"
    }
  ],
  "verification": {
    "verifyCommands": ["node --check src/example.js"]
  },
  "rollback": {
    "strategy": "transaction"
  }
}
```

冻结规则：

1. `type` 必须映射到已知动作类型或受控插件动作。
2. 声明的 `riskTier` 只能抬高基线风险，不能降低基线风险。
3. `steps` 可以是结构化对象，但最终仍会进入破坏性意图扫描和策略门判断。
4. `verification` 和 `rollback` 不是可选的安全建议；对 R2 写动作来说，它们是执行前提。

## 结果包络

执行结果必须可结构化消费，最少应包含：

```json
{
  "ok": true,
  "actionId": "repair-once-001",
  "riskTier": "R2",
  "verificationPassed": true,
  "rollbackUsed": false,
  "changedFiles": ["src/example.js"]
}
```

推荐补充字段：

- `exitCode`
- `summary`
- `metrics`
- `artifacts`
- `warnings`

## `action.json` 约束

动作包的 `action.json` 是声明文件，不是放权文件。

要求：

1. 只能声明动作元数据、允许的模块入口和验证方式。
2. 不能通过包内声明绕过全局命令策略。
3. `execute.js`、`verify.js`、`rollback.js` 必须是动作包内的常规文件，不能通过软链接逃逸到包外。
4. 插件代码执行仍受 `allowPluginCodeExecution` 总开关约束。

## 冻结的安全约束

v4.x LTS 期间，下列规则视为冻结：

1. R4 动作永不自动执行。
2. 写文件动作必须走事务快照和验证。
3. 命令执行必须同时经过 allowlist 和 denylist。
4. 插件动作不能通过声明降低 loader 的命令门槛。
5. 回滚失败会被记录，但不能被静默忽略。

## 向后兼容承诺

在 v4.x LTS 内：

- 现有动作包字段不会无预告删除。
- 已冻结字段的语义不会悄悄改成更宽松。
- 新增字段只会是向后兼容扩展，不会改变既有安全边界。
