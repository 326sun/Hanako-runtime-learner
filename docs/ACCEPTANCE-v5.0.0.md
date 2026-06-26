# v5.0.0 验收记录

日期：2026-06-25

## 范围

v5.0.0 收口 M0、M2、M3-lite 和 M6：

- M0：esbuild dist/zip 发布包，运行时仍无 npm dependencies。
- M2：LLM extraction worker，默认关闭、fail-soft、proposal/review-only。
- M3-lite：Hanako `task:*` bus 后台任务迁移，旧宿主安全降级。
- M6：版本、manifest 兼容线、治理文档、供应链说明、迁移说明、release readiness 和最终验收。

本版本不包含 M1 本地 embedding / vector index、M4 Agent 编排、M5 adaptive thresholds，也不启用 `resource.watch` 自动学习或新的真实自动执行面。

> **M1 deferred（2026-06-26）**：M1 本地 embedding 经 blocker 审查后正式 defer（Route C，见 [BLOCKERS.md](BLOCKERS.md) BLK-1 / [M1_BLOCKER_RESOLUTION_PLAN.md](M1_BLOCKER_RESOLUTION_PLAN.md)）——非性能通过、非功能完成，不在当前最终 install 范围；PoC 保留，未来满足重启条件才重开。

## 版本与兼容

- `package.json`：`5.0.0`
- `package-lock.json` root：`5.0.0`
- `manifest.json`：`5.0.0`
- `manifest.minAppVersion`：`0.345.0`
- Node.js：`>=22`
- runtime dependencies：无
- devDependencies：`esbuild@0.28.1`

## 阶段提交

| 阶段 | 提交 |
|---|---|
| M0 | `cdcb5286c05e309a63c9d7382d69479909b93840` |
| M2 | `2c93fad4b87be95bc2d2dc72a52e77ecd2d1f6e8` |
| M3-lite | `1c9c238777f0c41a4b43d8044208bd0d57460174` |
| M6 | final handoff commit reported after commit creation |

## 发布包

- release zip：`release/hanako-runtime-learner-dist.zip`
- zip 根目录必须包含：`index.js`、`manifest.json`、`README.md`、`LICENSE`、`plugin-process-runner-child.js`、`tools/`
- `tools/` 必须包含 8 个 `self_learning_*` 工具入口。
- zip 不得包含：`node_modules/`、`lib/`、sourcemap、dotfile、`tests/`、`release/`、嵌套 `dist/`。

## 默认安全

- `llmExtractionEnabled=false`。
- `backgroundTasksEnabled=true`，但 task bus 不可用时自动降级。
- 后台任务间隔有限频，不使用无限 `setInterval` 循环。
- LLM extraction schedule 仍受 `llmExtractionEnabled=false` 约束。
- LLM 输出不直接写 patterns/facts。
- 后台任务 complete/fail/cancel 写入审计事件。

## 门禁

M6 最终门禁必须通过：

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

预期测试总数：`773`，其中 `768 passed`、`5 skipped`、`0 failed`。

本地审计记录：

- `npm audit --omit=dev --cache .\.npm-cache`：通过，`found 0 vulnerabilities`。
- `npm audit --cache .\.npm-cache --audit-level=high`：已执行，但当前环境访问 npm registry audit endpoint 返回 `EACCES`，未产生 high/critical advisory 报告；正式发布前应在可联网发布环境重跑完整 audit。

## GUI smoke

本环境无法直接操作真实 Hanako GUI。M6 以 `npm run build` 的 dist/zip 结构校验和测试内 install-smoke 模拟路径作为可重复验收依据；真实 GUI 安装应由维护者在 Hanako `v0.345.x` 环境中手动确认。
