# 验收报告

## 版本信息

改造前：

1. package version: `4.0.17-lts`
2. npm test: `494 passed`
3. npm run check: `passed`
4. npm run benchmark: `16 scenarios passed`

改造后：

1. package version: `4.0.18-lts`
2. npm test: `498 passed`
3. npm run check: `passed`
4. npm run benchmark: `17 scenarios passed`
5. npm run release:check: `ready`

## 本版目标

本版属于 v4.0 LTS 维护硬化，不改变核心架构。

目标是补上一个机器可执行的发布前门禁：

```text
Release Readiness Gate
```

它用于回答：当前包是否满足 LTS 发布契约，是否可以进入分发或打 tag 前的最后确认。

## 新增能力

### 1. Release Readiness Gate

新增 `lib/release-readiness.js`，自动检查：

```text
package.json / package-lock.json 版本一致性
LTS version 格式
当前版本 CHANGELOG 章节
当前版本 ACCEPTANCE 报告
DESIGN_GOAL_COMPLETION_MATRIX 当前版本引用
API_FREEZE 文档
必需 LTS 文档是否存在且非空
benchmark corpus 是否有效
benchmark baseline / thresholds 是否存在
```

输出结构包含：

```json
{
  "summary": {
    "status": "ready",
    "ok": true,
    "version": "4.0.18-lts",
    "score": 100,
    "failedChecks": []
  },
  "checks": []
}
```

### 2. CLI 发布检查

新增：

```text
npm run release:check
```

也可以导出报告：

```text
node scripts/release-readiness.js --output-dir release-readiness
```

输出：

```text
release-readiness.json
release-readiness.md
```

### 3. Control 工具入口

`self_learning_control` 新增：

```text
action=release_readiness
```

它会把 release-readiness 报告写入 learnerDir 下的 `release-readiness/`，并记录 append-only event：

```text
release.readiness_checked
```

### 4. Benchmark 场景覆盖

新增场景：

```text
quality.release_readiness_gate
```

用于证明当前插件包自身满足 release readiness contract。

## 新增文件

```text
lib/release-readiness.js
scripts/release-readiness.js
tests/release-readiness.test.js
benchmarks/scenarios/quality/release-readiness-gate.json
docs/ACCEPTANCE-v4.0.18-LTS.md
```

## 修改文件

```text
package.json
package-lock.json
lib/benchmark-corpus.js
lib/evaluation-runner.js
tools/control.js
README.md
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## 新增测试

```text
release readiness passes when LTS release contract is coherent
release readiness blocks mismatched lockfile and missing acceptance report
release readiness report can be exported as JSON and Markdown
release readiness formatter surfaces failed checks
benchmark: quality.release_readiness_gate
```

## 安全边界

本版没有扩大自动执行边界。

```text
R4 自动执行：仍 blocked
外部副作用：仍 blocked_by_policy
删除、发布、push、tag、release：仍 never_auto
密钥、凭据、付款信息：仍 never_auto
R2 写入：仍必须 transaction + verification + rollback + scope gate
Plugin JS：仍必须显式 allowPluginCodeExecution，且走 process isolation baseline
Cross-project transfer：仍 requires target validation，不自动晋升
Skill promotion：仍不直接写 SKILL.md
Release readiness：只读检查 + 可选报告写入，不执行发布动作
```

## 自动执行边界

`release_readiness` 是治理检查，不是发布动作。

它不会：

```text
自动 git tag
自动 git push
自动 npm publish
自动修改安全策略
自动修改 skill registry
自动修改用户记忆
```

## 失败回滚验证

本版新增能力不改源码执行链，也不新增自动写入源码动作。

报告导出只写入指定报告目录；失败时不会改变 policy、memory、skill、transfer、agent state。

已有 rollback 场景继续由 benchmark 覆盖：

```text
controller.rollback_branch
plugin.rollback_on_verify_failure
safety.rollback_failed_verification
```

## 已知限制

1. Release readiness 检查的是发布契约完整性，不替代 `npm test`、`npm run check`、`npm run benchmark`。
2. 它验证 benchmark corpus 结构与数量，不直接代表 benchmark 运行结果；运行结果仍以 `npm run benchmark` 为准。
3. 它不会执行 git tag、push、release 或 publish。

## 下一版本建议

v4.0.19 或 v4.1 以后只建议做维护项：

```text
增加 benchmark case
补 dashboard 前端或 HTML 导出
增加 provider adapter
可选 container sandbox adapter
修 bug / 优化性能 / 完善文档
```

## 每版必须回答的 10 个问题

1. 这个版本新增了什么自动能力？
   - 新增 release readiness 自动检查与报告导出。
2. 这个自动能力属于 R 几风险？
   - R1/R2 边界内的只读治理检查；报告导出是低风险文件写入。
3. 自动执行前有什么 policy gate？
   - 不涉及动作执行；控制入口只运行本地只读检查和报告写入。
4. 自动执行前有什么 scope gate？
   - 不涉及源码写入；报告写入限定在指定 outputDir 或 learnerDir。
5. 如果执行失败，如何 rollback？
   - 不改核心状态；失败最多留下不完整报告目录，可安全删除。
6. 如何验证执行成功？
   - `npm run release:check`、`npm run check`、`npm test`、`npm run benchmark`。
7. 失败经验写到哪里？
   - 运行时入口会记录 `release.readiness_checked` 事件；失败检查体现在 report 的 failedChecks。
8. 成功经验如何晋升？
   - 本版不新增 skill 晋升路径；仍使用既有 skill promotion loop。
9. 什么情况会升级人工确认？
   - 任一 release readiness check 失败时，发布应人工停止并修复。
10. 这个版本有没有扩大高风险自动化边界？
   - 没有扩大 R4 自动化边界。
