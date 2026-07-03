# v5.1.7 验收记录（子系统级精简计划：control 路由收敛）

日期：2026-07-03

> 本版本在已发布的 `v5.1.6` 之上执行子系统级精简计划书
> （`test-plans/hanako-runtime-learner-subsystem-simplification-plan-v5.1.6.md`），
> 完成 S0-S11 共 12 个子系统的审查，随后经三遍多角度代码审查确认无正确性缺陷。
> 版本号 `5.1.6 → 5.1.7`（package.json / package-lock / manifest 同步）。

## 范围

1. **Phase A（S2 control 路由收敛）**：`tools/control.js` 从 533 LOC / 32 imports
   收敛到 268 LOC / 18 imports，status/proposal-review/maintenance 三个 handler 域
   下沉到 `tools/control-handlers/*.js`，逐字迁移、行为等价；新增
   `control_router_no_business_imports` report-only 防回流规则。
2. **Phase B（S1 基础层 + S3 入口）**：`lib/helpers.js` 312→277 LOC、18→15
   exports；`index.js` 及聚合模块确认边界清晰，防回流规则升级为自动化 drift
   检测测试。
3. **Phase C（S4-S9 六个核心域审计）**：观察/学习、记忆/检索、模型顾问/LLM、
   动作/agent、治理/审计、技能渲染——逐项以源码证据核实安全/正确性不变量，
   均确认无精简机会、无漂移。
4. **Phase D（S10 构建/发布基建 + S11 收口）**：发现并修复本轮自身引入的测试
   计数文档漂移；完成全部最终门禁。
5. **三遍多角度代码审查**（8 路并行 finder agent：3 正确性角度 + 3 清理角度 +
   altitude + CLAUDE.md 规范，之后人工核实）：**零正确性缺陷**；修复 3 项发现
   的维护性问题（`redactConfig` 重复定义、`CONTROL_BANNED_DIRECT_IMPORTS`
   缺失 drift 测试、1 处预先存在的死 import）。
6. **README 文档澄清（用户风险反馈跟进）**：测试徽章 `948/948` 增加环境依赖
   说明（本地 Windows 无 symlink 权限时实际为 943 passed/5 skipped，非缺陷）；
   补充 `trust: full-access` 与窄 `permissions: ["usage.read"]` 不对称的解释
   （引用 `docs/HOST_PROTOCOL_NOTES.md` 的宿主契约）；`self_learning_control`
   近 50 个 action 按代码层真实 side-effect 分类（只读查询/产出报告/提案预审/
   外部模型调用/本地状态变更）重新分组呈现，替代原先未分级的平铺列表。

## 不变量（未改动项）

- 所有默认配置值未变。
- 所有安全边界（scope-gate / validation-gate / action-risk / action-transaction /
  review / audit）判定逻辑未变。
- 所有默认关闭能力（外部模型、语义检索、LLM extraction、agent 自动执行、
  active skill injection、session messenger 通知、adaptive thresholds）保持
  默认关闭，未被本轮改为默认开启。
- R2-R4 action 风险分类逻辑未变（不可被外部输入降级）。
- 无 `lib/` 模块数增长（仅新增 `tools/control-handlers/*.js` 4 个 tools 模块）。

## 关键结果

| 项 | 结果 |
|---|---|
| package / lock / manifest | `5.1.7` |
| README version badge | `5.1.7` |
| README test badge | `948/948` |
| `tools/control.js` | 533→268 LOC（−50%），32→18 imports（−44%） |
| `lib/helpers.js` | 312→277 LOC，18→15 exports |
| lib 模块数 | 109（无变化） |
| soft warnings | 2→1（control imports 告警清零；剩余为无关的 lib module count 历史项） |
| structural warnings | 0 |
| 测试统计 | `948 tests · 943 passed · 5 skipped · 0 failed`（5 skip 为 Windows symlink 权限环境限制，非缺陷） |
| release zip | `release/hanako-runtime-learner-dist.zip`，SHA256 `ecc2d7e7a101f6ec147d1f69327127cf7c4256b645518f7826385bc1aa07005a` |

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run build` | passed（dist 13 files / bundle 367.5kB / release zip generated） |
| `npm run check` | passed |
| `npm test` | 948 tests · 943 passed · 5 skipped · 0 failed |
| `npm run benchmark` | passed（17/17 scenarios succeeded） |
| `npm run perf` | passed（all metrics within thresholds） |
| `npm run complexity:check` | passed（1 soft warning / 0 structural warnings / 0 hard violations） |
| `npm run release:check` | ready / Score 100 |
| `npm audit --audit-level=high` | 0 vulnerabilities |

## 交付物

- 精简计划执行文档：`test-plans/hanako-runtime-learner-subsystem-simplification-plan-v5.1.6.md`
  （含完整进度表与指标回填）。
- 收口结论：`test-plans/hanako-runtime-learner-subsystem-simplification-conclusion-v5.1.6.md`。
- 20 份逐单元格 findings 文档（`test-plans/findings/subsystem-simplify-v5.1.6-*.md`），
  含 S0-S11 全部子系统的边界审查证据与代码审查跟进记录。

## 结论

`v5.1.7` 是子系统级精简计划的收口发布：`tools/control.js` 控制面路由收敛取得
实质性、可度量的成果，六个核心域经严格审计确认健康，随后的独立多角度代码
审查未发现任何正确性缺陷。全程零默认行为变化、零安全边界放宽、零测试回归。
完整发布门通过后可创建 `v5.1.7` tag、GitHub Release 并上传 release zip asset。
