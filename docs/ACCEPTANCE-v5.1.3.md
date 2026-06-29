# v5.1.3 验收记录（配置一致性 + 面板即时生效）

日期：2026-06-29

> 待维护者授权推送：本记录完成代码 + 测试 + 门禁验收。tag / GitHub Release / asset /
> 安装留待真实 Hanako 验证通过后由维护者执行。版本号 `5.1.2 → 5.1.3`
> （package.json / package-lock / manifest 同步）。

## 范围

三组改动，均不放宽安全边界、不新增网络副作用、不动 official 架构：

1. **bugfix**：governance profile 不再覆盖 `includePendingPreferences` 安全闸门。
2. **feature**：设置面板改动经 `plugin_config_changed` 事件即时生效，无需重启。
3. **repo 卫生**：benchmark 生成产物移出 git 跟踪。

## 已修问题

| 严重度 | 模块 | 内容 |
|---|---|---|
| 中 | `lib/policy-profiles.js` | profile 模板此前混入安全闸门 `includePendingPreferences` 与能力/隐私开关（`modelAdvisorEnabled`/`semanticSearchEnabled`/`llmExtractionEnabled`/`includeUsageInAdvisorPrompt`/`workStatusEnabled`），用户显式开启后切 `autonomous` 被 doctor `policy_inconsistent` 误报并催关回。现 profile.values 只留治理姿态（auto-inject/auto-approve/require-review）+ `proposalChatNotifications`；上述开关移出，仅由 UI / `set_config` 掌控，doctor 不再误报。conservative 高危硬拦由 validation-gate 承担，正交 |
| 低 | `lib/proposals.js` | `code_patch` 调查工单此前对 `error:network_error`（环境性）与 `error:tool_error`（catch-all 杂烩桶）也生成，反复堆积噪声。现与 `error:unknown` 一并排出 `isActionableCodePatchPattern`；具体错误桶仍可生成 |

## 新增能力

| 模块 | 内容 |
|---|---|
| `index.js` + `lib/live-config.js`（新） | 订阅宿主 `plugin_config_changed`（`core/plugin-manager.ts` setConfig 广播），重桥接面板值并**原地更新**共享 config 对象（保持引用身份，detector / 闭包 / configRef / runner 同步生效），无需重启。新增纯函数 `replaceConfigInPlace` / `applyLiveConfig` |
| `manifest.json` | `learnFromUsage`（唯一在 onload 建立订阅、无法 live 的字段）标注 `reloadRequired: true` 与「改动后需重载」说明文案 |
| `.gitignore` | 忽略 `benchmark-results/`（`npm run benchmark` 的本地派生产物，含时间戳/延迟），并 `git rm --cached` 取消跟踪两份报告；可追踪输入仍是 `benchmarks/` 下 baseline |

## 门禁结果

| 门 | 结果 |
|---|---|
| `npm run check` | passed |
| `npm test` | 851 tests · 846 passed · 5 skipped · 0 failed · 0 cancelled |
| `npm run complexity:check` | OK（soft warnings 3 / 0 hard） |
| `npm run release:check` | ready / Score 100 |

## 验证补充（仓库外，一次性）

以临时目录加载真实 `index.js` onload + fake 宿主，模拟 `plugin_config_changed`，端到端确认：改面板后有效 config 即时更新（含布尔与数值字段）、pluginId 守卫只响应本插件事件、autonomous profile 不再翻动安全闸门。脚本未入库（按维护者要求跑后即删）。

## 结论

代码 + 测试一致，release-readiness 门禁 `ready`。功能性变更已具单元 + 集成覆盖。
真实 Hanako 面板/工具验证通过后，由维护者授权 tag 与 Release。
