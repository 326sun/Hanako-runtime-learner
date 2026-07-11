# v5.1.10 验收记录（发布准备与 Hanako v0.374.3 兼容加固）

日期：2026-07-11

## 范围

1. 完成安全提案应用的 durable `applying` 状态、崩溃恢复与审核状态对账。
2. whole-file 状态更新通过跨进程锁避免丢失更新；Windows 锁文件竞争中的瞬态 `EPERM` 受限重试，不再误判为硬失败。
3. 以 Hanako v0.374.3 官方源码验证生命周期、`ctx.dataDir`、EventBus、session 身份、执行边界和 capability 上下文契约。
4. `toolset_changed` 环境提醒不会生成学习回合；桌面 `session_user_message.message.text` 仍只采集真实用户文本。
5. 安装器与 dist/ZIP 校验覆盖全部运行模块及基线 `skills/self-learning/SKILL.md`。
6. README、设计矩阵、变更日志与发布门测试证据同步到 5.1.10。

## 不变项

- `trust: full-access` 与 `permissions: ["usage.read"]` 不变。
- 不新增宿主 capability、默认网络行为或自动执行权限。
- model advisor、semantic search、LLM extraction 仍默认关闭或显式启用。
- scope、review、validation、transaction、rollback 与 audit 边界不放宽。

## 关键结果

| 项 | 结果 |
|---|---|
| package / lock / manifest | `5.1.10` |
| Hanako 目标 | `v0.357.17` 稳定版；已验证 `v0.374.3` 预览版兼容性 |
| 测试统计 | `994 tests · 989 passed · 5 skipped · 0 failed`（本机 Windows symlink 权限导致 5 skip） |
| 状态锁压力 | 15 / 15 轮跨线程读改写通过 |
| 性能审计 | 所有 `perf` 指标在阈值内 |
| release ZIP | `release/hanako-runtime-learner-dist.zip` |
| ZIP 身份 | `release/hanako-runtime-learner-dist.zip.sha256` 由构建生成并由发布门复核 |

## 发布门

- `npm.cmd run check`
- `npm.cmd test`（生成当前源码测试证据）
- `npm.cmd run build`（生成 ZIP 与 SHA-256 sidecar）
- `npm.cmd run benchmark`
- `npm.cmd run perf`
- `npm.cmd run complexity:check`
- `npm.cmd run release:check`
- `npm.cmd audit --audit-level=high`

全部门禁通过后，`v5.1.10` 可作为新的 tag / GitHub Release 发布；不覆盖既有发布资产。
