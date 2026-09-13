# my-power-dsh

**中文** | [English](./README.md)

**my-power-dsh** 是一个独立的 DeepSeek Harness（DSH）插件 bundle —— 即包 `@mpd-dsh/mpd`：拥有自己的
插件行、一个 `mpd` agent preset 以及随包提供的 skill 语料库，用一条 `dsh plugin add` 即可安装。

它**不是** OMO 的 DeepSeek Harness 移植版。它的来源是事实性的，而非血统关系：一份
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)（OmO；commit `8c57e46`，
v5.0.0-beta.20 —— 本仓库并不跟随推进的基线）的固定基线，其 11 个 specialist 以适配后的 teammate
模板与 workmate BASE 模板形式随包发布；一个 328 个文件的 skill 语料库，混合了上游移植 skill、第三方
上游 skill 与本仓库编写的用例；以及一个被采纳的组件 —— 来自
[dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 的 `agent-teams` 插件（MIT），以一等
主代码形式内联并带本地适配。其余部分均在本仓库编写；RTL/EDA 表面不属于本仓库，它已拆分到兄弟子
bundle `@mpd-dsh/silicon`。

> **许可**：SUL-1.0 —— 继承自上游项目的许可（强 copyleft；完整文本见 [LICENSE.md](./LICENSE.md)）；
> 上游版权归 code-yeongyu 与 OmO 贡献者所有。被采纳的 `agent-teams` 组件保留其自身的 MIT 许可
> （声明见 [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)）；该 MIT 授权仅覆盖被采纳组件 —— 本项目自身
> 代码不是 MIT 许可。

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

**RTL/EDA 能力不在本仓库。** `rtl-*` skills、verif 插件、HDL 语言服务器配置、RTL 指南与 Verilog golden
fixtures 均由 silicon 子 bundle 拥有（`@mpd-dsh/silicon`，同级检出 `../my-power-dsh-silicon`，
`gitee.com/nop_chip/my-power-dsh-silicon`）。本仓库只承载 harness/bundle 软件面；仅安装 mpd 时启动
行为不变且不含任何 RTL 内容。

本 bundle 安装后提供 `@mpd-dsh/mpd`：DeepSeek 双轨（官方默认）、MCP 服务器、全部
mpd 插件（含 codegraph 自动初始化）、采纳的 agent-teams（团队工具 + 侧边栏团队页）、`mpd`
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
  工具 + AgentTeams 侧边栏 Tab）：一个正常命名的 `mpd` roster profile
  （`taskPlanning: captain`）把上述专家暴露为队友实例化模板。captain 调用
  `agent_teams_create(profile="mpd")`，在 AgentTeams Tab 中暂存计划，然后由依赖感知调度器执行。
- **Web GUI**（`@mpd-dsh/mpd` client bundle，`packages/mpd-bundle-plugin`）—— 整个
  AgentTeams GUI 就是 **DSH-better-sidebar 的一个 Tab**（`dsh-better-sidebar`，社区侧边栏
  bundle；Tab id `mpd-agent-teams`，order 85）。它列出本对话的进行中与已归档团队（成员与实时活动、
  任务行、依赖图、停止团队控件、暂存计划审批编辑器），在角标上显示本对话的进行中团队数，并在团队出现时
  自动打开一次 —— 插件设置 `autoOpenOnTeamActivity`，默认开启，可在侧边栏设置页关闭。**与原版面板
  视觉一致是硬性要求**：该 Tab 渲染的是被移除浮窗自己的内部结构 —— 带标题、忙碌圆点与收起控件
  （平台自带的 chevron）的 `panelHead`、`teams` 主体、采纳的空态提示与归档标签，全部走采纳的
  CSS-module 类名，因此团队/成员/任务规则读取的 `--dsw-alias-*` 变量与当初在浮窗里完全一致；
  只有窗口管理器部分（拖拽、改宽、浮动外框）被去掉。对话内团队卡片与右上角活动浮窗已**移除**。
  **Workmates** 页面是同一侧边栏的第二个 Tab，由 `ctx.betterSidebar.registerTab` 注册 ——
  列出 `~/.mpd/workmate/` 实例（base、uses、更新时间、note），点开查看 persona/memory/note，
  用由 roster 填充的 base 选择器新建，并可重命名或删除实例（zh/en，带显式的归档/彻底删除确认
  步骤）；数据来自 `GET /plugins/mpd-workmate/{list,roster,get}` 与
  `POST /plugins/mpd-workmate/{init,rename,delete}`。两个页面都**只在侧边栏**存在：没有该侧边栏时各自只输出一条警告
  且不注册任何东西（workmate 的 🤖 浮窗与侧栏脚部按钮也已移除），并且只要有 client 源注册了任一被移除
  的界面，`scripts/build-mpd-client.mjs` 就会让构建失败。bundle patch 带有 `mpd-web-compat` 自引用行
  （`name: '@mpd-dsh/mpd'`），使 client-modules boot graph 包含本 bundle 的 client entry
  —— 没有它任何客户端界面都不会加载。
- **Workmate 库**（`~/.mpd/workmate`）：roster 专家只是 BASE 模板；用 `mpd_workmate_init`
  将其实例化为一个独立命名的持久化、可演化副本。每次工作会话后它会自我总结
  （`mpd_workmate_reflect`）—— 演化自己的 persona + 独立 memory（带大小上限）并保留
  一张简短 note 卡。通过 `mpd_workmate_list` / `mpd_workmate_match` 复用；若没有
  note 匹配得足够好（`matched=false`），应新建一个 workmate 而不是强行弱匹配。
  **重命名**用 `mpd_workmate_rename`（搬移已演化的身份——目录键、元数据、索引键、note
  自引用、先前名称——绝不重新实例化），**删除**用 `mpd_workmate_delete`，默认**先归档**：
  实例移入 `~/.mpd/workmate/.archive/`（从 `list`/`match` 消失，手动 `mv` 搬回即可恢复），
  只有 `purge: true` + `confirm: <name>` 才会真正移除。两种变更在该 workmate **正在被使用**
  （被团队成员或进行中的 spawn 占用）时都会被**拒绝**，并列出阻塞的团队以便处理。名称仅限
  ASCII（`[a-z0-9_-]`），CJK/大写名称会被直接拒绝。在团队里，以 workmate 命名的成员会自动
  获得其 persona/memory 注入（`packages/mpd-agent-teams-plugin` 中打过补丁的
  `memberPersona`）。细节见
  [`packages/mpd-workmate-plugin/README.zh-CN.md`](packages/mpd-workmate-plugin/README.zh-CN.md)。
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
