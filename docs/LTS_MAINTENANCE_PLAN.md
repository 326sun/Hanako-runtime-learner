# v4.3.x LTS 与 v5 主线维护计划

`v5.0.0` 发布后，`v4.3.x` 成为长期维护线，`v5.x` 成为主线。旧用户可以继续停留在 v4.3.x；需要 Hanako `v0.345.x` task bus、发布 zip 自包含包和 v5 治理基线的用户再迁移到 v5。

## v4.3.x LTS 维护目标

1. 修复影响正确性、安全边界或旧宿主兼容性的缺陷。
2. 保持 v4.x 安装方式、`minAppVersion` 和冻结 API 不发生破坏性变化。
3. 不引入 v5 的发布打包、LLM extraction 或 task:* 调度要求。
4. 发布前继续执行 v4.x 对应 release gate。

## v5 主线维护目标

1. 保持 M0 的自包含 dist/zip 发布形态。
2. 保持 M2 LLM extraction 默认关闭、fail-soft、proposal/review-only。
3. 保持 M3-lite 后台任务 task:* 调度能力可关闭、可审计、可降级。
4. 保持 M6 的治理文档、供应链说明和验收记录同步。

## 允许的变更

- bug fix
- 审计加固
- 测试补全
- 基准补全
- 性能优化
- 内部重构
- 文档和发布整理

## 不允许的变更

- 放宽 R4 或外部副作用边界
- 新增默认开启的外部网络能力
- 让发布门执行真实发布动作
- 在 v4.3.x LTS 中引入 v5-only 宿主要求
- 在 v5.0.0 发布收口中补做 M1/M4/M5

## v5 发布前检查

```powershell
npm run build
npm run check
npm test
npm run complexity:check
npm run benchmark
npm run perf
npm run release:check
npm audit
```

## 文档一致性要求

以下文件必须与当前主线版本一致：

- `package.json`
- `package-lock.json`
- `manifest.json`
- `README.md`
- `CHANGELOG.md`
- `docs/DESIGN_GOAL_COMPLETION_MATRIX.md`
- `docs/ACCEPTANCE-v5.0.0.md`
- `docs/SUPPLY_CHAIN.md`
- `docs/MIGRATION_v4_to_v5.md`
- `docs/SECURITY_REVIEW-v5.0.0.md`
