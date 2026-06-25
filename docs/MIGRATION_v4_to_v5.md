# v4 到 v5 迁移说明

v5.0.0 是主线基线，不强制 v4.3.x 用户立即迁移。旧宿主、源码安装流程或希望维持 v4 LTS 边界的用户可以继续停留在 v4.3.x。

## 宿主与运行要求

| 项目 | v4.3.x | v5.0.0 |
|---|---|---|
| Hanako | 兼容旧 v0.330+ 线 | `minAppVersion` 为 `0.345.0` |
| Node | 旧 LTS 开发线 | Node.js `>=22` |
| 发布形态 | 源码目录安装为主 | release zip 自包含安装 |
| 运行时依赖 | 无 | 无 |
| 构建依赖 | 无强制打包依赖 | `esbuild` 仅 devDependency |

## 用户安装

普通用户应使用 release zip：`release/hanako-runtime-learner-dist.zip`。zip 根目录直接包含 `index.js`、`manifest.json`、`README.md`、`LICENSE`、`plugin-process-runner-child.js` 和 `tools/`，不需要也不应该在插件目录运行 `npm install`。

## 开发者安装

开发者可以继续 clone 仓库并运行：

```powershell
npm install
npm run build
npm run install-plugin
```

`npm install` 只用于开发/构建环境，终端用户安装 release zip 时不需要。

## 行为变化

- LLM extraction worker 存在，但 `llmExtractionEnabled` 默认仍为 `false`。
- 关闭 LLM extraction 时不会调用 Hanako `model:sample-text` / `sampleText`。
- LLM 输出只进入 proposal/review 链，不直接写入 `patterns.json`、`facts.json` 或 `SKILL.md`。
- 后台整理优先使用 Hanako `task:*` bus 协议；旧宿主没有 `task:*` 时自动降级，不中断插件加载。
- 后台任务有 single-flight 防并发、重复 schedule 防护和 event log 审计。

## 本次未包含

- M1 本地 embedding / vector index。
- M4 Agent 编排。
- M5 adaptive thresholds。
- `resource.watch` 自动学习。
- Execute / Repair / 外部真实副作用的新自动执行面。

## 迁移检查

1. 确认 Hanako 宿主满足 `0.345.0` 或继续使用 v4.3.x LTS。
2. 备份 `~/.hanako/self-learning/`。
3. 安装 v5 release zip。
4. 保持 `llmExtractionEnabled=false`，除非已明确接受外部模型采样。
5. 运行 `self_learning_doctor`，确认数据目录、event log 和配置状态正常。
