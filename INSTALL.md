# Runtime Self-Learning 安装指南

本文档只讲四件事：安装到哪里、怎么装、怎么升级、怎么排障。

## 目录约定

插件代码安装到：

```text
%USERPROFILE%\.hanako\plugins\hanako-runtime-learner
```

学习数据保存在：

```text
%USERPROFILE%\.hanako\self-learning
```

升级插件时不要删除 `self-learning`，否则会把历史学习记录一起清空。

## 首次安装

1. 关闭 Hanako。
2. 打开 PowerShell。
3. 执行：

```powershell
cd $env:USERPROFILE\Downloads
git clone https://github.com/326sun/Hanako-runtime-learner.git
cd Hanako-runtime-learner
npm run install-plugin
```

看到类似输出即可认为安装成功：

```text
Installed to C:\Users\<你的用户名>\.hanako\plugins\hanako-runtime-learner
OK    manifest.json
OK    index.js
OK    lib/common.js
OK    lib/hana-runtime-compat.js
OK    tools/search.js
OK    skills/self-learning/SKILL.md
```

4. 打开 Hanako。
5. 进入“设置 -> 插件”。
6. 允许全权限插件。
7. 启用 `Runtime Self-Learning`。

## 固定版本安装

如需固定到某个 release，例如 `v4.3.23`：

```powershell
git clone --branch v4.3.23 https://github.com/326sun/Hanako-runtime-learner.git
cd Hanako-runtime-learner
npm run install-plugin
```

## 如何确认插件已经工作

在 Hanako 中调用：

```text
hanako-runtime-learner_self_learning_stats
```

或者：

```text
hanako-runtime-learner_self_learning_control
```

参数：

```json
{ "action": "status" }
```

返回中看到以下字段，说明基础运行正常：

```text
patterns
injectable
historySnapshots
dataDir
```

## 升级

进入插件源码目录，执行：

```powershell
git pull
npm run install-plugin
```

不要执行下面这种删数据目录的命令，除非你明确想重置学习数据：

```powershell
Remove-Item -Recurse -Force $env:USERPROFILE\.hanako\self-learning
```

## 升级是否会丢数据

不会。安装脚本只替换插件代码目录：

```text
%USERPROFILE%\.hanako\plugins\hanako-runtime-learner
```

不会删除：

```text
%USERPROFILE%\.hanako\self-learning
```

所以旧版本积累的以下文件会继续被新版本读取：

```text
experience_log.jsonl
error_log.jsonl
patterns.json
config.json
turns.jsonl
skill_history/
```

## 清理旧目录

如果你以前安装过早期版本，可能还残留旧目录：

```text
%USERPROFILE%\.hanako\plugins\runtime-learner
%USERPROFILE%\.hanako\plugins-dev\runtime-learner
```

确认新目录可用后，可以删除：

```powershell
Remove-Item -Recurse -Force $env:USERPROFILE\.hanako\plugins\runtime-learner -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $env:USERPROFILE\.hanako\plugins-dev\runtime-learner -ErrorAction SilentlyContinue
```

保留的新目录应为：

```text
%USERPROFILE%\.hanako\plugins\hanako-runtime-learner
```

## 排障清单

安装或升级后，建议按下面顺序检查：

1. `manifest.json` 中的 `id` 必须是 `hanako-runtime-learner`。
2. 实际插件目录必须是 `%USERPROFILE%\.hanako\plugins\hanako-runtime-learner`。
3. 如果存在旧目录 `runtime-learner`，先移除旧目录，避免宿主读错目录。
4. 不要删除 `%USERPROFILE%\.hanako\self-learning`。
5. 安装后执行 `self_learning_control action=status`，确认 `dataDir` 仍然指向 `%USERPROFILE%\.hanako\self-learning`。
6. 如需完全卸载插件，只删除插件目录；如需清空学习数据，必须单独确认后再删数据目录。
