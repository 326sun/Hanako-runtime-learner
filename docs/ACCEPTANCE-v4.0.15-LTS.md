# 验收报告 · v4.0.15 LTS

## 版本信息

改造前：
1. package version: `4.0.14-lts`
2. npm test: `485 passed` in previous acceptance baseline
3. npm run check: passed
4. npm run benchmark: passed, 13 scenarios

改造后：
1. package version: `4.0.15-lts`
2. npm test: `489 passed`
3. npm run check: passed
4. npm run benchmark: passed, 14 scenarios

## 本版目标

补齐 `Skill Promotion End-to-End Loop`：把 reflexion memory、failure cluster、skill candidate、action feedback、promotion decision、effectiveness tracking、decay 和 active-skill registry 串成一条保守闭环。

本版不扩大高风险自动化边界，不默认写入 `SKILL.md`。

## 新增能力

1. 新增 `runSkillPromotionLoop()`：
   - 读取 `reflexion_memory.jsonl`
   - 聚合同类失败为 failure cluster
   - 达到阈值后生成或更新 skill candidate
   - 读取 `action_feedback.jsonl`
   - 将成功/回归证据吸收到 candidate evidence
   - 根据成功数、回归数和 decay 规则推进状态
   - 写入 `skill_candidates.json`
   - 写入独立的 `active_skills.json`

2. 新增候选 skill 生命周期：

```text
reflexion
→ failure_cluster
→ candidate
→ staged
→ active
→ decayed / removed
```

3. 新增反馈去重：
   - 通过 feedback id / action id / timestamp 组合避免重复计数。

4. 新增保守写入边界：
   - 默认阻止直接写 `SKILL.md`。
   - active skill 只进入独立 registry，后续仍可人工审核再注入核心技能文件。

5. Benchmark runner 新增步骤类型：
   - `run_skill_promotion_loop`

6. Benchmark corpus 新增场景：
   - `skill.promotion_e2e_loop`

## 新增文件

```text
lib/skill-promotion-loop.js
tests/skill-promotion-loop.test.js
benchmarks/scenarios/skill/skill-promotion-e2e-loop.json
docs/ACCEPTANCE-v4.0.15-LTS.md
```

## 修改文件

```text
lib/benchmark-corpus.js
lib/evaluation-runner.js
tools/control.js
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
CHANGELOG.md
package.json
package-lock.json
manifest.json
```

## 新增测试

```text
skill promotion loop creates candidates from reflexion clusters without writing SKILL.md
skill promotion loop absorbs feedback, stages candidates, and activates after additional evidence
skill promotion loop decays candidates with regression evidence
self_learning_control exposes skill promotion loop and listings
```

## 安全边界

本版没有扩大 R4 自动化边界。

保留边界：

```text
不自动写 SKILL.md
不自动提升跨项目迁移经验为核心技能
回归证据会触发 decay
低置信/过期候选会衰减
active skill registry 只是候选执行经验库，不等于核心技能文件
```

## 自动执行边界

本版新增自动化只处理 learnerDir 内部的学习状态文件：

```text
skill_candidates.json
active_skills.json
```

不会修改项目源代码、不会发布、不会删除、不会发消息、不会修改密钥。

## 失败回滚验证

本版没有新增写源码的事务动作，因此不需要 action transaction rollback。

学习状态写入采用独立 JSON registry：

```text
skill_candidates.json
active_skills.json
```

如果 promotion loop 失败，返回 `status: failed`，不会继续推进 candidate 状态。

## Benchmark 验收

Benchmark 从 13 个场景增加到 14 个场景。

新增场景证明：

```text
3 条同类 reflexion
→ 形成 promotable cluster
→ 创建 skill candidate
→ 吸收 3 条成功 feedback
→ 第一轮进入 staged
→ 第二轮进入 active
→ 写 active_skills.json
→ 默认不写 SKILL.md
```

## 已知限制

1. 仍未做用户可视化 dashboard。
2. active skill registry 还没有接入真正的 prompt injection 策略。
3. `SKILL.md` 写入仍应保留人工审核或额外 staged injection gate。
4. 跨项目 transfer candidate 与本地 skill promotion loop 仍是两条保守链路，尚未完全统一。

## 下一版本建议

下一版建议做：

```text
v4.0.16 Audit Dashboard / Report Surface
```

理由：现在执行链、插件、controller、benchmark、transfer validation、skill promotion loop 都已经有系统级证据，下一步应该把这些 evidence 汇总成用户可读的审计面板/报告层。
