# v4.3.22 验收记录

## 版本目标

`v4.3.22` 在 `v4.3.21` 的 v0.344.x contract 对齐基础上，新增**自学习控制台**——采纳 Hanako `v0.344+` 的原生 `chat.surface` 卡片，把自学习状态以插件私有会话 transcript 的形式在当前聊天内嵌展示。该功能为只读、用户显式触发，边界不放宽。

## 设计依据

- 设计 spec：`test-plans/2026-06-23-self-learning-console-chat-surface-design.md`（用户已确认）。
- 宿主契约（已核对 `liliMozi/openhanako` `v0.344.3` 源码）：
  - `session:create`（`hub/event-bus-capabilities.ts`）支持 `ownerPluginId` + `visibility: "plugin_private"` + `cwd`，返回带 `sessionId`/`sessionRef` 的会话对象。
  - `chat.surface` 校验（`server/plugin-chat-surface.ts`）：卡片须带 `pluginId` + `sessionId`；宿主用 `getSessionManifest` 校验会话存在、`ownerPluginId === card.pluginId`、`visibility ∈ {plugin_private, private}`，否则降级为 `chat.surface.unavailable`。
  - bus 权限：`createPluginBusProxy` 对插件仅强制 `usage.read`，`session:create`/`session:send` 在 `full-access` 下放行，故无需新增 permission。

## 实现

- `lib/console-session.js`（新增，隔离单元）：
  - `ensureConsoleSession(ctx)`：探测 `session:create` 可用性；读 `<dataDir>/console-state.json` 复用会话（`session:get` 可用时校验存活，失效重建）；否则创建 `plugin_private` 会话并持久化。任何失败返回 `null`，从不抛。
  - `buildSnapshot(dataDir, config, input)`：拼装"最近活动 tail + 待处理提案"纯文本，长度封顶、容忍缺失/损坏数据文件。
- `tools/console.js`（新增工具 `self_learning_console`，`sessionPermission.readOnly`）：确保会话 → 投递快照（复用 `session-messenger.send`）→ 返回 `details.card`（`type: "chat.surface"`）。会话不可用时返回纯文本、不带卡片。
- `manifest.json`：`activationEvents` 增加 `onToolCall:self_learning_console`；未新增 permission/capability，`minAppVersion` 维持 `0.330.0`。

## 优雅降级

| 宿主能力 | 行为 |
|---|---|
| `session:create` 不可用（旧宿主） | 工具返回纯文本状态，无卡片，不创建会话、不写状态文件 |
| `session:create` 抛错 | 捕获，降级为纯文本 |
| 渲染器不识别 `chat.surface` | 卡片被忽略（前向兼容） |
| 会话被宿主回收（`session:get` 可用） | 下次调用重建并刷新 `console-state.json` |

## 验收结果

| 项目 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 606 个测试，601 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 通过，无阈值越界 |
| `npm run release:check` | Score 100 |

## 本版确认项

1. 控台会话懒创建、归插件所有、`plugin_private`，sessionId 持久化于 `console-state.json` 并复用；失效重建。
2. `chat.surface` 卡片 shape 含 `pluginId`/`sessionId`/`sessionRef`，`sessionPath` 仅在宿主提供时带；宿主校验不通过时由宿主侧降级，本插件不报错。
3. 旧宿主（无 `session:create`）下工具纯文本降级、不发卡片、不写状态文件；未抬 `minAppVersion`。
4. 快照投递复用 `session-messenger`（`sessionId` 优先），不耦合 observer/advisor 后台路径。
5. 自动化边界未放宽：新增的是只读呈现工具与插件私有会话生命周期，无新增自动放行或危险动作。
6. 发布门、设计矩阵、架构说明（`87` 个 lib 模块）、README 徽章与版本号、CHANGELOG 与当前版本一致；发布门测试基线默认同步至 606。

## 结论

`v4.3.22` 满足当前 release gate，作为兼容 Hanako `v0.344.x` 的功能增强版本（自学习控制台 / `chat.surface`）发布。
