# Complexity Debt Ledger

复杂度债务清单。记录已知的复杂度热点，便于维护期有计划地治理，而**不是**要求在 LTS 期立刻重构。

- 预算与规则：[COMPLEXITY_BUDGET.md](COMPLEXITY_BUDGET.md)
- 实时数据：[COMPLEXITY_REPORT.md](COMPLEXITY_REPORT.md)（`npm run complexity:report` 刷新）

## 记录格式

每条债务包含以下字段：

- **ID**：`C-NNN`，单调递增，永不复用。
- **Area**：所属区域 / 文件。
- **Symptom**：复杂度表现。
- **Evidence**：可验证的度量（来自复杂度报告）。
- **Risk**：放任不管的风险。
- **Fix**：建议的低风险治理方向（不强制立刻执行）。
- **Status**：`open` / `accepted`（接受为 LTS 期常态）/ `in-progress` / `resolved`。

债务超出 hard limit 时必须升级处理（会阻断 `release:check`）；仅超出 soft target 时记为
`open` 或 `accepted`，作为优先治理对象。

---

## C-001 — tools/control.js 控制分发器过大

- **Area**: `tools/control.js`
- **Symptom**: 单文件 LOC 与 import 数初始为全仓最高，承担过多控制面动作分发职责。
- **Evidence（LOC 轨迹）**: 初始 712 LOC / 28 imports（均超 soft 600/20，仍在 hard 900/35 内）→ 3a 后 667 / 29 → 3b 后 620 / 30 → 3c（仅测试）620 / 30 → 拆分试点 610 / 31 → events 域迁移 **601 / 32**。**累计 712 → 601 LOC（−111，−15.6%）**；imports 28 → 32（每次只读抽取需在 control.js import 回用，故 imports 不降反小升，已多次预判并验证）。control.js **已不再是全仓最大文件**（现最大为 `tests/pattern-detector.test.js` 648 LOC）。
- **Risk**: 控制面入口持续累积分支；imports 偏高但稳定处于 hard limit（35）内，距上限仍有余量。
- **Status**: **closed-low-risk（第十阶段 2026-06-24 阶段性收口）** —— 低风险治理全部完成；高风险/收益递减部分明确 deferred（见下"收口结论"）。LTS 维护期不再继续拆分。

### 第三阶段职责地图（2026-06-24，纯审计，未改代码）

| 区域 | 行号 | 职责 | 依赖/外部模块 | 被哪些动作使用 | 适合抽出? |
|---|---|---|---|---|---|
| imports | 1–28 | 27 条 import，覆盖 24 个源模块 | 几乎所有 lib 子系统 + doctor/_shared | 全部 | 否（是症状，非原因；只有拆 handler 才会下降） |
| 共享/skill 助手 | 30–57 | `buildSkill`/`regenerateSkill`（skill 渲染+落盘）、`redactConfig`+`SENSITIVE_CONFIG_KEYS`、`readPluginVersion` | skill-lifecycle、common、fs | 多个 mutation 动作 + status | 部分（见下） |
| 纯汇总/格式化 | 59–103 | `countByStatus`、`summarizeDecoratedPatterns`、`countWaitingAgentTasks`、`validationNextAction`、`reviewPanelNextActions` | 无（纯函数） | status / review_panel / validate_proposal | **是（最佳候选）** |
| HANDLERS 动作表 | 105–559 | ~45 个动作处理器（读/改/审批/迁移/报告/外部模型/诊断） | 全部子系统 | execute 路由 | 否（action 执行链，本期排除） |
| 工具元信息 | 560–562 | `name` / `description` | — | 宿主契约 | 否 |
| **安全分类（边界）** | 564–635 | `*_ACTIONS` 五个集合 + `describeControlSideEffect` + `sessionPermission` | — | 宿主权限门 | **否（安全边界，明确不抽）** |
| parameters schema | 637–696 | 输入 JSON Schema（action enum + ~50 属性） | 引用 `Object.keys(HANDLERS)` | 宿主契约 | 是（纯数据，属性表可抽） |
| execute 调度 | 698–712 | 加载 config/patterns、查表、包装结果 | common | 入口 | 否（核心路由） |

**关键结论**：control.js 的两个头部指标里，**712 LOC 可由纯函数/schema 抽取适度降低，但 28 imports 不会**——import 数由 HANDLERS 需要几乎所有子系统驱动，只有把 handler 按域拆分（属 action 执行链，本期排除）才能下降。因此本期只规划「降 LOC、不动执行链与边界」的安全抽取，import 治理留待后续专项。

- **Fix plan（分级，低风险优先）**：
  1. **3a 抽纯汇总/格式化函数 ✅ 已完成（第四阶段 2026-06-24）** → 新建 `tools/control-summaries.js`，迁移 `countByStatus` / `summarizeDecoratedPatterns` / `countWaitingAgentTasks` / `validationNextAction` / `reviewPanelNextActions` 5 个纯函数（函数体逐字不变），control.js import 回用。新增 `tests/control-summaries.test.js`（18 个直接单测）。control.js 712 → 667 LOC；测试 606 → 624（计数已同步 README 徽章/文案、release-readiness 默认与夹具）。四门全绿、0 violations。
  2. **3b 抽 parameters 属性表 ✅ 已完成（第五阶段 2026-06-24）** → 新建 `tools/control-parameters.js` 导出 `CONTROL_PARAM_PROPERTIES`（除 `action` 外的全部属性，逐字迁移）。control.js 保留 `action`（含 `enum: Object.keys(HANDLERS)`）并以 `properties: { action, ...CONTROL_PARAM_PROPERTIES }` 展开，键顺序不变、schema 等价。新增 `tests/control-parameters.test.js`（7 个单测，校验字段/顺序/required/enum 等价）。control.js 667 → 620 LOC；测试 624 → 631（计数已同步）。**注**：原 schema 不含 `additionalProperties`，为保持行为未新增该字段（不改变输入校验契约）。四门全绿、0 violations。
  3. **3c 评估型处理 ✅ 已完成（第六阶段 2026-06-24，仅测试+文档，未改生产代码）**：
     - **`redactConfig`**：确认与 `lib/audit-bundle.js` 同名函数**语义不同（见下表）**，**保留分离、不合并**。新增 `tests/control-redaction.test.js`（7 个特征测试），分别经公共入口 `execute({action:"status"})` 与 `buildAuditBundle({config})` 锁定两者行为，未导出/未移动任何涉密私有函数。
     - **`readPluginVersion`**：纯只读、显式 `pluginDir` 入参、无 control 上下文依赖 → 原则上可抽；但抽出会给本就 import 偏多的 `control.js` **再加一条 import**（仅省 ~2 LOC），得不偿失，**保持原地**，留待 handler 按域拆分专项时随 import 重组一并处理。
  4. **后续专项（非本期）**：HANDLERS 按域拆子模块（proposals / reviews / agent-tasks / transfers / reports / skill-promotion），每组自带 import——这是唯一能同时降 LOC 和 imports 的路径，但属 action 执行链，须先补 characterization 测试再分组，单独评审。
     - **回归网准备 ✅（第七阶段 2026-06-24）**：新增 `tests/control-handlers.characterization.test.js`（27 个用例），经 `execute()` 锁定拆分前各 handler 域的当前行为：status/doctor/list、proposals/reviews 查询、events、agent-tasks、transfers、skill-promotion/policy-profiles、set_config（成功回显 + 校验拒绝）、run_model_advisor（disabled / 无 key，均不触网）、安全拒绝路径（conservative 挡 apply_proposal、未知 review、trust_project_scripts 无脚本拒绝、unknown action）。未改任何生产代码。
     - **拆分试点 ✅（第八阶段 2026-06-24）**：迁移**一个低风险只读域**到 `tools/control-handlers/skill-policy.js`（导出 `skillPolicyHandlers`：`list_skill_candidates` / `list_active_skills` / `list_policy_profiles`，函数体逐字不变），control.js 以 `...skillPolicyHandlers` 挂回 HANDLERS 汇总表。子模块仅实现 handler 体，**不持有权限判定**；`execute` / `*_ACTIONS` / `describeControlSideEffect` / `sessionPermission` 全部留在 control.js 未改。control.js 620 → 610 LOC；imports 30 → 31（此只读域的 `loadSkillCandidates`/`loadActiveSkills` 仍被 `status` 使用，故不随迁移移出——**印证审计结论：只有“该域 import 变为子模块独占”时 control.js imports 才会下降**；本试点目的是验证迁移机制而非降 imports）。子模块 28 LOC / 2 imports。第七阶段 27 个 characterization 全绿、四门全绿、0 violations。后续可按此模式迁移更多**纯只读且 import 可独占**的域（如 events、transfers 查询）以真正压低 control.js imports；写副作用/安全相关 handler 仍不迁移。
     - **候选审计 + events 域迁移 ✅（第九阶段 2026-06-24）**：审计 events / transfers 查询 / agent-tasks 查询三域，结论——三者迁移后 control.js imports **均减 0**（各域至少一个函数仍被 `status` 或 `export_audit_bundle` 使用，故 lib import 行保留；LOC 减幅均 <25）。三者仅满足准入条件 3（新模块 imports ≤5 且边界清晰）。选**收益最高、风险最低**的 events 域迁移到 `tools/control-handlers/events.js`（`eventHandlers`：`list_events` / `event_summary` / `verify_event_log`，纯只读、逐字不变）。control.js 610 → 601 LOC；imports 31 → 32（+1 子模块 import；`event-log.js` 行保留供 `readEvents`/`appendEvent`/`replayEventState` 用，仅移除 control.js 中已无引用的 `verifyEventLog` 绑定）。子模块 27 LOC / 1 import。第七阶段 events 域 3 个 characterization 全绿、四门全绿、0 violations。

       **候选审计表（第九阶段）**

       | 域 | handler | 新模块 imports | 该域 import 是否 control.js 独占 | control.js imports 变化 | control.js LOC 变化 | 写副作用/网络/credential/安全 | 准入 |
       |---|---|---|---|---|---|---|---|
       | events | list_events / event_summary / verify_event_log | 1 | 否（readEvents/replayEventState 仍用于 export_audit_bundle；appendEvent 全局） | 0（净 +1：新增子模块 import） | −9 | 无（纯读） | 条件 3 ✓ → **已迁移** |
       | transfers 查询 | list_transfer_candidates / show_transfer_candidate | 1 | 否（listTransferCandidateRecords 用于 status+audit；summarizeTransferCandidate 用于写 handler） | 0 | ~−7 | 无（纯读） | 条件 3 ✓（未选） |
       | agent-tasks 查询 | list_agent_tasks / show_agent_task | 1 | 否（listAgentTaskStates 用于 status） | 0 | ~−8 | 无（纯读） | 条件 3 ✓（未选） |

       **结论**：纯只读域因依赖与 status/audit-bundle 共享，逐域迁移**无法降 control.js imports**，只能小幅降 LOC。要真正压低 imports，需把 status/export_audit_bundle 对这些函数的使用一并纳入领域聚合（更大重构，超出"单域只读迁移"边界）。后续单域迁移收益递减，建议达成既定 LOC 目标后停止增量拆分，或另立专项处理聚合。
     - **未覆盖/留待 fixture 的 handler**：含写副作用且需多步 fixture 的 happy-path（`apply_proposal`/`apply_review` 成功、`preview_proposal`/`validate_proposal`、`approve`/`reject`、`regenerate_skill`/`regenerate_memfs`、`rollback`、`run_benchmarks`/`export_audit_bundle`/`generate_audit_dashboard`/`release_readiness`、`run_skill_promotion_loop`、agent-task 审批/恢复、transfer 注册/校验/过期）。其中 proposals/reviews 工作流已由 `tests/review-governance.test.js` 行为覆盖，release/benchmark 由 `tests/control-runtime-package.test.js` 覆盖，credential 路径由 `tests/control-credentials.test.js` 覆盖；其余（agent-task 恢复链、transfer 全生命周期、audit-bundle/dashboard 内容断言）需较重 fixture，**登记为拆分专项启动前需补的回归项**，本期不写脆弱测试。
- **不建议现在抽**：HANDLERS 执行体、安全分类集合 + `describeControlSideEffect` + `sessionPermission`、`execute` 调度、credential 处理（`run_model_advisor`/`set_config`）、脚本信任（`trust_project_scripts`）、proposal apply（`apply_proposal`/`apply_review`）。
- **现有测试覆盖**：`control-credentials` / `control-runtime-package` / `runtime-e2e` / `review-governance` / `audit-dashboard` / `disk-sync` / `event-log` 经 `execute()` 行为级覆盖，可作为后续抽取的回归网（但未直接单测上述纯函数）。

#### 两处 `redactConfig` 行为差异（已由 `tests/control-redaction.test.js` 锁定，禁止合并）

| 维度 | `tools/control.js` redactConfig | `lib/audit-bundle.js` redactConfig |
|---|---|---|
| 屏蔽哪些 key | 固定白名单：`modelAdvisorApiKey`、`semanticEmbeddingApiKey` | 正则 `/api.?key\|token\|secret\|password/i` 匹配的任意 key |
| 屏蔽掩码 | `"***"` | `"[redacted]"` |
| URL/endpoint | **不处理**（原样保留） | 匹配 `/url\|endpoint/i` 的字符串值 → 取 `new URL(...).origin` |
| token/secret/password | 不单独处理（除非命中固定 2 key） | 处理（正则命中） |
| 空值（falsy） | 不屏蔽（仅 truthy 才屏蔽） | 不替换（`out[key]=out[key]`，等效保留） |
| 调用入口 | `status` / `set_config` 的输出 `config` 字段 | `buildAuditBundle(...).config` |

两者服务不同场景（控制面回显 vs 审计包导出），掩码风格与覆盖面均不同，**合并会改变两侧输出语义且涉密，明确不做**。

#### 收口结论（第十阶段 2026-06-24）

C-001 的**低风险治理已全部完成并收口**，进入 LTS 维护期常态；高风险/收益递减部分明确 deferred。

**已完成**

| 子项 | 状态 | 落点 |
|---|---|---|
| 3a 纯汇总/格式化抽取 | ✅ | `tools/control-summaries.js` + 单测 |
| 3b parameters 属性表抽取 | ✅ | `tools/control-parameters.js` + 单测 |
| 3c redact/readPluginVersion 评估 | ✅ | 行为锁定测试 `tools/control-redaction` + 文档；redactConfig 保留分离、readPluginVersion 留原地 |
| HANDLERS characterization 回归网 | ✅ | `tests/control-handlers.characterization.test.js`（27 用例） |
| skill/policy handler 拆分试点 | ✅ | `tools/control-handlers/skill-policy.js` |
| events handler 域迁移 | ✅ | `tools/control-handlers/events.js` |

**Deferred（LTS 维护期不做）**

- **transfers / agent-tasks 小域迁移**：暂缓。审计已证明这两域迁移后 control.js imports **减 0**、LOC 仅减 ~7/~8，收益递减；每迁一域反而新增一条子模块 import。与已迁移的 events 相比无额外结构收益，不值得继续制造改动面。
- **import 聚合专项**：deferred。control.js imports 偏高的根因是 `status` / `export_audit_bundle` 这两个"聚合型" handler 跨域引用了几乎所有子系统的函数，使各只读域的依赖无法被子模块独占。要真正压低 imports，必须重组 status/audit-bundle 的共享依赖（聚合层重构），**风险高于当前 LTS 维护目标**，且 imports 当前 32 仍稳处 hard limit（35）内、距上限有余量——不构成发布阻断。故延后，待有明确必要时另立专项评审。

**当前结论**

- control.js 已从 **712 → 601 LOC（−15.6%）**，退出"全仓最大文件"。
- imports 仍偏高（32），但在 hard limit（35）内，非发布阻断项。
- 低风险部分完成，高风险/低收益部分延后；C-001 以 `closed-low-risk` 收口，不再继续拆分。

#### 收口后追记（simplify-S6 台账对齐，2026-07-03）

上文第十阶段的"Deferred"清单在 v5.1.1 审计的 S11.P2 遍（收口之后）被**实际推进**了，
台账此前未同步，特此对齐（详见对应 commit message）：

- **commit `97acb85`（2026-06-27，S11.P2）**：迁移 **agent-tasks 域**
  （`control-handlers/agent-tasks.js`：agent_graph_preview + list/show/approve/
  reject/cancel/resume_agent_task）与 **audit 域**（`control-handlers/audit.js`：
  run_benchmarks + export_audit_bundle + generate_audit_dashboard 等）。
- **commit `21eaccf`（2026-06-28，S11.P2）**：迁移 **transfers 域**
  （`control-handlers/transfer.js`），control.js 558→524 LOC。

即：第九阶段候选审计表中"未选"的 transfers/agent-tasks 两域已完成迁移，且
S11.P2 进一步突破了第九阶段"纯只读域迁移无法降 imports"的边界（agent-tasks
迁移带走了 agent-graph-readonly / agent-resume 两条 import）。

**现状快照（2026-07-03，`complexity:report` 实测）**：`tools/control-handlers/`
共 5 个子模块（skill-policy / events / agent-tasks / audit / transfer）；
control.js **627 LOC / 31 imports**（对比收口快照 601/32：imports 净降 1；
LOC 上升 26 来自 v5.1.3 功能与 P8.B 复用逻辑等正常增量，非治理回退）。
C-001 维持 `closed-low-risk` 状态不变。

## C-002 — 大型 test 文件

- **Area**: `tests/pattern-detector.test.js` 等
- **Symptom**: 个别测试文件体量大，单文件覆盖过多场景，定位与维护成本上升。
- **Evidence**: `tests/pattern-detector.test.js` 648 LOC（> soft 600）；`tests/common.test.js` 530；`tests/observer.test.js` 456。
- **Risk**: 测试文件膨胀降低可读性，但不影响运行时安全；优先级低于 lib/tools。
- **Fix**: 按行为分组拆分为更小的 `*.test.js`；纯测试改动，零运行时风险。
- **Status**: **resolved（simplify-S5，2026-07-03）** — `pattern-detector.test.js`
  666 LOC 按行为拆为三件（core store 233 / ingest 277 / prune 234），42 用例
  逐字搬移、总数不变；超 soft 的测试文件清零。次大的
  `runtime-e2e.test.js`（588）评估后保留（未超 soft，重型共享夹具拆分为负收益），
  留作 soft 线突破时的观察项。

## C-003 — 核心运行时模块体量偏大

- **Area**: `lib/observer.js`、`lib/action-registry.js`
- **Symptom**: 核心模块接近 soft target，属架构中心节点，改动半径大。
- **Evidence**: `lib/observer.js` 496 LOC、`lib/action-registry.js` 476 LOC（soft 600 以内但偏高）。
- **Risk**: 属 v4.x 核心架构，LTS 期**禁止大改**；强行拆分风险高于收益。
- **Fix**: 维护期仅监控，不主动拆分；若未来逼近 soft/hard 再评估抽取纯函数辅助模块。
- **Status**: accepted

## C-004 — 基础设施 export 面偏宽

- **Area**: `lib/helpers.js`、`lib/json-io.js`
- **Symptom**: grab-bag 式工具模块导出项多，接近单文件 export soft target。
- **Evidence**: 初始 `lib/helpers.js` 与 `lib/json-io.js` 各 17 exports（soft target 18，逼近）。
- **Risk**: 工具模块持续吸附新导出，越过 soft target 后成为隐性耦合中心。
- **Fix**: 新增工具函数前先评估归属，避免无依据堆积到 `helpers.js`；必要时按主题拆分。
- **Status**: in-progress

### 第二阶段处置（2026-06-24）

逐个统计了两模块每个 export 的引用位置后，只做了零行为变更、零签名变更的整理：

- **`lib/json-io.js` 17 → 15**：`hanakoPreferencesPath`、`normalizeLogSessionRow` 两个 export
  **零外部消费者**（仅被本模块内部调用，且经 `common.js` facade 无谓透传，未列入冻结 API），
  降为模块私有函数并从 `common.js` 重导出列表移除。沿用 v4.3.2 审计「对仅内部使用的函数
  去掉多余 export」的既有实践。
- **`lib/helpers.js` 保持 17**：全部 17 个 export 均有 ≥1 个真实外部消费者，按
  「不删除仍被引用的 export」一律保留。其中 `sessionTargetDisplay` / `toolCategory` /
  `sanitizeAdvice` / `isUsageFailure` 为单一消费者函数，理论上可内聚到调用方，但：
  ① 内聚会拆散 session 三件套等内聚分组、反降可读性；② 指标已在 soft target（18）以内。
  权衡后**维护期不做搬迁**，仅在此登记为低优先候选。

风险已降低：移除了 2 个对外暴露却无人使用的 export，缩小了 facade 公共面；`helpers.js`
单一消费者函数留待未来专门重构再评估。验证：`check` / `test`(606) / `complexity:check` /
`release:check`(100) 全绿。

## C-005 — lib 模块数逼近 hard limit（已决策：上调预算）

- **Area**: `lib/` 目录整体；`lib/complexity.js` 的 `COMPLEXITY_HARD_LIMITS.libModuleCount`。
- **Symptom**: lib 模块数 98（v5.1.1 审计基线）→ **107**（2026-07-03，v5.1.3 + 性能/简化批次后），
  soft target 95 已超 12，hard limit 110 **仅剩 3 个余量**。任何后续"拆大文件"式治理或
  新功能模块都可能在不相关的提交里意外撞墙（`release:check` 直接失败）。
- **Evidence**: `npm run complexity:report` 摘要行"lib 模块数 107 / 110 / 95"。
  增量构成：v5.1.1 审计 P2 遍的拆分产物（`proposal-diff-preview` /
  `observer-adoption` / `scope-diff-preview` / `agent-controller-nodes` /
  `audit-dashboard-render`）、v5.1.3 功能（`live-config`）、性能批次基建
  （`file-cache` / `onload-timing`）等——**每一个单独看都有正当理由**。
- **合并不是可行杠杆（已证）**: 简化计划 simplify-S3（2026-07-03）对全部 30 个
  LOC<90 的 lib 文件做了消费者普查与逐项评估（详见
  `test-plans/findings/simplify-S3.md`）：9 个单消费者候选全部因安全/准入边界、
  冻结核心减负产物、或独立测试价值而应保留；多消费者小工具"小"是内聚的结果。
  结论：**零个可安全合并的候选**。
- **Risk**: 3 个余量意味着预算已失去其设计原则 3（"hard limit 高于当前最大值，
  留出维护余量"）承诺的 headroom——预算从"防膨胀信号"退化成"随机绊线"。
- **Fix（建议，待维护者决策）**: 二选一——
  1. **（推荐）上调**：`libModuleCount` hard 110 → **118**、soft 95 → **105**，
     理由：(a) 原预算按 v4.x LTS 规模设定，v5.0 现代化（LLM 抽取、agent 图、
     live-config 等）是维护者批准的合法架构增长；(b) S3 普查证明现有模块无一
     冗余；(c) 恢复 ~10 个 headroom 回归预算自身的设计原则。同步改
     `lib/complexity.js` 常量 + 本文档 + `COMPLEXITY_BUDGET.md` 表格。
  2. **维持 110**：接受 3 余量，代价是把"新建 lib 文件"变成事实上的高摩擦
     操作——若选此项，应把简化计划 §1.1 的决策顺序（先移位/合并、新建文件
     是最后手段）固化进 `COMPLEXITY_BUDGET.md` 作为长期规则。
  无论选哪个，**"发现大文件默认拆新文件"的治理动作都应废止**（v5.1.1 审计
  P2 遍的默认动作把 98 推到 107 正是本条债务的直接成因）。
- **Status**: **resolved（2026-07-03，维护者采纳推荐方案）** — 本条目由简化计划
  simplify-S4 写入证据与建议，维护者确认采纳方案 1（上调）。已执行：
  `lib/complexity.js` 的 `COMPLEXITY_HARD_LIMITS.libModuleCount` 110→118、
  `COMPLEXITY_SOFT_TARGETS.libModuleCount` 95→105；`docs/COMPLEXITY_BUDGET.md`
  表格同步，并新增规则 0（新建文件是最后手段）+「预算调整历史」记录本次变更。
  CHANGELOG 条目待下次版本号变更时一并记录（本次调整未随版本发布）。

## C-006 — 入口文件 index.js 体量（已重构、已纳管、接受现状）

- **Area**: `index.js`（插件入口）。
- **Symptom**: 838 LOC / 28 imports，超 soft target（600/20），hard（900/35）内。
- **背景（简化计划 simplify-S1/S2，2026-07-03）**: 此前 index.js 完全不在复杂度
  扫描范围内（盲区），且 `onload()` 是 552 行单函数。S1 已把 onload 拆为
  **27 行阶段调用链 + 17 个具名阶段函数**（最大 87 行，经共享 `rt` 对象传递
  状态，语句顺序与 timer marks 逐条保留，runtime-e2e 零改动全绿）；S2 给
  `lib/complexity.js` 加了 `rootFiles` 扫描（默认 index.js + install.cjs），
  从此该文件的体量**可见、可趋势追踪**。
- **Evidence**: `complexity:report` 现列出 index.js 两条 soft warning
  （LOC 838 > 600、imports 28 > 20）。LOC 高于重构前（750）是拆分的结构成本
  （函数签名 + 每阶段 JSDoc 契约），换来的是函数级复杂度质变。
- **Risk**: 低——阶段边界清晰后，新能力有明确插入位置，不再默认堆入巨型函数；
  hard 余量充足（LOC 62、imports 7）。
- **Fix**: 维护期仅监控。若未来逼近 hard，再评估把（届时已边界清晰的）阶段
  函数整体搬迁到一个 lib 模块——属机械操作，但消耗 1 个 lib 模块名额，须与
  C-005 决策联动。
- **Status**: accepted
