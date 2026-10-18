# Runtime Self-Learning · v6.0.0

面向 HanaAgent 1.1.24-beta 的 v2 App。本地记录重复工作流、用户纠正和工具错误，提供记忆检索、审查与相关经验提示。默认不调用模型，不直接联网。

## 安装与旧数据

导入官方打包器生成的 `app-hanako-runtime-learner-6.0.0.zip`，完成宿主安装审查，并为需要使用的 Agent 启用 App。不要同时运行同名 v1 插件，避免重复采集。

数据位于 `<HANA_HOME>/app-data/hanako-runtime-learner/`。安装目录只读；学习结果、审查和生成提示都写入 App 数据目录。卸载默认保留数据。

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

提示注入需要 `app/hooks.agent-before-start`。缺少可靠项目范围时，只允许相关的 general/global 已批准经验进入提示，待审偏好不注入，项目经验仍可通过显式搜索检索。

后台计划不会在安装或启动时自动建立。明确调用 `self_learning_background action=enable` 后创建或恢复三项 App 自有计划；重复调用不重复建立。停用计划会保留学习数据。

模型整理和 LLM 提取默认关闭。启用设置后，通过 `sdk.models.utility` 使用宿主工具模型，由宿主负责凭据、取消与用量。LLM 提取只生成待审候选。启用后台计划不等于启用这些模型功能。

## 申请的能力

- `app/tools.expose-to-model`：让所选 Agent 发现并调用工具。
- `app/usage.read`：从宿主归一化用量元数据学习，不读取请求正文或凭据。
- `app/hooks.agent-before-start`：在后续回合加入相关的已审核经验。
- `app/models.infer`：仅在明确启用模型功能时调用宿主工具模型。
- `app/tasks.manage`：用户显式启用后管理本 App 的后台计划。

没有申请读取宿主凭据、任意本机程序、外部工作区写入或网络白名单。未授予的能力在 stats 中明确显示；授权变化后重载 App 生效。基础的事件学习、检索和治理不依赖模型授权。

## v1 功能差异

- 直接读取宿主官方记忆文件、工作区自动修复/命令执行在此隔离版禁用；没有转换成隐式本机高权限进程。
- 自配外部模型/embedding 端点不在默认分发包的网络声明中；默认使用本地 BM25 和可选宿主工具模型。
- 旧 console 会话和打开系统目录工具未在本版注册。数据路径由 stats 返回。
- benchmark / release_readiness / trust_project_scripts 是仓库开发操作，不作为 App 运行工具开放；请使用源码 CLI。
- 不覆盖安装包内的 SKILL.md 或用户自定义技能；生成提示保存在数据目录并通过获授权钩子使用。

## 验证范围

在 Windows、HanaAgent 1.1.24-beta 的官方打包器与静态/隔离启动检查上验证。自动测试覆盖异步学习回合、全局/项目与待审提示门禁、后台计划去重、资源回执及数据复制。尚未完成真实模型对话、真实付费模型调用、生产数据迁移或 macOS/Linux 验收。

官方通用 smoke 环境没有 app:capabilities 服务；该环境只验证受保护功能关闭时的启动。完整授权分支通过 SDK 契约测试验证，不把 smoke 当作真实聊天验收。

## 源码与许可

源码：<https://github.com/326sun/Hanako-runtime-learner>。v6.0.0 当前为本地候选，尚未上传远端 Release。

插件主体 MIT；内联官方 App SDK 为 Apache-2.0，见 `THIRD_PARTY_NOTICES.md` 与 `licenses/HANA-SDK-APACHE-2.0.txt`。
