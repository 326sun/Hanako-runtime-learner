# v5.1.11 本地适配验收

日期：2026-10-18。目标：HanaAgent 1.1.24-beta。运行环境：Windows、Node 24.15.0。

- 来源：插件 v5.1.10 tag / commit `2acf05455ad264670f59e328afa38c9c346dbe15`。
- 初始回归：994 tests，988 passed，1 failed，5 skipped。失败为中文 URL 路径解码。
- 修复前新契约测试可复现任务参数与 Pi 工具错误读取失败。
- 修复后全量：1001 tests，996 passed，5 skipped，0 failed。
- 5 项 symlink 测试因 Windows 权限跳过，未宣称跨平台通过。
- 隔离真实宿主 TaskRegistry / bus：3 个计划、重复建立幂等、1 次真实调度执行完成、recovering 任务恢复为 failed。
- 现有 v1 格式和 `minAppVersion: 0.345.0` 基线保留；只对上述最新版执行了新的宿主验证。
- 安装、测试、基准和发布门的命令见 [HANA_1.1_COMPATIBILITY.md](HANA_1.1_COMPATIBILITY.md)。机器可读测试证据位于 `benchmark-results/test-results.json`；构建 ZIP 和 SHA-256 位于 `release/`。
- 未改动真实安装与学习数据，未发布 GitHub tag，未进行生产对话或跨平台验收。
