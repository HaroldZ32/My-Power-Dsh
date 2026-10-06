# mpd-bundle
**中文** | [English](./README.md)

本 bundle 的 host 平面 patch 层是 `cordis.patch.yml`，它位于**仓库根目录**（标准 cordis bundle 布局 —— `package.json` 把它声明为 `dsh.bundle.patch` 数组的第一个条目）。它挂载每一个 mpd-dsh plugin row — MCP servers（ast-grep / git-bash / lsp / codegraph + 远程 context7 / grep.app）、B/C 线 plugins（mpd-config 置顶，使 mpdConfig service 对下方 rows 可见；随后是 mpd-dsh-adapter / mpd-tools / modelchain / roles / ulw / hashline / boulder / comment-checker / codegraph / memory / workmate）、本 bundle **自己**的团队平面（`mpd-team-core` / `mpd-team-watchdog` / `mpd-team-compact`）、`mpd-web-compat` 自注册行（`name: '@mpd-dsh/mpd'`——承载 bundle web client 的 loader 条目）、mpd-bootstrap provisioning，以及**三个**官方 Agent Teams 行（`mpd-agent-team`、`mpd-tool-agent-team`、`mpd-ui-agent-team`，外加工具行指向的 `mpd-roster-provider` 行）。被采纳的 `agent-teams` body **不再被任何行挂载** —— 已无任何 loader 行指向 `packages/mpd-agent-teams-plugin`。

波形读取行（`mcp-wave-mcp` / `mcp-traceweave`）**未挂载**：它们包装外部 Python MCP server，在 `cordis.patch.yml:92-123` 中连同安装步骤一起保持注释状态，因此没有这些二进制的机器仍能原样启动。

该 bundle 只随附 ONE preset（`mpd`，主工作 agent），声明为 `presets/mpd.patch.yml` 中的 **`preset-mpd` 行** —— `dsh.bundle.patch` 数组的第二个条目：它配置 `dsh-agent-instructions`，使用 `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]`，使每个 project session 都尝试读取 AGENT.md，并声明 native tool presentation。（已退役的 preset **目录**形式 `packages/mpd-bootstrap-plugin/presets/` 不再存在：harness 0.1.7-rc.2 的预设模型是"每个预设一行"，子条目列表内联在该行里。）各专家以 subagent roster（`mpd-roles-plugin`）形式存在，而非 presets。

## 会话启动团队门（强制）

会话启动时**没有团队** —— 团队不是会话的前提条件。冻结谓词在会话第一步的 pre-step 求值，并由 `mpd-roles-plugin` 在官方插件的接缝上**机械执行**：

```
trigger = explicit flag OR (matchedSignals >= 1)
```

- 显式标记（**A**）为 `team:` 前缀或处于词边界的 `!team`；标记会被**消费掉**，绝不会作为目标文本进入模型。
- 软信号为 (**B**) 去重命中 ≥ 4 个交付动词、(**C**) **一个**信号、由其 3 路子信号中的 2 路满足（≥ 3 条枚举行、≥ 3 个不同动作动词、≥ 3 个动作子句），以及 (**D**) 该会话工作区存在**正在进行**的 boulder 工作（`.mpd/boulder.json` 中 `status: "active"`）—— 仅有 plan **文件**并不构成信号（旧的"文件探测"在本工作区的每个会话都会触发）。
- **未命中** → 会话单独运行：没有团队、也没有通知。

`team.gate`（`mpd.jsonc`）决定一次触发**做什么**，按调用解析：`mechanical`（默认）| `advisory` | `off`。

- **mechanical** → 门通过本 bundle **自己**的 `agent_teams_plan` 工具 **stage** 一个**可批准的 plan shell** —— 0 成员、0 任务、`approval: required` —— 并注入**恰好一条**携带标记 `[AgentTeams] Session-start team rule` 的通知，点名该调用**返回**的 plan id。此时**没有 spawn 任何东西**：该 shell 在 captain 用 `add_member` / `create_task` 扩展（每个成员的 prompt 取自 `mpd_role_persona`）并用 `agent_teams_plan {action:"approve"}` 批准之前一直是**惰性**的 —— 批准才是落地团队记录、并通过本 bundle 的 **native 执行器**唤醒成员的时刻。若该会话已有 staged 的 plan，门只报告这一事实、不再重复 stage（第二次 stage 会归档进行中的 plan）。
- **advisory** —— 未挂载 `agent_teams_plan` 时实际也走这条路 —— 那**一条**通知声明 `NO team was staged`，由 captain 在工作确实需要时自行组队。
- **off** → 监听器直接返回。

显式的 `team:` / `!team` 请求属于信号 **A**，走**同一条**路径（在 `mechanical` 下同样会 stage 该 shell）。门只作用于顶层 `mpd` session —— 带 `parentSession` 的 subagent/成员会话永远不适用，其它 preset 的会话亦然 —— 每个会话只结算一次，且其内部失败不会影响该 step。`mpd` preset 的 persona 带有对应的 SESSION STARTUP RULE，使 captain 无论门是否命中都按正确方式工作。

**已退役 —— 作为历史保留，不再是配置。** 本节过去记录的是内置 `agent-teams` 插件的 `sessionTeamPolicy` / `autoRoute` 旋钮、它供应的 **“MPD Default”** 默认团队（由 `agent_teams_create(approval="required", profile="mpd")` staged），以及 `mode: auto | instruct` 选择加入项。已无任何 loader 行挂载该插件，以上键、工具与该 staged-team 流程在已发布的会话里都不存在。

## 配置平面

团队平面自身的配置就是门的那个键，加上各行自己的配置：

- `team.gate` —— `mechanical`（默认）| `advisory` | `off`，由 `mpd-roles-plugin` **按调用**读取。
- 官方 `mpd-agent-team` 行携带 patch 中的上限：`maxMembers: 16`、`maxTasks: 256`、`maxPendingMessagesPerMember: 64`、`maxMessageBytes: 32768`、`disposalTimeoutMs: 5000`。
- `mpd-team-core` 拥有 `<workspace>/.mpd/team/` 下的团队记录：`teams/<id>.json`、staged plan 所在的 `staging/<sessionId>.json` 槽位，以及已归档的计划。

已退役内置行那套对齐上游的上限（`maxParallelMembers`、`maxMessagesPerRun`、`maxWallClockMinutes`、`maxMemberTurns`、`messagePayloadMaxBytes`、`recipientUnreadMaxBytes`、`mailboxPollIntervalMs`、`memberMaxDepth`、`stateDir`、`enforcement`）属于**历史**：它们只存在于 `packages/mpd-agent-teams-plugin/lib/index.ts`，而没有任何行挂载它。

## TUI 组合

同一个 patch 也组合 TUI 版本：`mpd-tui` 行挂载
`@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`（该包自身不带 patch，因此这一行是唯一挂载点，任何组合都无法重复该 loader 条目 id）。

预设选择有**两个** id-target，按平面各一，都指向同一个包并把 `config.default` 设为 `mpd`：
- `agent-preset-registry` —— `dsh-web-app` 为 web/base 组合插入的那一行；
- `dsh-tui-agent-preset-registry` —— `dsh-tui` 为自己组合铸造的**带作用域**的行。

第二个并非冗余：`dsh-tui` profile 不组合 `dsh-web-app` 层，所以第一个目标在那里会被跳过（`patch: entry agent-preset-registry not found`），而 TUI 自己的行会保留 `default: standard` —— 可该组合里没有任何东西声明 `standard` 预设（`@deepseek-harness-tui/dsh-tui@0.12.0` 完全没有声明任何 `@deepseek-ai/dsh-agent-preset` 行 —— 2026-10-02 实测：它自带的作用域注册表行仍保留 `default: standard`，而该版本附带的唯一预设目录是 `presets/liangshen/`），于是每个新的 TUI 会话都会去要一个并不存在的预设。两个 id 各自只存在于一个组合中，因此另一个 profile 只会记录一条 not-found 警告、什么都不改；id-target 只赋值本文件携带的键并跳过 `id`，所以 TUI 那一行自带的「编译期 DISABLED 表达式」原样保留。Harness 0.1.7-rc.2 移除了本文件过去针对的「预设根」行（`agent-presets` / `dsh-tui-agent-presets`，二者都挂在已删除的 `@deepseek-ai/dsh-agent-presets` 包上）。不携带该行的组合——headless profile，或 `dsh-tui` 平面上另铸了不同名字的注册表行——只会记录 `patch: entry agent-preset-registry not found` 并保留自己的默认值；`mpd` 预设本身由第二个 patch 文件声明（`presets/mpd.patch.yml`，行 `preset-mpd`），任何组合都不需要再单独选择它。
