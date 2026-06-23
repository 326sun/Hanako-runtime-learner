# v4.3.20 验收记录

## 版本目标

`v4.3.20` 是 `v4.3.19` 的 contract-level 收尾版，依据 Hanako 宿主权威协议源码（`liliMozi/openhanako` 的 `core/plugin-context.ts`、`core/plugin-config.ts`、`packages/plugin-runtime`）核对适配，修复两处 v0.341+ 适配引入的副作用，边界不放宽：

- **`config.json` 撞车修复**：宿主在 `ctx.dataDir` 同目录持久化自己的插件配置存储 `config.json`（`{schemaVersion, global, agents, sessions}`）。运行时私有配置改名 `runtime-config.json`，把 `config.json` 归还宿主；新增 `lib/runtime-config-path.js` 做一次性迁移，旧宿主遗留的扁平 `config.json` 自动搬迁，宿主形状的 `config.json` 绝不触碰。
- **`network.fetch` 通道修复**：宿主声明式 `ctx.network.fetch` 要求静态 `allowedHosts`（裸 `"*"` 匹配不到任何 host），无法表达用户任意配置的整理模型/embedding 端点。改回直接 `fetch`（宿主保留 legacy 直连兼容），移除 manifest 失效的 `network` 块与未使用的 `network.fetch` capability。

## 验收结果

| 项目 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 578 个测试，573 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 通过，无阈值越界 |
| `npm run release:check` | Score 100 |

## 本版确认项

1. 运行时私有配置文件统一为 `runtime-config.json`：`index.js` 的 runtime paths、`tools/_shared.js` 的 `toolPaths`、`set_config`、proposal apply 的 `configPath`、observer live-reload 全部对齐。
2. 迁移仅搬迁扁平插件 config，永不移动或覆盖宿主 `{global,...}` 形状的 `config.json`；迁移幂等、不抛异常、损坏文件原地保留。
3. 整理模型（`lib/model-advisor.js`）与语义 embedding（`tools/search.js`）对用户任意端点使用直接出站请求，并保留原有超时控制；不再优先 `ctx.network.fetch`。
4. manifest 不再声明失效的 `network` 块与未使用的 `network.fetch` capability；`model.sample` / `session` capability 保留。
5. 自动化边界未放宽；危险控制动作仍由宿主 reviewer / 策略层处理。
6. 发布门、设计矩阵、架构说明、版本号与当前版本一致。

## 结论

`v4.3.20` 满足当前 release gate，可作为兼容 Hanako v0.341.x 的 contract-level 收尾维护发布版本。
