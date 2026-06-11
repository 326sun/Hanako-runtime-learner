# 学习治理

学习结果进入可审计治理链，防止模式膨胀、噪音注入和无人监管的自动变更。

---

## 治理流水线

```
Pattern → autoApprove → Proposal → Review Queue → Diff Preview → Validation Gate → Apply / Reject → Event Log → Rollback
```

### Proposal 与运行时动作风险

| 类型 | 风险 | 行为 |
|---|---|---|
| `skill_patch` | 低 | 默认自动应用，刷新 SKILL.md；严格审核模式下进入 Review Queue |
| `config_patch` | 中 | 经过 Validation Gate；高风险配置会 warning/block |
| `code_patch` | 高 | 永不自动写代码，需人工审批后手动实施 |
| `action_plan` | R0-R4 | 运行时策略计划；低风险可自动执行，高风险只进入 Review Queue |

`action_plan` 不通过 `applyProposal` 写文件，而由 Runtime Auto Action 管线处理：Policy Gate 决定 `auto_execute`、`manual_confirm`、`defer` 或 `reject`。

### Review Queue

Proposal 创建后自动入队，记录：
- 来源 pattern ID
- 风险等级
- diff 预览（skill_patch/config_patch 的行级变更，code_patch 的实施计划）
- validation 状态

控制动作：`review_panel`、`preview_proposal`、`validate_proposal`、`approve_review`、`reject_review`、`apply_review`。

### Validation Gate

Proposal apply 前必须通过。`code_patch` 始终禁止自动 apply。`skill_patch` 检查头部 `# Runtime Self-Learning` + token budget。

`config_patch` 经过完整验证链：
- payload 必须是 plain object
- key 必须在 `DEFAULT_CONFIG` 白名单内（未知 key 拒绝）
- 类型校验（expected type vs actual type）
- number 类型校验范围（`NUMERIC_RANGES`）
- 枚举值检查（`governanceProfile`、`modelAdvisorSource` 等）
- conservative profile 下阻断高风险配置变更（`CONSERVATIVE_BLOCKS`）

所有类型在 doctor 状态为 `critical` 时阻止 apply。

### Event Log

Append-only `event_log.jsonl` 记录 proposal/review/skill 的所有状态变更。`event_summary` 从事件流回放各实体最新状态。

### Rollback

`action=rollback` 从 `skill_history/` 恢复上一个 SKILL.md 快照（上限 20）。

---

## Doctor 健康检查

`self_learning_doctor` 只读诊断，不修改文件。输出 Good / Warning / Critical + 修复建议。

| 检查项 | 触发条件 | 严重度 |
|---|---|---|
| `duplicate_patterns` | desc/fix 完全相同的重复 pattern | warning |
| `conflicting_facts` | 同 subject/predicate 多个有效值 | high |
| `stale_auto_approved` | 自动批准但长期未采纳 | warning |
| `pending_preference_injection` | `includePendingPreferences` 开启且存在未审核偏好 | high |
| `pending_preference_backlog` | 未审核偏好堆积 ≥10 | info |
| `proposal_backlog` | 待处理提案 ≥10（≥25 升级 critical） | warning/critical |
| `skill_budget` | 可注入提示超出 `maxSkillTokens` | info |
| `privacy_retention` | 日志存在超过 30 天的条目 | warning |
| `scope_leakage` | 可注入 pattern 横跨多个具体项目 | info |
| `orphan_relations` | 关系边指向已不存在的 pattern | warning |
| `evidence_missing` | 高分 pattern 缺证据 | info |
| `review_backlog` | 待审核 review ≥20 | warning |
| `validation_blocked_reviews` | 被 validation 阻塞的 review | high |
| `memfs_stale` | MemFS 视图落后于 patterns/facts | info |

评分从 100 起按严重度扣分。Critical 或 <50 → Critical，high/warning 或 <80 → Warning，否则 Good。

---

## MemFS 长期记忆视图

`patterns.json` 是机器源，人读不便。MemFS 把当前记忆渲染为可读、可 diff 的 Markdown 文件树（派生视图，可删除后重建）：

```text
memfs/
├── system/{user_profile,hard_constraints,active_projects}.md
├── projects/<project>.md
├── patterns/{workflows,errors,preferences}.md
└── archive/deprecated.md
```

```text
self_learning_control action=regenerate_memfs
```

---

## 策略配置档

三种预设，一键切换：

| 配置档 | 自动注入 | 自动批准 | Pending 偏好 | 严格审核 |
|---|---|---|---|---|
| `conservative` | 关闭 | 关闭 | 关闭 | 开启 |
| `balanced`（默认） | 开启 | 开启 | 关闭 | 关闭 |
| `autonomous` | 开启 | 开启 | 开启 | 关闭 |

外部网络功能（模型顾问、语义检索）在所有配置档中默认关闭，需显式配置才会外发。

```text
self_learning_control action=set_policy_profile governanceProfile=conservative
```

## 审计包导出

```text
self_learning_control action=export_audit_bundle
```

生成 `audit-bundle.json` + `audit-report.md`，汇总 doctor、scope 分布、proposal/review 状态、event replay summary，自动脱敏 API key/token/secret/password。


## Runtime Auto Action v2.0

运行时动作闭环：

```text
Trigger → Action Plan → Policy Gate → Transaction → Executor → Verifier → Feedback → Learning
```

### 风险分级

| 级别 | 定义 | 自动执行策略 |
|---|---|---|
| R0 | 内部记录、诊断、统计 | 自动 |
| R1 | 只读或可忽略副作用 | 自动 |
| R2 | 工作区内可回滚写入或上下文重组 | 需要 verification 与 rollback |
| R3 | 影响长期行为或项目状态 | 默认人工确认 |
| R4 | 外部不可逆或高影响动作 | 永不自动执行 |

### 永不自动执行

以下动作被视为高风险或破坏性动作，必须人工确认或直接拒绝：

```text
rm -rf / delete / remove project files
git push / git tag / release
npm publish
external POST/PUT/PATCH/DELETE
send email/message
modify credentials/secrets
relax validation or policy gates
```

### 自动执行后的验证

每个自动执行动作必须生成结构化结果并经过 `action-verifier`：

- 命令 exit code
- 测试/检查通过情况
- diff scope
- 反馈指标 before/after
- transaction rollback 状态

结果写入 append-only `action_feedback.jsonl`。策略权重写入 `action_policy_weights.json`，但权重只能影响优先级，不能绕过风险分级和 Validation Gate。


### v2.1 R2 事务写入规则

`apply_patch_sandboxed` 与 `execute_repair_once` 属于 R2 动作，允许在严格门禁下自动执行，但必须满足以下条件：

1. 必须提供 rollback plan，并由 `action-transaction` 捕获目标文件快照。
2. 必须提供 verification，例如 `verification.metrics` 与 `verifyCommands`。
3. 文本补丁使用 `oldText/newText`，默认 `oldText` 必须唯一匹配。匹配 0 次或多次都会拒绝并回滚。
4. 验证命令必须在 allowlist 内，且不能命中 denylist。
5. 验证失败时先尝试一次受控 `repairPlan`；没有 repair 或 repair 失败时自动 rollback。
6. repair 最多一次，不允许循环修复。
7. 所有结果写入 `action_feedback.jsonl`，但反馈权重不得绕过风险门禁。

新增 verifier 指标：

- `patch_applied`：确认实际发生了 patch/write。
- `verification_commands_pass`：确认验证命令全部通过。
- `rollback_clean`：确认回滚后目标文件恢复干净。
