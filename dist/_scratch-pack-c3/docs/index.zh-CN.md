# my-power-dsh 文档

[English](index.md) | **中文**

my-power-dsh（DeepSeek Harness，DSH 的插件 bundle）的文档中心。如果你只想知道这个 bundle 是什么、
怎么安装，请先读 [README](../README.zh-CN.md)；想要完整文档集合，就从这里开始。

![分层架构图：DeepSeek Harness 宿主、bundle 的两层 patch、唯一的适配器接缝、用户接触到的界面，以及各个状态根目录。](./assets/images/architecture.svg)

*本 bundle 的形状：一个 DSH 宿主、两层 patch、唯一的适配器接缝、用户接触到的界面，以及状态根目录。完整组装说明见 [`design.zh-CN.md`](design.zh-CN.md)。*

## 阅读路径

### 使用者

1. [README](../README.zh-CN.md) —— 产品页：它是什么、两个端并排对比、特性、安装、快速上手、
   状态与已知限制。
2. [`user-guide.zh-CN.md`](user-guide.zh-CN.md) —— 长文、面向任务的使用者指南。
3. [`tui.zh-CN.md`](tui.zh-CN.md) —— 如果你在终端里工作，读 DSH-TUI 版本。
4. [`user-guide.zh-CN.md` §11](user-guide.zh-CN.md#11-故障排查速查) —— 症状 → 修复速查表。

### 扩展作者

1. [`extension-authoring-guide.zh-CN.md`](extension-authoring-guide.zh-CN.md) —— 什么时候扩展才是对的
   工具，以及模板实操。
2. [`extensions.zh-CN.md`](extensions.zh-CN.md) —— 冻结的契约、四种贡献种类、CLI。
3. [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md) —— 供智能体写扩展使用的机器契约
   （仅英文）。
4. [`../extensions/README.zh-CN.md`](../extensions/README.zh-CN.md) —— 随包提供的发现根目录。

### 贡献者

1. [`../CONTRIBUTING.zh-CN.md`](../CONTRIBUTING.zh-CN.md) —— 开发环境、构建与测试命令、关卡、git 模型。
2. [`development.zh-CN.md`](development.zh-CN.md) —— 本仓库自身的工作细节：布局、QA 通道、打包、
   vendor、发布流程。
3. [`design.zh-CN.md`](design.zh-CN.md) —— bundle 如何组装与挂载；改动 `packages/` 下任何东西之前
   先读它。
4. [`../AGENTS.md`](../AGENTS.md) —— 有约束力的仓库手册（仅英文）。
5. [`../CHANGELOG.md`](../CHANGELOG.md) —— 每个版本改了什么。

### 智能体

1. [`../AGENTS.md`](../AGENTS.md) —— 有约束力的手册：约定、关卡、git 模型。
2. [`../agent-references/troubleshooting.md`](../agent-references/troubleshooting.md) —— 完整的
   症状 → 原因 → 修复对照表。

此处原先列出的「采纳的 agent-teams 变更登记表」已随它所描述的 vendored 主体一同删除（de-vendor 波次）；
实时登记见 `agent-references/index.md`。

`agent-references/**` 面向智能体，按策略仅提供英文；它有意位于本文档中心所描述的双语范围之外。

## 文档索引

| 文档 | 读者 | 内容 |
|---|---|---|
| [`../README.zh-CN.md`](../README.zh-CN.md) | 所有人 | 产品页：bundle 是什么、Web 与 TUI 两个端并排对比、能力清单、安装步骤、快速上手，以及诚实的边界。 |
| [`user-guide.zh-CN.md`](user-guide.zh-CN.md) | 使用者 | 面向任务的指南：安装/卸载、`mpd` preset、按用途划分的工具、专家名册、workmate 库、团队模式、DSH-TUI 版本章节、Web GUI、`mpd.jsonc` 配置、从使用者视角看扩展、故障排查。 |
| [`extensions.zh-CN.md`](extensions.zh-CN.md) | 扩展作者 | 扩展接口 —— 冻结的描述符契约、四种贡献种类（skills、flows、MCP 服务器、roles）、发现根与开发者 CLI。 |
| [`extension-authoring-guide.zh-CN.md`](extension-authoring-guide.zh-CN.md) | 扩展作者、初次接触者 | 面向任务的编写指南 —— 什么时候扩展才是对的工具、唯一的一条平面选择规则、隔离姿态及其已接受的残余风险、生命周期/重启矩阵、模板实操、分发与故障排查。 |
| [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md) | 编写扩展的智能体 | 机器契约（仅有英文）—— 逐类型要求、每次文档检查都会校验的清单骨架、平面合法性、错误特征、拒绝清单与 v1 硬性边界。 |
| [`extension-adaptation-report.zh-CN.md`](extension-adaptation-report.zh-CN.md) | 技术决策者 | 外部插件适配的现状报告 —— 两条路径及各自适合谁、扩展接口清单、运行时与隔离姿态、本棵代码树上真实验证过的内容、风险与缺口，以及按 P0/P1/P2 排序的建议。 |
| [`tui.zh-CN.md`](tui.zh-CN.md) | TUI 会话使用者 | DSH-TUI 版本 —— 安装命令、TUI 原生界面、准入与分发产物、逐包兼容性台账，以及明确的 NOT-CLAIMED 清单。 |
| [`tui-parity.zh-CN.md`](tui-parity.zh-CN.md) | 在两个端之间做选择的用户 | 界面对齐台账：每个 Web 界面一行，列出它的 TUI 对应物、支撑该结论的证据等级，以及仍然开放的偏差。 |
| [`design.zh-CN.md`](design.zh-CN.md) | 工程师、好奇的使用者 | bundle 如何组装与挂载：补丁层、启动链、插件清单、交互流程、状态布局、web 客户端接线、TUI 版本接线。 |
| [`development.zh-CN.md`](development.zh-CN.md) | 开发者 | 仓库布局、构建/测试命令、QA 用例目录、关卡、打包/安装、vendor、git 模型、常见坑。 |
| [`../CONTRIBUTING.zh-CN.md`](../CONTRIBUTING.zh-CN.md) | 贡献者 | 如何贡献：开发环境、关卡、git 模型、文档规则、证据、pull request。 |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 所有人 | 发布说明，最新的在最前，每个已发布版本一节。 |
| [`../AGENTS.md`](../AGENTS.md) | 智能体 + 维护者 | 有约束力的仓库手册：约定、关卡、git 模型、故障排查。 |
| [`../extensions/README.zh-CN.md`](../extensions/README.zh-CN.md) | 扩展作者 | bundle 自带的发现根目录：三个根、各自的生命周期，以及随包提供的参考扩展。 |

维护者材料 —— 属于当前工作规范而非历史记录：

| 文档 | 读者 | 内容 |
|---|---|---|
| [`feature-audit.zh-CN.md`](feature-audit.zh-CN.md) | 工程师 | 工程基线：固定的上游 `8c57e46`（v5.0.0-beta.20）规格与移植状态对照（即 `AGENTS.md` §1 指向的能力目标）。 |
| [`upstream-parity-ledger.zh-CN.md`](upstream-parity-ledger.zh-CN.md) | 维护者、评审者 | 针对固定基线持续维护的专家对齐台账（双语）。 |

## 包参考

`packages/<name>/` 下的每个包都带有双语 `README.md` + `README.zh-CN.md`，但有一处已明确说明的
例外：**`mpd-mcp-shared`**（由各 MCP 服务器共享的辅助模块）只提供源码与测试 —— 它的 README 配对
是已记录的后续项。已退役的 `mpd-agent-teams-plugin` 目录随被采纳主体的其余部分一并**删除**（去
vendor 波次，2026-10-07），所以那份作为出处的 README 已不存在，也不再需要豁免；该主体剩下的部分见
下面「宿主插件」。

- **宿主插件** —— `mpd-dsh-adapter-plugin`（所有插件行共同调用的唯一 harness 接缝适配器）、
  `mpd-config-plugin`、`mpd-tools-plugin`、`mpd-modelchain-plugin`、`mpd-roles-plugin`、
  `mpd-ext-plugin`（扩展接口）、`mpd-ulw-plugin`、`mpd-hashline-plugin`、`mpd-boulder-plugin`、
  `mpd-goal-plugin`、`mpd-comment-checker-plugin`、`mpd-memory-plugin`、`mpd-codegraph-plugin`、
  `mpd-workmate-plugin`、`mpd-bootstrap-plugin`、`mpd-verify-plugin`、
  `mpd-team-core-plugin`（团队记录）、`mpd-team-compact-plugin`、`mpd-team-watchdog-plugin`、
  `mpd-roster-provider-plugin`、`mpd-tui-adapter-plugin`、`mpd-tui-plugin`、
  `mpd-better-sidebar-host`、`mpd-bundle-plugin`（bundle web 兼容 + 合并后的 web 客户端）、
  `mpd-qa-roles-probe`（仅 QA）。
- **共享库** —— `mpd-schemastery`（schemastery 校验器与六个 DSH 框架模块，四个随包插件的
  `Config` schema 与六个测试文件都解析到它）。
- **MCP 服务器** —— `mpd-mcp-astgrep`、`mpd-mcp-gitbash`、`mpd-mcp-lsp`、`mpd-mcp-codegraph`。
- **MCP 共享辅助模块** —— `mpd-mcp-shared`（四个服务器包装器所启动的二进制解析与 stdio 核心）。
- **聚合** —— `mpd-bundle`（`cordis.patch.yml`）。

## 图片资源

所有文档图片都放在 [`assets/images/`](./assets/images) 下。它们分为两类：示意图（以 SVG 编写，
因此标签可选中、可 diff）与随包发布的 bundle 的真实截图：

| 资源 | 被谁引用 | 内容 |
|---|---|---|
| [`architecture.svg`](./assets/images/architecture.svg) | 本文档中心、[design.zh-CN.md](design.zh-CN.md) | bundle 的各层：DSH 宿主 → patch 层 1 → patch 层 2 → 适配器接缝 → 界面 → 状态根目录。 |
| [`ulw-loop.svg`](./assets/images/ulw-loop.svg) | [使用者指南 §13.2](user-guide.zh-CN.md#132-ulw-循环与它的关卡) | 一次 ultrawork 运行：分诊、可选计划、按轮次走 `pin → red → green → surface → clean` 循环执行、验证关卡与质量关卡。 |
| [`team-lifecycle.svg`](./assets/images/team-lifecycle.svg) | [使用者指南 §6](user-guide.zh-CN.md#6-团队模式) | 一波团队工作的完整路径，以及各类护栏（只读工具禁用、持久邮箱、compare-and-set 任务板、提示性写入范围）。 |
| [`hero-web-tui.png`](./assets/images/zh-CN/hero-web-tui.png) | [README](../README.zh-CN.md) | 同一个 bundle 在两个端上的并排对比：Web GUI 与 DSH-TUI，各自裁到 Agent Teams 面板与团队场景。 |
| [`web-team-board.png`](./assets/images/zh-CN/web-team-board.png) | [README](../README.zh-CN.md#一个插件两个端) | Web 端带真实名册与任务图的 Agent Teams 面板。 |
| [`tui-team-dag.png`](./assets/images/zh-CN/tui-team-dag.png) | [README](../README.zh-CN.md#一个插件两个端) | 同一个团队渲染成一整屏 DSH-TUI 场景，任务图用制表符画出。 |
| [`web-plugins-installed.png`](./assets/images/zh-CN/web-plugins-installed.png) | [README](../README.zh-CN.md#安装) | 一条安装命令之后的 Plugins 页面：`@mpd-dsh/mpd` 列在 **Installed** 且已启用。 |
| [`web-agent-presets.png`](./assets/images/zh-CN/web-agent-presets.png) | [README](../README.zh-CN.md#用法) | Agent presets 页面：`mpd` preset 被标记为新任务的默认项。 |
| [`web-settings-mpd.png`](./assets/images/zh-CN/web-settings-mpd.png) | [README](../README.zh-CN.md#用法) | 设置页里的 MPD 分区 —— 与 `.mpd/mpd.jsonc` 是同一批旋钮。 |
| [`tui-status-line.png`](./assets/images/zh-CN/tui-status-line.png) | [README](../README.zh-CN.md#快速上手) | DSH-TUI 提示符上方的按键状态行，以及打开的 `/mpd` 命令树。 |
| [`tui-workmates.png`](./assets/images/zh-CN/tui-workmates.png) | [README](../README.zh-CN.md#用法) | DSH-TUI 里的 `/mpd workmates` 列表。 |

上面每一张截图都由 [`docker/ui/`](../docker/ui) 下的 Docker 通道产出，不是手工截的、也不是在绘图
工具里画的：Web 图由无头 Chromium 驱动真实应用取得，终端图由真实终端模拟器在真实 PTY 上渲染真实
TUI 取得。通道的原始输出落在 `docker/ui/out/`（该目录被 gitignore），只把筛选后的图片提交到本目录。
SVG 示意图则是在本仓库中编写的。

## 扩展资产

- [`../extensions/README.zh-CN.md`](../extensions/README.zh-CN.md) —— bundle 自带的发现根目录。
- [`../extensions/mpd-ext-example/`](../extensions/mpd-ext-example) —— 默认禁用的参考扩展：一个
  skill、一个 flow、一个 role，以及一个可用的零依赖 stdio MCP 服务器。
- [`../scripts/mpd-ext.ts`](../scripts/mpd-ext.ts) —— 开发者 CLI
  （`validate` / `scaffold` / `list` / `--self-test`）。

## 过程记录

`docs/plan-{c,d,e,f}.md`、`docs/decisions.md` 以及 `track-a-report.md` / `bline-report.md`
记录了移植决策与证据时间线。它们是历史，而不是当前规范；当前规范是 `AGENTS.md`、
`docs/feature-audit.zh-CN.md` 与上面列出的文档。
`docs/plan-tui-edition.md` 与 `docs/tui-edition-report.md` 是 DSH-TUI 版本的同类记录：冻结的验收契约，
以及评判它的交付报告。这些文件按策略豁免双语要求（`AGENTS.md` §3），每个文件都带有自己的豁免标记，
或匹配已声明的模式。

## QA 证据

真实运行证据位于 `evidence/<domain>/<slug>/<timestamp>/`；每个 QA 用例的断言记录在
[`skills/dsh-qa/SKILL.md`](../skills/dsh-qa/SKILL.md) 中。
