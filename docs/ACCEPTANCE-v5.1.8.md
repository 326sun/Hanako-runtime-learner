# v5.1.8 验收记录（usage evidence + doctor 降噪补丁）

日期：2026-07-03

> 本版本是在已发布的 `v5.1.7` 之上做干净补丁发布。`v5.1.7` tag / release asset 不覆盖、不重写；修复进入新提交、新 tag 与新 GitHub Release。

## 范围

1. **usage pattern evidence 补齐**：`ingestUsage()` 为 large-context 与 failed-request usage pattern 生成结构化 `usage` evidence，记录 model、operation、status、token 规模、request id / entry id 与错误摘要；已有 usage pattern 被强化时追加去重 evidence。
2. **doctor evidence_missing 降噪**：`evidence_missing` 不再统计 `status === "rejected"` 的高分旧 pattern，避免已拒绝记忆污染健康报告。
3. **回归测试补强**：新增 usage evidence、existing usage pattern evidence 追加、entry id fallback、rejected pattern doctor 降噪测试。
4. **发布计数同步**：测试总数从 `948` 更新到 `950`，同步 README badge、release-readiness 默认值和 release fixture。

## 不变项

- 不做历史 backfill，不批量改写已有用户数据。
- 不新增外部模型调用、网络权限或自动执行能力。
- 不改变 scope-gate、validation-gate、action-risk、review、audit、transaction 默认边界。
- LLM extraction、semantic search、model advisor、adaptive thresholds 等默认关闭或 recommendation-only 策略保持不变。

## 关键结果

| 项 | 结果 |
|---|---|
| package / lock / manifest | `5.1.8` |
| README version badge | `5.1.8` |
| README test badge | `950/950` |
| 测试统计 | `950 tests · 945 passed · 5 skipped · 0 failed`（5 skip 为 Windows symlink 权限环境限制，非缺陷） |
| release zip | `release/hanako-runtime-learner-dist.zip`，SHA256 `6490c5879fc1414dc39f4e7dda35355ce9f63c17fc38e88f12f0a40256edcf2f` |

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run build` | passed |
| `npm run check` | passed |
| `npm test` | 950 tests · 945 passed · 5 skipped · 0 failed |
| `npm run benchmark` | passed（17/17 scenarios succeeded） |
| `npm run perf -- --json` | passed（all metrics within thresholds） |
| `npm run release:check` | ready / Score 100 |
| `npm audit` | 0 vulnerabilities |

## 结论

`v5.1.8` 是 evidence 质量与健康诊断噪音的补丁发布。它修复了未来 usage pattern 缺 provenance 的主要来源，并避免 rejected 历史 pattern 继续拉低 doctor 报告可信度；默认行为、安全边界和自动化治理策略不变。完整发布门通过后可创建 `v5.1.8` tag、GitHub Release 并上传新的 release zip asset。
