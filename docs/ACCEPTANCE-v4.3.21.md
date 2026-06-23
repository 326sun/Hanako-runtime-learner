# v4.3.21 验收记录

## 版本目标

`v4.3.21` 依据 Hanako 宿主新测试版协议 `v0.344.3`（`liliMozi/openhanako`）做 contract-level 核对与会话身份对齐，并修复一处用户可见的文案损坏缺陷。边界不放宽。

- **协议核对（v0.341.19 → v0.344.3）**：差异对本插件实际用到的面（`ctx.bus` capability 调用、`ctx.config`、直连 `fetch`）基本是增量。新增的 ResourceIO `resource.watch` / `ctx.resources.watch/subscribe`、UI capabilities `resource.open/pick/requestAccess`、原生 `chat.surface` 卡片、route 级 `getPluginRequestContext` 均落在本插件未触及的区域。`createPluginBusProxy` 对插件仅强制 `usage.read`，`session:send`（`session.write`）/`model:sample-text`（`model.sample`）在 `full-access` 下放行，故 manifest 仅声明 `usage.read` 已充分，`minAppVersion` 维持 `0.330.0`。
- **会话身份对齐**：以 `sessionId`/`sessionRef` 为权威，`sessionPath` 降级为旧 locator。
  - `recordUsage` post-flush 句柄由 `session.sessionPath || sessionIdentityKey(session)` 改为统一 `sessionIdentityKey(session)`，与 observer 注册键一致，保证 `resolveSessionTarget` 命中 `sessionTargets` 并 round-trip 完整 target。
  - `SessionTurn` 构造器不再把合成身份键（`sid:`/`sref:`）兜底塞进 `sessionPath`；`sessionPath` 只保留真实文件定位或 `null`。
- **缺陷修复**：`lib/session-messenger.js` 提案通知正文与 `workStatusText` fallback 的 UTF-8 损坏（乱码）按原意重建。

## 验收结果

| 项目 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 594 个测试，589 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 通过，无阈值越界 |
| `npm run release:check` | Score 100 |

## 本版确认项

1. 会话身份：usage 驱动的学习活动与 post-flush 整理/通知在宿主提供 `sessionId` 时不再丢失 `sessionId`/`sessionRef`；`sessionPath` 字段不再被合成身份键污染。
2. capability 探测与 manifest 权限声明经宿主 `v0.344.3` 源码核对确认正确，无需改动；未新增 permission/capability。
3. `session-messenger.js` 文案为合法 UTF-8，开启对话提案通知/工作状态时不再出现乱码。
4. 全库无残留 mojibake；`session:send` payload 仍按 `sessionId → sessionRef → sessionPath` 优先构造。
5. 自动化边界未放宽；危险控制动作仍由宿主 reviewer / 策略层处理。
6. 发布门、设计矩阵、README 徽章与版本号、CHANGELOG 与当前版本一致；发布门测试基线默认同步至 594。

## 范围之外（后续版本）

- 自学习控制台（`chat.surface`）：设计 spec 已完成（`test-plans/2026-06-23-self-learning-console-chat-surface-design.md`），实现留待后续版本，本版未包含。

## 结论

`v4.3.21` 满足当前 release gate，可作为兼容 Hanako `v0.344.x` 的 contract-level 对齐与缺陷修复维护发布版本。
