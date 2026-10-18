# v6.0.0 / v2 App 迁移与验证

日期：2026-10-18（Asia/Shanghai）。目标：HanaAgent 1.1.24-beta。

## 当前状态

v2 App 源定义位于 `app/hanako-runtime-learner/`，入口与适配器位于 `v2/`。
`npm run build:app` 生成可安装目录 `dist-app/hanako-runtime-learner/`。
旧根 manifest 和 index 保留为 v1 核心及回归基线；不要把整个源码目录作为 v2 包导入。

官方 `@hana/app-sdk` 从安装包随附 tarball 固定到 `vendor/`，构建时内联。
App 无运行时 npm 安装，不解析宿主 node_modules。SDK 类型和源码未手改。

## 接口迁移

| v1 | v2 |
|---|---|
| 生命周期类由宿主 onload | `defineApp` + 已等待回执的 SDK 注册 |
| `ctx.dataDir` 插件目录 | `sdk.dataDir` App 数据目录 |
| 可写安装路径内 SKILL.md | 数据目录 generated/；获授权的 before-start 钩子注入相关全局经验 |
| 同步 bus subscribe | 等待注册，异步事件串行处理，停止时排干已接收队列 |
| `model:sample-text` | `sdk.models.utility`，requestId 取消；后台绑定真实 taskId |
| v1 task:* | App 自有 registerHandler / schedule / pauseSchedule / resumeSchedule |
| 启动自动创建计划 | apply 只绑定处理器，用户工具 enable 后建立计划 |
| 同步文件交付回执 | await `sdk.resources.stage` |
| full-access | 5 项明确声明的 App 能力，缺少可选授权时关闭对应功能并在 stats 显示 |

安装包不声明任意本机执行或网络域名。官方记忆文件直读、外部工作区自动执行、旧 console/open-dir 不在此隔离版启用。自配网络端点需要另行声明并审核 network 范围，本次包默认没有。完整差异见随包 README，未宣称 v1 的所有 full-access 操作已有 v2 对等实现。

## 数据迁移

1. 先在 Hana 停用旧 v1 插件。不要删除旧目录或旧学习数据。
2. v2 首次安装前，预览：

   ```powershell
   node scripts/migrate-v2-data.js --source '<旧插件实际 dataDir>' --target '<HANA_HOME>/app-data/hanako-runtime-learner'
   ```

3. 核对路径后，用同样参数追加 `--apply`。目标必须不存在或为空；现有目标数据绝不合并或覆盖。复制前后会检查源文件是否变化，发现变化即放弃，不提交半份目标。
4. 导入 `release-v2/app-hanako-runtime-learner-6.0.0.zip`，按宿主审查决定授予声明能力，并为指定 Agent 启用。
5. 运行 stats / doctor，核对 patternCount、dataDir 与授权；普通对话实测后再显式 enable 后台计划。

迁移预览曾识别 4632 个候选数据文件、72825244 字节；本次用户随后选择从空数据开始，未运行复制。已停用 v1，并于 2026-10-18 完成本地 ZIP 安装和用户权限确认；生产日志确认 v6.0.0 loaded、7 个工具注册，设置页可见。旧数据未迁入。CLI 不复制临时锁、符号链接、程序或源码。

## 可复现验证

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run benchmark
npm run perf
npm run complexity:check
npm audit --audit-level=high
npm run build:app
# 将此变量指向包含 APPS.md 和 scripts 的实际 Hana Server 目录。
$env:HANA_APP_TOOLS_ROOT = '<installed Hana server root>'
npm run validate:app -- --smoke
npm run package:app
```

最终 ZIP 也经过官方 `validate-app.mjs --archive <zip> --smoke --json` 验证，结果为 ok、0 error、0 warning、backend loaded。
通用 smoke 没有 app:capabilities 服务，本包按 fail-closed 启动基础功能；因此这个结果只证明隔离启动，不证明完整授权的真实模型对话。完整授权的学习/注入/调度分支另由 SDK fixture 测试覆盖。

全量回归为 1009 tests、1004 passed、5 skipped、0 failed；5 skip 为本机 Windows symlink 权限限制。17 个基准场景通过，性能、复杂度、语法检查通过，npm audit 0 漏洞。最终证据随 `release-v2/` 提供。

尚未验证真实付费模型调用、真实聊天中的 Agent 选工具、生产数据迁移、长时间后台运行、macOS/Linux。本地安装成功不等同市场审核或上架。
