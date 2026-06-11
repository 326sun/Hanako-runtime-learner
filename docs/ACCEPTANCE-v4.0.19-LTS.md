# 验收报告

## 版本信息

改造前：

1. package version: `4.0.18-lts`
2. npm test: `498 passed`
3. npm run check: `passed`
4. npm run benchmark: `17 scenarios passed`
5. npm run release:check: `ready`

改造后：

1. package version: `4.0.19-lts`
2. npm test: `502 passed`
3. npm run check: `passed`
4. npm run benchmark: `17 scenarios passed`
5. npm run release:check: `ready`

## 本版目标

本版属于 v4.0 LTS 维护优化，不改变核心架构。

目标是处理用户提出的三项要求：

```text
1. 审计代码
2. 精简臃肿代码
3. 提升代码性能
```

本版不追求新增自治能力，而是压缩重复逻辑、降低热路径复杂度，并补充针对性测试。

## 新增能力

### 1. Advisor Insights 共享处理层

新增：

```text
lib/advisor-insights.js
```

集中处理三类原本分散在入口文件和控制工具中的逻辑：

```text
mergeAdvisorSuggestions
buildRepeatedCodePatchProposals
buildHighRiskAdvisorCodePatchProposals
```

### 2. 手动 advisor 合并路径优化

`tools/control.js` 的 `run_model_advisor` 以前对每条 suggestion 执行一次 `patterns.find(...)`。

现在改为一次构建 pattern id 索引：

```text
before: O(pattern_count × suggestion_count)
after:  O(pattern_count + suggestion_count)
```

### 3. Runtime 生命周期代码精简

`index.js` 不再直接维护 advisor 合并、重复 proposal 创建、高风险 proposal 创建的局部循环。

入口文件现在只负责：

```text
调度
记录 activity
通知 review
刷新 skill
```

具体 proposal/advisor 细节下沉到可测试 helper。

## 新增文件

```text
lib/advisor-insights.js
tests/advisor-insights.test.js
docs/CODE_AUDIT_OPTIMIZATION_ROUND3_2026-06-10.md
docs/ACCEPTANCE-v4.0.19-LTS.md
```

## 修改文件

```text
package.json
package-lock.json
index.js
tools/control.js
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## 新增测试

```text
advisor insights merges advisor suggestions into arrays with one lookup pass
advisor insights merges advisor suggestions into pattern maps
advisor insights builds repeated code patch proposals only for eligible unresolved error patterns
advisor insights builds high-risk advisor proposals from a pre-indexed pattern source
```

## 安全边界

本版没有扩大任何自动执行边界。

```text
R4 自动执行：仍 blocked
外部副作用：仍 blocked_by_policy
删除、发布、push、tag、release：仍 never_auto
密钥、凭据、付款信息：仍 never_auto
code_patch proposal：仍 manual review only
skill promotion：仍不直接写 SKILL.md
policy gate / scope gate / rollback / verifier：未放宽
```

## 自动执行边界

本版没有新增自动执行动作。

新增 helper 只改变内部组织方式：

```text
advisor advice merge
code_patch proposal construction
high-risk proposal filtering
```

它不会自动应用 code_patch，也不会绕过 review queue。

## 失败回滚验证

本版不新增源码自动写入动作，因此没有新的 runtime rollback 路径。

既有 rollback 仍由以下 benchmark 场景覆盖：

```text
controller.rollback_branch
plugin.rollback_on_verify_failure
safety.rollback_failed_verification
```

## 已知限制

1. `tools/control.js` 仍是大文件，因为它承担 self_learning_control 的动作分发。继续拆分需要 handler 级别特征测试。
2. `lib/pattern-detector.js` 仍较大，但其缓存、遗忘曲线、workflow scoring、relation cleanup 行为耦合较强，暂不建议在 LTS 末期强拆。
3. 本版提升的是 advisor 合并路径复杂度，不代表所有运行路径都有显著性能变化。

## 下一版本建议

v4.0.20 或 v4.1 以后只建议继续维护项：

```text
按 action domain 拆分 tools/control.js
为 pattern-detector 添加更多 characterization tests
增加 benchmark case
补 dashboard HTML 导出
常规 bug fix / 性能优化 / 文档微调
```

## 每版必须回答的 10 个问题

1. 这个版本新增了什么自动能力？
   - 没有新增自动能力；新增的是 advisor/proposal 共享处理 helper。
2. 这个自动能力属于 R 几风险？
   - 不新增动作风险；内部 helper 属于维护优化。
3. 自动执行前有什么 policy gate？
   - 未改变现有 policy gate。
4. 自动执行前有什么 scope gate？
   - 未改变现有 scope gate。
5. 如果执行失败，如何 rollback？
   - 不新增自动写入动作；既有 rollback 机制不变。
6. 如何验证执行成功？
   - `npm run check`、`npm test`、`npm run benchmark`、`npm run release:check`。
7. 失败经验写到哪里？
   - 未改变；仍进入既有 feedback / reflexion / event log 路径。
8. 成功经验如何晋升？
   - 未改变；仍通过 skill candidate / promotion loop，不直接污染 SKILL.md。
9. 什么情况会升级人工确认？
   - 未改变；高风险 code_patch、R3/R4、scope 不明确、policy 冲突仍升级人工确认。
10. 这个版本有没有扩大高风险自动化边界？
   - 没有扩大 R4 或 high-risk 自动化边界。
