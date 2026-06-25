# v5.0.0 安全复审

日期：2026-06-25

## 复审结论

v5.0.0 放宽的是发布工程约束：允许构建期 devDependency `esbuild` 生成自包含 release zip，并允许在宿主支持时使用 Hanako `task:*` bus 调度后台整理。运行时安全边界没有放宽：无 runtime dependencies、无默认外部模型、无 M1/M4/M5、无新增真实自动执行面。

## 放宽点与缓解

| 放宽点 | 风险 | 缓解 |
|---|---|---|
| 构建期引入 `esbuild` | 供应链与平台二进制风险 | 精确锁定 `0.28.1`，仅 devDependency，不进入 release zip；`npm audit` 纳入 M6 gate。 |
| 发布形态改为 dist/zip | 源码泄漏、缺文件、嵌套 zip 风险 | `npm run build` 调用 `lib/dist-verify.js` 检查必需文件、8 个工具入口、无 `node_modules`、无 `lib/`、无 sourcemap/dotfile、zip 根目录正确。 |
| LLM extraction worker | 内容外发与模型错误风险 | 默认关闭；关闭时不采样；启用后只请求宿主脱敏摘要；失败 fail-soft；输出只进 proposal/review。 |
| `task:*` 后台调度 | 重复 schedule、并发运行、重启恢复风险 | capability 探测、不可用降级、schedule 去重、single-flight、完成/失败/取消审计、recovering/running 旧任务安全标记。 |
| `minAppVersion` 抬升 | 旧宿主不兼容 | v4.3.x LTS 继续维护；v5 文档明确旧用户可停留。 |

## 未放宽边界

- R4、外部不可逆动作、`git push`、`git tag`、release/publish 永不自动执行。
- R2 写动作仍要求作用域门、事务快照、验证和回滚。
- 项目脚本执行仍要求脚本哈希信任基线。
- `resource.watch` 自动学习未启用。
- M1 本地 embedding / vector index 未实现。
- M4 Agent 编排未实现。
- M5 adaptive thresholds 未实现。

## 审计要求

- 后台任务 complete/fail/cancel 写入 event log。
- proposal/review/event log 可回放。
- release readiness 检查版本、manifest、docs、README 测试数、dist/zip、复杂度预算和 benchmark corpus。
- release zip 不包含 `node_modules`、源码 `lib/`、测试目录、sourcemap、dotfile 或嵌套 `dist/`。
