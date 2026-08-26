# AGENTS.md — omo-dsh 仓库门禁（对齐 OMO 原版纪律）

本仓库是 oh-my-openagent → DeepSeek Harness 的移植仓库。所有改动遵守：

1. **只在本仓库开发**：严禁修改/推送上游 oh-my-openagent 仓库；vendor 拷贝只读。
2. **插件形态铁律**：一切交付物为 cordis 插件（自研插件 或 bundle 内官方插件条目）。
   逻辑禁止散落在 profile、脚本或用户家目录配置。
3. **测试门禁**：每个插件包 bun test 全绿 + tsgo --noEmit 全绿，方可提交。
4. **QA 门禁**：涉及运行时行为的改动必须跑 skills/dsh-qa 对应用例，证据落盘
   evidence/<域名>/<slug>/；无证据 = 未完成。
5. **隔离纪律**：QA 必须使用隔离 DSH_HOME（临时目录），脚本内断言隔离生效，绝不碰用户真实 ~/.dsh。
6. **基线纪律**：omo 资产锁定于 VENDOR_LOCK.json 记录的 commit，不追新；
   更新基线必须先跑 scripts/verify-vendor.mjs。

（此文件在 P0 随仓库骨架一并提交，规则随 PLAN.md §5 演进）
