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
- `mpd_role_spawn` — **一次性**单次咨询（one-shot single-call consult）：对一个 role 发起一次有界委派并返回一份报告。被生成的子智能体（roster persona + route + 对 read-only roles 的 write-deny toolFilter）**以该 role 的名称为 label**（`Architect`、`Deep Worker`），而不再是 `role-<id>-<random>`。报告落定后 adapter 会 dispose 该 activation，因此该次咨询**不可复用**：新问题请发起**新的** spawn。（harness 的 catalog 是只追加的，所以已结束的子会话仍可能以 `inactive` 列出；但契约始终是一次性的。）`mpd_workmate_spawn` 使用同样的**一次性** spawn 机制但作用于持久的、可演化的实例 —— 连续性由库中的 persona/memory/note **记录**承载，而不是子会话；团队工作是官方 `spawn_teammate` 路径。
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

**已明确的边界 —— roster 段落只列出 BASE 名册。** 扩展贡献的 role 是按调用（`mpdExtensions`）解析的，而不是在 agent scope 创建时解析，因此它们不会出现在下方的 `mpd:roster` 段落中。它们依然完全可用：可通过 `mpd_role_spawn` 单次咨询（single-call consult）、可作为 **workmate BASE 模板**，而且知道它的 Lead 仍可用 `spawn_teammate` 并传入 `mpd_role_persona` 的文本把它 stage 为 teammate。

## Team mode

多成员 team work 并非在此构建：**staging** 走 mpd 的 plan 平面（`agent_teams_plan`，由 `mpd-team-core-plugin` 拥有），而成员本身由**官方 Agent Teams 插件**承载（`@deepseek-ai/dsh-experimental-agent-team` + `-tool-agent-team` + `-client-ui-agent-team`，由本 bundle 的 `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` 行挂载）；其 Lead 用 `spawn_teammate` 创建 teammate，用 `team_task_create` 为其开卡。本行贡献该路径的**名册一侧** —— 每一次调用都经由 `mpd-dsh-adapter`：

| 契约 | 本行的实现方式 |
|---|---|
| 名册送达到 Lead | 一个 **AGENT 作用域**的 `mpd:roster` 系统提示段落（顺序 `605`，紧跟 Harness 的 `TEAM_POLICY`（600）之后），只对顶层 `mpd` session 注册 —— 绝不在 host 平面（那会把名册注入本进程服务的每一个 session），也绝不进入 teammate 或其它 preset 的 session |
| teammate 的 persona | 该段落点名 `spawn_teammate` 与 `mpd_role_persona`：Lead 把成员的 persona 文本作为 prompt 传入 |
| 只读 teammate 的纪律 | 一道 TOOL GUARD（见下），经适配器注册 |
| session 启动复杂度闸门 | 一个 `agent/pre-step` 监听器：当 `team.gate` 为 `mechanical` 时 **stage** 一个可批准的 plan shell —— 自 2026-10-20 起**重新成为默认**（见下） |

**模型路由跟着 label 走。** `TeamService` 只转发 `{prompt, parent}` 外加 descriptor label（teammate 的 `description`），因此 label 是请求携带的唯一名册身份（`docs/plan-0.1.7-adaptation.md` §3）。只有当 `description` **点名**某个名册成员时，`mpd-roster-provider-plugin` 才会应用该成员的 `teamModels.slot*` 路由；其余 teammate 完全不被路由 —— 请求按原样（by identity）透传，由 staging 它的 session 的 Harness 解析路由生效（顶层 spawn 是队长的路由，team-lead spawn 是 Lead 的路由）。prompt 文本无法改变路由。同一组槽位也作用于 `mpd_role_spawn` / `mpd_workmate_spawn`（它们会传入显式的 `agentOptions`）；名册段落如实说明这一点。路由中的推理强度还会经过适配器的 `withSupportedEffort`（`mpd-dsh-adapter-plugin`）：若槽位的模型**完全没有**推理等级，则不发送任何等级 —— spawn 照常运行，而不是因 provider 无法接受的关键字失败；而声明了推理等级的模型则保留槽位的等级。

### 只读 teammate 会被机械地拒绝

那七个名称的拒绝清单在**两条**路径上生效，且共用**同一个**导出常量（`READONLY_DENY`），因此二者永远不会漂移：

- **单次咨询路径** —— `mpd_role_spawn` 传入 `toolFilter: { deny: READONLY_DENY }`（保持不变）；
- **team 路径** —— 一道 tool guard 经适配器解析**调用方** agent 的团队身份（`dsh.teamMembership(exec.agent)`）：当身份为 `teammate`，且其面向模型的名号经归一化（小写、每段非字母数字 → `-`，可选一个尾部 `-<数字>` 团队唯一后缀）后命中某个**只读**名册成员时，清单中的任何工具名都会被拒绝。拒绝信息会点名该成员与规则，并指向 Lead 或某个 worker 成员。Lead、worker 成员、非团队 agent 以及无法解析的身份一律放行；该 guard 从不抛错、从不改动状态、也从不放宽。

这修掉了已退役、由 profile 携带 `toolDeny` 的实测缺陷：以 "Explorer" 身份 stage 却未带过滤器的 teammate 会保留 `write`/`edit`/`bash`。

**拒绝清单由 Harness 自己在 spawn 之前裁定一次。** 只要其中一个名字未在本 profile 注册，`tools.restrict()` 就会拒绝**整份**清单，因此一个未注册条目（无 `cclsp` 主机上的两个 `mcp__lsp__*` 名称）会让名册与 workmate 库的**每一次**只读 spawn 全部失败 —— 2026-10-10 实测，而正是这扇被砖死的正门把 captain 推向了 Harness 自带的 `subagent` 工具。适配器的 `restrictToolsTolerant` 把**规范**清单应用到调用方自己的 scope 并在同一同步轮次内释放，因此唯一裁定者是 Harness 自己：它报告为未知的名字会被剪除，**只允许一次**重试，第二次失败一律抛出。`READONLY_DENY` 本身未变，两个包的清单保持完全一致（由 `roles.test.ts` 断言），且该清单**绝不**用 `hasTool` 预过滤（AGENTS.md §13）。被剪除的名字会在该行日志中报告一次。

### 委派闸门与侦察 guard（2026-10-20 恢复）

本行在只读 guard 之外安装**两道** `tools.guard` 回调：**captain 侦察 guard**（`mpd` preset 的顶层 session 委派侦察，因此对**源码**路径的 `read`/`grep`/`glob` 会被拒绝，而文档带 —— `.mpd/**`、`docs/**`、`evidence/**`、`agent-references/**` 以及根目录的说明/概览文件 —— 保持可读；开关 `captain.investigation`，默认 `"deny"` | `"allow"`）与**委派闸门**（对 `subagent`、`subagent_fork`、`workflow` 的调用被拒绝，拒绝文本点名 `mpd_role_spawn`、workmate 库、Agent Teams 与 `send_message`，并明确限定：`send_message` 只能继续**已存在的 TEAM 子会话**，绝不用于已结束的咨询（consult 是一次性的）；开关 `delegation.gate`，默认 `"deny"` | `"captain"` | `"allow"`）。

**委派闸门的 preset 豁免只适用于顶层 session。** 别的 preset（包括部署默认的 `cordis`）的**顶层** session 保留自己的 spawn 习惯；而**成员与子 session 不论运行哪个 preset 都继续受门控** —— 它们的委派属于 captain 的路径，子 session 的 preset 不得重新打开官方 spawn 工具。侦察 guard 由 `sessionIsMpdCaptain` 限定（顶层 **且** `mpd` preset），因此对任何 rank 的非 `mpd` session 都不生效。闸门按不依赖 preset 的 `sessionRank` 判定，其 mode 在该范围内决定覆盖面：`deny`（默认）覆盖 `mpd` preset 的顶层 session 以及每个成员/子/无 header 的 session，`captain` 只约束顶层 session，`allow` 则完全放行。

**为什么恢复。** 2026-10-17 的决定把这两者连同 persona 的回归一起撤下（"一个 agent、完整工具包、由 persona 提示词引导"）。实测后果是：captain 自己做完每一次搜索、名册/团队工具基本闲置、上下文被一次次文件读取撑大。2026-10-20 的决定把这个包拆开 —— **长提示词保留，两道决策性 guard 回归** —— 并且 persona 现在把规则写在最前面，所以开局就是委派，而不是先撞一次被拒的 `read`。写入路径**刻意不变**：`write`/`edit`/`bash` 不受门控，验证法的写守卫（`verify.mode`）继续处于撤销状态；验证法要求的是**另一个 agent 记录的裁决**，那是纪律，不是 hook。

诊断依据是 boot 行 —— 恢复的 guard 报 **mode**，撤销的那个报 absent：

```
[mpd-roles] team plane: readOnlyGuard=installed deny=8 \
  captainInvestigation=deny \
  delegationGate=deny \
  verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode) \
  askUserQuestion=installed rosterSection=agent-scoped order=605 sessionGate=mechanical
```

恢复记录在 `.mpd/plans/restore-guard-discipline.md`；断言它的 QA 用例是 `skills/dsh-qa/scripts/delegation-gate.ts`（拒绝表、开关拼写、名册正门）与 `skills/dsh-qa/scripts/captain-scope.ts`（boot 行 token、已发布 apply 站点、persona）。

### session 启动复杂度闸门（自 2026-10-20 起重新默认 MECHANICAL）

在 session 的第一个 pre-step，本行求值冻结谓词

```
trigger = explicit flag OR (matchedSignals >= 1)
```

信号为 **A**（`team:` 前缀或 `!team`；标记会从目标文本中被**消费**）、**B**（不同交付动词 —— 阈值随 sensitivity 行而定）、**C**（**一个**信号，由其三路子信号中的足够多路触发：枚举行、不同动作动词、动作小句）、**D**（session 工作区存在**正在进行**的 boulder 工作：`.mpd/boulder.json` 中 `status: "active"` —— 仅有 plan **文件**并不构成信号；2026-10-07 修复，因为旧的文件探测在本工作区的每个 session 都会触发）、**E**（CJK 规模指令：Han 字符数**且**不同动作动词数；词表已包含中文指令实际使用的交付类动词）与 **F**（**工作区规模**：一次有界根目录 `readdir` 能找到一个项目清单文件、一个项目目录且可见条目 ≥ 8 —— 仅在 `easy` 行求值）。每一条通知都携带标记 `[AgentTeams] Session-start team rule`。

`mpd.jsonc` 的 `team.sensitivity` 选择阈值行（`easy` —— **默认** | `normal` | `strict`）：`normal` 精确复现 2026-10-22 之前的**谓词** —— 同样的数值**以及**同一套 wave 之前的动词词表（本 wave 新增的英文与 CJK 动词在该行不可见）；缺失或未知的取值一律读作 `easy`（闸门不会因配置抛错）：

| sensitivity | B 不同动词 | C 行 / 动词 / 小句 | E Han 字符 / 动词 | F 工作区规模 |
|---|---|---|---|---|
| `easy`（默认） | ≥ 2 | ≥ 2 / ≥ 2 / ≥ 2（2-of-3） | ≥ 24 / ≥ 2 | 开 |
| `normal` | ≥ 4 | ≥ 3 / ≥ 3 / ≥ 3（2-of-3） | ≥ 60 / ≥ 2 | 关 |
| `strict` | ≥ 6 | ≥ 4 / ≥ 4 / ≥ 4（3-of-3） | ≥ 80 / ≥ 3 | 关 |

触发后**做什么**由 `mpd.jsonc` 的 `team.gate` 按调用决定：`mechanical`（**自 2026-10-20 恢复起为默认**）| `advisory` | `off`。

- **mechanical** —— 闸门通过 `agent_teams_plan` 工具 **stage** 一个**可批准的 plan shell**（0 成员、0 任务：第一个 pre-step 时还不存在任何分解），并注入**一条** user 角色通知，点名该调用**返回**的 plan id。此时**没有 spawn 任何东西**：该 plan 在 captain 用 `add_member` / `create_task` 扩展并用 `agent_teams_plan {action:"approve"}` 批准之前一直是**惰性**的，批准才是 spawn 成员、发布任务的时刻。当本 session 已有 staged 的 plan 时，闸门只报告这一事实、不再重复 stage —— 第二次 stage 会归档进行中的 plan。
- **advisory** —— 未挂载 `agent_teams_plan` 工具，或 `team.gate: "advisory"` 时，那**一条**通知声明 `NO team was staged`，并告诉 captain 在工作确实需要时自行 stage。
- **off** —— 监听器直接返回。

显式的 `team:` / `!team` 请求属于信号 **A**，走**同一条**路径：在 `mechanical` 下同样会 stage 该 shell，且标记会从目标文本中被**消费**。它只作用于顶层 `mpd` session（子 session —— subagent、teammate、workflow worker —— 以及其它 preset 的 session 都不会收到），每个 session 只结算一次，且其内部失败不会影响该 step。
