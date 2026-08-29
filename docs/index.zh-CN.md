# my-power-dsh 文档

**中文** | [English](index.md)

这是 my-power-dsh DeepSeek Harness (DSH) bundle 的文档索引。以下是完整文档集合；
仓库手册是 [`AGENTS.md`](../AGENTS.md)（面向代理与人类的约束规则），公开概览是
[`README.zh-CN.md`](../README.zh-CN.md)（英文版：[`README.md`](../README.md)）。

## 阅读顺序

| 文档 | 面向人群 | 内容 |
|---|---|---|
| [`../README.zh-CN.md`](../README.zh-CN.md) | 所有人 | 简短公开概览：这个 bundle 提供什么、继承/来源声明。 |
| [`feature-audit.zh-CN.md`](feature-audit.zh-CN.md) | 工程师 | 当前工程基线：上游 `8c57e46`（v5.0.0-beta.20）spec 与本移植现状的能力对照（AGENTS.md §1 指向的工程目标）。 |
| [`user-guide.zh-CN.md`](user-guide.zh-CN.md) | 用户 | 安装、预设、专家（roster）、workmate 库、团队模式、GUI 面板、配置。 |
| [`architecture.zh-CN.md`](architecture.zh-CN.md) | 工程师、好奇的用户 | bundle 如何组装与挂载：patch 层、插件清单、模型路由、状态布局、web client 接线、交互流程。 |
| [`development.zh-CN.md`](development.zh-CN.md) | 开发者 | 仓库布局、构建/测试命令、QA case 目录、门禁、打包/安装、vendor、git 模型、常见坑。 |
| [`../AGENTS.md`](../AGENTS.md) | 代理 + 维护者 | 仓库约束手册：约定、门禁、git 模型、排障。 |
| [`../LICENSE.md`](../LICENSE.md)、[`../LICENSE-NOTICES.md`](../LICENSE-NOTICES.md) | 所有人 | SUL-1.0 许可 + 第三方声明（采纳的 dsh-agent-teams、comment-checker）。 |

## 包参考

每个包的 README 位于 `packages/<name>/README.md`（英文版，标题下有中文切换链接）：

- **Host 插件** —— `mpd-config-plugin`、`mpd-tools-plugin`、`mpd-modelchain-plugin`、
  `mpd-roles-plugin`、`mpd-ulw-plugin`、`mpd-hashline-plugin`、`mpd-boulder-plugin`、
  `mpd-comment-checker-plugin`、`mpd-memory-plugin`、`mpd-codegraph-plugin`、
  `mpd-workmate-plugin`、`mpd-bootstrap-plugin`、`mpd-agent-teams-plugin`（采纳）、
  `mpd-bundle-plugin`（bundle web-compat + 合并 web client）、`mpd-qa-roles-probe`（仅 QA）。
- **MCP 服务器** —— `mpd-mcp-astgrep`、`mpd-mcp-gitbash`、`mpd-mcp-lsp`、
  `mpd-mcp-codegraph`。
- **聚合** —— `mpd-bundle`（`cordis.patch.yml`）。

## 历史规划文档

`docs/plan-{c,d,e,f}.md`、`docs/decisions.md` 以及
`track-a-report.md` / `bline-report.md` 记录移植决策与证据时间线。它们是历史，不是
当前规范；`AGENTS.md`、`docs/feature-audit.md` 与本页以上文档才是当前的。

## QA 证据

真实运行证据位于 `evidence/<domain>/<slug>/<timestamp>/`；每一个 QA case 的断言见
[`skills/dsh-qa/SKILL.md`](../skills/dsh-qa/SKILL.md)。
