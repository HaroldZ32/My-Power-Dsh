# mpd-roles-plugin
**中文** | [English](./README.md)

各专家以 **专家名册**（specialist roster）形式存在，而非独立的 presets。每个 role 以其**名称**称呼、以其**职责**说明；另外还带有 persona 文本（`personas/<内部键>.md`）、DeepSeek model chain 以及 read-only discipline。

| role（它做什么） | readonly |
| --- | --- |
| Architect — 架构评审、深度调试、自审 | yes |
| Researcher — 基于证据的代码/开源检索 | yes |
| Planner — 只产出 `.mpd/plans` 计划，绝不实现 | yes |
| Deep Worker — 端到端执行目标并自验 | no |
| Senior Engineer — 主要实现与验证 | no |
| Lead — 编排、委派、整合 | no |
| Explorer — 只读的代码库检索与定位 | yes |
| Reviewer — 正确性/风险发现，不修 | no |
| Plan Reviewer — 计划可执行性与引用核查 | yes |
| Vision Analyst — 图像/截图/PDF 分析 | yes |
| Junior Engineer — 快速、边界清晰的小改动 | no |

## Surface

- `mpdRoles` service（`ctx.get("mpdRoles")`）：`list()` / `get(key)` — 被 `mpd-modelchain-plugin` 消费（chain lookup）。
- `mpd_roles_list` — roster，每个 role 一行：名称、route、做什么。
- `mpd_role_spawn` — one-shot consult：将一个 role 作为 subagent 生成（roster persona + route + 对 read-only roles 的 write-deny toolFilter）。被生成的 subagent **以该 role 的名称为 label**（`Architect`、`Deep Worker`），而不再是 `role-<id>-<random>`。
- `mpd_role_persona` — 为需要将 persona 作为文本使用的 spawn surface 获取 persona 文本（官方 Agent Teams 的 `spawn_teammate` 会把它作为 teammate 的 `prompt`）。

**两个 surface 共用同一套命名（名称统一）。** 名称就是 role 的身份：它既是 team mode 下 agent-teams 为成员取的名称，也是单次 `mpd_role_spawn` 产生的 label。称呼时任意拼写均可：`Architect`、`architect`、`Deep Worker`、`deep-worker`、`deepworker`、`Plan Reviewer`（大小写、空格、连字符、下划线均不敏感）。**任何 surface 都不再展示沿袭自上游的别称** —— role 只用它做什么来描述。

*内部键（永不作为工具输入）：* 稳定内部键 —— `mpd-modelchain-plugin` 与 `personas/<键>.md` 使用的 chain key（`oracle`、`sisyphus-junior` …）、camelCase 写法（`sisyphusJunior`）以及 legacy 的 `mpd-<键>` 形式 —— 在 **service 路径**（`ctx.get("mpdRoles").get(key)`）上仍可解析，因此既有 chain 与内部调用方继续可用；但它们**被工具输入拒绝**：`mpd_role_spawn`、`mpd_role_persona` 与 `mpd_modelchain_resolve` 只接受 NAME 拼写，并以只列名册名称的响亮错误作答 —— 错误中绝不重复被拒绝的键，id 也永远不会被返回、列出或要求。**workmate library 的行为一致**：`mpd_workmate_init` 只匹配功能名（稳定 id 会被拒绝，并给出只列名称的错误），`meta.baseId` 仅作为内部溯源保留，任何工具输出、路由或界面都不会暴露它。

`ctx.get("mpdRoles").get(key)` 仍使用同一套解析 —— 这是**内部**路径。面向工具的路径只接受 NAME 拼写，因此 `mpd_modelchain_resolve`、名册工具与 workmate library（`mpd_workmate_init base=...`）都只按名称称呼 role。

## 由扩展贡献的 role

`mpd-ext` 扩展可以贡献 role。它们**按调用**合并进本名册（`ctx.get("mpdExtensions")`，在工具执行时惰性解析 —— 绝不是 apply 期缓存，因此稍后才 apply、甚至稍后才注册的扩展同样可见），并且与基础 role 拥有完全相同的 surface：

- `mpd_roles_list` 会连同其所属扩展一起列出（`extension: <扩展 id>`）；`mpd_role_spawn` / `mpd_role_persona` 用扩展声明的名称称呼它，任意拼写均可（`Code Reviewer`、`code-reviewer`、`codereviewer`）。
- 扩展声明为 `readonly` 的 role，spawn 时与只读的基础 role 一样带上 write-deny toolFilter。
- `mpdRoles` service 同样提供它们，因此可作为 **workmate BASE 模板**使用（`mpd_workmate_init base="Code Reviewer"`）；当扩展声明了 `provider` + `model` 时，`mpd_modelchain_resolve` 也能解析。
- 其稳定 id 带命名空间（`ext-<扩展 id>-<名称 slug>`），因此永远不会与基础 id 冲突。

拒绝是响亮且隔离的：名称已被基础 role 或另一个扩展占用的 role，会在 `mpd_roles_list` 的 `refused` 列表中报告并记录一次日志 —— 它绝不会拖垮名册或启动。persona 文件不可读的 role 同样被拒绝；被配置禁用的扩展则完全不贡献 role。

**已明确的边界 —— roster 段落只列出 BASE 名册。** 扩展贡献的 role 是按调用（`mpdExtensions`）解析的，而不是在 agent scope 创建时解析，因此它们不会出现在下方的 `mpd:roster` 段落中。它们依然完全可用：可通过 `mpd_role_spawn` 一次性 spawn、可作为 **workmate BASE 模板**，而且知道它的 Lead 仍可用 `spawn_teammate` 并传入 `mpd_role_persona` 的文本把它 stage 为 teammate。

## Team mode

多成员 team work 并非在此构建：**staging** 走 mpd 的 plan 平面（`agent_teams_plan`，由 `mpd-team-core-plugin` 拥有），而成员本身由**官方 Agent Teams 插件**承载（`@deepseek-ai/dsh-experimental-agent-team` + `-tool-agent-team` + `-client-ui-agent-team`，由本 bundle 的 `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` 行挂载）；其 Lead 用 `spawn_teammate` 创建 teammate，用 `team_task_create` 为其开卡。本行贡献该路径的**名册一侧** —— 每一次调用都经由 `mpd-dsh-adapter`：

| 契约 | 本行的实现方式 |
|---|---|
| 名册送达到 Lead | 一个 **AGENT 作用域**的 `mpd:roster` 系统提示段落（顺序 `605`，紧跟 Harness 的 `TEAM_POLICY`（600）之后），只对顶层 `mpd` session 注册 —— 绝不在 host 平面（那会把名册注入本进程服务的每一个 session），也绝不进入 teammate 或其它 preset 的 session |
| teammate 的 persona | 该段落点名 `spawn_teammate` 与 `mpd_role_persona`：Lead 把成员的 persona 文本作为 prompt 传入 |
| 只读 teammate 的纪律 | 一道 TOOL GUARD（见下），经适配器注册 |
| session 启动复杂度闸门 | 一个 `agent/pre-step` 监听器，默认会 **stage** 一个可批准的 plan shell（见下） |

**模型路由只保留在一次性路径上。** `TeamService` 只把 `{prompt, parent}` 转发给 `ctx.subagents.startContinuable`（`docs/plan-0.1.7-adaptation.md` §3），因此 teammate 继承 Lead 的路由，无法为其附加 provider/persona/tool filter。`teamModels.slot*` 路由因此只作用于 `mpd_role_spawn` / `mpd_workmate_spawn`（它们会传入显式的 `agentOptions`）；名册段落如实说明这一点，而不是承诺 Harness 无法兑现的路由。

### 只读 teammate 会被机械地拒绝

那七个名称的拒绝清单在**两条**路径上生效，且共用**同一个**导出常量（`READONLY_DENY`），因此二者永远不会漂移：

- **一次性路径** —— `mpd_role_spawn` 传入 `toolFilter: { deny: READONLY_DENY }`（保持不变）；
- **team 路径** —— 一道 tool guard 经适配器解析**调用方** agent 的团队身份（`dsh.teamMembership(exec.agent)`）：当身份为 `teammate`，且其面向模型的名号经归一化（小写、每段非字母数字 → `-`，可选一个尾部 `-<数字>` 团队唯一后缀）后命中某个**只读**名册成员时，清单中的任何工具名都会被拒绝。拒绝信息会点名该成员与规则，并指向 Lead 或某个 worker 成员。Lead、worker 成员、非团队 agent 以及无法解析的身份一律放行；该 guard 从不抛错、从不改动状态、也从不放宽。

这修掉了已退役、由 profile 携带 `toolDeny` 的实测缺陷：以 "Explorer" 身份 stage 却未带过滤器的 teammate 会保留 `write`/`edit`/`bash`。

**拒绝清单由 Harness 自己在 spawn 之前裁定一次。** 只要其中一个名字未在本 profile 注册，`tools.restrict()` 就会拒绝**整份**清单，因此一个未注册条目（无 `cclsp` 主机上的两个 `mcp__lsp__*` 名称）会让名册与 workmate 库的**每一次**只读 spawn 全部失败 —— 2026-10-10 实测，而正是这扇被砖死的正门把 captain 推向了 Harness 自带的 `subagent` 工具。适配器的 `restrictToolsTolerant` 把**规范**清单应用到调用方自己的 scope 并在同一同步轮次内释放，因此唯一裁定者是 Harness 自己：它报告为未知的名字会被剪除，**只允许一次**重试，第二次失败一律抛出。`READONLY_DENY` 本身未变，两个包的清单保持完全一致（由 `roles.test.ts` 断言），且该清单**绝不**用 `hasTool` 预过滤（AGENTS.md §13）。被剪除的名字会在该行日志中报告一次。

### 委派闸门（官方 spawn 工具不是本 bundle 的委派路径）

`delegation-gate.ts` 经适配器注册**一道** `tools.guard` 回调：对 `subagent`、`subagent_fork`、`workflow` 的调用会被**拒绝**，拒绝文本点名获准路径（`mpd_role_spawn`、`mpd_workmate_match` + `mpd_workmate_spawn`、Agent Teams、`send_message`）。开关是 `mpd.jsonc` 的 `delegation.gate`：

- **deny**（默认）—— captain **与**所有 member session 一律被拒：成员仍能使用的逃生门不构成纪律；
- **captain** —— 只拒本工作区的**顶层** session；
- **allow** —— 完全释放该闸门。

闸门以 §5 的**与 preset 无关**的 session 等级为键，因此在任何挂载本 bundle 的工作区里，无论 profile 给 session 指派了哪个 preset，它都生效。这里**刻意不用**"不在 preset 平面组合该行"的做法：本部署的实时顶层 session 运行的是本 bundle 并不拥有的 preset（`cordis`），所以 guard 才是可移植的拒绝，挂载本 bundle 即是 opt-in。该行的 boot 行会报告 `delegationGate=<mode>`（Harness 没有 `tools.guard` seam 时报告 `delegationGate=absent reason=…`）。

**诚实边界：** 该 guard 在派发时读取**工具调用**，因此名册从不发布的工具天然被覆盖，而未挂载本 bundle 的 profile 上的 session 根本没有闸门；它也拦不住模型去**尝试**别的工具。

`mpd` preset 的 persona 携带一段简短的 STANDING WORKING DISCIPLINE 清单（同一假设重复两次即关闭、用检视工具代替猜测、只想下一步具体操作、一轮内并发发出相互独立的调用、shell 调用是短暂的、以真实输出而非预期校验、YAGNI/PDCA），改编自 `dsh-liangshen`（Apache-2.0）—— 仅取理念，不携带上游任何字节。

### session 启动复杂度闸门（默认机械执行）

在 session 的第一个 pre-step，本行求值冻结谓词

```
trigger = explicit flag OR (matchedSignals >= 1)
```

信号为 **A**（`team:` 前缀或 `!team`；标记会从目标文本中被**消费**）、**B**（≥ 4 个不同的交付动词）、**C**（**一个**信号，由其三路子信号中的 ≥ 2 路触发：≥ 3 条枚举行、≥ 3 个不同动作动词、≥ 3 个动作小句）与 **D**（session 工作区存在**正在进行**的 boulder 工作：`.mpd/boulder.json` 中 `status: "active"` —— 仅有 plan **文件**并不构成信号；2026-10-07 修复，因为旧的文件探测在本工作区的每个 session 都会触发）。每一条通知都携带标记 `[AgentTeams] Session-start team rule`。

触发后**做什么**由 `mpd.jsonc` 的 `team.gate` 按调用决定：`mechanical`（默认）| `advisory` | `off`。

- **mechanical** —— 闸门通过 `agent_teams_plan` 工具 **stage** 一个**可批准的 plan shell**（0 成员、0 任务：第一个 pre-step 时还不存在任何分解），并注入**一条** user 角色通知，点名该调用**返回**的 plan id。此时**没有 spawn 任何东西**：该 plan 在 captain 用 `add_member` / `create_task` 扩展并用 `agent_teams_plan {action:"approve"}` 批准之前一直是**惰性**的，批准才是 spawn 成员、发布任务的时刻。当本 session 已有 staged 的 plan 时，闸门只报告这一事实、不再重复 stage —— 第二次 stage 会归档进行中的 plan。
- **advisory** —— 未挂载 `agent_teams_plan` 工具，或 `team.gate: "advisory"` 时，那**一条**通知声明 `NO team was staged`，并告诉 captain 在工作确实需要时自行 stage。
- **off** —— 监听器直接返回。

显式的 `team:` / `!team` 请求属于信号 **A**，走**同一条**路径：在 `mechanical` 下同样会 stage 该 shell，且标记会从目标文本中被**消费**。它只作用于顶层 `mpd` session（子 session —— subagent、teammate、workflow worker —— 以及其它 preset 的 session 都不会收到），每个 session 只结算一次，且其内部失败不会影响该 step。
