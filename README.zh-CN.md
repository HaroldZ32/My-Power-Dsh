# my-power-dsh

**中文** | [English](./README.md)

my-power-dsh 是一个 DeepSeek-Harness 插件 bundle，移植了 oh-my-openagent (OmO) 的可移植能力。

> **Fork 声明**：本项目是 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> （commit `8c57e46`，v5.0.0-beta.20）的 fork，做了深度修改；继承上游
> **Sustainable Use License 1.0 (SUL-1.0)**。上游版权归 code-yeongyu 与 OmO 贡献者所有。
> 完整许可文本： [LICENSE.md](./LICENSE.md)。

**安装（一条命令，直接在检出目录执行）**

```sh
dsh plugin --profile web add .        # 在仓库根目录执行
```

> 仓库根目录**就是** bundle 包（`@mpd-dsh/mpd`）：其 manifest 声明了 `dsh.bundle.patch`、
> `dsh.client` 以及各行的解析所依赖的 `exports` 映射，因此这一条命令就会装好全部插件行、
> `mpd` preset 与整个 skill 语料库——无需打包步骤、无需复制步骤。
> `dsh plugin remove @mpd-dsh/mpd` 同样干净地反向卸载。
>
> `node scripts/pack-mpd.mjs`（`npm run pack`）现在只是**发布**步骤：为发布或 tarball 安装组装
> 可迁移的 `dist/mpd-package/`（`dsh plugin --profile web add dist/mpd-package`）。
> 本地检出安装完全不需要它。

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
- **Web GUI**（`@mpd-dsh/mpd` client bundle，`packages/mpd-bundle-plugin`）：
  **Workmates** 页面通过 `ctx.betterSidebar.registerTab` 注册为 **DSH-better-sidebar**
  （社区 `dsh-better-sidebar` bundle）的一个 Tab —— 列出 `~/.mpd/workmate/` 实例
  （base、uses、更新时间、note），点开查看 persona/memory/note，并用由 roster 填充的
  base 选择器新建；数据来自 `GET /plugins/mpd-workmate/{list,roster,get}` 与
  `POST /plugins/mpd-workmate/init`。若 profile 中没有该侧边栏，同一页面会以 bundle 自带的
  🤖 浮窗 + 侧栏脚部按钮挂载。采纳的 agent-teams 团队卡片/活动浮窗依赖 harness 的
  `conversationEvents` 服务，而当前 DSH 版本已不再提供，因此不挂载（团队协作通过
  `agent_teams_*` 工具进行）。bundle patch 带有 `mpd-web-compat` 自引用行
  （`name: '@mpd-dsh/mpd'`），使 client-modules boot graph 包含本 bundle 的 client entry
  —— 没有它面板永远不会加载。
- **Workmate 库**（`~/.mpd/workmate`）：roster 专家只是 BASE 模板；用 `mpd_workmate_init`
  将其实例化为一个独立命名的持久化、可演化副本。每次工作会话后它会自我总结
  （`mpd_workmate_reflect`）—— 演化自己的 persona + 独立 memory（带大小上限）并保留
  一张简短 note 卡。通过 `mpd_workmate_list` / `mpd_workmate_match` 复用；若没有
  note 匹配得足够好（`matched=false`），应新建一个 workmate 而不是强行弱匹配。
  在团队里，以 workmate 命名的成员会自动获得其 persona/memory 注入（
  `packages/mpd-agent-teams-plugin` 中打过补丁的 `memberPersona`）。
- **唯一的 Harness 适配器。** 所有 mpd 行都通过 `packages/mpd-dsh-adapter-plugin`（`mpdDsh` 服务）
  完成工具注册/guard/post-execute、内部工具调用、子代理 spawn、skill 供给与 preset 解析——因此
  DeepSeek Harness 改变某个接缝时，只需改一个文件，而不是改遍所有插件（AGENTS.md §6）。
- **整体安装、整体卸载。** 一条 `dsh plugin add dist/mpd-package` 同时装好全部插件行与资产：
  `mpd` preset 由 `<bundle>/presets` 供给（patch 把 preset 名册的根指向该目录），skill 语料库由
  `<bundle>/skills` 供给（`mpd-bootstrap` 行注册 `ctx.skills` provider）。不再向 `$DSH_HOME` 复制任何内容，
  因此 `dsh plugin remove @mpd-dsh/mpd` 会连同行、preset 与 skills 一起移除，不留残留；只有 workmate 库
  （`~/.mpd/workmate`，属于你自己的演化 agent）保留。

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
