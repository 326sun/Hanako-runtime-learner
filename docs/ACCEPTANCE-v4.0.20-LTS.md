# 验收报告

## 版本信息

改造前：

1. package version: `4.0.19-lts`
2. npm test: `502 tests，Windows 上 7 failed / 2 skipped`
3. npm run check: `passed`
4. npm run benchmark: `Windows 上 2 个场景相关测试失败`
5. npm run release:check: `ready`

改造后：

1. package version: `4.0.20-lts`
2. npm test: `502 tests，498 passed + 4 skipped（Windows symlink 权限，合理跳过）`
3. npm run check: `passed`
4. npm run benchmark: `17 scenarios passed`
5. npm run release:check: `ready，score 100`

## 本版目标

本版属于 v4.0 LTS 维护优化，不改变核心架构。

目标是处理用户提出的四项要求：

```text
1. 审计代码
2. 修改代码有问题的地方
3. 精简臃肿代码
4. 提升代码性能
```

## 修复的关键问题

### 1. Windows 持久化静默丢失（关键 bug）

文件名清洗正则 `/[^a-zA-Z0-9._:-]+/g` 放行了 `:`，而 taskId 形如 `task:<hex>`。
在 NTFS 上 `:` 是数据流分隔符，临时文件写入落入数据流、rename 报 `EINVAL`，
且调用方用 `try {} catch {}` 包裹保存——审计 trace、agent 任务状态、transfer
记录在 Windows 上从未成功落盘。受影响模块：

```text
lib/audit-trace.js
lib/agent-task-store.js
lib/task-state.js
lib/transfer-registry.js
lib/audit-dashboard.js
```

修复：`lib/common.js` 新增 `safeFileSlug()`（排除 `:`），五处统一改用。

### 2. Windows 测试缺陷

1. `tests/benchmark-corpus.test.js` 用 `URL.pathname` 取项目根，win32 下得到
   `/D:/...` 导致语料目录找不到 → 改用 `fileURLToPath`。
2. symlink 越界测试在无管理员权限时硬失败 → 与既有测试一致地跳过并注明原因。

### 3. 死代码与重复实现

1. 删除 21 个零引用导出（代码、测试、docs、benchmarks 全无引用），包括
   假实现 `checkUniqueCandidate`、自身有 bug 的 `verifyRepair`（读取
   execAsync 不存在的 `status` 字段）、`task-state.js` 从未使用的持久化半部。
2. 五份手写"tmp+rename 原子写"收敛到 `common.js` 的 `writeJson()`（其中
   audit-dashboard 原实现根本不是原子写）。
3. `hana-runtime-compat.js`（与 hanako-ui-beautify 同步的兼容层）刻意未动。

### 4. 性能

```text
appendAuditEvent: 每次追加深拷贝全部历史事件 O(events²) → 浅拷贝追加 O(events)
message_update:   assistantText 达到 1000 字符上限后跳过每个流式 delta 的正则归一化
```

### 5. 健壮性

损坏的 benchmark scenario JSON 现在进入 `rejected` 列表，而不是让
`loadBenchmarkCorpus` 整体崩溃。

## 新增文件

```text
docs/CODE_AUDIT_OPTIMIZATION_ROUND4_2026-06-11.md
docs/ACCEPTANCE-v4.0.20-LTS.md
```

## 修改文件

```text
package.json / package-lock.json / CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
lib/common.js（新增 safeFileSlug）
lib/audit-trace.js lib/agent-task-store.js lib/task-state.js
lib/transfer-registry.js lib/audit-dashboard.js lib/review-queue.js lib/proposals.js
lib/repair-strategies.js lib/repair-classifier.js lib/event-log.js lib/model-advisor.js
lib/agent-state-machine.js lib/agent-resume.js lib/action-types.js lib/action-registry.js
lib/action-registry-runtime.js lib/plugin-process-runner.js lib/command-allowlist.js
lib/subtask-queue.js lib/task-graph.js lib/memory-index.js lib/benchmark-corpus.js
lib/observer.js tools/stats.js
tests/benchmark-corpus.test.js tests/filesystem-boundary-final-audit.test.js
tests/action-transaction-boundary.test.js
```

## 净精简

```text
源代码净减少约 240 行；删除 21 个死导出；未新增任何运行时依赖。
```

## 安全边界

本版没有扩大任何自动执行边界。

```text
R4 自动执行：仍 blocked
外部副作用：仍 blocked_by_policy
删除、发布、push、tag、release：仍 never_auto
密钥、凭据、付款信息：仍 never_auto
code_patch proposal：仍 manual review only
skill promotion：仍不直接写 SKILL.md
policy gate / scope gate / rollback / verifier：未放宽
```

## 数据迁移说明

POSIX 老安装中带字面 `:` 的旧记录文件（如 `audit/task:abc.json`）在新命名
（`task_abc.json`）下不会被读取；新写入使用新命名。Windows 上旧文件本就
从未成功写出，无需迁移。

## 失败回滚验证

本版不新增源码自动写入动作。既有 rollback 仍由以下 benchmark 场景覆盖：

```text
controller.rollback_branch
plugin.rollback_on_verify_failure
safety.rollback_failed_verification
```

## 已知限制

1. `tools/control.js` 仍是大文件（动作分发器），拆分前需 handler 级特征测试。
2. `lib/pattern-detector.js` 仍较大，缓存/遗忘曲线行为耦合强，LTS 期不强拆。
3. 各模块本地一行式 `clone()`/`now()` 重复属无行为收益的改动，刻意保留。

## 每版必须回答的 10 个问题

1. 这个版本新增了什么自动能力？
   - 没有。本版是 bug 修复 + 死代码清理 + 性能微优化。
2. 这个自动能力属于 R 几风险？
   - 不新增动作风险。
3. 自动执行前有什么 policy gate？
   - 未改变现有 policy gate。
4. 自动执行前有什么 scope gate？
   - 未改变现有 scope gate。
5. 如果执行失败，如何 rollback？
   - 不新增自动写入动作；既有 rollback 机制不变（且在 Windows 上其审计证据现在能真正落盘了）。
6. 如何验证执行成功？
   - `npm run check`、`npm test`、`npm run benchmark`、`npm run release:check` 全部通过。
7. 失败经验写到哪里？
   - 未改变；仍进入既有 feedback / reflexion / event log 路径。
8. 成功经验如何晋升？
   - 未改变；仍通过 skill candidate / promotion loop。
9. 什么情况会升级人工确认？
   - 未改变。
10. 这个版本有没有扩大高风险自动化边界？
    - 没有。
