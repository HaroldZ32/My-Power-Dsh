# mpd-bundle
**中文** | [English](./README.md)

DSH bundle 聚合包：`cordis.patch.yml` 挂载每一个 mpd-dsh plugin row — MCP servers（ast-grep / git-bash / lsp / codegraph + 远程 context7 / grep.app）、B/C 线 plugins（mpd-config 置顶，使 mpdConfig service 对下方 rows 可见；随后是 mpd-dsh-adapter / mpd-tools / modelchain / roles / ulw / hashline / boulder / comment-checker / codegraph / memory / workmate）、`mpd-web-compat` 自注册行（`name: '@mpd-dsh/mpd'`——承载 bundle web client 的 loader 条目）、mpd-bootstrap provisioning，以及被采纳的 `agent-teams` row（`stateDir: .mpd/team`）。

波形读取行（`mcp-wave-mcp` / `mcp-traceweave`）**未挂载**：它们包装外部 Python MCP server，在 `cordis.patch.yml:92-123` 中连同安装步骤一起保持注释状态，因此没有这些二进制的机器仍能原样启动。

该 bundle 只随附 ONE preset（`mpd`，主工作 agent；assets 位于 `packages/mpd-bootstrap-plugin/presets/mpd`）：它配置 `dsh-agent-instructions`，使用 `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]`，使每个 project session 都尝试读取 AGENT.md，并声明 native tool presentation。各专家以 subagent roster（`mpd-roles-plugin`）形式存在，而非 presets。

## 会话启动团队门（强制）

会话启动时**没有团队** —— 团队不是会话的前提条件（对齐上游：上游 team mode 默认关闭）。被采纳的 agent-teams 插件**机械式强制**的是一道**咨询式复杂度门**（`sessionTeamPolicy` 配置，实现见 `packages/mpd-agent-teams-plugin/lib/session-start.js`），而不是仅靠提示词约束：

- `mode: off`（默认）= 不自动建队、不无条件注入通知；机械门是与 `mode` 解耦的 `autoRoute: true`（默认启用）。
- 在会话第一步的 pre-step 上，门按 `trigger = 显式标记 OR (matchedSignals >= 1)` 判定：显式标记为 `team:` 前缀或 `!team`（标记会被**消费掉**，不会作为目标文本进入模型）；软信号为 (B) 去重命中 ≥4 个交付动词、(C) 编号/动作动词/子句 ≥3、(D) 该工作区存在 `.mpd/plans/*.md`。
- **未命中** → 会话单独运行：没有团队、也没有通知。
- **软信号命中** → 门**不建任何团队**：只注入**恰好一条**咨询通知（标记 `[AgentTeams] Session-start team rule`），点名命中的信号并明确说明**没有团队被 staged**。captain 应在工作确实需要团队时自行调用 `agent_teams_create(approval="required", profile="mpd")` 建队；若工作不需要团队（短小或单线程任务），则继续单独执行，并用一句话说明。已有团队的会话（恢复）则直接沿用原团队。
- **显式 `team:` / `!team`** → 建队路径不变：供应 staged 默认团队 **“MPD Default”**（profile `mpd`，`approval: required` —— 成员此时只是 roster 行，只有用户审阅并在 Web 计划面板批准后才会真正 spawn），并注入「本会话由复杂度门路由」通知。`/agent-teams` 命令同样会建队。
- 适用范围：`presets: [mpd]` 覆盖 mpd preset 会话，以及没有任何 preset 的会话（headless 直跑）；subagent/成员会话（带 `parentSession`）永远不会被自动建队。
- 门落在 **PRE-STEP**，先于 preset 的规模判定纪律生效 —— 规模纪律不再出现「只有团队已存在时才被提到」的顺序缺陷。
- 该策略每个会话只结算一次：会话中途被删除的团队不会被重建，之后 captain 自己新建的团队也不会被覆盖/争抢。
- `mpd` preset 的 persona 带有对应的 SESSION STARTUP RULE，使 captain 无论门是否命中都按正确方式工作。

如需旧行为，可显式选择加入：`mode: auto` 仍会无条件供应默认团队，`mode: instruct` 仍只注入指令通知而不建队 —— 三个取值全部保留。

## 配置平面

该行同时携带对齐上游 `team_mode` 的上限键（全部**缺省安全**，默认落到本地冻结取值）：`maxMembers: 16`（保留本地上限）、`maxParallelMembers: 8`、`maxMessagesPerRun: 10000`、`maxWallClockMinutes: 120`、`maxMemberTurns: 500`、`messagePayloadMaxBytes: 32768`（min 1024）、`recipientUnreadMaxBytes: 262144`（min 1024）、`mailboxPollIntervalMs: 3000`（min 500）、`memberMaxDepth: 1`、`stateDir: .mpd/team`，以及 `enforcement: enforce`（超限发送被挡下；`observe` 仅记录 —— 与上游语义一致）。

## TUI 组合

同一个 patch 也组合 TUI 版本：`mpd-tui` 行挂载
`@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`（该包自身不带 patch，因此这一行是唯一挂载点，任何组合都无法重复该 loader 条目 id）。

预设选择有**两个** id-target，按平面各一，都指向同一个包并把 `config.default` 设为 `mpd`：
- `agent-preset-registry` —— `dsh-web-app` 为 web/base 组合插入的那一行；
- `dsh-tui-agent-preset-registry` —— `dsh-tui` 为自己组合铸造的**带作用域**的行。

第二个并非冗余：`dsh-tui` profile 不组合 `dsh-web-app` 层，所以第一个目标在那里会被跳过（`patch: entry agent-preset-registry not found`），而 TUI 自己的行会保留 `default: standard` —— 可该组合里没有任何东西声明 `standard` 预设（`@deepseek-harness-tui/dsh-tui@0.11.1` 不附带预设行），于是每个新的 TUI 会话都会去要一个并不存在的预设。两个 id 各自只存在于一个组合中，因此另一个 profile 只会记录一条 not-found 警告、什么都不改；id-target 只赋值本文件携带的键并跳过 `id`，所以 TUI 那一行自带的「编译期 DISABLED 表达式」原样保留。Harness 0.1.7-rc.2 移除了本文件过去针对的「预设根」行（`agent-presets` / `dsh-tui-agent-presets`，二者都挂在已删除的 `@deepseek-ai/dsh-agent-presets` 包上）。不携带该行的组合——headless profile，或 `dsh-tui` 平面上另铸了不同名字的注册表行——只会记录 `patch: entry agent-preset-registry not found` 并保留自己的默认值；`mpd` 预设本身由第二个 patch 文件声明（`presets/mpd.patch.yml`，行 `preset-mpd`），任何组合都不需要再单独选择它。
