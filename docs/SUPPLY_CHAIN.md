# 供应链说明（Supply Chain）

本文件记录 Runtime Self-Learning 的依赖与构建供应链，作为 v5.0 放宽「零构建依赖」约束后的可审计依据。

## 运行时依赖：无

插件**没有任何运行时依赖**。`package.json` 不包含 `dependencies` 字段。所有插件逻辑只使用 Node 内置模块（`fs` / `path` / `crypto` / `child_process` / `url` / `zlib` 等）。

宿主安装插件后不会替插件执行 `npm install`，因此运行时必须自满足。v5.0 采用 **esbuild 预打包**：源码经构建内联为自洽产物，发布包内不含 `node_modules`，终端用户拖入 zip、启用即可。

## 构建期依赖（devDependencies）

| 包 | 版本 | 用途 | 是否进入发布产物 |
|---|---|---|---|
| `esbuild` | `0.28.1`（精确锁定） | 构建期把 `index.js` 与 8 个工具入口分别打包为自洽 ESM bundle | 否。仅 devDependency，构建期使用，不随发布 zip 分发 |

- 版本以 `--save-exact` 精确锁定，并提交 `package-lock.json`，保证可复现构建。
- esbuild 自带平台原生二进制（由其 optionalDependencies 解析）。这是**构建机**上的工具链，**不**进入发布产物，也**不**是插件运行时依赖。
- License：MIT。
- 原生 addon：插件运行时无原生 addon；esbuild 的平台二进制仅用于开发/构建期。
- `npm audit`：M6 release gate 必跑；高危或严重漏洞为发布阻断。
- M6 本地结果：`npm audit --omit=dev --cache .\.npm-cache` 返回 `found 0 vulnerabilities`。完整 devDependency audit 已执行，但当前受限环境对 npm registry audit endpoint 返回 `EACCES`，未获得 advisory 结果；正式发布环境应重跑完整 `npm audit`。
- v5.0 **不引入**任何需要编译的原生 addon（faiss-node / hnswlib-node / native sqlite-vss 等）；M1 的 transformers / embedding / wasm / 模型权重未进入本次发布。

## 构建与发布产物

- 构建命令：`npm run build`（`node scripts/build.js`）。
- 源码（受测、可审计）：`index.js` + `lib/**` + `tools/**`。
- 发布产物（仅用于安装）：`dist/`
  - `dist/index.js`：主插件打包产物（`lib/**` 内联）。
  - `dist/tools/*.js`：8 个 `self_learning_*` 工具，各自独立打包（不再依赖 `../lib`）。
  - `dist/manifest.json`、`dist/README.md`、`dist/LICENSE`。
  - `dist/plugin-process-runner-child.js`：子进程 fork 目标，**原样拷贝**、不打包（运行期按路径 fork）。
- 发布 zip：`release/hanako-runtime-learner-dist.zip`，**根目录即插件本体**（`index.js` / `manifest.json` / `tools/` 直接在根，无嵌套 `dist/`）。
- `dist/` 与 `release/` 均为生成物，已加入 `.gitignore`，不提交源码仓库；不参与复杂度预算扫描（扫描范围固定为 `lib/scripts/tests/tools`）。

## 构建自检（scripts/build.js + lib/dist-verify.js）

每次 `npm run build` 强制自检，任一失败即 `exit 1`：

- `dist/` 必含 `index.js`、`manifest.json`、`README.md`、`LICENSE`、`plugin-process-runner-child.js`；
- `dist/tools/` 必含 8 个 `self_learning_*` 工具入口，且各文件非空；
- `dist/index.js` 与每个 `dist/tools/*.js` 不含未解析的插件内部 import（`../lib` / `../tools` / `../index`）；
- `dist/` 不含 sourcemap、dotfile、`node_modules`、源码 `lib/` 目录；
- 发布 zip 根目录直接包含 `index.js` + `manifest.json` + `tools/`，且不嵌套 `dist/`。

## 审计产物

- `release/esbuild-meta.json`：esbuild metafile，供审计构建图与产物体积；**不进入发布 zip**。

## 排除项

- `dependencies`：无。
- `node_modules/`：不进入 `dist/` 或 release zip。
- `lib/` 源码目录：由 esbuild 内联进 bundle，不随 zip 分发。
- `tests/`、`release/`、嵌套 `dist/`、sourcemap、dotfile：不进入 zip。
- M1 本地 embedding / vector index、M4 Agent 编排、M5 adaptive thresholds：不属于 v5.0.0 发布范围。
