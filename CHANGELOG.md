# 更新日志

本文档记录 Runtime Self-Learning 的版本演进。`v4.x` 为 LTS 维护线，因此该阶段的记录重点放在缺陷修复、审计加固、性能整理和发布治理，不再扩张自动化边界。

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
