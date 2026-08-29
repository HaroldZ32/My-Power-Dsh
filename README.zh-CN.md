# my-power-dsh

**中文** | [English](./README.md)

my-power-dsh 是一个 DeepSeek-Harness 插件 bundle，移植了 oh-my-openagent (OmO) 的可移植能力。

> **Fork 声明**：本项目是 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> （commit `8c57e46`，v5.0.0-beta.20）的 fork，做了深度修改；继承上游
> **Sustainable Use License 1.0 (SUL-1.0)**。上游版权归 code-yeongyu 与 OmO 贡献者所有。
> 完整许可文本： [LICENSE.md](./LICENSE.md)。

**安装（一条命令，可整体迁移）**

```sh
node scripts/pack-mpd.mjs                          # -> dist/mpd-package/（无 checkout 绝对路径）
dsh plugin --profile web add dist/mpd-package      # 安装打包后的 bundle
```

> 注意：`dsh plugin add` 必须指向**打包后的**包（仓库根目录没有 `dsh.bundle.patch` 条目）。
> 当目标位置包含打包后的包时，`dsh plugin add <path-or-git-url>` 同理可用。

## 文档

完整文档位于 [`docs/`](docs/index.md) —— 从 [`docs/index.md`](docs/index.md) 开始：

- [`docs/user-guide.md`](docs/user-guide.md) —— 安装、预设、专家（roster）、workmate
  库、团队模式、GUI 面板、配置（[中文版](docs/user-guide.zh-CN.md)）。
- [`docs/architecture.md`](docs/architecture.md) —— bundle 组装、启动链路、插件清单、
  交互流程、状态布局、web client 接线（[中文版](docs/architecture.zh-CN.md)）。
- [`docs/development.md`](docs/development.md) —— 构建/测试/QA/打包/发布
  （[中文版](docs/development.zh-CN.md)）。
- [`AGENTS.md`](AGENTS.md) —— 仓库约束手册（约定、门禁、git 模型、排障）。

本 bundle 安装后提供 `@mpd-dsh/mpd`：DeepSeek 双轨（官方默认）、MCP 服务器、全部
mpd 插件（含 codegraph 自动初始化）、采纳的 agent-teams（团队 + Web 面板）、`mpd`
主代理预设，以及作为 SUBAGENTS 的 OMO 起源专家：

- **`mpd` 预设的每个工程会话都会尝试读取 `AGENT.md`**（依次回退 `AGENTS.md`、
  `CLAUDE.md`），通过 `dsh-agent-instructions` 实现。
- **11 个 OMO 起源代理是专家与队友模板，不是预设**：Architect、Researcher、Planner、
  Deep Worker、Senior Engineer、Lead、Explorer、Reviewer、Plan Reviewer、Vision
  Analyst 和 Junior Engineer 位于 mpd-roles roster —— 用 `mpd_role_spawn` 单发咨询，
  `mpd_roles_list` 列 roster，`mpd_role_persona` 取 persona 文本。只读角色在 spawn 时
  被机制上禁用写工具。
- **团队模式采用采纳的 dsh-agent-teams 插件**（主代码位于
  `packages/mpd-agent-teams-plugin`，`agent_teams_*`
  工具 + Web 活动面板）：一个正常命名的 `mpd` roster profile
  （`taskPlanning: captain`）把上述专家暴露为队友实例化模板。captain 调用
  `agent_teams_create(profile="mpd")`，在面板中暂存计划，然后由依赖感知调度器执行。
- **Web GUI**（`@mpd-dsh/mpd` client bundle，`packages/mpd-bundle-plugin`）：团队
  活动浮窗 + 团队卡片（采纳的 agent-teams client，原样内嵌）以及一个
  **Workmate 库**浮窗（侧边栏脚部 "Workmates" 按钮）：列出 `~/.mpd/workmate/` 实例
  （base、uses、note），并可在浏览器中通过 `GET/POST /plugins/mpd-workmate/*` 新建。
  bundle patch 带有 `mpd-web-compat` 自引用行（`name: '@mpd-dsh/mpd'`），使
  client-modules boot graph 包含本 bundle 的 client entry —— 没有它面板永远不会加载。
- **Workmate 库**（`~/.mpd/workmate`）：roster 专家只是 BASE 模板；用 `mpd_workmate_init`
  将其实例化为一个独立命名的持久化、可演化副本。每次工作会话后它会自我总结
  （`mpd_workmate_reflect`）—— 演化自己的 persona + 独立 memory（带大小上限）并保留
  一张简短 note 卡。通过 `mpd_workmate_list` / `mpd_workmate_match` 复用；若没有
  note 匹配得足够好（`matched=false`），应新建一个 workmate 而不是强行弱匹配。
  在团队里，以 workmate 命名的成员会自动获得其 persona/memory 注入（
  `packages/mpd-agent-teams-plugin` 中打过补丁的 `memberPersona`）。
- `mpd-bootstrap` 首次启动自动复制 `mpd` 预设 + skill 语料（版本戳：升级包版本并重新
  打包即可刷新已安装副本）。

**两条硬规则**
1. 工程遵循上游纪律：bun test / tsgo 门禁、隔离 QA、证据落在
   `evidence/<domain>/<slug>/`、阶段门禁。
2. 每个交付物都是 DSH 插件（自写 cordis 插件或官方插件实例）。不留散落脚本、不写裸配置。

- 移植计划：[PLAN.md](./PLAN.md)
- 基线锁：[VENDOR_LOCK.json](./VENDOR_LOCK.json)
- 法律：[LICENSE.md](./LICENSE.md) / [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)
- 门禁与分支模型：[AGENTS.md](./AGENTS.md)
- 一键安装（主流程）：`node scripts/pack-mpd.mjs && dsh plugin --profile web add dist/mpd-package`；
  旧开发流程：`node scripts/install-profile.mjs --yes`（默认 dry-run；见 --help）

状态：Plan D 解耦完成 —— 可迁移的一插件安装（evidence/plan-d/relocate PASS）；
Plan C 各波完成（团队采纳、ultrawork 引擎、hashline、boulder、mpd.jsonc、memory
git+svn、vision e2e）；Plan F 完成 —— OMO 代理作为 subagent roster
（mpd-roles-plugin）、单一 `mpd` 主预设承载 AGENT.md 约定、mpd.jsonc 接入全部运行时
插件（evidence/plan-f/roles-subagent PASS）。
