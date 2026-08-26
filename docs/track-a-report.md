# Track A 报告（P0–P5 首轮）

## DoD 状态（S1–S7）

| # | 标准 | 状态 | 证据 |
|---|---|---|---|
| S1 | 可复现构建 bundle | 部分达成 | bootstrap/verify-vendor/build-mcp 通过；生产 profile 安装（dsh plugin/pnpm）待用户侧执行——见"遗留" |
| S2 | 官方 API headless+web 双端 | headless 达成 / web 待手测 | 双轨 7.8s/7.9s PASS；web 组合 dump 通过，真实 GUI 待手测 |
| S3 | >=3 skills、>=2 MCP、>=3 预设 | 超额达成 | 7 skills、2 个可调用 MCP（ast-grep 真实成功、lsp 链路，codegraph 默认禁用）、4 预设 |
| S4 | 金标通过率 >=80%，含 >=2 硬件 | 达成 | 9/9=100%，硬件 G2(adder4)/G9(cnt8) 两道 |
| S5 | 原仓库零改动零推送 | 达成 | 全程核查；仅检出时已有的 2 个 evidence modified |
| S6 | 许可证合规 | 达成 | LICENSE-NOTICES（SUL-1.0 内部使用声明） |
| S7 | 全部插件形态 + 测试/QA 证据 | 基本达成 | 全部能力以插件包/官方插件条目交付；QA 脚本 5 个带 --self-test；插件源码级 bun test 尚待补 |

## 遗留（用户侧/后续）

1. 生产 profile 安装：dsh plugin --profile omo add 本 bundle + bootstrap 拷贝预设到 $DSH_HOME/.agent-presets（安装脚本待加）；
2. web GUI 预设手测：选 omo-oracle/librarian/prometheus/hephaestus 预设各跑一次（DSH UI 预设选择器）；
3. 插件包内源码单测补建（bun test 目录）——B 线前完成；
4. F9（config.roots 在 headless 的语义差异）继续跟踪；F12 金标设计修正。

## 提示词适配结论

- DeepSeek 对 OMO 原版人格适配良好：Prometheus（规划纪律）、Oracle（证据链审查+拒绝越权）、任务级工具纪律均已实证；
- 适配日志见 tests/prompt-adaptation-log.md；后续迭代依据 rubric 失败项（本轮无失败项）。
