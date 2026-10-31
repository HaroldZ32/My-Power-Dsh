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
| 验证者 | `write`、`edit`、`mpd_hashline_edit`、`mcp__ast_grep__rewrite`、`mcp__ast_grep__scan`、`mcp__lsp__rename_symbol`、`mcp__lsp__rename_symbol_strict`，以及两个 bundle spawn 工具 `mpd_role_spawn` / `mpd_workmate_spawn`——验证者**绝不委派**：裁决是它自己的活，FAIL 才是把工作退回写作者的通道 |
| 处于上下文检查点的成员 | 除 `cellwork_handoff`、`cellwork_context`、`cellwork_status` 之外的全部 |
| 副队长 | **迷你队长**：队长白名单**去掉** `cellwork_start`/`cellwork_stop`，再加上四个子 cell 动词 `cellwork_subteam`、`cellwork_activate`、`cellwork_dispatch`、`cellwork_supervise`；完全没有文件工作工具 |
| 规划器（`cell-planner`） | 文档带内的 `read`/`grep`/`glob`——`.mpd/**`、`docs/**`、`evidence/**`、`agent-references/**`；任意深度、workspace 根内外、**按 basename** 命中的 `AGENT.md`/`AGENTS.md`/`CLAUDE.md`；根上仅 `README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`LICENSE*.md`——以及它制定计划所需的其它一切工具 |
| 普通成员 | 全部放行：它就是普通工作者 |

每次拒绝都是**一整段教学式说明**：点名被拒的调用、可替代的调用，以及作为出路的 `cellwork_stop`。
`cellwork_stop` 归档 cell，座位随之消失，同一个 session 立刻恢复不受限。

规划器那一行属于本仓库自己的侦察规则，而不是 cellwork 的发明：它的可读带**就是**顶层 `mpd` 队长保留的那条带
（一条 parity 测试同时导入两份清单，因此不可能漂移），路径按**拼写**判定、绝不解析符号链接，并且 `..` 段
**只**在 basename 是三个指令文件之一时放行——读兄弟项目的 `AGENT.md` 正是它存在的理由。在 cell 之内，规划器
从不自己做侦察，而且一次咨询就是**叶子**：`mpd_role_spawn` 传调用者记录的深度 + 1，**并且**在子会话自己的
工具作用域里拒绝两个 spawn 工具，因此子会话绝不可能再次委派；已经处于深度 2 或更深的调用者会被直接拒绝。
cell 规划器位于深度 1、保留自己的路线，它发起的咨询落在深度 2、本身就是一个叶子；`cellwork_recon` 不受这条
深度下限约束，因为它自己的深度由 `cellwork.depthMax` 封顶。

## 磁盘状态

`<workspace>/.mpd/cellwork/<cell-id>/` 下是 `state.json`（记录本体）、`journal.jsonl`（只追加的历史）、
`requirements.md`、`split/<rev>.json` 与 `split/<rev>.refused.json`、`contracts/<taskKey>.md` 与
`handoff/<member>-<n>.md`。
根目录每次调用都经 `dsh.workspaceRoot(exec)` 解析——绝不使用 `process.cwd()`，也绝不缓存成常量。写入先落到
同目录下的临时文件再 rename，因此读者要么看到旧记录、要么看到新记录，永远看不到写了一半的文件。

记录是**带版本**的；损坏、无法解析或版本高于本构建的状态一律是**点名绝对路径的拒绝**——绝不静默重置，也绝
不覆盖。停止即归档：目录保留、记录标记 `stopped`，之后再次 `/cellwork` 会得到一个全新的 cell id。

## 本包提供的工具

- `cellwork_status` —— 阶段、目标、队长、requirements/split 修订号、成员及其模式、已注入的检查点数、活跃
  team 的成员/任务计数、已记录的切分票看板 id（`splitTaskId`）、cell 记录与活跃名册的成员差异
  （`missingFromCell` / `missingFromTeam` / `inSync`，只报告不修改）、调用者自己的座位，以及磁盘路径。
- `cellwork_start` —— 打开**当前活跃 cell** 的 requirements 阶段（仅队长）：校验 cell 与调用者、写入
  `startedAt`、记入 journal。它绝不创建 cell；创建只属于命令。
- `cellwork_stop` —— 归档 cell（不删除）、清除守卫、交还工具。只要还有看板任务处于 `claimed`/`in_progress`
  就**拒绝**，除非 `force:true`；强制停止会被如实记入 journal。

flow 工具：`cellwork_requirements`（规划器的 finalize/update；章节正文延伸到同级或更高级的下一个标题，因此
`###` 留在父章节内）、`cellwork_recon`（规划器的一次性只读咨询）、`cellwork_split`（切分器的按度量图——每个
任务可声明自己的看板 `member`，拒绝会把 findings 持久化到 `split/<rev>.refused.json`）、
`cellwork_activate`（队长的物化；对每个不同的 `member` 只拉起一个成员，每份合约同时点名 owner role 与成员，
其返回的 `reused` 列出从 cell 记录或活跃名册解析、而不是新拉起的成员名）。

协议工具：`cellwork_dispatch`（一次仅声明所有者的派发，外加 `reassign` 改派）、`cellwork_supervise`（队长的
只读巡检，含每个被围栏成员与其仍拥有的未关闭行）、`cellwork_context`（成员自己的占用）、`cellwork_handoff`
（检查点交接文档；第一份仍在等待屏障时**第二份**被拒绝）、`cellwork_subteam`（子队长的子 cell 登记）、
`cellwork_send` / `cellwork_inbox`（持久的 cell 邮件——`send` 行先落盘，唤醒尝试是单独的 `wake` 记录）。它们
落在本文档所述**同一份记录与同一个守卫**之上。

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
- **B7 仅声明的所有者派发。** 就绪任务**只**配给它声明的所有者；所有者忙、缺席或**被围栏**时如实报告、
  任务保持待派发——绝不替换。成员在以下任一情况下**被围栏**：记录的 `mode` 是 `checkpoint`、它写下的交接
  仍在等待压缩屏障、或屏障放弃并记录了 `fenced: true` + `fencedReason`；被围栏的成员绝不被发消息。
  `cellwork_dispatch {reassign:[{task_id, owner}]}` 就是修复：对每一对，在派发**之前**先把该行在看板上
  claim 给那个成员、记 `task-reassigned`（from → to），然后投递——失败会报告在
  `reassigned`/`reassignInvalid` 里、绝不抛错；终态行、未知成员或被围栏的**目标**一律拒绝；**启动失败**
  （FAILED）或仍在**启动中**（PROVISIONING）的目标同样拒绝（为它 claim 的行永远不会被接手），投递 handle
  取最新的**非空**值——cell 记录的 `executorRef` 为空时回退到活跃名册的 handle。改派之后目标
  拥有一个在飞任务，因此同一趟会把它的**其它**就绪行报告为 BUSY（每个成员每趟一个任务）：这是已写明的
  规则，不是回归。每个代码任务的验证循环在派发之前打开。
- **C1 —— `member` 就是座位。** 切分任务可以声明 `member`；省略时成员名**就是** owner role。多个任务可以
  共用一个成员，多个成员也可以共用一个 owner role（这才是同一个 role 的真正并行）。座位的**身份**是激活、
  切分校验与派发共用的同一套归一化：**任何文字**的字母与数字保留、大小写折叠、其它字符的连续段折叠成一个
  `-`——因此 `"Seat A"`/`"seat-a"` 是**一个**座位，`"工程师 A"`/`"工程师-a"` 是**一个**座位，
  `"工程师甲"`/`"工程师乙"` 是**两个**。身份为空的名称（纯标点 `---` 或空串）、超过 64 字符、或含控制
  字符/路径分隔符的名称按 `member-invalid` 拒绝；两个任务解析到**同一个**座位却声明**不同** owner role 按
  `member-role-conflict` 拒绝；`self-review` 在双方都声明成员时比较的就是这同一个身份。激活对每个不同的
  `member` 只拉起一个成员，合约同时点名 owner role 与成员（`Owner: **<role>** (member `<name>`)`）。
- **C11 —— 切分票按 id 查找，丢失的 owner 会被修复。** staging 把被 stage 的切分票的**看板 id** 记为
  `splitTaskId`；每次查找先试这个 id、再退回按 owner 匹配，因此需求变更既能标记切分过期、又能重新派发
  **同一行**。切分票缺失/无 owner 是点名修复方式的硬错误，而 staging 自己会通过把该行 claim 给
  `cell-splitter`（`agent_teams_task {action:"claim", claimant:"cell-splitter"}`）来修复丢失的 owner，而
  不是铸出重复票。**即使修复被拒绝，id 依旧会被记录**（journal 在旁边带 `ownerRepairError`），因此 id 优先
  的查找继续有效；成功的修复记为 `splitTicketOwnerRepaired`。重切分路径只复用**一行**：需求更新优先选
  **活跃的**切分器行（先按记录的 id，再按 `cell-splitter` 拥有的任意活行），把它用到的 id 写回 cell 记录
  （字段 `splitTaskId`，答复里报告为 `recordedSplitTaskId`），只有当记录的行已终态且没有活行时才追加替代行（同样的 cell role、subject 带新
  修订号）。
- **邮件日志格式变了，且单向兼容。** `send` 行如今总是带 `wakeSent: false`，唤醒结果作为**单独的** `wake`
  记录（`t:"wake"`、`sent`、`reason?`、`at`）追加在其后。本构建能正确折叠更旧的日志（`wake` 之前的行保留
  自己的 `wakeSent`）；来自**旧构建**的读者会把新行读成"未唤醒"——一条「一个 bundle 一个 workspace」的
  边界，如实写明而非隐藏。
- **激活可续做，并附带写明的崩溃边界。** 一趟激活运行期间，每个产物只往 journal 加**一条**紧凑的
  `cell-activation-progress` 行（stage、key、ordinal、total），仅此而已。累积的 id——在飞修订号
  （`activationInFlight`）、已拉起的成员、已铸出的看板 id（`activatedTasks`）与已打开的循环
  （`activatedLoops`）——只在**这一趟失败**时**一次性**写进 cell 记录，即 `cell-activation-partial` 行；
  同一趟的每一行共用同一个不递减的趟时刻，因此 journal 是单调的（D7：119 份完整快照约占 490 KB journal 的
  40%，且最后一行的戳比它上面的行还早）。阶段绝不回退——首次激活仍是 `split`，对已在执行的 cell 做局部
  重切分则保持 `executing`。
  一次**返回的失败**之后重试，会从这份记录续做：成员按名字与活跃名册对账
  （重复的 `add_member` 直接复用，绝不致命）、每个切分键复用已记录的看板 id、为**每个**还没有循环的代码任务补开
  验证循环——**例外**是升级前的 cell 里保留下来的任务：它的 `activatedLoops` 没有条目，但冻结合约上已经写明循环
  id，因此合约**不会**被重写，也不会再开第二条循环。只有在派发成功之后才写入 `activatedRevision`。**更新的**被
  接受修订号会**取代**更旧的在飞部分激活——记入 journal（`activation-in-flight-superseded`），更旧的部分产物被
  放弃，其已记录的行被核对（保留的 id 复用、被去掉的工作标记 `cancelled`）——而**更低**的修订号、激活已物化的
  修订号与激活过期切分，仍按既有教学式错误拒绝。返回的 `reused` 列出从 cell 记录或活跃名册解析、而不是新拉起的
  成员名。
  **崩溃边界：** 进程在激活中途**死亡**时完全没有部分状态。成员仍按名字与活跃名册对账，但看板任务与验证循环
  只通过已记录的表获知，因此死亡那一趟创建的任务或循环会在重试时**再创建一次**——可检出、不可删除（团队平面
  没有取消动词）。一次返回失败的残余窗口是一次看板/验证调用加一次 cell 记录写入；一次崩溃的窗口则是整趟激活。
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
  之前就拒绝。循环还**点名自己的写作者**：激活把拥有该任务的成员的 session id 作为 `writer_id`（trim 后
  1..200 字符）、把人类可读名字作为 `writer_reason: "member: <name>"`（同样 1..200）传进去，于是记录的
  same-agent 拒绝比较的是真实的 agent 身份键而不是 `delegate:pending` 占位符；两个参数在 `writer:"self"` 下
  用同一句话拒绝。这个比较是**字符串**比较：让规则有意义，但从不保证不可伪造。
- **一个 override、一个身份。** `windowOverride` 是单值：它认证**任何**目录读不到窗口的 route，并记录为
  `override`。规划任务由**调用者自己的身份**（规划器/切分器）关闭，关闭失败只记入 journal，绝不影响修订。
- **压缩结果必须分类。** 屏障先等该 agent 空闲（`compactionRetries` 次有界重试，间隔 `idleBarrierDelayMs`），
  再带真实的 `AbortController` 信号压缩。写入 journal 的原因取值是 `compacted` | `no-safe-range` | `busy` |
  `aborted` | `failed` | `no-engine` 之一；重试预算用完绝不是一次静默的空操作。
- **邮件与重种边界。** cell 邮件先落盘（持久），唤醒尽力而为。`cellwork_send` 在 cell 树里解析收件人 ——
  成员名、`captain`，或跨 cell 形式 `"<cellId>/<captain|member>"`，其中 `<cellId>` 必须是**本** cell 登记过的
  子 cell 或本 cell 的父 cell（`cell.subcellIds` / `cell.parentCellId`），其它一律以
  `"not in this cell's tree"` 拒绝。显式给出的名字既不是 `captain`、也不是**目标 cell** 的成员时会被
  **拒绝**——答复列出该 cell 的成员——绝不悄悄投进调用者自己的收件箱。一次发送会把该行追加到**目标 cell** 的
  `mail.jsonl`——跨 cell 发送时就是
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
- **通用 team 动词就是 cell 模式消除的危险。** `agent_teams_dispatch` 会把就绪任务配给声明的 owner，但当
  owner 忙时会**退回按名册顺序**配对；本波次中它把一条 REVIEW 任务交给了写过被审泳道的成员。队长立即释放
  配对、把该行恢复给独立评审者，而写作者披露它只跑了 `git diff --stat`、一次标记 grep 和一次目录列表就被
  叫停——没有产生任何裁决，因此没有被污染的判断被采用。`cellwork_dispatch` 仅声明 owner、绝不替换；在 cell
  模式之外，等声明的 owner，或先释放再刻意改派。
- 1/4 窗口规则是基于实测字节与可配置比率得出的**经认证估算**，不是测量，并且对 CJK 刻意从严。
- 本包的测试不宣称做过真·LLM 端到端运行：它们用一个假 ctx 证明命令面、各模式下守卫的判定、状态存储，以及
  start/status/stop 生命周期。挂载启动证明这一行**能被应用**；真实的 `/cellwork` 派发由 QA 用例证明。

## 测试

`bun test packages/mpd-cellwork-plugin` —— 离线、无 harness、无网络。每条用例都走宿主实际使用的 adapter 入
口（`apply`、捕获到的命令定义、捕获到的工具定义，以及那**唯一一个**守卫谓词），并在全新的临时 workspace
里运行。本波次的缺陷臂各自成文件：`activate-resume-e2e`（五个阶段**各自**失败一次，随后收敛且无重复）、
`split-refused`、`requirements-subheadings`、`dispatch-fenced`、`dispatch-reassign`、`mail-order`、
`planner-guard`、`band-parity` 与 `status-reconcile`。

本包的接缝规则就是仓库的规则：所有对 harness 的接触都经 `resolveDshAdapter(ctx)`，设计背景见
[插件编写参考](../../agent-references/plugin-authoring.md)。
