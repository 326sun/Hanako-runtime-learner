# v5.0 API 冻结总览

`v5.0.0` 是 Runtime Self-Learning 的现代化基线。v4.x LTS 的“零依赖源码安装”约束已解除为“无运行时依赖、发布包自包含”，但安全边界、治理链和人工确认规则继续冻结。

## v5.0 冻结范围

| 主题 | 文档 |
|---|---|
| 动作接口 | [ACTION_API.md](ACTION_API.md) |
| 策略门与风险分级 | [POLICY.md](POLICY.md) |
| 事务与回滚 | [TRANSACTION.md](TRANSACTION.md) |
| 沙箱边界 | [SANDBOX.md](SANDBOX.md) |
| 技能晋升 | [SKILL_PROMOTION.md](SKILL_PROMOTION.md) |
| 审计与治理 | [AUDIT.md](AUDIT.md)、[GOVERNANCE.md](GOVERNANCE.md) |
| 供应链与发布包 | [SUPPLY_CHAIN.md](SUPPLY_CHAIN.md) |

## v5.0 允许什么

- 使用 devDependency `esbuild` 生成自包含 `dist/` 和 release zip。
- 通过 Hanako `task:*` bus 协议注册可调度后台整理任务。
- 默认关闭的 LLM extraction 只生成 proposal/review，不直接写入 patterns/facts。
- 保留旧宿主降级路径：缺少 `task:*` 或 `model:sample-text` 时 fail-soft。
- 维护 v4.x 用户的 LTS 文档和迁移说明。

## v5.0 不允许什么

- 不放宽 R4、外部写请求、`git push`、`git tag`、release/publish 自动执行边界。
- 不默认启用外部模型、embedding、vector index、agent 编排或 resource.watch 自动学习。
- 不把 LLM 输出直接写入 `patterns.json`、`facts.json` 或生成的 `SKILL.md`。
- 不把 `node_modules`、源码 `lib/`、sourcemap、测试目录或嵌套 `dist/` 放进 release zip。

## 版本线说明

| 版本 | 状态 | 说明 |
|---|---|---|
| `v4.3.x` | LTS | 旧宿主和源码安装用户可停留；只接收安全修复、兼容修复和发布门修正。 |
| `v5.0.0` | 主线基线 | M0/M2/M3-lite/M6 收口；不包含 M1/M4/M5。 |
| 后续 v5.x | 主线 | 新能力必须继续默认安全，且先更新治理文档和 release readiness。 |

## 维护规则

1. 公开契约变化必须先写文档。
2. 风险更高的行为只能收紧，不能放松。
3. 新增外部服务、模型采样、自动化或持久写入必须默认关闭或显式降级。
4. 发布必须通过 `npm run build`、`npm run check`、`npm test`、`npm run complexity:check`、`npm run benchmark`、`npm run perf`、`npm run release:check` 和 `npm audit`。
5. 验收文档、设计矩阵、README、CHANGELOG、package、lockfile 和 manifest 必须保持一致。
