# 验收报告

## 版本信息

改造前：
1. package version: `4.0.7-lts`
2. npm test: `462 passed, 0 failed`
3. npm run check: passed

改造后：
1. package version: `4.0.8-lts`
2. npm test: `469 passed, 0 failed`
3. npm run check: passed

## 本版目标

补齐 Cross-project Transfer Registry。让跨项目迁移候选不再只是一次性返回对象，而是成为可追踪、可验证、可失效、可审计的持久化资产。

## 新增能力

- 持久化跨项目迁移候选到 `cross_project_transfers/`。
- 记录候选初始门禁结果、验证命令、验证历史、生命周期事件。
- 支持目标项目验证通过 / 失败记录。
- 验证通过后只标记为“可进入人工晋升评审”，不自动写入 `SKILL.md`。
- 支持候选过期，过期后禁止继续记录验证。
- `self_learning_control` 增加迁移候选的列表、查看、注册、验证、过期操作。
- 审计导出包含 transfer candidate 摘要和状态分布。

## 新增文件

```text
lib/transfer-registry.js
tests/transfer-registry.test.js
docs/ACCEPTANCE-v4.0.8-LTS.md
```

## 修改文件

```text
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
lib/audit-bundle.js
tools/control.js
tests/policy-audit.test.js
```

## 新增测试

```text
tests/transfer-registry.test.js
```

覆盖内容：

```text
register transfer candidate
persist/load transfer candidate
record target validation evidence
block promotion on failed validation
list by target/status
expire candidate and block future validation
batch registration
self_learning_control transfer registry actions
audit bundle transfer candidate summary
```

## 安全边界

- transferred memory 仍然不能直接写入 `SKILL.md`。
- transferred memory 仍然不能自动晋升 active skill。
- 目标项目验证通过后也只是 `manualPromotionEligible: true`。
- 过期或拒绝的候选不能继续验证。
- registry 不降低 `cross-project-scope` 的安全决策。

## 自动执行边界

本版没有扩大 R4 自动执行边界。

## 失败回滚验证

本版新增的是 registry 持久化和状态记录，不涉及文件补丁执行。写入采用临时文件 + rename 的原子写入模式，避免半写入 registry 文件。

## 已知限制

- registry 尚未深度接入 Agent Controller 的迁移任务节点。
- registry 只记录验证状态，不自动运行验证命令。
- skill promotion 仍需人工评审流程进一步接入。

## 下一版本建议

下一版优先补 Benchmark Scenario Corpus，让当前已有的 evaluation runner 不再只有指标计算能力，而是有稳定场景库、基线对比和回归阈值。
