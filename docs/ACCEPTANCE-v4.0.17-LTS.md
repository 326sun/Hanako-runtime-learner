# 验收报告

## 版本信息

改造前：

1. package version: `4.0.16-lts`
2. npm test: `492 passed`
3. npm run check: `passed`
4. npm run benchmark: `15 scenarios passed`

改造后：

1. package version: `4.0.17-lts`
2. npm test: `494 passed`
3. npm run check: `passed`
4. npm run benchmark: `16 scenarios passed`

## 本版目标

完成 v4.0 LTS 最后一轮收口：

```text
LTS Docs + API Freeze
Active Skills Prompt Injection Gate
Final Candidate Evidence
```

## 新增能力

### 1. LTS API 冻结文档

新增并冻结以下公开契约：

```text
docs/ACTION_API.md
docs/POLICY.md
docs/TRANSACTION.md
docs/SANDBOX.md
docs/SKILL_PROMOTION.md
docs/AUDIT.md
docs/BENCHMARKS.md
docs/MIGRATION_v3_to_v4.md
docs/API_FREEZE.md
```

这些文档明确了 Action Plugin API、Policy Decision API、Transaction API、Sandbox API、Skill Promotion API、Audit API、Benchmark API 与迁移规则。

### 2. Active Skills Injection Gate

v4.0.15 已经让 `active_skills.json` 成为证据支持的 active skill registry。v4.0.17 补上最后的受控注入门：

```json
{
  "activeSkillsInjectionEnabled": false,
  "activeSkillsInjectionMaxCount": 3,
  "activeSkillsInjectionMinSuccess": 7,
  "activeSkillsInjectionMaxRegression": 0
}
```

默认仍然关闭。只有显式开启时，`active_skills.json` 中满足以下条件的规则才会进入渲染后的 `SKILL.md`：

1. `status === "active"`
2. 有 `rule`
3. `successCount >= activeSkillsInjectionMinSuccess`
4. `regressionCount <= activeSkillsInjectionMaxRegression`
5. `injectable !== false`
6. 最终仍受 `maxSkillTokens` 裁剪

### 3. Benchmark 新增 render_skill 场景

新增 benchmark step：

```text
render_skill
```

新增场景：

```text
skill.active_skill_injection_gate
```

证明 active skill registry 不会默认污染 `SKILL.md`，只有通过显式 gate、成功证据和回归门槛后才进入 skill preview。

## 新增文件

```text
docs/ACTION_API.md
docs/POLICY.md
docs/TRANSACTION.md
docs/SANDBOX.md
docs/SKILL_PROMOTION.md
docs/AUDIT.md
docs/BENCHMARKS.md
docs/MIGRATION_v3_to_v4.md
docs/API_FREEZE.md
docs/ACCEPTANCE-v4.0.17-LTS.md
benchmarks/scenarios/skill/active-skill-injection-gate.json
```

## 修改文件

```text
lib/common.js
lib/evaluation-runner.js
lib/benchmark-corpus.js
tests/common.test.js
README.md
CHANGELOG.md
manifest.json
package.json
package-lock.json
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## 新增测试

```text
common.test: gates active skill registry injection behind explicit config
common.test: selects only injectable active skills
benchmark: skill.active_skill_injection_gate
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
Active skill injection：默认关闭，必须显式 opt-in
```

## 自动执行边界

`activeSkillsInjectionEnabled` 只影响 `SKILL.md` 渲染内容，不自动执行动作，不提升风险权限，不绕过 policy gate。

## 失败回滚验证

本版无新增写入类自动动作。已有 rollback 场景继续由 benchmark 覆盖：

```text
controller.rollback_branch
plugin.rollback_on_verify_failure
safety.rollback_failed_verification
```

## 已知限制

1. 当前 sandbox 是命令与子进程隔离，不是完整容器级隔离。
2. Dashboard 已支持 Markdown/JSON report surface，但没有独立前端 UI。
3. `activeSkillsInjectionEnabled` 开启后仍建议定期查看 `active_skills.json` 和 dashboard。

## 下一版本建议

v4.1 以后建议只做维护：

```text
bug fix
benchmark case expansion
adapter pack
docs refinement
optional container sandbox adapter
optional dashboard frontend
```

## 每版必须回答的 10 个问题

1. 这个版本新增了什么自动能力？
   - 没有新增自动执行能力；新增 active skill 受控注入门和 API freeze 文档。
2. 这个自动能力属于 R 几风险？
   - Active skill rendering 属于 R1/R2 边界内的 prompt-surface 变更，不执行外部动作。
3. 自动执行前有什么 policy gate？
   - 不涉及动作执行；动作执行仍受原 Policy Gate。
4. 自动执行前有什么 scope gate？
   - 不涉及写入动作；R2 写入仍受 Scope Gate。
5. 如果执行失败，如何 rollback？
   - 本版不新增写入执行；既有 transaction rollback 继续保留。
6. 如何验证执行成功？
   - `npm run check`、`npm test`、`npm run benchmark`。
7. 失败经验写到哪里？
   - 仍写入 reflexion/action_feedback 相关文件。
8. 成功经验如何晋升？
   - 仍通过 skill promotion loop 进入 candidate/staged/active registry。
9. 什么情况会升级人工确认？
   - R3/R4、scope unclear、budget exceeded、external side effect、cross-project promotion、policy-sensitive writes。
10. 这个版本有没有扩大高风险自动化边界？
   - 没有扩大 R4 自动化边界。
