# Complexity Budget (v4.x LTS)

本文件定义 Runtime Self-Learning 在 v4.x LTS 维护期的复杂度预算与治理规则。
它是 hard limit / soft target 的**权威说明**；可机读的实际数值定义在
[`lib/complexity.js`](../lib/complexity.js) 的 `COMPLEXITY_HARD_LIMITS` /
`COMPLEXITY_SOFT_TARGETS` 常量中，两者必须保持一致。

- 状态报告：`npm run complexity:report` → [COMPLEXITY_REPORT.md](COMPLEXITY_REPORT.md)
- 门禁检查：`npm run complexity:check`（超出 hard limit 时 `exit 1`）
- 发布集成：`npm run release:check` 含 `complexity.within_budget` 检查项

## 设计原则

v4.x 已进入 LTS 维护期，复杂度预算的目的是**防止膨胀**，不是强迫重构。

1. **冻结优先**：维护期不为新功能放宽预算。新增复杂度需要明确依据。
2. **可机读、可验证**：预算落在代码常量与脚本里，不只是散文约定。
3. **headroom 而非现状卡死**：hard limit 高于当前最大值，留出维护余量；
   soft target 贴近现状，作为优先治理信号。
4. **零运行时依赖不可动摇**：复杂度治理本身不得引入任何运行时依赖。

## 扫描范围

`lib/`、`scripts/`、`tests/`、`tools/` 下的 `.js` / `.cjs` / `.mjs` 文件。
度量为轻量启发式（非完整 AST 解析）：LOC、import+require 数、export 数、TODO/FIXME 数。
TODO/FIXME 仅统计约定式标记（`TODO:` / `FIXME:` / `TODO(author):`），
代码或字符串中单纯出现这两个词（含本治理工具自身）不计入，避免自指误报。

## Hard limits（超出即 `release:check` 失败）

| 维度 | Hard limit |
|---|---|
| 单文件 LOC | 900 |
| 单文件 import + require 数 | 35 |
| 单文件 export 数 | 25 |
| TODO/FIXME 总数 | 40 |
| `lib/` 模块数 | 118 |

## Soft targets（超出记为债务，不阻断发布）

| 维度 | Soft target |
|---|---|
| 单文件 LOC | 600 |
| 单文件 import + require 数 | 20 |
| 单文件 export 数 | 18 |
| TODO/FIXME 总数 | 10 |
| `lib/` 模块数 | 105 |

超出 soft target 但在 hard limit 内的项，会在复杂度报告中列为 soft 警告，并应登记到
[COMPLEXITY_DEBT.md](COMPLEXITY_DEBT.md)。

## 模块新增规则

> **2026-07-03（C-005）更新**：lib 模块数轨迹 98→107；预算同步上调为 hard
> 110→118、soft 95→105（原因见下方「预算调整历史」）。同时，「拆大文件默认
> 新建文件」被证明是本次预算逼近上限的直接成因（`test-plans/findings/simplify-S3.md`
> 的普查证明现有小模块无一可安全合并），因此新增规则 0：**先判断能否移位/合并/就地处理，
> 新建文件是最后手段**，不再是"文件太大就拆"的默认动作。

0. **新建文件是最后手段**：某文件超预算时，先问“这段代码是否根本不该在这里”
   （移到已有的、职责相符的文件）、再问“能否合并/复用现有模块”，只有在目标
   宿主文件拆完后仍逼近 soft/hard、或被拆部分有独立复用/测试/安全边界价值时，
   才新建 `lib/` 模块。
1. **禁止新增无依据模块**。任何新增 `lib/` 模块必须有明确依据（治理/安全/兼容），
   并在 PR 描述与 CHANGELOG 中说明，否则视为预算违规。
2. **one-in-one-out（默认仍适用，但让位于规则 0）**：维护期内每新增一个非必要
   模块，应同步合并/删除一个等量模块，使 `lib/` 模块数保持稳定（目标 ≤ soft
   target 105）。
3. 治理/基础设施工具（如本复杂度治理自身）可作为一次性有依据的例外，但仍计入 `lib/` 模块数预算。

## 依赖规则

- **不允许新增运行时依赖**，除非经过明确批准并记录在案。
- 复杂度治理工具仅使用 Node 内置模块（`fs` / `path`），不引入任何第三方包。
- `package.json` 不得出现 `dependencies` 字段；如需新增请先走批准流程。

## 调整预算的流程

收紧或放宽任一 limit 都是**显式治理动作**：

1. 修改 `lib/complexity.js` 中的常量。
2. 同步更新本文件对应表格。
3. 在 CHANGELOG 记录原因（若本次调整未随版本发布，先记入下方「预算调整历史」，
   待下次版本发布时并入该版本的 CHANGELOG 条目）。
4. 确认 `npm run check`、`npm test`、`npm run complexity:check`、`npm run release:check` 全部通过。

## 预算调整历史

- **2026-07-03 — `libModuleCount` hard 110→118、soft 95→105**（`docs/COMPLEXITY_DEBT.md` C-005）。
  背景：`hanako-runtime-learner-simplification-plan-v5.1.3.md` 简化计划执行期间，
  实测 lib 模块数从 v5.1.1 审计基线的 98 增长到 107（hard 110 仅剩 3 个余量）。
  simplify-S3 对全部 30 个 <90 LOC 的小模块做了消费者普查，逐一评估后**零个**
  可安全合并——现有模块均有安全边界/冻结核心减负/独立测试等正当理由。据此
  判定「合并回收」不是可行杠杆，选择上调预算恢复其"高于当前最大值留出余量"
  的设计原则，同时把"新建文件是最后手段"固化为规则 0（见上）。维护者已确认
  采纳该方案。**尚未随版本发布**，CHANGELOG 条目待下次版本号变更时一并记录。
