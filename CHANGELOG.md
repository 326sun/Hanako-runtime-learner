# Changelog

本文档记录 Runtime Self-Learning 的版本演进。`v4.3.x` 进入 LTS 维护线，`v5.x` 为现代化主线。

## 5.1.5 - 2026-07-03（结构收敛维护发布）

> 在已发布的 `5.1.4` 之上完成下一步结构收敛计划 N0-N6：对外文档状态精确化、控制面 action metadata 集中、入口 runtime wiring 聚合、结构性复杂度报告、以及 release zip 真实安装/升级 smoke。

- **能力状态文档精确化（README）**：将“本版本不包含 M1/M4/M5”的粗粒度表述改为能力状态矩阵，明确 local vector index 未完整发布、semantic embeddings 默认关闭、agent orchestration 受治理约束、adaptive thresholds 为 recommendation-only、LLM extraction 只产待审候选。
- **控制面 action metadata 集中（`tools/control-action-registry.js`）**：把 `tools/control.js` 内多组 action 分类 Set 收敛为单一 registry，统一 side-effect、config/pattern loading 分类；新增 registry 覆盖测试，防止新增 action 忘记更新权限/加载语义。
- **入口 runtime wiring 聚合（`index.js`）**：抽出 `lib/runtime-live-config.js` 与 `lib/runtime-skill-refresh.js` 两个聚合模块。`index.js` 从 838 LOC / 27 imports 降到 588 LOC / 19 imports，入口 LOC/import 两条 soft warning 消除。
- **复杂度治理升级（report-only structural warnings）**：`complexity` 新增结构规则警告通道，当前只报告、不阻断 release；覆盖 index runtime wiring 聚合边界与 control action registry 边界。当前 structural warnings 为 0。
- **真实安装/升级 smoke**：从 GitHub Release 下载 `v5.1.4` zip，SHA256 匹配；本机旧安装 5.0.0 已备份并升级到 5.1.4 release 包，插件 onload/onunload、control status、doctor json、search 空 store smoke 通过。该项验证已发布包，v5.1.5 发布后应复用同流程验证新 asset。
- **复杂度结果**：soft warnings `5 → 2`；剩余为 `lib module count` 109 > soft 105、`tools/control.js` imports 32 > soft 20。hard violations 0。
- **测试与发布门**：测试总数 `938` → `943`（`943 passed` / `0 skipped` / `0 failed`）。`npm run build`、`npm run check`、`npm test`、`npm run benchmark`、`npm run perf`、`npm run complexity:check`、`npm run release:check`、`npm audit --audit-level=high` 已通过；release zip SHA256 为 `44A53715E21DE5C0B468AB08FF46B53C2A2F1D424C4DE2778257A117DB7A5884`。

## 5.1.4 - 2026-07-03（性能护栏 + 简化治理收口）

> 在已发布的 `5.1.3` 之上完成性能计划 P6-P10 与简化计划 S1-S6，收口 C-005
> 复杂度预算决策。版本号 `5.1.3` → `5.1.4`（manifest / package.json /
> package-lock 同步）。

- **onload 结构简化（`index.js`，等价重构）**：`onload()` 从 552 行单函数拆为
  27 行阶段调用链 + 17 个具名阶段函数（最大 87 行）。共享 `rt` 对象承载阶段状态，
  保留 config 对象身份、语句顺序和 12 个 timer marks；runtime e2e 零改动通过。
- **复杂度扫描补盲区（`lib/complexity.js`）**：新增 `rootFiles` 扫描，默认纳入
  `index.js` 与 `install.cjs`，但不计入 `libModuleCount`。新增复杂度扫描测试，
  避免入口文件继续脱离 `complexity:report/check`。
- **测试文件拆分（`tests/pattern-detector*.test.js`）**：原
  `pattern-detector.test.js` 666 LOC 按行为拆为 core store / ingest / prune 三件，
  42 个用例总数不变，消除测试文件 LOC soft warning。
- **复杂度预算治理（C-005）**：S3 对 30 个 <90 LOC 的 lib 文件做消费者普查，
  证明零个可安全合并候选；维护者采纳推荐方案，将 `libModuleCount` hard
  110→118、soft 95→105，并在 `docs/COMPLEXITY_BUDGET.md` 固化“新建文件是
  最后手段”规则。`docs/COMPLEXITY_DEBT.md` 同步 C-005 resolved、C-006
  accepted。
- **性能计划 P6-P10 收口**：完成 observer 热路径、patterns dirty-sync 修复、
  audit/event 缓存、advisor/extraction 可观测性与开发工具改进；发布前
  `benchmark` 17/17、`perf` 全部在阈值内。
- **测试与发布门**：测试总数 `851` → `938`（`933 passed` / `5 skipped` /
  `0 failed`）。`npm run build`、`npm run check`、`npm test`、`npm run benchmark`、
  `npm run perf`、`npm run release:check` 与 `npm audit --audit-level=high`
  均通过。

## 5.1.3 - 2026-06-29（配置一致性 + 面板即时生效）

> 三组改动：修复 profile 覆盖安全闸门的 bug、让设置面板改动即时生效、benchmark 产物移出 git 跟踪。版本号 `5.1.2` → `5.1.3`（manifest / package.json / package-lock 同步）。

- **profile 只治理「审查/应用姿态」，不再覆盖用户私有开关（`lib/policy-profiles.js`，bugfix）**：profile 模板此前混入了安全闸门 `includePendingPreferences` 与一批能力/隐私开关（`modelAdvisorEnabled` / `semanticSearchEnabled` / `llmExtractionEnabled` / `includeUsageInAdvisorPrompt` / `workStatusEnabled`），导致用户显式开启后切到 `autonomous` 会被 doctor `policy_inconsistent` 报漂移、并催其关回去。现 profile.values 只保留治理姿态（auto-inject / auto-approve / require-review）+ 区分 autonomous 与 balanced 的 `proposalChatNotifications`；上述开关全部移出，仅由 UI / `set_config` 显式控制，doctor 不再就它们误报（mismatch 期望值从 `profile.values` 推导）。注：`conservative` 对高危能力的硬拦由 validation-gate（`config_conservative:*`）+ 高危告警承担，与本改动正交；移除后 `autonomous` 与 `balanced` 仅余 `proposalChatNotifications` 之别。
- **设置面板配置即时生效（`index.js` + 新增 `lib/live-config.js`，feature）**：宿主在用户改面板时写 `config.json` 并广播 `plugin_config_changed`（`core/plugin-manager.ts`），但不重载插件。现订阅该事件、重桥接面板值并**原地更新**共享 config 对象（保持引用身份，detector / 闭包 / configRef / runner 同步生效），无需重启。唯一在 onload 建立订阅的 `learnFromUsage` 仍需重载——manifest 为它加了 `reloadRequired: true` 与说明文案。新增 `replaceConfigInPlace` / `applyLiveConfig` 纯函数。
- **code_patch 工单只面向可修错误（`lib/proposals.js`，降噪 bugfix）**：重复错误模式会被铸成 high-risk「调查」工单（`code_patch`，无 filePatches、需人审）。`isActionableCodePatchPattern` 此前只挡 `error:unknown`，导致 `error:network_error`（环境性，无代码可修）与 `error:tool_error`（catch-all 杂烩桶，匹配泛 `/error|failed/`，无单一目标）也反复生成工单堆进队列。现将这两类与 `error:unknown` 一并排除；具体错误桶（file_not_found / permission_denied / syntax_error / path_error 等）仍可生成。已堆积的历史工单可用 `reject_proposal` 清理或随 decay 淘汰。
- **benchmark 产物移出 git（`.gitignore`，repo 卫生）**：`benchmark-results/benchmark-report.{json,md}` 是 `npm run benchmark` 的生成产物，含每次运行的时间戳/延迟，跟踪它会在每次跑基准时弄脏工作区。改为 `.gitignore` 忽略 + `git rm --cached` 取消跟踪；可追踪的输入是 `benchmarks/` 下的 baseline，报告为本地派生物。
- **测试**：净增 8 条（`live-config` 3 + `manifest-contract` 重启注 1 + `policy-audit` 用户私有开关泛化 + `doctor` autonomous+能力开关不误报 + `advisor-insights` code_patch 非可作错误桶排除等）。测试总数 `843` → `851`（`846 passed` / `5 skipped` / `0 failed`）；同步 README 徽章/计数与 `lib/release-readiness.js` 的 `expectedTestCount`。

## 5.1.2 - 2026-06-28（全面审计加固，**非 GitHub Release**）

> 在 `5.1.1` 之上完成一轮 S1–S12 × 正确性/复杂度/性能三遍全面审计（36 单元格），修复审计发现的中/低危逻辑问题、治理复杂度热点。release freeze 持续——未 tag、未创建 GitHub Release、未上传 asset、未安装。版本号 `5.1.1` → `5.1.2`（manifest / package.json / package-lock 同步）。审计计划书与结论存于仓库外 `D:\openhanako\test-plans\`。

- **agent 崩溃落态（`lib/agent-controller.js`，中）**：`AgentController` step 异常会逃逸且不落 FAILED 态；现强制落 FAILED、写 `state.crashed` audit、持久化，并补测试。
- **`diagnose_bus` 权限声明（`tools/control.js`，中）**：带 session target 时原声明为只读，可能绕过宿主 review/prompt；现按 target 区分 `external_side_effect` vs `read`，并补测试。
- **发布门禁去假绿（`lib/release-readiness.js` / `lib/dist-verify.js`，中）**：测试数默认值陈旧可能误过 → 统一到 `843` 并补 fixture；zip 仅校验非空 → 新增 zip central directory root 校验（`verifyZipRoot`）。
- **usage attribution（`lib/sample-text.js`，低）**：`sampleTextViaBus()` 补传 `ctx.pluginId` 到采样 payload，并断言。
- **task-store 容错（`lib/agent-task-store.js`，低）**：区分缺失文件（ENOENT/null）与损坏文件（throw corrupt），并补测试。
- **复杂度治理（等价重构，行为/导出面不变）**：`proposals.js` 448→338（拆 `proposal-diff-preview.js`）、`observer.js` 501→452（拆 `observer-adoption.js`）、`scope-gate.js` 428→274（拆 `scope-diff-preview.js`）、`agent-controller.js` 332→161（拆 `agent-controller-nodes.js`）、`audit-dashboard.js` 308→196（拆 `audit-dashboard-render.js`）、`tools/control.js` 631→524 / imports 34→30（拆 `control-handlers/transfer.js`，移除 LOC soft 告警）。
- **测试**：测试总数 `838` → `843`（`838 passed` / `5 skipped` / `0 failed`）；同步 README 徽章/计数文案与 `lib/release-readiness.js` 的 `expectedTestCount` 默认。`complexity:check` OK（soft warnings 3 / 0 hard）；`release:check` ready / Score 100。

## 5.1.1 - 2026-06-27（model advisor 可观测性补强，**非 GitHub Release**）

> 在 `5.1.0` 之上对 model advisor 的「静默失败」做可见性补强。release freeze 持续——未 tag、未创建 GitHub Release、未上传 asset、未安装。版本号 `5.1.0` → `5.1.1`（manifest / package.json / package-lock 同步）。

背景：official 模式在 Hanako `v0.345.x` 上凭证链由宿主侧自洽（utility 模型缺省回退主聊天模型），根因不在凭证缺失，而在 advisor 跳过/失败时**无声无息**。本版只让真实状态可见，不改 official 架构。

- **advisor 运行状态持久化（`lib/model-advisor.js`）**：`maybeRun` 的三个出口（success / skipped / error）写入 `model_advisor_status.json`。新增纯函数 `buildAdvisorStatus()` 负责 `consecutiveFailures` 记账（success 归零、error 递增、skipped 保留），抽出以便单测。
- **doctor 诊断（`tools/doctor.js`）**：`modelAdvisorEnabled=true` 时按运行状态报告——从未运行 → `advisor_never_run`(info)；error 单次瞬时 → `advisor_error`(warning)，连续 ≥3 次 → (high)；config 类跳过 → `advisor_skipped`(warning)；良性跳过（pattern 不够 / 冷却 / 无候选）→ (info)，不再把正常空闲态拉成 Warning；`modelAdvisorEnabled=false` 全程静默。
- **测试**：新增 11 条（doctor 7 + `buildAdvisorStatus` 4）。测试总数 `827` → `838`（`833 passed` / `5 skipped` / `0 failed`）；同步 README 徽章/计数文案与 `lib/release-readiness.js` 的 `expectedTestCount` 默认。

## 5.1.0 - 2026-06-26（内部安装候选 / install smoke candidate，**非 GitHub Release**）

> 这是一个**内部安装冒烟候选版本**，仅用于在真实 Hanako 上做安装/加载冒烟，**不是 GitHub Release**：release freeze 持续——未 tag、未创建 GitHub Release、未上传 asset。版本号从 `5.0.0` 升至 `5.1.0`（package.json / package-lock / manifest 同步）。

主线在 `v5.0.0` 之上累积了一批**实验性、默认关闭、零副作用、未接入主流程**的能力，外加 M1 的正式 defer。完整审计见 `docs/FINAL_INSTALL_READINESS.md`，候选验收见 `docs/ACCEPTANCE-v5.1.0.md`。

- **✅ Hanako GUI 安装冒烟通过（2026-06-26）**：`5.1.0` dist 在真实 Hanako（`v0.345.x`）加载——`onload` 成功、`self_learning_*` 工具注册、只读 `feedback_summary` 与 `agent_graph_preview` 可用、无 failed 诊断。完整记录见 `docs/INSTALL_SMOKE_RESULT-v5.1.0.md`。冒烟通过**不改变 release freeze**：仍未 tag / 未 Release / 未传 asset。
- **安装注意项**：正式安装应**替换旧社区版 v5.0.0**，而非并存。在 dev-slot 与旧 v5.0.0 并存时，宿主可能用**旧 v5.0.0 schema** 遮蔽 v5.0.0 之后新增的 action（尤其 M4b 的 `agent_graph_preview`）；替换后可在 `self_learning_control` 的 action 列表确认 `agent_graph_preview` 存在，以验证生效的是新 schema。

- **M5 / M5b - feedback signals + diagnostic（observation only）**：`lib/feedback-signals.js` 记录 `memory_injected/injection_revoked/memory_closed` 到本地 hash 链 event-log；`self_learning_control` 只读 `feedback_summary` action。零自适应、不参与任何当前决策。
- **M5c - adaptive threshold DESIGN GATE（design only）**：`docs/M5_ADAPTIVE_THRESHOLD_GATE.md`，纸面安全包络，无代码、无 flag、无阈值变更。
- **M1 - local embedding 正式 defer（Route C）**：改判 `deferred-for-current-release`（非通过、非完成），失败证据保留于 `docs/BLOCKERS.md` BLK-1 + `docs/M1_BLOCKER_RESOLUTION_PLAN.md`；`tools/search.js` 不改、PoC 不合并。
- **M5d - adaptive threshold 最小实现（默认 OFF、recommendation-only）**：`lib/adaptive-thresholds.js` 纯函数，对 `minInjectScore` 产单步 clamp 提案，`apply` 恒 false、不改 config、无人 import；新增 `adaptiveThresholdsEnabled`（默认 false）。`docs/ADAPTIVE_THRESHOLDS.md`。
- **M4a - experimental readonly agent graph skeleton**：`lib/agent-graph-readonly.js` 六只读节点（Observe/Plan/Policy/Verify/Learn/Finalize），只产 plan/report，零执行/写文件/shell；不 import fs/child_process。`docs/AGENT_GRAPH_READONLY.md`。
- **M4b - readonly agent graph diagnostic entry**：`self_learning_control` 只读 action `agent_graph_preview`，调用 M4a graph 返回 report；不新增 self_learning_* 工具（dist 仍 8 工具 / 13 文件）。
- **文档一致性修复（final audit）**：README 测试徽章与文案、`lib/release-readiness.js` 的 `expectedTestCount` 默认（两处）、`tests/release-readiness.test.js` fixture 默认由 `773` 校正为真实 `827`（`822 passed` / `5 skipped` / `0 failed`），消除自 v5.0.0 起累积的计数漂移。

## 5.0.0 - 2026-06-25

`v5.0.0` 正式收口 M0、M2、M3-lite 和 M6。版本号同步至 `5.0.0`，`manifest.minAppVersion` 提升至 `0.345.0`，测试总数保持 `773`（`768 passed`、`5 skipped`、`0 failed`）。

### M6 - governance release

- 版本收口：`package.json`、`package-lock.json`、`manifest.json` 统一为 `5.0.0`。
- 兼容线收口：`manifest.minAppVersion` 抬升至 `0.345.0`，对应 Hanako `v0.345.x` task bus 基线。
- 文档收口：新增 `docs/MIGRATION_v4_to_v5.md`、`docs/PRIVACY.md`、`docs/SECURITY_REVIEW-v5.0.0.md`、`docs/ACCEPTANCE-v5.0.0.md`，更新 API freeze、LTS 维护、供应链、README 和设计矩阵。
- release readiness：检查 v5 版本、manifest、`minAppVersion`、README 测试数、必需文档、dist/zip、benchmark corpus 和复杂度预算。
- 范围纪律：本发布不包含 M1 本地 embedding / vector index、M4 Agent 编排、M5 adaptive thresholds、`resource.watch` 自动学习或新的真实自动执行面。

### M3-lite - task:* 后台任务最小迁移

- 新增 `lib/host-tasks.js` host task 适配层，封装 Hanako `task:*` bus 协议：`task:register-handler`、`task:unregister-handler`、`task:register`、`task:update`、`task:complete`、`task:fail`、`task:cancel`、`task:remove`、`task:schedule`、`task:list-schedules`、`task:list`。
- capability 探测优先走 `ctx.bus.getCapability("task:schedule")`，回退 `ctx.bus.hasHandler("task:schedule")`；task bus 不可用时返回 `unavailable/skipped` 并保持旧机会式后台整理路径。
- 将 advisor、prune、log-retention 与 M2 LLM extraction worker 纳入可调度后台任务；schedule 注册按 ID 去重，不在每次 onload 生成重复 schedule。
- 所有后台 task handler 使用 single-flight 防并发，complete/fail/cancel/recovering-fail 写入 `event_log.jsonl`；失败 fail-soft，不中断插件加载。
- LLM extraction scheduled tick 继续遵守 M2 治理：`llmExtractionEnabled=false` 默认关闭，disabled 时不调用 `sampleText`，模型失败 fail-soft，输出只进 proposal/review。
- 新增测试覆盖 fake bus handler 注册与 schedule、不可用降级、single-flight、防重复 schedule、complete/fail/cancel 审计、recovering fail、LLM scheduled tick 默认关闭。
- 测试总数 `764 -> 773`。

### M2 - default-off LLM extraction

- 新增默认关闭的 LLM extraction worker，使用宿主 `model:sample-text` / `sampleText` 能力时先做 capability 探测，旧宿主或模型失败均 fail-soft。
- LLM 输出只进入 proposal/review，不直接写入 `patterns.json`、`facts.json` 或 `SKILL.md`。
- `llmExtractionEnabled=false` 时不采样、不外发、不改变 M0/v4 默认行为。
- 范围纪律：不包含 M1 本地 embedding / vector index、M3-lite 后台调度、M4 Agent 执行、M5 自适应阈值。

### M0 - dist package

- 引入 `esbuild@0.28.1` 作为 devDependency，仍无 runtime dependencies。
- `npm run build` 生成自包含 `dist/` 与 `release/hanako-runtime-learner-dist.zip`。
- release zip 根目录直接包含插件文件，不含 `node_modules`、源码 `lib/`、sourcemap、dotfile、测试目录或嵌套 `dist/`。
- `engines.node` 提升到 `>=22`；`dist/`、`release/` 为生成物并已 `.gitignore`。
- 范围纪律：M0 不引入 transformers、embedding、wasm、模型权重或原生 addon。

## 4.3.23

- 新增复杂度治理门：`lib/complexity.js` 定义 hard limit / soft target，`npm run complexity:check` 在超出 hard limit 时失败，`npm run complexity:report` 生成 `docs/COMPLEXITY_REPORT.md`。
- 发布门纳入 `complexity.within_budget` 检查，并补充 `docs/COMPLEXITY_BUDGET.md` / `docs/COMPLEXITY_DEBT.md`，把 v4.x LTS 的模块数、单文件 LOC、import/export 数和 TODO/FIXME 预算写成可审计规则。
- 拆分控制面热点复杂度：新增 `tools/control-parameters.js`、`tools/control-summaries.js` 与 `tools/control-handlers/*`，让 `tools/control.js` 从 712 LOC 收敛到约 602 LOC，并保留行为特征回归。
- 测试总数 `606 -> 665`：新增控制面参数、摘要、脱敏、handler characterization 与 release-readiness 复杂度门回归；README 徽章和发布门默认测试基线同步到 665。
- 边界未放宽：本版只增加本地静态治理、文档和控制面结构整理，无新增自动放行、网络、发布或外部副作用能力。

## 4.3.22

- **新增自学习控制台（`chat.surface`，Hanako v0.344+）**：新增只读工具 `self_learning_console`，把"最近活动 + 待处理提案"快照投递进一条插件自有的 `plugin_private` 会话，并以原生 `chat.surface` transcript 卡片在当前聊天内嵌展示，可点开滚动查看历史快照。这是 UX/呈现层的可选增强，**不扩张自动化边界**：控台只读、由用户显式调用工具触发，不自动应用任何动作、不在后台主动推送。
  - 会话懒创建、归插件所有（`ownerPluginId`）、`visibility: "plugin_private"`，sessionId 持久化到 `<dataDir>/console-state.json` 并复用；宿主提供 `session:get` 时校验存活、失效自动重建。
  - **优雅降级、不抬 `minAppVersion`（维持 `0.330.0`）**：探测 `session:create` 不可用（旧宿主）时工具返回纯文本状态、不发卡片；旧渲染器忽略未知 `chat.surface` 卡片类型（前向兼容）。
  - 新增隔离模块 `lib/console-session.js`（`ensureConsoleSession` 生命周期 + `buildSnapshot` 文本拼装），工具壳 `tools/console.js` 仅做接线；快照投递复用现有 `session-messenger`（按 `sessionId` 优先构造 payload），不耦合 observer/advisor 后台路径。
- 测试总数 `594 -> 606`：新增 `console-session`（8）与 `console-tool`（4）回归——覆盖懒创建/复用、`session:create` 不可用与抛错降级、`session:get` 失效重建、卡片 shape（`pluginId`/`sessionId`/`sessionRef`，`sessionPath` 仅在宿主提供时带）、快照非空/含活动/长度封顶；发布门测试基线默认同步至 606。
- 边界未放宽：新增的是只读呈现工具与插件私有会话生命周期，无新增自动放行或危险动作。

## 4.3.21

- 对照 Hanako 宿主新测试版协议 `v0.344.3`（`liliMozi/openhanako` 的 `core/plugin-context.ts`、`packages/plugin-runtime`、`server/plugin-chat-surface.ts`、`hub/event-bus-capabilities.ts`）做 contract-level 核对。该版本对本插件实际用到的面（`ctx.bus` capability 调用、`ctx.config`、直连 `fetch`）基本是增量；新增的 ResourceIO `resource.watch`、UI `resource.*`、`chat.surface`、route `getPluginRequestContext` 均落在本插件未触及的区域。核对确认 capability 探测（`getCapability().available !== false` → `hasHandler` 回退）与 manifest 权限声明（`usage.read`）仍正确——`createPluginBusProxy` 对插件仅强制 `usage.read`，`session:send`/`model:sample-text` 在 `full-access` 下放行，无需新增 permission，`minAppVersion` 维持 `0.330.0`。
- **会话身份对齐 v0.344 语义（`sessionId`/`sessionRef` 为权威，`sessionPath` 仅为旧 locator）**：
  - **`recordUsage` 句柄丢身份（修复）**：post-flush 管线的 `sessionHandle` 原先用 `session.sessionPath || sessionIdentityKey(session)`，当宿主提供 `sessionId` 时句柄退化为原始 path，`resolveSessionTarget` 查 `sessionTargets`（observer 按 `sessionIdentityKey` 注册）必然 miss，回退为字符串后只剩 `sessionPath`，使下游整理/通知丢失 `sessionId`/`sessionRef`。改为统一用 `sessionIdentityKey(session)`，与 observer 注册键一致并保证完整 target round-trip，同时统一了通知冷却 Map 的键。
  - **`SessionTurn` 污染 `sessionPath`（加固）**：path 缺失时构造器会把合成身份键（`sid:`/`sref:`）兜底塞进 `sessionPath`，污染 scope 推断与 dedup payload。`sessionPath` 现在只保留真实文件定位或 `null`；path 形态的旧 key 仍按 path 接受。
- **修复 `lib/session-messenger.js` 中文字符串 UTF-8 损坏（缺陷）**：`formatProposalNotification` 的提案通知正文与 `notifyWorkStatus` 的 `workStatusText` fallback 在磁盘上为乱码，开启对话提案通知/工作状态时用户会看到不可读文本。已按原意重建为正确 UTF-8 文案。
- 测试总数 `578 -> 594`：纳入新宿主 payload 的稳定会话标识捕获回归与 `SessionTurn` 不污染 `sessionPath` 的回归；发布门测试基线默认同步至 594。
- 边界未放宽：纯 contract-level 对齐与缺陷修复，无新增自动化能力。

## 4.3.20

- 对照 Hanako 宿主权威协议（`liliMozi/openhanako` 的 `core/plugin-context.ts`、`core/plugin-config.ts`、`packages/plugin-runtime`）做 contract-level 收尾，修复两处 v0.341+ 适配引入的副作用：
  - **`config.json` 与宿主插件配置存储撞车（数据完整性）**：宿主用 `ctx.dataDir` 同目录持久化自己的 `config.json`（`{schemaVersion, global, agents, sessions}` 结构），而本插件运行时也把扁平 config 写在 `<dataDir>/config.json`，两个写入方会互相覆盖。运行时私有配置改名为 `runtime-config.json`，`config.json` 归还宿主；新增 `lib/runtime-config-path.js` 做一次性迁移（旧宿主遗留的扁平 `config.json` 搬到 `runtime-config.json`，宿主 `{global,...}` 形状的 `config.json` 绝不触碰）。
  - **`network.fetch` 声明式通道对任意用户端点不可用（功能失效）**：宿主 `ctx.network.fetch` 要求静态 `allowedHosts` 白名单，裸 `"*"` 不匹配任何 host；而整理模型/语义 embedding 的端点是用户任意配置的，无法在 manifest 枚举。改回直接 `fetch`（宿主明确保留 legacy 直连兼容），并移除 manifest 里失效的 `network` 块与未使用的 `network.fetch` capability。
- 测试总数 `570 -> 578`：新增 `runtime-config.json` 迁移回归（6 项）、整理模型对任意端点使用直连 fetch 的回归、manifest 不声明失效 network 通道的回归；`runtime-e2e` 的 `ctx.dataDir` 断言改为校验运行时写 `runtime-config.json` 且不创建 `config.json`。
- 边界未放宽：纯 contract-level 对齐与缺陷修复，无新增自动化能力。

## 4.3.19

- 收口 Hanako v0.341+ 宿主数据目录语义：主运行时不再在模块加载时固定 legacy `learnerDir()`，而是在 `onload` 中按 `ctx.dataDir` 生成运行路径；旧宿主继续回退 legacy 目录。新增回归确保 `config.json` 与 `activity_log.jsonl` 写入宿主提供的数据目录，不误写 `HANA_HOME/self-learning`。
- 加强插件权限审计上下文：`self_learning_control` 与 `self_learning_open_dir` 保持 reviewer-bound 的保守工具级权限，同时补充 `describeSideEffect()`，按 action 区分只读查询、审计/benchmark/release 输出、review queue 写入、外部模型整理和本地治理状态变更，避免 v0.341+ reviewer 只能看到泛泛副作用。
- 测试总数 `568 -> 570`，新增 `ctx.dataDir` 主运行时回归和工具 session side-effect 分类回归。
- 边界未放宽：`self_learning_control` 仍声明为 `external_side_effect`，新增描述只提升审计可见性，不扩大自动放行范围。

## 4.3.18

- 适配 Hanako 宿主 v0.341.x 的接口变更，向后兼容旧宿主：
  - **`ctx.config` 方法化存储**：宿主由普通对象改为 `getAll()/setMany()/getSchema()` 方法存储。`normalizeConfig` 统一两套 API；`applyPanelConfig` 与 `panelCredentialsToStore` 现在先经 `getAll()` 取值——修复了新宿主下用户在设置面板输入的 API Key 被静默丢弃的破坏点。
  - **`ctx.network.fetch`**：模型整理与语义 embedding 的 HTTP 请求优先走宿主声明式网络通道（manifest `network`），旧宿主回退到全局 `fetch`；二者统一为标准 WHATWG `fetch(url, options)` 签名。
  - **工具返回结构化格式**：所有工具由返回纯字符串改为 `{ content: [{ type: "text", text }], details }`；新增 `sessionPermission` 声明（只读工具 `readOnly`，副作用工具 `external_side_effect`）。
  - **`register()` 生命周期清理**：onload 通过宿主 `register()` 登记 disposable，保证即使 onunload 被跳过也能有序释放订阅与落盘；旧宿主无此回调时安全跳过。
  - **`ctx.dataDir`**：工具与运行时优先使用宿主提供的数据目录。
  - manifest 新增 `sensitiveCapabilities` 与 `network` 声明，`minAppVersion` 提升至 `0.330.0`。
- 测试总数 `566 -> 568`，新增 method-based config 凭证桥接回归；工具测试改用 `parseToolResult/unwrapToolResult` 适配结构化返回。
- 边界未放宽：纯协议兼容适配，无新增自动化能力。

## 4.3.17

- 事件日志锁现在会回收崩溃写入方遗留的陈旧 `.event-log.lock`：单次追加只会短暂持锁，故 mtime 超过 30 秒的锁判定为孤儿并原子重建，避免后续每次 `appendEvent` 都在事件循环上同步空等满 5 秒锁超时后抛错。`wx` 原子创建仍保证并发重建时只有一个持有者。
- 凭据密钥派生改为按进程缓存：派生输入（机器标识 + 固定盐）恒定，`loadCredentials` 不再对每个已存密钥重复支付一次 PBKDF2(10 万次迭代) 的开销。加解密结果与行为不变。
- 测试总数 `565 -> 566`，新增事件日志陈旧锁回收回归。
- 边界未放宽：仅做可用性加固与启动期性能整理。

## 4.3.16

- 审计扫尾，移除热路径中的低风险冗余实现。
- `official-memory-bridge` 复用共享 `readJson()`，动作与插件执行在退回隐式 `process.cwd()` 工作区根时会明确上报。
- `self_learning_search` 在单次调用内复用 BM25 索引；命令 denylist 正则与 Windows `npm` / `npx` 路径解析加入有界缓存。
- 动作包加载阶段复用包目录 `realpath`，减少 `action.json`、`execute.js`、`verify.js`、`rollback.js` 的重复路径解析。
- 控制面 `release_readiness` / `run_benchmarks` 现在通过安装时写入的 `.source-root.json` 回到源码仓库查找发布与基准材料；没有源码根时返回 `unavailable`，不再把裁剪后的运行包误报为发布失败。
- `self_learning_open_dir` 在 Windows 下改用参数化 `cmd /c start` 调用，并在失败时仍返回目录文件摘要。
- 测试总数 `557 -> 565`，新增工作区根回退、插件子进程回退元数据、prepared-search 索引一致性、运行包源码根解析、open-dir 命令构造回归和事件日志跨进程并发写入回归。
- 边界未放宽：仅做可观测性、去重、路径语义修复和热路径清理。

## 4.3.15

- 修复 `self_learning_search` 未把 `project` 作用域传给官方记忆桥的问题，避免跨代理结果混入。
- 修复审批辅助器对已解决、任务不匹配、当前节点不匹配请求的 fail-open 风险。
- 测试总数 `555 -> 557`。

## 4.3.14

- 任务审批现在要求唯一且当前仍 pending 的请求，拒绝陈旧或歧义状态。
- 取消任务时不再重写已解决审批；无 request id 的取消会先清理该任务的 pending 审批。
- 测试总数 `553 -> 555`。

## 4.3.13

- 官方记忆桥在返回 `officialMemory` 文本前先做敏感值脱敏。
- 官方记忆条目带 agent 推导作用域，桥级搜索支持项目过滤。
- 测试总数 `551 -> 553`。

## 4.3.12

- 被拒绝的 `set_config` patch 不再提前写入 `credentials.enc`。
- 现在先校验配置 patch，再决定是否保存凭证。
- 测试总数 `550 -> 551`。

## 4.3.11

- 自动加载的插件动作包声明命令必须通过 loader / 全局命令策略。
- 插件不能再通过 `action.json` 自授权验证命令或权限命令。
- 测试总数 `549 -> 550`。

## 4.3.10

- 动作包的 `execute.js` / `verify.js` / `rollback.js` 现在必须是包内常规文件。
- 软链接模块、非文件模块和越界 `realpath` 会在注册阶段被拒绝。
- 测试总数 `547 -> 549`。

## 4.3.9

- 技能 patch 自动应用统一改走 `applyProposalSafely()`，只允许写可信根下的 `skills/self-learning/SKILL.md`。
- 学习得到的 `desc` / `fix` 先收敛成单行数据，避免把 Markdown 结构注入到 `SKILL.md`。
- 测试总数 `544 -> 547`。

## 4.3.8

- 计划声明的 `riskTier` 不能再把动作基线风险往下压，只能抬高不能降低。
- 新增 action-risk 回归测试，锁定 R2 写动作不会被伪装成 R1 / R0。
- 测试总数 `542 -> 544`。

## 4.3.7

- 针对动作执行和安全子系统做主动审计加固。
- 结构化 `steps` 现在也会参与破坏性意图扫描。
- 文件系统 denylist 改为大小写无关且识别软链接逃逸。
- 危险命令判断补上 Windows 可执行扩展名和 Node `--loader` / `--experimental-loader` 风险。
- 测试总数 `537 -> 542`。

## 4.3.6

- 修复设置面板中 API Key 字段被静默忽略的问题，真实值现在会安全写入加密凭证仓库。
- 修复手动 `run_model_advisor` 错把占位符凭证当真实 Bearer Token 的问题。
- 测试总数 `531 -> 537`。

## 4.3.5

- 修复 `added-models.yaml` 中嵌套 `model_defaults:` 子映射导致的凭证解析中止。
- slash-keyed model id 不再让整个 provider 凭证集失效。
- 测试总数 `530 -> 531`。

## 4.3.4

- 修复 `added-models.yaml` 中嵌套 `models:` 序列导致的凭证丢失。
- provider 字段内部的嵌套序列会被跳过，顶层 list-shaped `providers:` 仍然 fail-closed。
- 测试总数 `529 -> 530`。

## 4.3.3

- 打通 Hanako 设置面板与运行时配置文件之间的桥接。
- `ctx.config` 和 `DATA_DIR/config.json` 现在通过 `applyPanelConfig()` 对齐；面板能控制的键以面板值为准。
- 凭证键仍不直接写入 `config.json`。
- 测试总数 `519 -> 529`。

## 4.3.2

- 设置面板 schema 收紧：枚举、数值范围、密码字段与 validation gate 对齐。
- 新增 `npm run perf` 和热路径阈值，固定搜索、装饰、渲染、裁剪和冷启动基线。
- 批量剪枝、导出面和注入判定逻辑做了冗余清理。
- 删除死文件 `lib/rank-fusion.js`，`lib` 模块数收口到 `81`。
- 测试总数提升到 `515`，`benchmark` `17/17`，`release:check` `100`。

## 4.3.1

- 修复设置面板自动关闭问题。
- 搜索工具在读取配置后会解密 `semanticEmbeddingApiKey`，避免静默降级成纯 BM25。
- embedding API 调用改用 Node 原生 `https`，不再依赖宿主是否提供 `fetch`。

## 4.3.0 LTS

- 完成 v4.x API Freeze 文档。
- `ARCHITECTURE.md` 和 `README.md` 从旧时代状态整理到 v4.3.0 当前实现。
- `tests/release-readiness.test.js` 的 coherent-project fixture 补齐 `README.md` 和 `manifest.json`。
- 版本质量状态固定为：`81` 个 `lib` 模块、`496` 个测试、`17` 个 benchmark 场景。
- `v4.3.0` 标志路线图收口，此后 `v4.x` 进入维护期。

## 4.2.0 LTS

- `decoratePatterns()` 合并 filter + decorate，减少热路径中间数组分配。
- `observer.js getTurn()` 的 LRU 淘汰从 `O(n log n)` 收紧到 `O(n)`。
- 合并 6 个单一消费者微模块，统一 `nowIso()`。

## 4.1.0 LTS

- 引入项目脚本信任门和 `trust_project_scripts` 控制动作。
- 锁定文件系统祖先 `realpath` 检查、软链接逃逸防护、非本地 HTTP endpoint 告警和 URL 脱敏。
- `install.cjs` 与 `manifest.json` 版本线对齐。

## 4.0.21 LTS

- 修复 classifier 驱动 repair 分支丢失 `await` 的问题。
- 修复文本 patch 中 `$&` / `$'` / `$$` 替换模式污染写入结果的问题。
- `allowedFiles` / `allowedDirs` 改为按路径段匹配。
- `oldText/newText` patch 的新增 / 删除行按真实 payload 统计。
- 绝对路径和 `..` patch 目标会在建事务前被拒绝。
- snapshot 失败会直接中止事务。
- `skill_patch` 目标必须显式是 `SKILL.md`。
- 测试总数 `502 -> 510`。

## 4.0.20 LTS

- 修复 Windows 下 `:` 文件名导致的持久化失败，统一走 `safeFileSlug()`。
- 多个存储面统一复用 `writeJson()` 原子写路径。
- 清理 21 个无引用导出和一批损坏的死代码。
- benchmark 场景错误 JSON 不再导致 corpus 直接崩溃。

## 4.0.19 LTS

- 抽出 `lib/advisor-insights.js`，去掉运行时与控制工具重复的 advisor 合并逻辑。
- 手动 `run_model_advisor` 与高风险 advisor proposal 生成改为复用 pattern id 索引。
- 清理 `tools/control.js` 中重复的 transfer-candidate 校验。

## 4.0.18 LTS

- 新增 `lib/release-readiness.js`、`npm run release:check` 和 `self_learning_control action=release_readiness`。
- 发布门开始机器化校验版本、文档、benchmark、设计矩阵和冻结说明是否一致。
- benchmark 场景数提升到 `17`。

## 4.0.17 LTS

- 补齐 Action、Policy、Transaction、Sandbox、Skill Promotion、Audit、Benchmarks 和 `v3 -> v4` 迁移文档。
- `active_skills.json` 进入 `SKILL.md` 需要显式开关、成功证据、回归门和 `maxSkillTokens`。
- benchmark 场景数提升到 `16`。

## 4.0.16 LTS

- 引入审计仪表板与导出面：`lib/audit-dashboard.js`、`dashboard.json`、`dashboard.md`。
- `self_learning_control` 新增 `generate_audit_dashboard`。

## 4.0.15 LTS

- 打通技能晋升闭环：反思记忆、失败聚类、候选技能、效果跟踪、衰减和 active skill registry。
- 激活技能仍停留在注册表，不直接改写 `SKILL.md`。

## 4.0.14 LTS

- Agent Controller 增加 `RepairNode` / `RollbackNode` 恢复分支。
- 校验推迟到 `VerifyNode`，避免 premature interrupt。

## 4.0.13 LTS

- 插件 `execute.js` / `verify.js` / `rollback.js` 改为受控子进程执行。
- 子进程引入 workspace `cwd`、清洗环境、超时 kill 和输出上限。

## 4.0.12 LTS

- benchmark 覆盖从 `5` 扩展到 `10` 个场景。
- 引入 `lib/transfer-validation-runner.js`，让跨项目迁移候选能在目标项目执行验证命令。

## 4.0.11 LTS

- 注册型插件动作开始支持 `verify.js` 和 `rollback.js`。
- `verification.commands` 统一进入现有沙箱命令策略。

## 4.0.10 LTS

- Action Registry Runtime 接入 Controller 和 Executor 主链。
- 非核心注册动作可以通过运行时注册表执行；不允许自动执行的动作会进入队列而不是静默执行。

## 4.0.9 LTS

- 引入内置 benchmark 场景语料库、基线文件和阈值文件。
- `npm run benchmark` 和 `self_learning_control run_benchmarks` 形成正式入口。

## 4.0.8 LTS

- 引入跨项目迁移注册表，记录候选、验证历史和手工晋升条件。
- 审计导出开始包含迁移候选统计。

## 4.0.7 LTS

- 增加 Agent Controller 的任务状态持久化、审批、拒绝、取消和恢复工具。
- 审批与恢复链开始写入连续审计事件。

## 4.0.6 LTS

- 引入 Action Registry / Marketplace 基线。
- 插件动作不能覆盖核心动作类型，不能绕过策略门、回滚和沙箱边界。

## 4.0.5 LTS

- 建立跨项目记忆迁移基线：项目画像、迁移候选、信心降权、目标重验证和 scope 校验。

## 4.0.4 LTS

- 引入 Agent Controller 基线：显式任务图、状态机、人类中断和审计轨迹持久化。

## 4.0.3 LTS

- 建立任务分解运行时、评估运行器、反思记忆与技能候选的基础能力。
- 设计目标完成矩阵从此开始区分“包版本号”和“真实自治成熟度”。

## 4.0.2 LTS

- 最终审计加固：修复版本不一致、加强命令 allowlist、让文件系统边界识别软链接、清理 release zip 中的陈旧源树。

## 4.0.1 LTS

- LTS 收尾加固：benchmark runner 改走真实执行链，补齐独立 `diff-preview` API，继续收紧命令安全边界。

## 4.0.0 LTS

- `v4.0.0` 标志 Autonomous Runtime Learner 稳定线成形。
- 这一版把 Reflexion Memory、Skill Promotion、Model Router、Agent Controller、执行沙箱、审计仪表板、跨项目迁移、Action Marketplace 和 benchmark 套件纳入统一架构。

## 3.x 里程碑

### 3.5.0

- 建立 benchmark 与评估套件。

### 3.4.0

- 引入 Action Marketplace。

### 3.3.0

- 引入跨项目记忆迁移能力。

### 3.2.0

- 建立审计仪表板能力。

### 3.1.0

- 建立执行沙箱环境。

### 3.0.0

- 引入 Agent Controller。

## 2.x 里程碑

### 2.8.0

- 引入 Model Router。

### 2.7.0

- 建立技能晋升管线。

### 2.6.0

- 建立 Reflexion Memory。

### 2.5.0

- 引入任务分解运行时。

### 2.4.0

- 修复引擎强化，开始按错误类型驱动自动修复。

### 2.3.0

- Diff Preview、Scope Gate 和 Impact Analyzer 成形。

### 2.2.0

- Review Queue 与 Executor 正式打通。

### 2.1.0

- R2 事务写入链建立。

### 2.0.0

- Runtime Auto Action 闭环成形。

## 1.x 里程碑

### 1.8.1

- `skill_patch` 内容去重闸门，减少无意义的 `SKILL.md` 写入与备份。

### 1.8.0

- 接入 Hanako `0.305+` 官方插件采样接口，model advisor 开始优先走宿主采样。

### 1.7.1

- 修复磁盘状态吸收、损坏配置备份、事件日志尾部读取和重复 token 估算。

### 1.7.0

- 治理收口、runtime E2E 与事件日志哈希链完善。

### 1.6.1

- 系统审计修复与模块合并。

### 1.6.0

- 引入治理策略档与本地审计包。

### 1.5.0

- 建立严格审查模式与事件回放摘要。

### 1.4.0

- 学习治理链成形：Review Queue、Diff Preview、Validation Gate。

### 1.3.0 - 1.0.0

- 逐步建立 doctor、时序事实、证据抽样、作用域检索、官方记忆桥和 proposals 基础能力。

## 0.x 里程碑

### 0.9.0

- 建立作用域感知检索、CJK BM25 倒排索引和准入 gate。

### 0.8.x

- 修复遗忘曲线、usage 去重、配置一致性、隐私默认值和 advisor 降噪问题。

### 0.7.x

- 建立 proposals、官方记忆桥、控制面和早期自动化约束。

### 0.6.x

- 建立知识关系、活动日志、早期 model advisor 和持久化裁剪链。

### 0.3.0

- 首个公开版本，三层主链为“观察 -> 学习 -> 注入”。
