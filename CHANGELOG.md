# 更新日志

本文档记录 Runtime Self-Learning 的版本演进。`v4.x` 为 LTS 维护线，因此该阶段的记录重点放在缺陷修复、审计加固、性能整理和发布治理，不再扩张自动化边界。

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
