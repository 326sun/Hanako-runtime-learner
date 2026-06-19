# 基准说明

本项目有两类性能检查：场景基准和热路径微基准。

## 1. 场景基准

执行：

```powershell
npm run benchmark
```

用途：

- 回归验证典型学习场景
- 确认不同模块协同下没有明显性能倒退
- 作为发布前的固定检查项

当前内置场景数：`17`

## 2. 热路径微基准

执行：

```powershell
npm run perf
```

用途：

- 盯住搜索、装饰、渲染、裁剪等高频路径
- 对局部清理和重构提供阈值护栏

典型关注指标：

- `search_ms`
- `decorate_ms`
- `skill_render_ms`
- `prune_ms`
- `all_cold_ms`
- `all_cached_ms`
- 冷启动 import 时间

## 解释原则

1. `benchmark` 是集成场景，关注真实工作流。
2. `perf` 是微基准，关注局部热点。
3. 任一基准变慢都要先找原因，再决定是否接受。

## 发布要求

`benchmark` 属于正式发布门的一部分。`perf` 是建议门，但在做性能整理时应一起看。
