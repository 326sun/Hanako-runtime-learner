# v4.3.19 验收记录

## 版本目标

`v4.3.19` 是 `v4.3.18` 的维护加固版，重点不是扩张能力，而是把 Hanako v0.341+ 宿主契约适配收得更完整：

- 主运行时按宿主 `ctx.dataDir` 生成数据路径，旧宿主继续回退 legacy `learnerDir()`。
- `self_learning_control` 与 `self_learning_open_dir` 补充 `sessionPermission.describeSideEffect()`，让 reviewer 能看到具体副作用类型。
- `self_learning_control` 仍保持工具级 `external_side_effect`，action 级描述仅用于审计与审批上下文，不放宽自动执行边界。
- 新增回归覆盖 `ctx.dataDir` 主运行时写入路径与 session side-effect 分类。

## 验收结果

| 项目 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 570 个测试，565 通过，5 跳过 |
| `npm run benchmark` | 17/17 通过 |
| `npm run perf` | 通过，无阈值越界 |
| `npm run release:check` | Score 100 |

## 本版确认项

1. 主运行时 `onload` 中创建 runtime paths/loggers，优先使用 `ctx.dataDir`；`onunload` 使用已注册 logger，必要时再按当前 ctx fallback。
2. `config.json`、`activity_log.jsonl`、patterns、usage seen、capabilities、history 和 proposal 相关路径统一来自同一 runtime path 集合。
3. `self_learning_open_dir` 明确声明打开系统文件管理器的副作用。
4. `self_learning_control` 明确区分 read、plugin output、review queue mutation、external model run 和 plugin state mutation；`preview_proposal` / `validate_proposal` 没有被误标为纯只读。
5. 自动化边界未放宽；危险控制动作仍由宿主 reviewer / 策略层处理。
6. 发布门、设计矩阵、版本号与当前版本一致。

## 结论

`v4.3.19` 满足当前 release gate，可作为兼容 Hanako v0.341.x 的维护发布版本。
