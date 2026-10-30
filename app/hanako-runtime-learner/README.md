# Runtime Self-Learning · v6.2.0

面向 HanaAgent 1.3.6-beta 的 v2 App，构建使用官方 `@hana/app-sdk` 1.3.6-beta。本地记录重复工作流、用户纠正和工具错误，提供记忆检索、审查与相关经验提示。默认不调用模型，不直接联网。

## 安装与旧数据

v6.2.0 是未发布候选；最终 ZIP 由本地官方打包器生成，不要把 v6.0.0 正式包误作本版本。，完成宿主安装审查，并为需要使用的 Agent 启用 App。不要同时运行同名 v1 插件，避免重复采集。

Hana 将程序安装目录与数据目录分开管理，但都归在同一个 `<HANA_HOME>` 下：

```text
<HANA_HOME>/
├── apps/hanako-runtime-learner/                 # App 程序，宿主管理、只读
└── app-data/hanako-runtime-learner/              # 本 App 的数据根
    ├── patterns.json / facts.json / memory-state.json
    ├── episodes.jsonl / experience_log.jsonl / runtime-config.json
    ├── generated/                                # 生成的技能与提示
    └── exports/                                  # 记忆导出备份
```

记忆、配置、运行日志、生成文件和导出都以 `sdk.dataDir` 为根，不会散写到桌面或工作区。管理/备份时查看 `self_learning_stats` 返回的 `dataDir`；卸载默认保留该目录。不要将可写数据放入只读的 `apps/` 安装目录。

从 v1 迁移时，先停用 v1，再在随附源码目录执行迁移预览：

```powershell
node scripts/migrate-v2-data.js --source '<旧插件实际 dataDir>' --target '<HANA_HOME>/app-data/hanako-runtime-learner'
```

核对输出后加 `--apply` 复制。目标必须不存在或为空；工具拒绝覆盖现有 App 数据，不修改原目录。迁移文件在本机复制，不属于上架 ZIP。

## 使用

| 工具 | 用途 |
|---|---|
| self_learning_stats | 数据规模、配置、授权及受限功能状态 |
| self_learning_search | 按作用域检索经验 |
| self_learning_report | 学习与提案报告 |
| self_learning_activity | 最近学习活动 |
| self_learning_doctor | 只读健康检查 |
| self_learning_control | 审核、配置、本地审计导出等治理操作 |
| self_learning_background | status / enable / disable 后台整理计划 |
| self_learning_memory | 只读查看、搜索、单条读取及修订历史 |
| self_learning_memory_manage | 新增/修改/逻辑删除、导出、预览/导入及逐条批准 |

提示注入需要 `app/hooks.agent-before-start`。缺少可靠项目范围时，只允许相关的 general/global 已批准经验进入提示，待审偏好不注入，项目经验仍可通过显式搜索检索。

后台计划不会在安装或启动时自动建立。明确调用 `self_learning_background action=enable` 后创建或恢复三项 App 自有计划；重复调用不重复建立。停用计划会保留学习数据。

模型整理和 LLM 提取默认关闭。启用设置后，通过 `sdk.models.utility` 使用宿主工具模型，由宿主负责凭据、取消与用量。LLM 提取只生成待审候选。启用后台计划不等于启用这些模型功能。

## 申请的能力

- `app/tools.expose-to-model`：让所选 Agent 发现并调用工具。
- `app/usage.read`：从宿主归一化用量元数据学习，不读取请求正文或凭据。
- `app/hooks.agent-before-start`：在后续回合加入相关的已审核经验。
- `app/models.infer`：仅在明确启用模型功能时调用宿主工具模型。
- `app/tasks.manage`：用户显式启用后管理本 App 的后台计划。
- `app/session.stage-file`：将用户请求的记忆备份作为附件交付到当前会话；不授权读写工作区。

没有申请读取宿主凭据、任意本机程序、外部工作区写入或网络白名单。`self_learning_memory` 为只读工具；`self_learning_memory_manage` 对本地数据变更和文件交付声明外部副作用权限。未授予的能力在 stats 中明确显示；授权变化后重载 App 生效。基础的事件学习、检索和治理不依赖模型授权。

## 长期记忆管理

`self_learning_memory` 只读提供 `list`、`get`、`search`、`history`、`provenance`、`episodes`；搜索可选 `memoryLayer=core/archive/all`，仅 `core` 记忆参与自动提示。`self_learning_memory_manage` 提供 `upsert`、`delete`、`export`、`preview_import`、`import`、`approve`。事实采用 subject/predicate/object 结构，修改冲突事实时关闭旧事实有效期并保留替代关系；类别包括 preference/fact/project_state/workflow/error/event/other。导出生成版本化 JSON 备份。导入必须携带匹配当前数据版本的一次性 previewId，应用时只新增；同 ID 不覆盖，导入项进入待审核状态，事实要经单独 approve 才能替代当前值。删除是逻辑隐藏：不会从旧 patterns/facts、历史日志或过去的外部备份中安全擦除正文。Episode 记录只保存任务/工具摘要和 opaque session hash，不保存原始对话正文。导出默认省略已拒绝/替代的记忆及审批、证据与修订历史，便于安全迁移。

建议顺序：`preview_import` → 检查新增/冲突 → `import` → `list` 检查待审内容 → `approve` 单条批准。导入包应来自可信来源；导入不会执行内容或直接进入提示。修改、删除、批准与导入都应由用户针对具体记忆明确指示。写操作工具声明外部副作用权限。

## v6.2 检索和层级

episode 来源通过证据 ID 回查，事实保留 `validFrom/validTo` 和 `learnedAt`，区分发生时间与系统获知时间。检索将 CJK BM25、多查询 RRF、显式实体/别名关系与本地字符 n-gram 信号融合；它不是神经语义向量，也不调用外部模型。`memoryLayer=core/archive/all` 可筛选，自动提示只取 core 且已批准条目，归档记忆通过显式 search 查找。

## v6.2 检索和分层

每个学习回合会有不含原始文本的 episode 索引，证据可通过 opaque episode ID 回查。事实记录区分有效时间与系统获知时间，并保留替代链。核心层按预算提示，归档层通过显式检索；检索将 CJK BM25、多查询 RRF、显式实体关系和字符 n-gram 融合。字符 n-gram 是确定性本地词法信号，不是神经 embedding。本版本不接入 Graphiti 服务、Neo4j、Mem0、Letta 或云端向量库。

## v1 功能差异

- 直接读取宿主官方记忆文件、工作区自动修复/命令执行在此隔离版禁用；没有转换成隐式本机高权限进程。
- 自配外部模型/embedding 端点不在默认分发包的网络声明中；默认使用本地 BM25 和可选宿主工具模型。
- 旧 console 会话和打开系统目录工具未在本版注册。数据路径由 stats 返回。
- benchmark / release_readiness / trust_project_scripts 是仓库开发操作，不作为 App 运行工具开放；请使用源码 CLI。
- 不覆盖安装包内的 SKILL.md 或用户自定义技能；生成提示保存在数据目录并通过获授权钩子使用。

## 验证范围

本版本只在 Node/SDK fixture 与官方打包器静态检查上验证；未完成生产 AppHost 安装、Node 26 archive smoke、真实模型对话、生产数据迁移或 macOS/Linux 验收。请勿把 v6.0 / 6.1 历史安装记录当作 v6.2 验收。

官方通用 smoke 环境没有 app:capabilities 服务；该环境只验证受保护功能关闭时的启动。完整授权分支通过 SDK 契约测试验证，不把 smoke 当作真实聊天验收。

## 源码与许可

源码：<https://github.com/326sun/Hanako-runtime-learner>。v6.0.0 当前为本地候选，尚未上传远端 Release。

插件主体 MIT；内联官方 App SDK 为 Apache-2.0，见 `THIRD_PARTY_NOTICES.md` 与 `licenses/HANA-SDK-APACHE-2.0.txt`。
