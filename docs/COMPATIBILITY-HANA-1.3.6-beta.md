# HanaAgent 1.3.6-beta 兼容审查

日期：2026-10-28。对象：`自学习/6.2` v6.2.0 App 候选。官方当前下载页列出的版本为 HanaAgent 1.3.6-beta（页面标注 2026-10-26）；本机宿主服务包 `hanako-server` 也为 1.3.6-beta。此次为源码、SDK 契约、官方静态校验审查，不代表生产安装或真实对话验收。

## SDK 基线与差异

- 已将构建锁定并内联的官方 `@hana/app-sdk` 更新为 1.3.6-beta，来源是当前 Hana 1.3.6-beta Creator 随附 tarball；SHA-256 为 `4732034DB0535BE5A521F20558CF4FC5BA33B09BF2B0D1F3B34FE5C88F5AD73D`，SHA-512/integrity 与版本记录在 `vendor/README.md` 与 `package-lock.json`。
- 生成 SDK 镜像已替换为官方 1.3.6-beta `dist/`，文件集合 369/369 匹配。1.1.24-beta → 1.3.6-beta 的差异：66 个文件有变化、4 个新增；直接调用的 `context`、`server-client`、`tasks`、`registration`、`entry-context` 及相关运行时实现一致。
- 与本 App bus 类型交集的新增项仅有未使用的 `session:create.namespace: "app" | "home"` 输入/回包字段及 `app/sessions.home` capability 常量。本 App 不创建会话，不声明/使用该能力。新增 UI/card/chrome/input-status/session-search APIs 也未被调用。
- 插件 `minAppVersion` 继续为 `1.1.0`：当前使用的 API 最低门槛不因 SDK 包升级而自动抬高；支持下限与构建 SDK 版本是两件事。最终包仍需新 Hana 1.3.6-beta 官方静态校验。

## 审查结果

- Manifest 为 `manifestVersion: 2`，只申请当前实际使用的工具暴露、用量读取、模型推理、任务管理、before-start Hook 和会话文件交付能力；没有新增 network host。当前 `minAppVersion: 1.1.0` 是宽兼容下限，不是本次测试宿主版本声明；此候选目标并已在当前 1.3.6-beta 官方校验器静态检查。
- 对照当前 1.3.6-beta `APPS.md`：App 进程、只读 `apps/<id>` 安装目录、可写 `app-data/<id>`、卸载保留数据、Tool execute 的单参数 context、只读/需审查 permission、`app/usage.read`、`app/hooks.agent-before-start`、App Tasks `registerHandler/schedule`、Resource `stage`、异步注册 receipt 等契约与插件调用一致。
- 当前宿主官方 `validate-app.mjs --archive ... --json` 对最终候选包返回 `ok: true`、`issues: []`、0 errors/0 warnings。最终 ZIP SHA-256：`562AA632DE6484DFD2ABF2CBAC7D185B8A5A2D07A2573C24C7850BF10874F0C3`。
- SDK 1.3.6-beta 基线更新后，最终全量回归：1069 项，1064 通过、5 项因 Windows symlink 权限限制跳过、0 失败；`npm run check`、复杂度检查和构建通过。官方静态包校验与依赖审计通过（0 vulnerabilities）。
- SDK 来源、lockfile 和生成镜像一致性由 `tests/app-sdk-sync.test.js` 自动核对；新增 2 项测试确保包版本/lockfile 与镜像哈希匹配。
- 更新后最终 ZIP SHA-256：`49A5D270B27C7931785048DE52B960F265D7BF5E87391F35C5F1E4CA38211ACA`。

## 限制

- 本机 Node 为 24.15；当前官方 AppHost archive smoke 要求 Node 26，未运行。当前 Hana 桌面宿主本身为 1.3.6-beta，但本候选没有安装到生产 AppHost，也没有做真实聊天、真实授权 Hook/用量事件、长期任务重启或生产数据迁移。
- 因此结论是“在 1.3.6-beta 官方当前静态契约与打包器下无已知不兼容；实际 API 交集没有发现破坏性变化”，不是“所有生产行为已证明无问题”。
