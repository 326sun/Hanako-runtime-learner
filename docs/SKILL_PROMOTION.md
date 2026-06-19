# 技能晋升说明

技能晋升负责把“局部模式”提升为“更稳定、可复用的技能提示”，但这个过程必须受证据和回归约束。

## 流程

```text
reflexion -> cluster -> candidate -> evidence -> staged -> active
```

## 阶段含义

| 阶段 | 说明 |
|---|---|
| `candidate` | 初步候选，还没有足够证据。 |
| `staged` | 证据逐渐完整，等待进一步确认。 |
| `active` | 已经可作为稳定技能参与注入。 |

## 晋升条件

通常至少关注：

- 重复次数
- 成功证据数
- 回归次数
- 作用域稳定性
- 文本是否适合写入 `SKILL.md`

## 注入边界

即便技能进入 `active`，也不代表会自动注入。注入仍受以下开关和预算控制：

- `activeSkillsInjectionEnabled`
- `activeSkillsInjectionMaxCount`
- `activeSkillsInjectionMinSuccess`
- `activeSkillsInjectionMaxRegression`
- `maxSkillTokens`

## 冻结规则

1. 技能文本必须被当成数据渲染，不能借机注入 Markdown 结构。
2. 技能晋升不能绕过作用域门。
3. 已激活技能的回归信号必须能让它降级或停止注入。
