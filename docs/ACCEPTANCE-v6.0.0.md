# v6.0.0 v2 App 本地验收

2026-10-18，Windows，Node 24.15.0；官方作者工具与 AppHost 来自 HanaAgent 1.1.24-beta 安装包。

- 新增 v2 SDK/迁移测试 8 项，全部通过。完整回归 1009 项，1004 passed、5 skipped、0 failed。
- 5 skip 是本机 symlink 权限探测，未宣称其它平台执行通过。
- 语法、复杂度、17 个基准场景、性能阈值检查通过，npm audit 0 漏洞。
- 官方目录校验、目录隔离 smoke、ZIP 校验和 ZIP 隔离 smoke：ok；0 error、0 warning；backend loaded。
- 官方打包器生成 ZIP 与 entry JSON，不手工填 hash/size。最终包不含生产数据、测试、源码目录、node_modules 或 SDK 源树。
- 通用 smoke 缺少 app:capabilities 服务，验证的是未启用受保护功能的基础启动；授权分支由 SDK fixture 覆盖，不能代替真实用户聊天与授权验收。
- 真实旧数据只读预览：4632 个可迁移文件，72825244 字节，applied=false。
- 2026-10-18 16:37:57（Asia/Shanghai）通过 Hana 本地安装完成用户能力审查；生产加载成功、7 个工具已注册、17 字段的设置页可见。安装目录 8 个文件与官方 ZIP 逐项 SHA-256 一致。
- 本次选择从空数据开始，未迁移旧数据；启动确认 0 条已有经验。用量观察另从宿主读取最近一周 13 条记录。旧 v1 已停用。
- `node scripts/demo-app.js` 提供可复现的 SDK fixture 输入与结果：read → edit → exec_command 的中间 toolUse 归并为 1 回合、默认 0 模型调用、后台计划显式启用及去重。此演示不是真实模型会话。
- 生产数据复制、付费模型调用、长时间后台运行及其它系统未测。原 full-access 工作区执行与官方记忆文件桥未启用。
- 市场收录未完成。旧市场 PR #14 仍未合并；现行 Global 无登记或批准。本次只准备投稿材料。

复现命令与功能差异见 [V2_MIGRATION.md](V2_MIGRATION.md)。
