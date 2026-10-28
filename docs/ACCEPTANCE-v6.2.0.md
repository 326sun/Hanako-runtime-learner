# v6.2.0 长记忆升级工作版验收

日期：2026-10-28。此文件只记录 `6.2/` 独立候选的本地证据，不代表生产安装或市场发布。

## 借鉴并落地的机制

- Graphiti/Zep：episode -> derived memory 的来源链；episode 保存发生时间、写入时间、项目/任务范围、工具摘要、结果、纠正/错误信号和 opaque session hash。事实保留 `validFrom`、`validTo`、`learnedAt`，旧事实 supersede 而不物理覆盖。
- Mem0：把实体/别名和关键词作为独立检索信号，与 BM25、多查询 RRF 融合；不引入自动云端实体抽取，实体必须来自显式 subject/object/entities/aliases。保留项目门控和人工审核，避免 ADD-only 累积旧事实直接进入提示。
- Letta：core/archive 分层和预算思想。preference/fact/project_state 默认 core，其余默认为 archive；自动提示只取已批准 core，归档内容仍可显式检索。
- LongMemEval：增加信息提取、跨会话来源、知识更新、时间有效性和未知信息拒答边界的回归用例方向；不在本候选中声称完整跑完官方数据集。

## 新增功能

- `self_learning_memory` 增加 `provenance`、`episodes` 只读动作和 `memoryLayer=core/archive/all` 查询过滤。
- `episodes.jsonl` 每个回合一条 bounded record；由 `evidence.id` / `sourceRefs` 指向 episode。原始用户文本、session path 和凭证不写入 episode；原有 experience log 的隐私策略保持不变。
- `memory-relations.js` 提供显式实体/别名关系、有限一跳关系 boost、字符 n-gram 稀疏相似信号和 core/archive 分类；不引入 Graph DB、向量服务或额外联网。
- 记忆输出附带 `memoryTier`、`sourceRefs`、关系、学习时间和有效时间，便于审查为何命中以及何时有效。

## 已验证

- 构建 SDK 已锁定为与当前 HanaAgent 1.3.6-beta 同版的官方 `@hana/app-sdk`；npm lockfile、generated SDK 镜像、第三方声明一致。`tests/app-sdk-sync.test.js` 自动检查版本、完整文件清单及逐文件 SHA-256。

- 6.2 episode、多信号、关系边、core/archive 测试已加入现有测试套件；聚焦 App/managed-memory/retrieval 当前 57 项通过。
- SDK fixture 测试覆盖每个学习回合生成 episode、hash 化引用、episode ID 可用于 provenance 回查；真实宿主并未安装验证。
- 继承 6.1 的导入预览绑定、待审门控、逻辑删除、事实 supersession 和 App fixture 测试。
- 初版审计后的全量回归：1067 tests，1062 passed，5 skipped，0 failed；5 个 skip 是 Windows 下 symlink 创建权限不足。
- 新增回归覆盖：general/未知项目不搜索项目私有记忆；读/写工具动作不可互换；读写、导入导出绑定项目范围；Hook 按宿主 sessionPath 注入对应项目记忆；`get` 返回正文；episode 可查完整历史、锁定追加与容量修剪；伪造 sourceRefs 被拒；导出丢弃悬空关系；字符/实体信号参与最终提示排序。
- `npm run check` 通过；`npm run complexity:check` OK，4 条既有 soft warnings、0 structural warnings；依赖审计为 0 vulnerabilities。
- 审计修正后的 ZIP 已重新生成，官方归档静态校验 `ok=true, errors=0, warnings=0`；`npm audit --audit-level=high` 为 0 vulnerabilities。最终 ZIP SHA-256：`DDAF177E6E5179B9CBA3C1B3AB6DBB295EB1A456E6FE1D1268171554051984FD`。
- Node 26 archive runtime smoke 未运行（本机 Node 24）；真实 Hana 安装、生产数据迁移与实际对话尚未验收。

## 未实施或未声称

- 没有直接引入 Graphiti/Neo4j、Mem0 SDK、Letta server、LanceDB/Qdrant 或其它外部服务。
- 没有神经 embedding 模型；字符 n-gram 是本地确定性稀疏信号，不应称为语义向量。
- 没有自动从原始对话抽取实体并自动批准核心记忆；LLM extraction 仍走原有待审链。
- 没有完成完整 LongMemEval/LoCoMo 官方数据集评分、真实付费模型、生产迁移、长期后台和其它系统验收。
- 删除仍是逻辑隐藏，不承诺从旧日志或已有外部备份安全擦除。
