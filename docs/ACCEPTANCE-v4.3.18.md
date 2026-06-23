# v4.3.18 验收记录

## 版本目标

`v4.3.18` 的工作重点是适配 Hanako 宿主 v0.341.x 的接口变更，并保持对旧宿主的向后兼容：

- `ctx.config` 由普通对象改为 `getAll()/setMany()/getSchema()` 方法存储；面板桥接与凭证桥接统一经 `getAll()` 取值（修复新宿主下面板 API Key 被静默丢弃）
- HTTP 请求优先走宿主声明式网络通道 `ctx.network.fetch`，旧宿主回退全局 `fetch`，统一标准 `fetch(url, options)` 签名
- 工具返回结构化 `{ content, details }` 格式，并声明 `sessionPermission`
- onload 通过宿主 `register()` 登记 disposable 清理；旧宿主无回调时安全跳过
- 工具与运行时优先使用宿主提供的 `ctx.dataDir`
- manifest 新增 `sensitiveCapabilities` 与 `network` 声明，`minAppVersion` 提升至 `0.330.0`
- 不放宽任何自动化和安全边界

## 验收结果

| 项目 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 568 个测试，563 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 通过，无阈值越界 |
| `npm run release:check` | Score 100 |

## 本版确认项

1. `normalizeConfig` 统一两套 config API；`applyPanelConfig` 与 `panelCredentialsToStore` 在 method-based store 下经 `getAll()` 正确取值，新增回归覆盖。
2. `ctx.network.fetch` 与全局 `fetch` 调用路径统一为标准签名；模型整理与语义 embedding 在两类宿主下均可用。
3. 所有工具返回结构化格式并声明会话权限；测试经 `parseToolResult/unwrapToolResult` 适配。
4. `register()` 生命周期清理在新宿主登记 disposable，旧宿主安全跳过；onunload 兜底不变。
5. 命令执行、文件系统边界、动作执行与插件加载边界均未被放宽。
6. 发布门、设计矩阵、版本号与当前版本一致。

## 结论

`v4.3.18` 满足当前 release gate，可作为兼容 Hanako v0.341.x 的维护发布版本。
