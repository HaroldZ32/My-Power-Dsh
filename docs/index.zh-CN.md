# my-power-dsh 文档

[English](index.md) | **中文**

my-power-dsh（DeepSeek Harness，DSH 的插件 bundle）的文档中心。如果你只想知道这个 bundle 是什么、
怎么安装，请先读 [README](../README.zh-CN.md)；想要完整文档集合，就从这里开始。

## 阅读顺序

| 文档 | 读者 | 内容 |
|---|---|---|
| [`../README.zh-CN.md`](../README.zh-CN.md) | 所有人 | 产品页：bundle 是什么、能力清单、一条命令安装、快速上手。 |
| [`user-guide.zh-CN.md`](user-guide.zh-CN.md) | 使用者 | 面向任务的指南：安装/卸载、`mpd` preset、按用途划分的工具、专家名册、workmate 库、团队模式、DSH-TUI 版本章节、Web GUI、`mpd.jsonc` 配置、从使用者视角看扩展、故障排查。 |
| [`extensions.zh-CN.md`](extensions.zh-CN.md) | 扩展作者 | **新增**：扩展接口 —— 冻结的描述符契约、四种贡献种类（skills、flows、MCP 服务器、roles）、发现根与开发者 CLI。 |
| [`extension-adaptation-report.zh-CN.md`](extension-adaptation-report.zh-CN.md) | 技术决策者 | **新增**：外部插件适配的现状报告 —— 两条路径及各自适合谁、扩展接口清单、运行时与隔离姿态、本棵代码树上真实验证过的内容、风险与缺口，以及按 P0/P1/P2 排序的建议。 |
| [`tui.zh-CN.md`](tui.zh-CN.md) | TUI 会话使用者 | **新增**：DSH-TUI 版本 —— 安装命令、TUI 原生界面、准入与分发产物、逐包兼容性台账，以及明确的 NOT-CLAIMED 清单。 |
| [`architecture.zh-CN.md`](architecture.zh-CN.md) | 工程师、好奇的使用者 | bundle 如何组装与挂载：补丁层、启动链、插件清单、交互流程、状态布局、web 客户端接线、TUI 版本接线。 |
| [`development.zh-CN.md`](development.zh-CN.md) | 开发者 | 仓库布局、构建/测试命令、QA 用例目录、关卡、打包/安装、vendor、git 模型、常见坑。 |
| [`../AGENTS.md`](../AGENTS.md) | 智能体 + 维护者 | 有约束力的仓库手册（英文）：约定、关卡、git 模型、故障排查。 |
| [`../extensions/README.zh-CN.md`](../extensions/README.zh-CN.md) | 扩展作者 | bundle 自带的发现根目录：三个根、各自的生命周期，以及随包提供的参考扩展。 |

维护者材料 —— 属于当前工作规范而非历史记录：

| 文档 | 读者 | 内容 |
|---|---|---|
| [`feature-audit.zh-CN.md`](feature-audit.zh-CN.md) | 工程师 | 工程基线：固定的上游 `8c57e46`（v5.0.0-beta.20）规格与移植状态对照（即 `AGENTS.md` §1 指向的能力目标）。 |
| [`upstream-parity-ledger.zh-CN.md`](upstream-parity-ledger.zh-CN.md) | 维护者、评审者 | 针对固定基线持续维护的专家对齐台账（双语）。 |

## 包参考

`packages/<name>/` 下的每个包都带有双语 `README.md` + `README.zh-CN.md`，但有两处已明确说明的
例外：**`mpd-mcp-shared`**（由各 MCP 服务器共享的辅助模块）只提供源码与测试 —— 它的 README 配对
是已记录的后续项；而被采纳的 **`mpd-agent-teams-plugin`** 原样保留上游 `README.md` 作为出处
（provenance），双语规则对其豁免。

- **宿主插件** —— `mpd-dsh-adapter-plugin`（所有插件行共同调用的唯一 harness 接缝适配器）、
  `mpd-config-plugin`、`mpd-tools-plugin`、`mpd-modelchain-plugin`、`mpd-roles-plugin`、
  `mpd-ext-plugin`（扩展接口）、`mpd-ulw-plugin`、`mpd-hashline-plugin`、`mpd-boulder-plugin`、
  `mpd-comment-checker-plugin`、`mpd-memory-plugin`、`mpd-codegraph-plugin`、
  `mpd-workmate-plugin`、`mpd-bootstrap-plugin`、`mpd-team-compact-plugin`、
  `mpd-agent-teams-plugin`（采纳）、`mpd-bundle-plugin`（bundle web 兼容 + 合并后的 web 客户端）、
  `mpd-qa-roles-probe`（仅 QA）。
- **MCP 服务器** —— `mpd-mcp-astgrep`、`mpd-mcp-gitbash`、`mpd-mcp-lsp`、`mpd-mcp-codegraph`。
- **MCP 共享辅助模块** —— `mpd-mcp-shared`（四个服务器包装器所启动的二进制解析与 stdio 核心）。
- **聚合** —— `mpd-bundle`（`cordis.patch.yml`）。

## 扩展资产

- [`../extensions/README.zh-CN.md`](../extensions/README.zh-CN.md) —— bundle 自带的发现根目录。
- [`../extensions/mpd-ext-example/`](../extensions/mpd-ext-example) —— 默认禁用的参考扩展：一个
  skill、一个 flow、一个 role，以及一个可用的零依赖 stdio MCP 服务器。
- [`../scripts/mpd-ext.mjs`](../scripts/mpd-ext.mjs) —— 开发者 CLI
  （`validate` / `scaffold` / `list` / `--self-test`）。

## 历史规划文档

`docs/plan-{c,d,e,f}.md`、`docs/decisions.md` 以及 `track-a-report.md` / `bline-report.md`
记录了移植决策与证据时间线。它们是历史，而不是当前规范；当前规范是 `AGENTS.md`、
`docs/feature-audit.zh-CN.md` 与上面列出的文档。
`docs/plan-tui-edition.md` 与 `docs/tui-edition-report.md` 是 DSH-TUI 版本的同类记录：冻结的验收契约，
以及评判它的交付报告。

## QA 证据

真实运行证据位于 `evidence/<domain>/<slug>/<timestamp>/`；每个 QA 用例的断言记录在
[`skills/dsh-qa/SKILL.md`](../skills/dsh-qa/SKILL.md) 中。
