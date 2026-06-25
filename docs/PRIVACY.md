# 隐私说明

Runtime Self-Learning 默认只在本机记录学习数据。外部模型、语义检索和 LLM extraction 都必须显式启用，默认不会外发内容。

## 本地数据

默认数据目录为 `~/.hanako/self-learning/`，主要包含 `patterns.json`、`facts.json`、`event_log.jsonl`、`action_feedback.jsonl`、`SKILL.md` 和 `memfs/` 派生视图。API key、token、secret、password 等敏感字段会在审计输出中脱敏。

## LLM extraction

- `llmExtractionEnabled` 默认 `false`。
- 关闭时不会调用 `model:sample-text`、`sampleText` 或等价宿主模型采样能力。
- 启用后也只请求宿主提供的脱敏摘要，不主动读取原始私密文件。
- 模型失败、capability 不可用或返回异常时 fail-soft，记录状态后跳过。
- LLM 结果只进入 proposal/review 治理链；不会直接写入 `patterns.json`、`facts.json`、生成的 `SKILL.md` 或自动动作。
- 用户偏好、durable private knowledge 和长期事实不会被自动发送到外部服务。

## 后台任务

v5.0.0 的后台任务通过 Hanako `task:*` bus 调度 advisor、prune、log-retention 和 LLM extraction tick。后台任务不会启用新的真实自动执行面，不会绕开策略门，也不会让 R2/R3/R4 行为自动运行。缺少 task bus 时，插件安全降级到旧机会式整理路径。

## 外部服务

模型顾问、语义检索和 embedding 相关配置默认关闭。启用外部服务需要用户显式配置 endpoint/model/key，并且仍受 proposal、review、event log 和 policy gate 约束。
