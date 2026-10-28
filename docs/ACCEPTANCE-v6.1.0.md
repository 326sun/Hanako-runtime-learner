# v6.1.0 长期记忆升级工作版验收

日期：2026-10-28。此文件只记录当前独立工作目录证据，不代表正式发布、生产安装或真实用户验收。

## 交付范围

- `self_learning_memory`：分页查看、查看单条与修订历史、按类型/项目过滤、受作用域门控的搜索、手工新增/部分修订、逻辑删除、导出、预览绑定导入、逐条批准。
- managed overlay：人工记录写入 `memory-state.json`，含 revision、候选预览、有限修订快照、删除 tombstone 和动作审计；与旧 `patterns.json` / `facts.json` 合并为有效视图。损坏的 overlay 会拒绝写入，不当作空库覆盖。
- 记忆类型：preference、fact、project_state、workflow、error、event、other；支持 summary、aliases、tags、keywords 和项目/任务范围。事实带有效期，稳定事实修改采用新 ID 并留下 supersession 关系。
- 检索：CJK BM25、现有中英同义词、元数据别名/摘要、多查询 RRF；准入在候选生成前发生，阻止无关项目记忆挤占 top-k。未实现向量索引或模型语义推理。
- 提示：同一个 managed effective view；只自动注入 approved/active，导入候选待显式批准；项目未知时仅 general/global；内容以预算约束的 JSON 数据行写入，不作为指令执行。
- 导入：版本化 JSON；一次性 previewId 绑定精确 bundle SHA-256、state revision 与 effective-memory fingerprint，预览过期或数据变动即拒绝。ID 冲突跳过并报告；事实冲突作为候选，不在导入时替换当前事实。
- 删除：逻辑隐藏，不再进入检索、注入和默认导出；不擦除旧 patterns/facts、历史日志、系统文件副本或用户已有的外部备份，不能作为安全擦除承诺。

## 已验证

- 最终全量回归：1052 tests，1047 passed，5 skipped，0 failed；5 个 skip 是 Windows 下 symlink 创建权限不足。
- `npm run check` 通过；`npm run complexity:check` 为 OK，4 条既有 soft warnings、0 structural warnings；`npm audit --audit-level=high` 为 0 漏洞。
- `npm run build:app` 生成 App 目录；官方 extension-pack 生成 6.1.0 ZIP 与 entry JSON。官方 archive 静态校验 `ok=true`、0 errors、0 warnings。
- 归档 `--smoke` 未完成：官方 smoke 要求 Node.js 26，当前环境 Node.js 24.15.0 且无缓存 runtime。不得把目录 smoke 成功或静态归档通过称为 ZIP runtime smoke。
- 51 项聚焦 App/管理层/检索测试通过，包含跨项目 top-k 阻塞、提示注入、待审核导入、预览错绑、事实替代、逻辑删除、别名召回等场景。SDK fixture 验证启动时注册 9 个工具；这不是生产 AppHost 安装观察。
- 测试命令、最终测试数、`npm run check`、`npm run build:app`、官方隔离包校验结果将在本轮最终回归后填写。

## 未验证/未包含

- 未安装或替换当前 Hana 生产中的 v6.0.0；未复制生产数据；未做真实对话、真实模型调用、长时间后台与其他操作系统测试。
- 未完成旧学习器 detector 对人工事实的物理同步；有效视图通过 overlay 优先规则遮盖旧值。旧 pattern 统计报告未必包含 overlay 统计，这类报告仍需继续接线。
- 不包含 SQLite/数据库替换、增量持久化向量索引、外部 DeepSeek 官方客户端连接器。Hana 内选择 DeepSeek 工具模型时，App 的模型中立数据路径不变。
- 该工作目录未含原 Git 元数据；发布门、CI、可复现源码 fingerprint 与供应链发布证据尚未建立。
