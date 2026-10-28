# Runtime Self-Learning

> 这是从 v6.1.0 候选派生的隔离 v6.2.0 工作副本，尚未发布。原 `source/`、`6.1/` 与当前生产版本均不受本目录改动影响。版本边界、已实现能力和验收限制见 [ACCEPTANCE-v6.2.0.md](docs/ACCEPTANCE-v6.2.0.md)。

**v6.2.0：面向 HanaAgent 1.3.6-beta 的 v2 App 长记忆候选。构建固定使用官方 `@hana/app-sdk` 1.3.6-beta。在 v6.1 记忆管理与事实时间线基础上，增加 episode 溯源、核心/归档分层、实体关系和字符 n-gram 多信号召回。

- 正式发布的 v6.0.0 包仍在原目录的 `release-v2/`。本目录 `dist-app/` 是 v6.2.0 候选构建，只用于本地验证；不要覆盖当前生产安装。
- 设置入口：**左下角齿轮 → 应用 → 自学习**。模型功能跟随 Hana 的工具模型；后台计划须显式启用。
- 安装后 Hana 将目录集中在同一个 `<HANA_HOME>` 根下，但按宿主规则分开只读程序与可写数据：

  ```text
  <HANA_HOME>/
  ├── apps/hanako-runtime-learner/                 # App 安装文件，宿主管理、只读
  └── app-data/hanako-runtime-learner/              # 此 App 的唯一可写数据根
      ├── patterns.json / facts.json / memory-state.json
      ├── episodes.jsonl / experience_log.jsonl / runtime-config.json
      ├── generated/                                # 生成的技能与提示文件
      └── exports/                                  # 用户请求导出的记忆备份
  ```

  备份/整理运行数据时以 App 返回的 `dataDir` 为准；卸载默认保留 `app-data/hanako-runtime-learner/`。不要把可写文件放入 `apps/`，也不要把源码中的 `dist-app/` 或 `release-v2/` 当作安装后数据目录。停用旧 v1 后，可从空数据开始或手动迁移；不要同时运行两个版本。
- [v6.2 App 使用说明](app/hanako-runtime-learner/README.md) · [迁移与构建](docs/V2_MIGRATION.md) · [v6.2 工作版验收](docs/ACCEPTANCE-v6.2.0.md) · [发布准备](docs/RELEASE-v6.2.0.md) · [Hana 1.3.6-beta 兼容审查](docs/COMPATIBILITY-HANA-1.3.6-beta.md) · [v6.0 历史验收](docs/ACCEPTANCE-v6.0.0.md)

v6.0.0 曾在 Windows 实际安装验证；这些证据不适用于 v6.2.0。v6.2.0 候选尚未安装到 Hana。

开发构建：`npm ci --ignore-scripts`、`npm run build:app`；官方打包和校验需设置 `HANA_APP_TOOLS_ROOT`，详见迁移文档。`node scripts/demo-app.js` 可运行不访问生产数据的工具演示。

v6.2.0 是独立升级工作目录中的未发布候选，不要与生产 v6.0.0 同时启用，也不要将本目录当作已验证的安装包。本版使用独立 managed memory overlay 保留用户编辑/逻辑删除并允许自动学习继续运行；迁移导入按待审处理。未引入数据库、神经向量索引、云图服务或新的网络能力。

## v6.2 长记忆增强

在 v6.1 管理层上增加 episode 来源查询、时态事实的系统获知时间、core/archive 分层和本地多信号召回（BM25 + 实体关系 + 字符 n-gram + RRF）。这些是 Graphiti/Mem0/Letta 设计机制的轻量本地实现，不是它们的 SDK/服务，也不包含神经 embedding 或完整图数据库。验证边界见 [v6.2.0 工作版验收](docs/ACCEPTANCE-v6.2.0.md)。

## v6.1 长期记忆升级

新增只读 `self_learning_memory` 与可审阅 `self_learning_memory_manage` 工具：分页查看、作用域搜索、修改、逻辑删除、修订历史；按 preference/fact/project_state/workflow/error/event/other 分类；导出版本化 JSON 包；导入必须先预览并携带匹配数据版本的 previewId，应用时只新增且所有条目保持待审核，逐项批准后生效。已有事实的有效期与替代关系用于维护变化中的长期事实。删除隐藏检索/提示/默认导出，但不是安全擦除。

当前版本保留 v6.0.0 的 JSON 持久化和 BM25 检索；数据库/索引组件替换尚未实施。DeepSeek 可作为宿主模型场景使用，但直接接入 DeepSeek 官方客户端需要独立适配。

## v1 历史参考

下文仅保留 v1 5.1.11 的历史说明。根 package/manifest 属于共享核心的回归基线；**v2 版本、权限和入口以 `app/hanako-runtime-learner/manifest.json` 为准**，请勿将整个源码目录导入为 App。

<p align="center">
  <sub>Hanako 本地运行时自学习引擎</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-5.1.11-blue" alt="version">
  <img src="https://github.com/326sun/Hanako-runtime-learner/actions/workflows/ci.yml/badge.svg" alt="CI">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/platform-Hanako%20Agent%20v0.345%2B-orange" alt="platform">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/tests-1001%2F1001-success" alt="tests">
</p>

> 本地适配候选 **v5.1.11**，目标为 **HanaAgent 1.1.24-beta（2026-10-18）**，尚未上传 GitHub 或发布 tag。
> 测试徽章沿用总数格式；本次实际结果为 `1001 tests / 996 passed / 5 skipped / 0 failed`。
> 5 项因本机 Windows 无 symlink 创建权限而跳过，本次没有验证其它平台。
>
> 这是现有 v1 插件的兼容维护版。当前官方宿主永久支持已发布 v1 插件；本次没有迁移成 v2 App。
> 安装和验证范围见 [docs/HANA_1.1_COMPATIBILITY.md](docs/HANA_1.1_COMPATIBILITY.md)。

Runtime Self-Learning 会观察本地 Hanako 对话中的重复工作流、用户纠正、常见报错和大上下文使用模式，把经过证据约束的经验整理成后续会话可用的保守提示。

设计目标很简单：让 Hanako 记住本地有价值的经验，但不扩大自动化边界。数据默认只保存在本机目录；外部模型调用和语义检索默认关闭，只有显式配置后才会启用。

v5.0.0 是现代化发布基线：M0 引入自包含 dist/zip 发布包，M2 增加默认关闭的 LLM extraction worker，M3-lite 将后台整理迁移到 Hanako `task:*` bus 调度，M6 完成版本、治理和 release check 收口。v5.1.7 完成子系统级精简，v5.1.8 补齐 usage evidence 并降低 doctor 噪音。v5.1.10 在既有审计修复上补齐安全提案恢复、跨进程状态锁、发布包完整性与 Hanako v0.374.3 预览版兼容验证。v5.1.11 继续适配 HanaAgent 1.1.24-beta 的事件和任务协议；默认安全/审批/事务/审计边界保持不变：

| 能力 | 当前状态 | 默认值 | 自动执行边界 |
|---|---|---|---|
| M1 local vector index | 未发布完整本地 vector index；默认检索仍以 BM25 为主 | 未启用 | 不参与默认检索路径 |
| Semantic embeddings | 可选语义检索与 RRF 融合路径 | `semanticSearchEnabled=false` | 需要 endpoint/model/key，失败 fail-soft |
| M4 agent orchestration | 受治理约束的 agent task / graph / resume 能力 | gated | 不绕过 proposal、review、action-risk 或 audit |
| M5 adaptive thresholds | instrumentation / recommendation-only | 不驱动默认决策 | 不自动改变运行时策略 |
| LLM extraction | 候选提取 worker | `llmExtractionEnabled=false` | 只生成待审候选，不直接写入 patterns/facts |

## 核心能力

| 领域 | 行为 |
|---|---|
| 工作流学习 | 连续观察到 3 次以上的稳定工具类别序列后，提炼为可复用工作流模式。 |
| 偏好学习 | 记录用户纠正、固定偏好和带证据的长期事实。 |
| 错误学习 | 把重复错误转成修复建议，并提示“不要盲重试”。 |
| 使用模式学习 | 记录大上下文、失败请求和资源使用特征。 |
| 检索 | 使用 CJK 友好的 BM25、作用域门禁、关系加权和可选语义融合。 |
| 技能注入 | 将高置信、受预算限制的提示写入生成的 `SKILL.md`。 |
| 治理 | 所有提案经过校验、审核队列、审计事件和健康检查。 |
| 自动动作 | 只允许低风险、可回滚、可验证的动作通过策略门执行。 |

## 安全边界

插件故意做得保守，默认行为是“看得见才放行、看不清就拒绝”。

| 类别 | 规则 |
|---|---|
| R4 / 高影响动作 | 永不自动执行。 |
| 外部写操作 | 永不自动执行。 |
| `git push` / `git tag` / release / publish | 永不自动执行。 |
| 文件写入 | 必须经过作用域门、事务快照、验证和回滚。 |
| R2 修复动作 | 只允许一次受控修复；失败即回滚。 |
| 项目脚本执行 | 必须先建立 `package.json` 脚本信任基线。 |
| 主动技能注入 | 默认关闭。 |
| 模型顾问 / 语义检索 | 默认关闭；凭证独立保存并加密。 |
| LLM extraction | 默认关闭；启用后只进 proposal/review，不直接写 patterns/facts。 |
| 后台任务 | 可关闭、可审计；旧宿主缺少 `task:*` 时自动降级。 |

运行时采用 fail-closed 策略：未知命令、未知配置键、非法提案、doctor 关键状态和越界作用域变更都会被拦下，而不是靠猜测继续执行。

### 关于 `trust: full-access`

`manifest.json` 声明 `"trust": "full-access"`，`"permissions": ["usage.read"]`——两者不是同一层。
按 [docs/HOST_PROTOCOL_NOTES.md](docs/HOST_PROTOCOL_NOTES.md) 记录的宿主契约：`permissions`
数组只用于宿主 `createPluginBusProxy` 显式强制校验的少数敏感 bus 能力（当前只有 `usage.read`，
用于从模型用量元数据学习）；其余 bus 能力（如 `session:send`、`model:sample-text`）与全部文件系统
/子进程访问，则统一由 `trust` 这个更粗粒度的整体授信级别放行，不经过 `permissions` 数组逐项声明。
本插件需要 `full-access` 是因为它要做的事本身就超出 bus 订阅范围：

- 在 `~/.hanako/self-learning/` 下读写学习数据、生成/回滚 `SKILL.md`（见“数据与隐私”）。
- `self_learning_open_dir` 需要打开本地目录。
- `self_learning_control` 的部分 action（`run_benchmarks`、受控修复/回滚等）需要执行文件写入或
  子进程调用，均经过“安全边界”表中列出的作用域门、事务快照、命令 allowlist 等约束。

当前宿主协议没有比 `full-access` 更细的档位能表达“文件系统访问但仅限本插件数据目录”，所以选择
声明 `full-access`，纵深防御落在代码层而非 manifest 层：见上表以及
[docs/SECURITY_REVIEW-v5.0.0.md](docs/SECURITY_REVIEW-v5.0.0.md)。

## 安装

用户安装 release zip：

下载或构建 `release/hanako-runtime-learner-dist.zip`，在 Hanako 插件管理界面导入 zip 即可。发布包已经自包含，终端用户不需要运行 `npm install`。

开发安装：

```powershell
git clone https://github.com/326sun/Hanako-runtime-learner.git
cd Hanako-runtime-learner
npm install
npm run build
npm run install-plugin
```

固定版本安装（下列命令仅供未来发布 v5.1.11 tag 后使用；当前请直接导入随附 ZIP，或使用随附源码）：

```powershell
git clone --branch v5.1.11 https://github.com/326sun/Hanako-runtime-learner.git
cd Hanako-runtime-learner
npm install
npm run build
npm run install-plugin
```

升级：

```powershell
git pull
npm run install-plugin
```

升级时不要删除 `~/.hanako/self-learning`，除非你明确要清空学习记录。

## 数据与隐私

本地数据默认位于：

```text
~/.hanako/self-learning/
```

关键文件：

| 文件 | 作用 |
|---|---|
| `patterns.json` | 工作流、偏好、错误、使用模式等学习结果。 |
| `facts.json` | 带时间感知和淘汰链的事实记忆。 |
| `event_log.jsonl` | 追加写审计事件链。 |
| `action_feedback.jsonl` | 自动动作执行结果和策略反馈。 |
| `SKILL.md` | 后续会话注入的受限提示。 |
| `memfs/` | 面向人类阅读的长期记忆 Markdown 视图。 |

敏感片段会被脱敏。API Key 和 embedding 凭证迁移后不会以明文形式长期保存在配置文件里。

LLM extraction 默认关闭。关闭时不会调用 Hanako `model:sample-text` / `sampleText`；启用后也只请求宿主提供的脱敏摘要，模型失败时 fail-soft，输出只进入 proposal/review 治理链。后台 task schedule 不会启用新的真实自动执行面。

## 工具面

| 工具 | 说明 |
|---|---|
| `self_learning_search` | 带作用域门的记忆检索：BM25 + 门禁 + 重排 + 可选语义融合。 |
| `self_learning_stats` | 查看当前统计、配置、能力和数据规模。 |
| `self_learning_report` | 输出可读的学习报告和待处理提案。 |
| `self_learning_activity` | 最近学习活动时间线。 |
| `self_learning_doctor` | 只读健康检查，返回严重级别和修复建议。 |
| `self_learning_control` | 治理入口：审核、策略、审计导出、发布就绪度、任务控制等。 |
| `self_learning_open_dir` | 打开本地自学习数据目录。 |

### `self_learning_control` 的 action 分组

`self_learning_control` 一个工具聚合了近 50 个 action，风险差异很大——这里按
`tools/control-action-registry.js` 里代码层的真实 side-effect 分类分组呈现，而不是按字母顺序堆一张
长列表。分组由代码维护（新增 action 必须在 registry 声明分类，否则测试会失败），下表只是把它翻译
成用户可读的形式。

| 分组 | side-effect | 代表 action | 说明 |
|---|---|---|---|
| **只读查询**（20 个） | `read` | `status`、`doctor`、`review_panel`、`list_proposals`、`list_events`、`diagnose_bus` | 纯读取，不写入任何文件，日常排障/巡检首选。 |
| **产出报告文件** | `plugin_output` | `run_benchmarks`、`export_audit_bundle`、`generate_audit_dashboard`、`release_readiness` | 只生成派生的 md/json 报告，不改动学习数据本身。 |
| **提案预审**（进 review queue） | `plugin_state_mutation` | `preview_proposal`、`validate_proposal` | 把提案送入待审队列/写事件日志，尚未真正“应用”改动。 |
| **调用外部模型** | `external_model_or_benchmark_run` | `run_model_advisor` | 默认关闭（`modelAdvisorEnabled=false`）；启用时才会发起出站请求。 |
| **本地状态变更**（20 个，风险最高） | `plugin_state_mutation` / `external_side_effect` | `apply_proposal`、`apply_review`、`set_config`、`rollback`、`trust_project_scripts` | 会真正改变已批准状态、配置或信任基线；`apply_proposal`/`apply_review` 走 `applyProposalSafely`（作用域门 + 事务快照 + 回滚，见“安全边界”），`trust_project_scripts` 需要先建立脚本信任基线。 |

常见只读排查命令：

```text
self_learning_control action=status
self_learning_control action=doctor
self_learning_control action=review_panel
self_learning_control action=list_proposals
self_learning_control action=release_readiness
```

常见需要谨慎使用的命令（会改变已保存状态或已批准提案，建议先跑对应只读 action 确认再执行）：

```text
self_learning_control action=validate_proposal proposalId=<id>
self_learning_control action=approve_review reviewId=<id>
self_learning_control action=apply_review reviewId=<id>
self_learning_control action=set_policy_profile governanceProfile=conservative
self_learning_control action=regenerate_memfs
```

## 配置重点

默认值已经偏向本地保守使用。最常调整的是下列键：

| 键 | 默认值 | 说明 |
|---|---:|---|
| `governanceProfile` | `balanced` | 内置档位：`conservative`、`balanced`、`autonomous`。 |
| `autoInjectHighConfidence` | `true` | 允许高置信经验进入 `SKILL.md`。 |
| `includePendingPreferences` | `false` | 待审核偏好默认不参与注入。 |
| `decayHalfLifeDays` | `30` | 记忆衰减半衰期。长期知识不随普通模式一起衰减。 |
| `activeSkillsInjectionEnabled` | `false` | 已激活技能默认不主动注入。 |
| `modelAdvisorEnabled` | `false` | 关闭时不会发生外部模型调用。 |
| `backgroundTasksEnabled` | `true` | 优先用 Hanako `task:*` 调度后台整理；旧宿主自动降级到机会式路径。 |
| `backgroundAdvisorIntervalMinutes` | `360` | 后台 advisor schedule 间隔，默认 6 小时。 |
| `backgroundRetentionIntervalMinutes` | `1440` | 后台日志保留 / prune schedule 间隔，默认 24 小时。 |
| `backgroundLlmExtractionIntervalMinutes` | `30` | LLM extraction worker schedule 间隔；仍受 `llmExtractionEnabled=false` 默认关闭约束。 |
| `semanticSearchEnabled` | `false` | 关闭时只使用本地 BM25。 |
| `officialMemoryBridgeEnabled` | `true` | 启用只读官方记忆桥。 |

`autoActions` 和 `autoActionCommands` 采用深合并配置，局部 patch 不会抹掉其余默认项。

## 架构概览

Runtime Self-Learning 是一条“四层流水线”：观察、学习、行动、治理。

```mermaid
flowchart LR
    EventBus["Hanako EventBus"] --> Observer["observer.js"]
    Observer --> Turn["SessionTurn / flushTurn"]
    Turn --> Detector["PatternDetector"]
    Detector --> Retrieval["MemoryIndex + scope gate"]
    Detector --> Pipeline["post-flush pipeline"]
    Pipeline --> Skill["生成 SKILL.md"]
    Pipeline --> Actions["自动动作策略"]
    Actions --> Txn["事务 / 验证 / 回滚"]
    Pipeline --> Proposals["提案"]
    Proposals --> Review["审核队列"]
    Review --> Audit["审计事件 / 报表"]
```

关键设计决策：

- 运行时零 npm 依赖；release zip 为自包含发布包。
- 自带 CJK 友好的 BM25 倒排索引和 bigram 分词。
- 跨项目记忆默认拒绝，除非显式标注为 general/global。
- 使用遗忘曲线和知识层级控制记忆衰减。
- JSON 写入统一走 `tmp + rename`，避免半写状态。
- 审计事件是追加写链式日志，支持回放和校验。
- v5.0.0 维持冻结的安全边界，同时保留 v4.3.x LTS 维护线。

更完整的模块图和治理链路见 [ARCHITECTURE.md](ARCHITECTURE.md) 与 [docs/API_FREEZE.md](docs/API_FREEZE.md)。

## 开发

要求 Node.js 22+（v5 构建与运行基线）。

```powershell
npm run build          # esbuild 打包为可安装的 dist/（开发期可选；发布期必跑）
npm run check          # 语法与源代码检查
npm test               # 1001 个测试
npm run benchmark      # 17 个内置基准场景
npm run perf           # 热路径微基准
npm run complexity:check   # 复杂度预算门禁（超 hard limit 即失败）
npm run complexity:report  # 生成 docs/COMPLEXITY_REPORT.md
npm run release:check  # 发布元数据与 v5 契约检查（含 dist/zip 与复杂度预算）
```

> **开发态 vs 发布态（v5）**：开发与审计直接跑源码（`index.js` + `lib/**` + `tools/**`），`npm run install-plugin` 拷贝源码目录即可。发布态走 `npm run build` 产出的 `dist/` zip——用户拖入 zip、启用即可，**无需 `npm install`**。详见 [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md)。

当前热路径基线（以有界运行规模 `N=100 = MAX_PATTERN_COUNT * 2` 为准）：

| 指标 | 典型本地结果 |
|---|---:|
| `search_ms` | ~0.03 ms |
| `decorate_ms` | ~0.02 ms |
| `skill_render_ms` | ~0.03 ms |
| `prune_ms` | ~0.05 ms |
| `all_cold_ms` | ~0.03 ms |
| `all_cached_ms` | ~0.00004 ms |
| 冷启动 import | ~27 ms |

`npm run perf` 是性能护栏，不是强制发布门，但很适合抓热路径回退。

## 发布检查表

发布前执行：

```powershell
npm run check
npm test
npm run benchmark
npm run perf -- --json
npm run release:check
```

`v5.1.11` 的预期结果：

```text
package version: 5.1.11
npm run check: passed
npm test: 1001 tests, 996 passed, 5 skipped, 0 failed
npm run benchmark: passed, 17 scenarios
npm run perf: passed, no threshold breaches
npm run release:check: Score 100
npm audit: 0 high/critical vulnerabilities
```

在具备 symlink 创建权限的发布参考环境中，这 5 个边界测试应执行并通过；在普通 Windows 开发机上它们会被能力探测跳过。

发布门不会执行 `git tag`、`git push`、`npm publish` 或任何外部副作用，它只检查本地文件和发布就绪度。

## 文档索引

| 文档 | 用途 |
|---|---|
| [INSTALL.md](INSTALL.md) | 安装、升级、卸载和排障。 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 模块分层、数据流和治理链路。 |
| [docs/GOVERNANCE.md](docs/GOVERNANCE.md) | 提案、审核、doctor 和审计治理。 |
| [docs/ACTION_API.md](docs/ACTION_API.md) | 动作插件 API。 |
| [docs/POLICY.md](docs/POLICY.md) | 风险分级与策略门。 |
| [docs/TRANSACTION.md](docs/TRANSACTION.md) | 事务、验证与回滚模型。 |
| [docs/SANDBOX.md](docs/SANDBOX.md) | 命令与文件系统边界。 |
| [docs/SKILL_PROMOTION.md](docs/SKILL_PROMOTION.md) | 基于证据的技能晋升。 |
| [docs/AUDIT.md](docs/AUDIT.md) | 审计事件、报表和导出。 |
| [docs/BENCHMARKS.md](docs/BENCHMARKS.md) | 基准场景与解释。 |
| [docs/MIGRATION_v3_to_v4.md](docs/MIGRATION_v3_to_v4.md) | v3 到 v4 迁移说明。 |
| [docs/MIGRATION_v4_to_v5.md](docs/MIGRATION_v4_to_v5.md) | v4 到 v5 迁移说明。 |
| [docs/LTS_MAINTENANCE_PLAN.md](docs/LTS_MAINTENANCE_PLAN.md) | v4.3.x LTS 与 v5 主线维护策略。 |
| [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md) | v5 构建依赖、dist/zip 和供应链说明。 |
| [docs/PRIVACY.md](docs/PRIVACY.md) | LLM extraction、后台任务和本地数据隐私说明。 |
| [docs/SECURITY_REVIEW-v5.0.0.md](docs/SECURITY_REVIEW-v5.0.0.md) | v5.0.0 安全复审。 |
| [docs/DESIGN_GOAL_COMPLETION_MATRIX.md](docs/DESIGN_GOAL_COMPLETION_MATRIX.md) | 设计目标完成矩阵。 |
| [docs/ACCEPTANCE-v5.1.11.md](docs/ACCEPTANCE-v5.1.11.md) | 当前版本验收记录。 |
| [CHANGELOG.md](CHANGELOG.md) | 版本历史。 |

## 许可证

[MIT](LICENSE) © Sun
