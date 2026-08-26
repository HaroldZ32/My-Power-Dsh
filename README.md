# omo-dsh

将 oh-my-openagent 的可移植能力接入 DeepSeek Harness（DSH）的第三方插件 bundle。

**两条铁律**
1. 测试与开发严格对齐 OMO 原版纪律：bun test、tsgo 类型门禁、隔离 QA（不碰用户真实 ~/.dsh）、
   证据落盘唯一规范路径 evidence/<域名>/<slug>/、阶段门禁。
2. 一切交付物均为 DSH 插件（cordis plugin）形式：有逻辑即自研插件，纯装配即 bundle 内插件条目，
   无游离脚本、无裸配置。

- 移植计划：见 [PLAN.md](./PLAN.md)
- 基线锁定：见 [VENDOR_LOCK.json](./VENDOR_LOCK.json)
- 许可声明：见 [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)
- 门禁规则：见 [AGENTS.md](./AGENTS.md)（P0 落盘）

状态：计划 v2 已交付，待确认后进入 P0 实施。
