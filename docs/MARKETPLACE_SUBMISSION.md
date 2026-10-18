## 投稿信息 / Submission

- 扩展名称：Runtime Self-Learning（运行时自学习）
- 类型与 ID：`app` / `hanako-runtime-learner`
- 发布者：Sun
- 用途：在本机观察重复工作流、用户纠正与工具错误，提供经验检索、审核、健康检查及获授权的相关提示注入。
- 作者仓库：https://github.com/326sun/Hanako-runtime-learner
- 正式 Release：https://github.com/326sun/Hanako-runtime-learner/releases/tag/v6.0.0
- 本次为 Global 市场首次登记：manifestVersion 2，版本 6.0.0。旧市场 OH-Plugins #14 是历史 v1 投稿，不属于此次 v2 审核。

## 图标预览

![Runtime Self-Learning 实际图标](https://raw.githubusercontent.com/326sun/Hanako-runtime-learner/v6.0.0/assets/runtime-learner-v2.png)

此 PNG 直接取自官方打包器生成的 entry JSON 图标，与安装包图标一致。

## 工具演示

这是以工具为主的 App，没有自定义卡片或面板。17 个字段由宿主生成设置页，入口是“左下角设置 → 应用 → 自学习”。

以下为 `node scripts/demo-app.js` 实际执行的 SDK fixture 结果；使用临时数据目录、空用量服务和模拟授权，不执行外部命令、不调用真实模型，不代表生产对话验收。完整输出随 Release 的 `tool-demo.json` 提供。

| 步骤 / 输入 | 实际结果摘要 |
|---|---|
| `self_learning_stats {}`（启动后） | `totalTurns: 0, patternCount: 0, app.version: "6.0.0", app.format: 2` |
| `self_learning_background {"action":"status"}` | `enabled: false, schedules: []` |
| 模拟用户“修改并验证演示文件”；依次发送 read、edit、exec_command 的事件，中间 `stopReason=toolUse`、最终 `stopReason=stop` | 存储 1 个完整回合，`toolsUsed: ["read","edit","exec_command"]` |
| 再次 `self_learning_stats {}` | `totalTurns: 1, patternCount: 0`；单次事件不会立即成为重复模式 |
| 连续两次 `self_learning_background {"action":"enable"}` | 只有 3 项计划，没有重复创建 |
| `self_learning_background {"action":"disable"}` | 3 项计划全部暂停；整个演示模型调用数为 0 |

## 作者自测报告

- Hana：1.1.24-beta；操作系统：Windows 11 专业版（10.0.26300，build 26300）；Node：24.15.0。
- 安装包：本 Release 的官方 ZIP，194205 bytes；SHA-256：`e3b9b93d71fe8991b62168b680bc3f5892252d62324c60ae7fbed6003a0e2895`。
- 2026-10-18 通过“本地安装”导入该 ZIP，由用户亲自完成能力审查；此次安装在 Release 发布前执行。
- 实际结果：宿主启动日志确认 v6.0.0 loaded，7 个工具显示“运行时已注册”，本机启用，设置页可见；安装目录 8 个文件与该 ZIP 的 SHA-256 全部一致。
- 本次停用旧 v1，选择空数据开始，未迁移旧记录；启动日志确认 0 条已有经验。默认用量观察另采集宿主最近一周的 13 条用量元数据。
- 官方静态检查、目录及 ZIP 隔离 smoke 通过：0 error、0 warning、backend loaded。
- 完整回归：1009 tests，1004 passed，5 skipped，0 failed。跳过项是 Windows symlink 权限限制；17 个基准场景、性能、复杂度、语法检查通过，npm audit 0 漏洞。
- 通用 smoke 缺少 `app:capabilities` 服务，只验证受保护功能关闭时的启动；完整授权分支另有 SDK fixture 回归。
- 未测试：真实模型对话、真实付费推理、生产数据复制、长时间后台运行、macOS/Linux。后台计划及模型功能默认不开启。
- 功能差异：官方记忆文件直读、外部工作区自动修复/命令执行、旧 console/open-dir 未在隔离版开放；自配模型和 embedding 端点不在网络声明中。

## 权限与外部服务

| 声明能力 | 用途 |
|---|---|
| `app/tools.expose-to-model` | 向 Agent 暴露 7 个自学习工具 |
| `app/usage.read` | 观察宿主归一化的用量元数据 |
| `app/hooks.agent-before-start` | 注入相关的、已审核的 general/global 经验；不自动跨项目注入 |
| `app/models.infer` | 用户开启模型功能后使用宿主工具模型；默认关闭 |
| `app/tasks.manage` | 用户显式 enable 后建立、恢复或暂停 App 自有后台计划 |

App 直接访问的外部服务：无。没有网络白名单、任意本机执行或外部工作区写权限；模型凭据由宿主管理，App 不读取宿主凭据。

## 投稿检查

- 本 PR 仅追加 `registry.json` 和 `approvals.json`，保留现有条目。
- 正式 Release 包含匹配的官方 entry JSON 和 ZIP；不使用自动生成的源码归档。
- kind、id、publisher 与 entry 一致；tag 为 `v6.0.0`，SHA-256 取自 entry 的 `archive.sha256`。
- 未手动编辑 `index.v2.json`，未修改市场脚本或工作流。
- 未将生产学习记录、用户配置或凭据作为投稿内容。
