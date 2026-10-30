# mpd-cellwork-plugin
**中文** | [English](./README.md)

`cell-work`（v1）——**由命令触发的"队长只做调度"模式**。除了 `/cellwork` 命令之外，bundle 里没有任何入口
能启动它：没有工具、没有事件手势、没有 preset 开关。cell 一旦运行，队长只负责调度、转达与记录，绝不修改
文件、不执行 shell、不做侦察、也不做验证。

## 命令是唯一入口

- `/cellwork <objective>` 通过 adapter 注册为 `cellwork`（没有别名，没有第二种拼写）。处理函数先写入唯一
  一份 cell 记录——`<workspace>/.mpd/cellwork/cell-<UTC 时刻>/state.json`，phase 为 `requirements`，
  带队长本人的 session id——随后把**恰好一条**激活指令作为发起该命令的 agent 自己的下一条用户消息提交
  （producer tag `mpd-cellwork`）。
- 参数为空或只有空白时返回用法错误，并且**完全不写任何 cell 状态**。
- 同一 workspace 已有活跃 cell 时，第二个 `/cellwork` 会被**拒绝**，拒绝信息点名那个活跃 cell 的 id：
  一次只能有一个 cell，两个 cell 会争抢同一块 team 看板。
- 组合环境没有可用的投递面时不会留下"半启动"状态：刚写入的记录会立即归档
  （`stopReason: "no-live-turn-surface"`），不会因此把队长锁死。

## 只做调度的队长守卫

每个插件只安装**一个** `tools.guard` 谓词，在派发时刻生效，只覆盖活跃 cell 认识的 session。不属于任何 cell
的 session 完全不受影响——这正是模式关闭时零成本的原因。

| 调用者 | 被拒绝的调用 |
|---|---|
| 队长 | 除 `cellwork_*`（但**不含** `cellwork_handoff`）、`agent_teams_*`、`ask_user_question`、`todo_write`、`mpd_memory_*`，以及唯一的验证循环开启器 `mpd_verify_open`（**精确名字**；其余 `mpd_verify_*` 一律仍被拒绝）之外的全部 |
| 验证者 | `write`、`edit`、`mpd_hashline_edit`、`mcp__ast_grep__rewrite`、`mcp__ast_grep__scan`、`mcp__lsp__rename_symbol`、`mcp__lsp__rename_symbol_strict` |
| 处于上下文检查点的成员 | 除 `cellwork_handoff`、`cellwork_context`、`cellwork_status` 之外的全部 |
| 副队长 | **迷你队长**：队长白名单**去掉** `cellwork_start`/`cellwork_stop`，再加上四个子 cell 动词 `cellwork_subteam`、`cellwork_activate`、`cellwork_dispatch`、`cellwork_supervise`；完全没有文件工作工具 |
| 普通成员 | 全部放行：它就是普通工作者 |

每次拒绝都是**一整段教学式说明**：点名被拒的调用、可替代的调用，以及作为出路的 `cellwork_stop`。
`cellwork_stop` 归档 cell，座位随之消失，同一个 session 立刻恢复不受限。

## 磁盘状态

`<workspace>/.mpd/cellwork/<cell-id>/` 下是 `state.json`（记录本体）、`journal.jsonl`（只追加的历史）、
`requirements.md`、`split/<rev>.json`、`contracts/<taskKey>.md` 与 `handoff/<member>-<n>.md`。
根目录每次调用都经 `dsh.workspaceRoot(exec)` 解析——绝不使用 `process.cwd()`，也绝不缓存成常量。写入先落到
同目录下的临时文件再 rename，因此读者要么看到旧记录、要么看到新记录，永远看不到写了一半的文件。

记录是**带版本**的；损坏、无法解析或版本高于本构建的状态一律是**点名绝对路径的拒绝**——绝不静默重置，也绝
不覆盖。停止即归档：目录保留、记录标记 `stopped`，之后再次 `/cellwork` 会得到一个全新的 cell id。

## 本包提供的工具

- `cellwork_status` —— 阶段、目标、队长、requirements/split 修订号、成员及其模式、已注入的检查点数、活跃
  team 的成员/任务计数、调用者自己的座位，以及磁盘路径。
- `cellwork_start` —— 打开**当前活跃 cell** 的 requirements 阶段（仅队长）：校验 cell 与调用者、写入
  `startedAt`、记入 journal。它绝不创建 cell；创建只属于命令。
- `cellwork_stop` —— 归档 cell（不删除）、清除守卫、交还工具。只要还有看板任务处于 `claimed`/`in_progress`
  就**拒绝**，除非 `force:true`；强制停止会被如实记入 journal。

flow 工具：`cellwork_requirements`（规划器的 finalize/update）、`cellwork_recon`（规划器的一次性只读咨询）、
`cellwork_split`（切分器的按度量图）、`cellwork_activate`（队长的物化）。

协议工具：`cellwork_dispatch`（一次仅声明所有者的派发）、`cellwork_supervise`（队长的只读巡检）、
`cellwork_context`（成员自己的占用）、`cellwork_handoff`（检查点交接文档）、`cellwork_subteam`（子队长的子
cell 登记）、`cellwork_send` / `cellwork_inbox`（持久的 cell 邮件）。它们落在本文档所述**同一份记录与同一个
守卫**之上。

## 配置

每个数字都是 `cellwork.<key>` 旋钮。**优先级为项目文件 > 行配置 > 随包发布的默认值**：
`<workspace>/.mpd/mpd.jsonc` 优先于 bundle patch 的 `config:` 块，后者优先于文档默认值。不是有限数字或
超出取值规则的声明会被**替换为默认值**，并在该行的日志里报告
（`<workspace>/.mpd/logs/mpd-cellwork.log`）。

`depthMax` 3 · `checkpointRatio` 0.5 · `windowFraction` 0.25 · `fixedOverheadTokens` 32000 ·
`fixedOverheadByRoute` {} · `toolSchemaChars` 0 · `outputReserveTokens` 8192 ·
`compactionHeadroomTokens` 65536 · `compactionRetries` 3 · `idleBarrierDelayMs` 200 ·
`asciiCharsPerToken` 3 · `cjkCharsPerToken` 1 · `contractGates` [] · `windowOverride` null。

模型自身的上下文**窗口不是旋钮**：切分时从模型目录读取，运行时从观测到的 token 计量读取，并记录来源。
`windowOverride` 只用于让"窗口读不到的 route"被显式认证，并且会记录为 override。

## 流程规则与声明边界

- **B4 中转。** 规划器从不直接面对用户：规划器 → `cellwork_send`/`agent_teams_mail` → 队长 →
  `ask_user_question` → 邮件回传。队长不撰写任何内容，也不替用户作答。
- **B6 实测预算。** 每个声明的输入都做 `stat`，并采样前 16 KiB 估算 CJK 占比；用可配置比率、实测固定开销、
  块/框架开销与输出预留计价。窗口**读取**自 adapter 的模型目录（来源 `catalog`）、或人工 override
  （来源 `override`），否则该任务为 `uncertified`——绝不猜测。仅当估算不超过
  `floor(window * windowFraction)`，且估算 + 模型最大输出 + 压缩预留仍在该窗口内时才接受；超预算任务会
  **带着**字节 → token 的明细被拒绝。
- **B7 仅声明的所有者派发。** 就绪任务**只**配给它声明的所有者；所有者忙或不存在时如实报告、任务保持
  待派发——绝不替换。每个代码任务的验证循环在派发之前打开。
- **激活可续做。** `cellwork_activate` 每创建一个产物就立即检查点——在飞修订号（`activationInFlight`）、已拉起的
  每个成员、已铸出的每个看板 id、已打开的每个循环（`activatedLoops`）——记在 `cell-activation-partial`
  journal 事件下；阶段绝不回退——首次激活仍是 `split`，对已在执行的 cell 做局部重切分则保持 `executing`。
  用**同一个**被接受的修订号重试会从这份记录续做：成员按名字与活跃名册对账
  （重复的 `add_member` 直接复用，绝不致命）、每个切分键复用已记录的看板 id、为**每个**还没有循环的代码任务补开
  验证循环，并且只有在派发成功之后才写入 `activatedRevision`。指定不同修订号、激活已物化修订号、激活过期切分，
  都按既有教学式错误拒绝。续做不是事务：残余窗口是一次看板/验证调用加一次 cell 记录写入，该窗口可能留下的重复
  看板行是可检出但不可删除的（团队平面没有取消动词）。
- **无损的工具结果。** cellwork 的每个工具结果都能通过 harness 的无损 JSON 走查：任务投影绝不带 `undefined`
  自有键（可选的 `owner` 直接省略，绝不写成 `undefined`），结果里也没有非有限数、负零或环。
- **B5 侦察边界。** `cellwork_recon` 用精确的 `Explorer`/`Researcher` 标签与绝对深度上限启动只读子代理，
  因此子代理人格接缝会施加名册的拒权清单。若该接缝不存在，只读仅由**提示词**保证，结果会报告
  `personaInjected:false`。
- **验证循环的生产者。** `mpd_verify_open` 用队长**活着**的 agent 与其本人 session id 调用，并如实记录在循环上；
  cell id 只作为**数据**出现在冻结合约上（`producer: cellwork:<cellId>`），绝不伪造 session。`mpd_verify_open`
  这个**精确名字**是队长白名单上**唯一**的 `mpd_verify_*` 条目：`mpd_verify_seat`、`mpd_verify_evidence`、
  `mpd_verify_record` 与 `mpd_verify_escape` 对队长仍被拒绝，因此队长打开的 `writer:"self"` 循环是惰性的
  （`mpd_verify_seat` 拒绝该循环自己的写作者）。没有活着的调用方 agent 时，`cellwork_activate` 在写入任何内容
  之前就拒绝。
- **一个 override、一个身份。** `windowOverride` 是单值：它认证**任何**目录读不到窗口的 route，并记录为
  `override`。规划任务由**调用者自己的身份**（规划器/切分器）关闭，关闭失败只记入 journal，绝不影响修订。
- **压缩结果必须分类。** 屏障先等该 agent 空闲（`compactionRetries` 次有界重试，间隔 `idleBarrierDelayMs`），
  再带真实的 `AbortController` 信号压缩。写入 journal 的原因取值是 `compacted` | `no-safe-range` | `busy` |
  `aborted` | `failed` | `no-engine` 之一；重试预算用完绝不是一次静默的空操作。
- **邮件与重种边界。** cell 邮件先落盘（持久），唤醒尽力而为。`cellwork_send` 在 cell 树里解析收件人 ——
  成员名、`captain`，或跨 cell 形式 `"<cellId>/<captain|member>"`，其中 `<cellId>` 必须是**本** cell 登记过的
  子 cell 或本 cell 的父 cell（`cell.subcellIds` / `cell.parentCellId`），其它一律以
  `"not in this cell's tree"` 拒绝。一次发送会把该行追加到**目标 cell** 的 `mail.jsonl`——跨 cell 发送时就是
  **收件方 cell** 的文件，该 cell 的 `cellwork_inbox` 从这里读取——而**发送方**的 journal 会以
  `cell:<cellId>` 戳并带 `toCell:<target>` 记录这次发送。跨 cell 的行会镜像 `fromCell`，只做持久投递——跨
  cell 不尝试唤醒——并出现在**那个** cell 的 `cellwork_supervise` 上。Lead 没有 executor handle，成员 → 队长的
  行由队长在 `cellwork_inbox` 读取（并在 `cellwork_supervise` 上呈现）；唤醒从未发出的行保持**未投递**状态，
  同样会在那里呈现（`unreadMail` 加上 `wakeFailures[]` 行，每行 `{id,to,subject,reason}`），而不只是出现在
  待办看板上。压缩屏障无法压缩时，代理会从交接文档重种；原生后端不暴露已落地激活的 dispose，因此旧子代理只
  做尽力中断，新 handle 记录在 cell 上。

**配置优先级（两种语言同述）：** 项目文件（`<workspace>/.mpd/mpd.jsonc` 的 `cellwork.*`）> 行配置
（bundle patch 的 `config:` 块）> 随包发布的文档默认值。

### 子单元渲染为嵌套分组

子单元在共享 DAG 里被画成一个**分组盒子**：盒子的内部就是该子单元自己的图，来自外部的依赖附着到盒子的帧上、
而不是盒内某个任务上，并且嵌套会递归。本包提供的是这张图所依据的**事实**，而不是图本身。
`cellwork_subteam` 把父 cell 的**实时** team id 写到新 cell 的 `CellState.parentTeamId` 上，并把
`subcell-created` 连同它写进 journal，且**不传**任何父级 id：团队平面在批准时从父 team 自己的名册推导这条
链接（`deriveParentTeam`），因为登记子 team 的 session 本身就是它的成员。本波次画盒子的是 TUI；web DAG 的分组帧
是已声明的后续工作（`docs/cellwork.md` 的"声明边界"）。

## 声明边界

- 守卫是**进程级、且只在派发时刻**生效。它看不见意图，无法阻止模型去"尝试"某个名字，也覆盖不到绕过工具
  直接调用 service 的代码行。
- 读不出来的 cell 记录会放行所有调用者：守卫无法执行一个它看不见的模式。此时拒绝会带着记录路径出现在命令
  与 `cellwork_status` 上。
- **取消记在 cell 记录上，而不是团队平面。** 团队平面没有取消动词：被后续切分修订去掉的任务会在 cell 记录里
  标记为 `cancelled`（`state.json: cancelledTasks`，key → 看板 id），它的看板行仍然**可见**。派发之所以跳过
  它，只是因为 cellwork 自己的派发会读取 cell 记录——单看看板仍然能看到这一行。
- 验证者的"盲"始终是**书面约定**，与本仓库其它地方一致：cellwork 接好合约、循环与裁决，但不假装能观测到
  验证者读过什么。
- 1/4 窗口规则是基于实测字节与可配置比率得出的**经认证估算**，不是测量，并且对 CJK 刻意从严。
- 本包的测试不宣称做过真·LLM 端到端运行：它们用一个假 ctx 证明命令面、各模式下守卫的判定、状态存储，以及
  start/status/stop 生命周期。挂载启动证明这一行**能被应用**；真实的 `/cellwork` 派发由 QA 用例证明。

## 测试

`bun test packages/mpd-cellwork-plugin` —— 离线、无 harness、无网络。每条用例都走宿主实际使用的 adapter 入
口（`apply`、捕获到的命令定义、捕获到的工具定义，以及那**唯一一个**守卫谓词），并在全新的临时 workspace
里运行。

本包的接缝规则就是仓库的规则：所有对 harness 的接触都经 `resolveDshAdapter(ctx)`，设计背景见
[插件编写参考](../../agent-references/plugin-authoring.md)。
