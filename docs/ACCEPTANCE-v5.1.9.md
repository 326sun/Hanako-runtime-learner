# v5.1.9 验收记录（Hanako v0.357.17 设计审计修复，兼容 v0.374.3 预览）

日期：2026-07-10

## 范围

1. 官方记忆桥绑定当前 `agentId`，缺失身份 fail-closed，不再跨 Agent 扫描。
2. `onload` 致命失败向宿主传播；延迟启动任务随卸载取消。
3. 官方模型采样失败不再读取宿主凭证并直连；私有来源保持显式配置。
4. localhost HTTP embedding 可用，embedding 缓存绑定 endpoint。
5. 正式发布门消费绑定源码 fingerprint 的全量测试证据，并校验构建生成的 ZIP SHA-256 sidecar。
6. 日志统计复用完整尾采样结果、加速并缓存大文件行数，且只为需要展示的日志聚合会话。
7. proposal/review 终态不可逆，重复 apply 幂等，审核拒绝与提案拒绝保持一致。
8. JSONL 尾读在换行边界不丢完整记录；计数缓存对路径和文件替换正确失效。
9. Hanako v0.374.3 的 `toolset_changed` 环境提醒不会被当作用户回合学习，桌面 `session_user_message.message.text` 仍可正确采集；新版执行边界与 capability 上下文字段保持透传。

## 不变项

- `trust: full-access` 与 `permissions: ["usage.read"]` 不变。
- 不新增宿主 capability、外部网络默认行为或自动执行权限。
- model advisor、semantic search、LLM extraction 仍默认关闭或显式启用。
- scope、review、validation、transaction、rollback 与 audit 边界不放宽。

## 关键结果

| 项 | 结果 |
|---|---|
| package / lock / manifest | `5.1.9` |
| Hanako 目标 | `v0.357.17` 稳定版；已验证 `v0.374.3` 预览版兼容性 |
| 测试统计 | `994 tests · 989 passed · 5 skipped · 0 failed`（本机 Windows symlink 权限导致 5 skip） |
| 性能审计 | 10 万行冷计数约 `18 ms → 2.6–4.7 ms`；大型 `stats` `49.14 ms → 41.4–44.0 ms` |
| release ZIP | `release/hanako-runtime-learner-dist.zip` |
| ZIP 身份 | `release/hanako-runtime-learner-dist.zip.sha256` 由构建生成并由发布门复核 |

## 发布门

- `npm run check`
- `npm test`（生成当前源码测试证据）
- `npm run build`（生成 ZIP 与 SHA-256 sidecar）
- `npm run benchmark`
- `npm run perf`
- `npm run complexity:check`
- `npm run release:check`
- `npm audit --audit-level=high`

全部门禁通过后，`v5.1.9` 可作为新 tag / GitHub Release 发布；不覆盖既有 `v5.1.8` 资产。
