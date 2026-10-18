# HanaAgent 1.1.24-beta 适配说明

日期：2026-10-18（Asia/Shanghai）。插件版本：5.1.11，本地候选，未发布远端。

## 依据

- 官方最新桌面版本：[v1.1.24-beta](https://github.com/liliMozi/openhanako/releases/tag/v1.1.24-beta)。
- 本机已验证安装包的 `package.json` 为 1.1.24-beta，OTA 身份为 `1.1.24-beta-win32-x64-421f6bcbc5dfce7f-ga800bb2b5443ef3f`。
- 随包 `APPS.md` 明确声明：现有 v1 插件永久兼容；新扩展使用 v2 App。本次维护现有 v1 插件，没有把 `manifestVersion` 改成 2。
- 随包 `bundle/index.js`：TaskRegistry、task bus handlers、legacy plugin loader、Pi 工具名及 `toolUse` 处理路径。
- 源码基线：官方插件仓库 v5.1.10，commit `2acf05455ad264670f59e328afa38c9c346dbe15`。公开 Hanako 源码并非当前 beta 二进制的源码，故以本机实际安装包契约为准。

## 改动

| 问题 | 适配后行为 |
|---|---|
| `message_end` 的 `toolUse` 被误当最终回复 | 保留同一学习回合，最后 `stop` 等终止标记才落盘；兼容旧 `tool_calls` |
| Pi 工具错误包装在 `result.content` | 保留具体错误文本，供错误分类与学习 |
| 搜索结果包装在 `details` 或文本 `content` | 恢复检索暴露记录和采用反馈 |
| 新工具名落入“其他” | `exec_command` / `write_stdin` 归入终端，`file` 归入文件探索 |
| 任务注册用了 `handler`，宿主要求 `run` 和 `abort` | 正确注册调度与取消回调 |
| 调度用了 `intervalMinutes`，宿主要求 `intervalMs` | 在适配边界转换分钟到毫秒 |
| 列表响应实际为数组 | 同时兼容数组与旧包装响应，避免重建计划及漏恢复任务 |
| schedule snapshot 不是已注册任务 | 每次执行注册独立任务，再更新状态和完成；并发触发只注册一次 |
| 部分计划建立失败 | 撤销本次新建计划和处理器，再启用机会式降级 |
| Windows 中文路径测试失败 | 使用 `fileURLToPath` 解码路径 |

## 安装

在 Hana 的本地扩展导入入口选择 `hanako-runtime-learner-v5.1.11-hana-1.1.24-beta.zip`，核对 id 为 `hanako-runtime-learner`、版本为 `5.1.11`，确认更新现有插件。同 id 导入按宿主升级流程处理。

当前目录顶层是更新后的自包含运行文件，`source/` 保留可继续维护的完整 Git 源码。安装 ZIP 仅含运行文件，不包含源码、测试或 `node_modules`；无需 npm install。

更新前建议备份实际学习目录，工具 `self_learning_stats` 的 `dataDir` 为准。宿主通常提供 `~/.hanako/plugin-data/hanako-runtime-learner/`；更早版本可能使用 `~/.hanako/self-learning/`。本次工作没有替换生产安装，也没有清空、迁移或回写用户学习数据。

## 验证

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm run benchmark
npm run perf
npm run complexity:check
npm run release:check
npm audit --audit-level=high
node scripts/verify-installed-host.js '<已安装的 1.1.24-beta server 根目录>'
```

隔离探针执行安装包里的真实 TaskRegistry 和 task bus 绑定，核验三项计划、重复启动、一次计划执行、任务完成与重启恢复；不会启动服务器，也不会读真实用户配置或学习数据。探针固定该 bundle 版本，宿主结构变化时明确失败；运行插件本身不依赖这些内部符号。

单元/E2E 测试使用临时数据和 fake EventBus；它们不等于在生产对话里实测。此次尚未在真实聊天中验证模型工具选择、长时间后台运行、可选真实模型/embedding 端点或其它操作系统。取消回调阻止晚到的任务完成状态，不能强制终止已发出的外部调用。默认关闭的功能继续保持关闭。
