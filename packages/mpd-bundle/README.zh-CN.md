# mpd-bundle
**中文** | [English](./README.md)

本 bundle 的 host 平面 patch 层是 `cordis.patch.yml`，它位于**仓库根目录**（标准 cordis bundle 布局 —— `package.json` 把它声明为 `dsh.bundle.patch` 数组的第一个条目）。它挂载每一个 mpd-dsh plugin row — MCP servers（ast-grep / git-bash / lsp / codegraph + 远程 context7 / grep.app）、B/C 线 plugins（mpd-config 置顶，使 mpdConfig service 对下方 rows 可见；随后是 mpd-dsh-adapter / mpd-tools / modelchain / roles / ulw / hashline / boulder / comment-checker / codegraph / memory / workmate）、本 bundle **自己**的团队平面（`mpd-team-core` / `mpd-team-watchdog` / `mpd-team-compact`）、`mpd-web-compat` 自注册行（`name: '@mpd-dsh/mpd'`——承载 bundle web client 的 loader 条目）、mpd-bootstrap provisioning，以及**三个**官方 Agent Teams 行（`mpd-agent-team`、`mpd-tool-agent-team`、`mpd-ui-agent-team`，外加工具行指向的 `mpd-roster-provider` 行）。被采纳的 `agent-teams` body 已**消失**：它先被取消挂载，随后由 `de-vendor-and-verify-law` 波次**删除**，
因此本树中已无任何东西加载它。

波形读取行（`mcp-wave-mcp` / `mcp-traceweave`）**未挂载**：它们包装外部 Python MCP server，在 `cordis.patch.yml:92-123` 中连同安装步骤一起保持注释状态，因此没有这些二进制的机器仍能原样启动。

该 bundle 只随附 ONE preset（`mpd`，主工作 agent），声明为 `presets/mpd.patch.yml` 中的 **`preset-mpd` 行** —— `dsh.bundle.patch` 数组的第二个条目：它配置 `dsh-agent-instructions`，使用 `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]`，使每个 project session 都尝试读取 AGENT.md，并声明 native tool presentation。（已退役的 preset **目录**形式 `packages/mpd-bootstrap-plugin/presets/` 不再存在：harness 0.1.7-rc.2 的预设模型是"每个预设一行"，子条目列表内联在该行里。）各专家以 subagent roster（`mpd-roles-plugin`）形式存在，而非 presets。

## 会话启动团队门（绑定，默认开启）

会话启动时**没有团队** —— 团队不是会话的前提条件。冻结谓词在会话第一步的 pre-step 求值，并由 `mpd-roles-plugin` 在官方插件的接缝上承载（**`team.gate` 的默认值是 `mechanical`**：命中时只 stage 一个惰性的可批准 shell，不 spawn 任何成员）：

```
trigger = explicit flag OR (matchedSignals >= 1)
```

- 显式标记（**A**）为 `team:` 前缀或处于词边界的 `!team`；标记会被**消费掉**，绝不会作为目标文本进入模型。
- 软信号按 `team.sensitivity` 选中的阈值行读取（`resolveSensitivity`：缺省或未知值都读作 `easy`，即 2026-10-22 起的默认行），下面就是已发布配置实际使用的 `easy` 行：(**B**) 去重命中 ≥ 2 个交付动词、(**C**) **一个**信号、由其 3 路子信号中的 2 路满足（≥ 2 条枚举行、≥ 2 个不同动作动词、≥ 2 个动作子句）、(**D**) 该会话工作区存在**正在进行**的 boulder 工作（`.mpd/boulder.json` 中 `status: "active"`；仅有 plan **文件**并不构成信号 —— 旧的“文件探测”在本工作区的每个会话都会触发）、(**E**) ≥ 24 个汉字**且** ≥ 2 个不同动作动词、(**F**) 工作区规模 —— 对根目录做**一次**有界列举，同时具备至少一个项目 manifest、至少一个惯用项目目录且可见条目 ≥ 8（`readWorkspaceScale`；点开头文件一律不计）。F 只在 `easy` 行求值；`normal`（`B`=4、C 的每路子信号阈值均为 3 且需 2-of-3、`E`=60、`F` 关闭）逐字复现 2026-10-22 之前的五信号谓词，`strict`（`B`=6、C 的每路阈值均为 4 且需 3-of-3、`E`=80、`F` 关闭）进一步收紧 —— 三行都在 `SENSITIVITY_THRESHOLDS` 里。
- **未命中** → 会话单独运行：没有团队、也没有通知。

`team.gate`（`mpd.jsonc`）决定一次触发**做什么**，由 `resolveGateMode` 按调用解析：`mechanical`（**2026-10-20 恢复后的默认值** —— 键缺省以及**每一个未知值**，包括 `"bogus"` / `0` / 一个对象和 legacy 的 `true`，都读作 `mechanical`，因此拼写错误绝不会悄悄关掉这条规则）| `advisory` | `off`（只有 `"off"` 与 `false` 会关闭）。

- **mechanical** → 门通过本 bundle **自己**的 `agent_teams_plan` 工具 **stage** 一个**可批准的 plan shell** —— 0 成员、0 任务、`approval: required` —— 并注入**恰好一条**携带标记 `[AgentTeams] Session-start team rule` 的通知，点名该调用**返回**的 plan id。此时**没有 spawn 任何东西**：该 shell 在 captain 用 `add_member` / `create_task` 扩展（每个成员的 prompt 取自 `mpd_role_persona`）并用 `agent_teams_plan {action:"approve"}` 批准之前一直是**惰性**的 —— 批准才是落地团队记录、并通过本 bundle 的 **native 执行器**唤醒成员的时刻。若该会话已有 staged 的 plan，门只报告这一事实、不再重复 stage（第二次 stage 会归档进行中的 plan）。
- **advisory** —— 未挂载 `agent_teams_plan` 时实际也走这条路 —— 那**一条**通知声明 `NO team was staged`，由 captain 在工作确实需要时自行组队。
- **off** → 监听器直接返回。

显式的 `team:` / `!team` 请求属于信号 **A**，走**同一条**路径（在 `mechanical` 下同样会 stage 该 shell）。门只作用于顶层 `mpd` session —— 带 `parentSession` 的 subagent/成员会话永远不适用，其它 preset 的会话亦然 —— 每个会话只结算一次，且其内部失败不会影响该 step。`mpd` preset 的 persona 带有对应的会话启动约定（冻结的通知标记、`team.gate` 旋钮及其 `mechanical` 缺省），使 captain 无论门是否命中都按正确方式工作。

**已退役 —— 作为历史保留，不再是配置。** 本节过去记录的是内置 `agent-teams` 插件的 `sessionTeamPolicy` / `autoRoute` 旋钮、它供应的 **“MPD Default”** 默认团队（由 `agent_teams_create(approval="required", profile="mpd")` staged），以及 `mode: auto | instruct` 选择加入项。已无任何 loader 行挂载该插件，以上键、工具与该 staged-team 流程在已发布的会话里都不存在。

## 配置平面

团队平面自身的配置就是门的那个键，加上各行自己的配置：

- `team.gate` —— `mechanical`（**2026-10-20 恢复后的默认值**）| `advisory` | `off`（只有 `"off"` 与 `false`），由 `mpd-roles-plugin` 的 `resolveGateMode` **按调用**读取。队长的三道机械守卫中只有**写入**守卫被撤销 —— 该行的启动行报告 `verifyGate=absent reason=…` —— 而 `installCaptainInvestigationGuard`（`captain.investigation`，`"deny"` 为默认 | `"allow"`）与 `installDelegationGate`（`delegation.gate`，`"deny"` 为默认 | `"captain"` | `"allow"`）**已由同一行安装**，启动行报告 `captainInvestigation=<mode>` / `delegationGate=<mode>` —— 只有接缝本身缺失时才报告 `absent reason=…`。
- 官方 `mpd-agent-team` 行携带 patch 中的上限：`maxMembers: 16`、`maxTasks: 256`、`maxMessageBytes: 32768`、`disposalTimeoutMs: 5000`。`maxPendingMessagesPerMember` 已**移除**：harness 0.2.1-rc.2 的 schema 不再声明它，因此该行不再设置。
- `mpd-team-core` 拥有 `<workspace>/.mpd/team/` 下的团队记录：`teams/<id>.json`、staged plan 所在的 `staging/<sessionId>.json` 槽位，以及已归档的计划。

已退役内置行那套对齐上游的上限（`maxParallelMembers`、`maxMessagesPerRun`、`maxWallClockMinutes`、`maxMemberTurns`、`messagePayloadMaxBytes`、`recipientUnreadMaxBytes`、`mailboxPollIntervalMs`、`memberMaxDepth`、`stateDir`、`enforcement`）属于**历史**：它们只存在于采纳主体的 `lib/index.ts` 中，而没有任何行挂载它，且该主体已被 de-vendor
波次**删除**。它们不是任何在用行会读取的旋钮。

## TUI 组合

同一个 patch 也组合 TUI 版本：`mpd-tui` 行挂载
`@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`（该包自身不带 patch，因此这一行是唯一挂载点，任何组合都无法重复该 loader 条目 id）。

### 预设选择 —— 默认由用户自己设定

本 bundle **不再有任何 preset id-target**（严格零覆盖，用户 2026-10-02 决定）。预设可能经由的两个注册表行 —— `dsh-web-app` 为 web/base 组合插入的 `agent-preset-registry`，以及 `dsh-tui` 为自己组合铸造的**带作用域**的 `dsh-tui-agent-preset-registry` —— 都是 **HOST 拥有**的，而 id-target 会**替换** HOST 层的决定：这正是策略禁止的事，且 `node scripts/verify-no-host-override.ts` 会让未来任何一处 id-target 直接失败。再加一个注册表行也不是替代方案：两行都挂载 `@deepseek-ai/dsh-agent-preset-registry`、各自 `provide` 同一个 `agentPresets` service，而重复 `provide` 是硬性 cordis 启动错误。

**因此部署默认值由用户自己设定**，通道就是 `docs/preset-default.md` 记录的那几条（其中 dsh-tui 那条由 `scripts/set-default-preset.ts` 自动化）：

- **web / headless** → `agent-preset-registry` 条目的 `selectedDefault` 易失字段，从 Settings UI 设定（注册表为新会话读取它，并优先于部署 `default`）。本 bundle 自己什么都不写。
- **dsh-tui** → `/preset mpd`，把 `{ "preset": "mpd" }` 持久化到 `~/.dsh-tui/agent-preset.json`；或在用户**自己**的 profile patch 里设 `DSH_TUI_PRESET=mpd`（它**优先于**已持久化的偏好）；或一条命令 `node scripts/set-default-preset.ts --yes`（默认 dry-run），按 dsh-tui 自己的字节形状写同一个文件。

没有这个用户动作，profile 就保持 HOST 默认的 `standard`，所以这里 `mpd` 是 **OPT-IN** 的；在 `cordis.patch.yml` 记录的 dsh-tui 平面（0.12.0；其 row id / `default: standard` 配置 / `presets/liangshen/` 已对照 0.13.0 复核）上，该版本根本没有声明 `standard` preset 行，因此要解析它的会话会带着已记录的 `agent-preset/not-found` 警告组合 —— 这正是 `docs/preset-default.md` 要填上的缺口。`mpd` preset 本身由第二个 patch 文件声明（`presets/mpd.patch.yml`，行 `preset-mpd`），任何组合都不需要再单独选择它。
