# v5.0 M2 基线记录（feat/v5-m2-llm-extraction）

> 临时基线快照，供 M2 回归对照。正式验收文档 `docs/ACCEPTANCE-v5.0.0.md` 在 M6 统一编写。

## 起点

- 基线分支：`main`
- 基线 commit：`e69f199c42f8a8dce79b560557c49c0bd24c3bf9`
- 基线 tag：`v4.3.23`
- 工作分支：`feat/v5-m2-llm-extraction`（从上述 commit 切出）

## 基线门禁（main，clean tree）

| 门禁 | 结果 |
|---|---|
| `npm run check` | exit 0 ✅ |
| `npm test` | tests **665** / pass **660** / fail **0**（5 skipped）✅ |
| `npm run complexity:check` | OK，3 soft warnings（max LOC 等仍在 hard limit 内）✅ |

## 复杂度预算关键值

- `lib/` 模块数：**88**（soft 95 / hard 110）→ M2 预计 +5 = 93，仍 < soft 95
- 单文件 LOC：hard 900 / soft 600
- 测试计数权威：`lib/release-readiness.js` 默认 `expectedTestCount ?? 665`；README 徽章 `tests-665%2F665`、`665 项测试`

## M2 不做清单（强约束）

- 不做 M1 本地 embedding / 向量索引
- 不做 M4 Agent Execute/Repair/Rollback 真实副作用
- 不做 M5 adaptive thresholds
- 不启用 resource.watch 自动学习
- LLM 产物**禁止**直接写 patterns.json / facts.json / runtime-config.json / SKILL.md
- 不碰宿主 config.json；运行时私有配置仅 runtime-config.json
- 不抬 minAppVersion（放 M0/M6）
- 不 push、不在 main 直接改
