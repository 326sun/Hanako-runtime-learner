# v4.x LTS 维护计划

`v4.3.0` 之后，Runtime Self-Learning 进入维护期。这个阶段的重点不是继续扩大功能面，而是保证边界、稳定性、性能和发布质量。

## 维护目标

1. 修复影响正确性和安全边界的缺陷。
2. 清理冗余实现，降低维护成本。
3. 维持热路径性能不倒退。
4. 保持文档、验收记录和发布门一致。

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
- 改变冻结 API 语义却不升级大版本
- 让发布门执行真实发布动作

## 发布前检查

每个 LTS 版本发布前至少应完成：

```powershell
npm run check
npm test
npm run benchmark
npm run perf
npm run release:check
```

## 文档一致性要求

以下文件必须与当前版本一致：

- `package.json`
- `manifest.json`
- `README.md`
- `docs/DESIGN_GOAL_COMPLETION_MATRIX.md`
- `docs/ACCEPTANCE-v<version>.md`

## 建议节奏

- 高频：小范围 hardening、缺陷修复、测试补齐
- 中频：性能清理、文档对齐
- 低频：仅在必要时更新冻结说明
