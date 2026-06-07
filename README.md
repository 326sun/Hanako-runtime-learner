# Runtime Self-Learning

不会安装时先看 [`INSTALL.md`](./INSTALL.md)。

Hanako 桌面应用的本地自学习运行时插件。观察交互习惯，归纳模式，按需检索。

## 设计理念

不把全部学习记录注入系统提示，而是构建一个**知识树**——大模型在需要时用 `self_learning_search` 按关键词、任务类型、上下文检索相关模式。避免了模式增多后 token 线性膨胀的问题。

```
观测（EventBus）→ 学习（分类检测+遗忘曲线）→ 存储（图结构+上下文）
                                                    ↓
                                              按需检索（文本+上下文+关系+记忆强度）
```

## 功能

- **跨类别工作流检测**：工具序列按 8 个语义类别（文件探索、代码编写、网络研究等）归类，只有跨 ≥2 个类别的序列才记录
- **用户偏好学习**：检测中英文纠正语句，自动提取偏好
- **艾宾浩斯遗忘曲线**：模式记忆强度随时间衰减，重复越多遗忘越慢；approved 模式永存
- **自动批准**：高置信模式无需手动审批，开箱即自进化
- **后台整理**：用小模型定期分析模式，生成结构化建议（需要 Hanako utility model 凭据）
- **设置页面实时统计**：运行时数据、模式分布、最近学到、整理状态一目了然
- **活动时间线**：每次学习事件记录到 activity log，可追溯

## 安装

```powershell
git clone https://github.com/326sun/hanako-runtime-learner.git
cd hanako-runtime-learner
npm run install-plugin
```

零外部依赖，仅 Node.js 内置模块。

## 工具

| 工具 | 说明 |
|------|------|
| `self_learning_search` | 按关键词、类型、任务上下文搜索模式（文本+上下文+关系+记忆四路加权） |
| `self_learning_activity` | 最近学习活动时间线 |
| `self_learning_stats` | 运行时统计：轮次、模式、可注入数 |
| `self_learning_report` | N 日学习报告 |
| `self_learning_control` | 审批、配置、回滚 |
| `self_learning_open_dir` | 打开数据目录 |
| `self_learning_chart` | 每日 Token 消耗柱状图（SVG，由宿主 skill 层提供） |

## 配置

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `autoInjectHighConfidence` | boolean | true | 自动注入高置信提示 |
| `autoApproveHighConfidence` | boolean | true | 自动批准（无需手动审批） |
| `minInjectScore` | number | 8 | 注入最低评分 |
| `minInjectCount` | number | 2 | 注入最少重复次数 |
| `decayHalfLifeDays` | number | 30 | 记忆半衰期 |
| `includePendingPreferences` | boolean | true | 未审核偏好也参与注入 |
| `learnFromUsage` | boolean | true | 从 LLM 用量中学习 |
| `modelAdvisorEnabled` | boolean | true | 启用后台整理 |
| `modelAdvisorSource` | string | official | 整理模型（official / private / off） |
| `workStatusEnabled` | boolean | true | 显示工作状态 |

设置页面中带 📊 📁 🧠 图标的展示字段为运行时只读数据，由插件动态更新，非用户可编辑配置。

## 数据

所有数据存储于 `~/.hanako/self-learning/`，不离开本地。

| 文件 | 内容 |
|------|------|
| `patterns.json` | 图结构模式（含 context、relations） |
| `experience_log.jsonl` | 结构化学习记录 |
| `turns.jsonl` | 紧凑轮次记录 |
| `error_log.jsonl` | 工具错误记录 |
| `activity_log.jsonl` | 学习活动时间线 |
| `skill_history/` | SKILL.md 快照（最多 20） |

所有日志文件保留 30 天，自动清理。

## 卸载

删除 `~/.hanako/plugins/hanako-runtime-learner/`，重启。学习数据在 `~/.hanako/self-learning/`，可单独删除。

## 许可证

MIT
