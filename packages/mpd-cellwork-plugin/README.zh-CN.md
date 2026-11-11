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
| 队长 | 除 `cellwork_*`（但**不含** `cellwork_handoff`、`cellwork_delegate` 与 `cellwork_consult`）、`agent_teams_*`、`ask_user_question`、`todo_write`、`mpd_memory_*`，以及唯一的验证循环开启器 `mpd_verify_open`（**精确名字**；其余 `mpd_verify_*` 一律仍被拒绝）之外的全部 |
| 验证者 | `write`、`edit`、`mpd_hashline_edit`、`mcp__ast_grep__rewrite`、`mcp__ast_grep__scan`、`mcp__lsp__rename_symbol`、`mcp__lsp__rename_symbol_strict`、两个 bundle spawn 工具 `mpd_role_spawn` / `mpd_workmate_spawn`、两个名册 consult 工具 `mpd_role_spawn_async` / `mpd_role_consult`，以及本包自己的 `cellwork_delegate` / `cellwork_consult`——验证者**绝不委派**：裁决是它自己的活，FAIL 才是把工作退回写作者的通道 |
| 处于上下文检查点的成员 | 除 `cellwork_handoff`、`cellwork_context`、`cellwork_status` 之外的全部 |
| 副队长 | **迷你队长**：队长白名单**去掉** `cellwork_start`/`cellwork_stop`，再加上四个子 cell 动词 `cellwork_subteam`、`cellwork_activate`、`cellwork_dispatch`、`cellwork_supervise`，**以及**两个咨询动词 `cellwork_delegate` / `cellwork_consult`；完全没有文件工作工具 |
| 规划器（`cell-planner`） | 文档带内的 `read`/`grep`/`glob`——`.mpd/**`、`docs/**`、`evidence/**`、`agent-references/**`；任意深度、workspace 根内外、**按 basename** 命中的 `AGENT.md`/`AGENTS.md`/`CLAUDE.md`；根上仅 `README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`LICENSE*.md`——以及它制定计划所需的其它一切工具 |
| 普通成员 | 全部放行：它就是普通工作者 |

每次拒绝都是**一整段教学式说明**：点名被拒的调用、可替代的调用，以及作为出路的 `cellwork_stop`。
`cellwork_stop` 归档 cell，座位随之消失，同一个 session 立刻恢复不受限。

规划器那一行属于本仓库自己的侦察规则，而不是 cellwork 的发明：它的可读带**就是**顶层 `mpd` 队长保留的那条带
（一条 parity 测试同时导入两份清单，因此不可能漂移），路径按**拼写**判定、绝不解析符号链接，并且 `..` 段
**只**在 basename 是三个指令文件之一时放行——读兄弟项目的 `AGENT.md` 正是它存在的理由。在 cell 之内，规划器
从不自己做侦察，而且一次咨询就是**叶子**：名册的 spawn 工具传调用者记录的委派深度 + 1，**并且**在子会话自己的
工具作用域里拒绝两个 spawn 工具，因此子会话绝不可能再次委派；已经处于委派深度 2 或更深的调用者会被那些
**工具**拒绝。cellwork 的三个咨询动词不走这条下限：它们经 `mpdConsults` 服务启动，由该服务把子会话放在调用者
深度 + 1——也就是调用者下方一层、一个叶子——并且不传任何绝对上限。
这里有**两套刻度**，不是一套。`cellwork.depthMax`（1..8，默认 3）是 **CELL 树**的刻度：它只数嵌套的 cell 与
team，`cellwork_subteam` 在 `depth + 1 > depthMax` 时拒绝。**智能体委派深度**是另一套由 harness 按 session
记录的刻度：cell 座位就是**团队成员**，因此在随包发布的拓扑里规划器位于委派深度 1，而**嵌套 cell** 的座位比
拉起它的 cell 再深一层。两个数字并不重合，所以 cell 上限绝不会被当作子会话的智能体上限传下去：在合法值
`depthMax: 1` 上，那种传法会让每一次咨询都被拒绝。

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
  它**唯一**的写入是**采纳**活跃 team 记录里本记录从未学到的座位（见「成员」）；它绝不推进阶段。
- `cellwork_start` —— 打开**当前活跃 cell** 的 requirements 阶段（仅队长）：校验 cell 与调用者、写入
  `startedAt`、记入 journal。它绝不创建 cell；创建只属于命令。
- `cellwork_stop` —— 归档 cell（不删除）、清除守卫、交还工具。只要还有看板任务处于 `claimed`/`in_progress`
  就**拒绝**，除非 `force:true`；强制停止会被如实记入 journal。

flow 工具：`cellwork_requirements`（规划器的 finalize/update；章节正文延伸到同级或更高级的下一个标题，因此
`###` 留在父章节内）、`cellwork_recon`（规划器的**只读**咨询——`{role, task}` 问一个问题，
`{role, questions:[…]}` 并发问 1..`cellwork.recon.maxQuestions`（默认 16）个并全部落定后返回）、`cellwork_split`（切分器的按度量图——每个
任务可声明自己的看板 `member`，拒绝会把 findings 持久化到 `split/<rev>.refused.json`）、
`cellwork_activate`（队长的物化；对每个不同的 `member` 只拉起一个成员，每份合约同时点名 owner role 与成员，
其返回的 `reused` 列出从 cell 记录或活跃名册解析、而不是新拉起的成员名；成员行的**另外两种**出现方式
是暂存与采纳，见下文）。

**后台委派**这一对，给 cell 座位使用（规划器、副队长、普通成员——绝不是队长）：`cellwork_delegate`
一趟启动 1..`cellwork.delegate.maxTasks`（默认 32）个咨询并**立即**返回它们的 `consultId`，角色由名册行**自己的**解析器规范化
（`DeepWorker`、`deep worker`、`deep-worker` 与 `Deep Worker` 是**同一个** agent）、可以是**任意**名册角色
（写作角色也算）；`cellwork_consult` 列出、等待、收取（会**释放**记录）与取消**本 cell** 发起的咨询。两者都走
`mpd-roles` 行在它**唯一**的咨询监督器之上提供的 `mpdConsults` 服务——一个注册表、一个并发上限
（每次启动的预算是 `cellwork.consultMax`，默认 32；显式声明的 `MPD_DSH_CONSULT_MAX` **优先**，两者都没有时
行默认值是 8；超上限的工作**排队**，且队列**没有长度上限**——上限只管**活跃**子会话）、一个静默死信器——服务缺席时按名字拒绝，绝不用无监督的
启动替代。三个咨询动词**都**走该服务（旧有的 `cellwork_recon {role, task}` 形态也算），因此只挂 cellwork、
**不挂** `mpd-roles` 行的组合连那个形态也会失去；随包发布的 bundle 同时挂载两行，所以只有手工搭建的组合会受
影响。校验是**全有或全无**，而这条规则只管**校验**：如果某个启动在**已经启动了部分子会话之后**失败，答复是
`ok:false` 并点名**确实已启动**的 id——那些子会话继续运行并保持记录，供 `cellwork_consult` 收取。

协议工具：`cellwork_dispatch`（一次仅声明所有者的派发，外加 `reassign` 改派、`unfence` 解围与 `rebind` 身份修复）、
`cellwork_supervise`（队长的只读巡检，含每个**关闭**座位——放弃围栏或归屏障所有的检查点——与其仍拥有的
未关闭行）、`cellwork_context`
（成员自己的占用）、`cellwork_handoff`（检查点交接文档；第一份仍在等待屏障时**第二份**被拒绝，而只被
**活跃** team 记录认识的成员会先被采纳，因此拿到同一条通道）、`cellwork_subteam`（子队长的子 cell 登记）、
`cellwork_send` / `cellwork_inbox`（持久的 cell 邮件，走 workspace 邮箱——`send` 通过共享存储铸造
`message`/`question`/`answer` 记录，`send` 行先落盘，唤醒尝试是单独的 `wake` 记录；协议见
[`docs/mail.zh-CN.md`](../../docs/mail.zh-CN.md)）。它们落在本文档所述**同一份记录与同一个守卫**之上。

## 成员：拉起、采纳与解围

- **成员就是 CELL 记录上的一个座位。** `state.json` 的 `members` 表把名字映射到每个 cellwork 动词都会读的
  那一行：role、session/executor handle、`mode`、交接计数，以及 `fenced`/`handoffReady` 标志。守卫、
  `cellwork_dispatch`、`cellwork_handoff`、`cellwork_context` 与 `agent/pre-step` 检查点监听器读的都是
  **同一行**。
- **一行有三种进入方式。** 一是**暂存**：`/cellwork` 暂存规划团队时写下 `cell-planner`/`cell-splitter`
  这两行（`planning-team-staged`）。二是**激活**：`cellwork_activate` 对每个不同的 `member` 只拉起一个
  成员，续做的一趟则复用活跃名册已经认识的行。三是**采纳**：激活之后用
  `agent_teams_plan {action:"add_member"}` 暂存的成员只有 TEAM 行、没有 cell 行，下一次**在 CELLWORK
  动词路径上**的座位解析——任何动词、`agent/pre-step` 检查点监听器，或 `agent/turn-stopping` 屏障
  监听器——会把这一行镜像进来，因此 `cellwork_handoff`、`cellwork_context` 与 `cellwork_status`
  看到它，就像激活当初创建了它一样。**工具守卫不是**这些触发器之一：它的座位解析是只读的，一次仅被
  放行或拒绝的派发不写任何内容。
- **镜像逐字段进行：** `name`、`role`、`sessionId` = `executorRef` = team 行的 `executorRef`、
  `mode: "member"`、`handoffReady: false`、`handoffs: 0`、`joinedAt` = 现在，外加 `adopted: true`。
  它只**持久化一次**，`member-adopted` journal 行只在这次写入**成功之后**才追加——失败的采纳不会为一行
  从未存在的成员留下历史；而且它是**幂等**的：第二次调用直接经 cell 行
  解析，不写任何内容。`adopted` 标记是附加字段，读取时会被保留——连屏障自己的行重建也会带上——因此
  **没有**它的行就是暂存或激活写的，两种历史始终可区分。记录**无法持久化**的采纳会被如实报告，而不是默认
  成功：`cellwork_handoff` 在触碰团队平面**之前**就拒绝，并点名**哪一半**失败——记录**读不出来**，还是写入
  没有落地——因此绝不会出现「有团队检查点、却没有被采纳的行」。
- **值得写明的三条不变量。** 被采纳的行以 `handoffReady: false` 开始——采纳打开的是检查点通道，绝不宣称
  已有检查点。镜像绝不携带 `fenced`、也绝不把 `handoffReady` 设为 `true`；采纳本身**绝不**覆盖已存在的行：
  被围栏或处于 checkpoint 模式的行保持原样，动词的表现与采纳出现之前完全一致。采纳绝不改写历史。
- **仍然存在的拒绝。** 解析不到本 cell team 任何座位的 session 仍按原样被拒绝——`cellwork_handoff` 的
  答复是 `this session belongs to no active cell`——并且什么都不会被采纳。旧的
  `"<name>" is not a recorded cell member` 只在「记录点名了座位、但那一行确实缺失」时保留（例如成员键的
  拼写与记录的 `name` 不一致，如手工改过或更旧的记录）；它不再是运行中途成员的遭遇。**边界：** 采纳只覆盖
  TEAM 记录已经认识的成员——team 记录里没有的 session，按设计仍然没有通道。
- **围栏死锁。** 放弃的屏障会给行标记 `fenced: true` + `fencedReason`，却把 `handoffReady` 留在 `true`，
  于是 `cellwork_handoff` 以 STILL WAITING for the compaction barrier 拒绝它；另一个清除方式只有又一次
  **成功**的屏障，而被围栏的成员根本无法发起。成员无法靠自救恢复。
- **`cellwork_dispatch {unfence:[…]}` 就是杠杆。** 仅队长、可选，并且在派发**之前**运行。判断按**记录**分别
  做出，因为屏障只在一个地方写下放弃的围栏。CELL 行带 `fenced: true` **就是**放弃（无论 TEAM 行怎么说）：
  该行**删除** `fenced`/`fencedReason`（normalizer 禁止 `fenced: false`）、把 `mode` 恢复为 `"member"`、
  把 `handoffReady` 设为 `false`、保持 `handoffs` 不变，并记 `member-unfenced`；同时通过团队平面的
  `unfence` 接缝重新打开 TEAM 座位（平面的 `mode: "checkpoint"` 同样算关闭拼写），答复携带
  `{member, unfenced: true, plane, planeReason?}`，并把平面那一半如实报告为 `unfenced`、`absent` 或
  `refused`，绝不声称一次没有发生的重开。
- **待处理的检查点不是放弃。** 每次交接都会在 TEAM 行写下 `mode: "checkpoint"`，而压缩屏障仍拥有重新打开的
  权力，这样的一行没有 `fenced` 键。CELL 行**也没有** `fenced: true` 时，对它执行解围会答复
  `{member, unfenced: false, reason: "checkpoint-pending", detail}`，并且**两个记录都不写**——那个状态归
  屏障所有。上面的 CELL 标记优先：即使 TEAM 行仍写着 `mode: "checkpoint"`，真正的放弃也会被恢复。
- **`not-fenced` 是事实，不是失败。** 两个记录都**没有持住**（既无显式围栏、也无检查点拼写）的成员答复
  `{member, unfenced: false, reason: "not-fenced"}`；记录不被重写，team 平面也不会被询问。CELL 行只带着
  `handoffReady: true` 的成员**不是**这种情况：该标记本身就是一种检查点拼写，座位归压缩屏障所有，未加
  force 的答复是 `checkpoint-pending`（两个记录都不写），因为重新打开归屏障所有。未加 force 的杠杆只清
  显式的放弃标记。
- **名字必须无歧义地解析。** 共享规则是：先精确的成员键，再精确的显示名，最后才是非空且**恰好只有一个**
  成员携带的规范化键；未知或有歧义的拼写（例如 后端1/前端1 下的 `1`）拒绝整个 `unfence` 调用或
  `cellwork_send` 收件人，并点名已记录的成员。什么都不会被清除、写入或投递——拼错一个名字绝不会让清单
  只生效一半。
- **TEAM 座位只能经团队平面的接缝移动。** 组合暴露 `mpdTeamActions.unfence` 时，同一次调用会重新打开 TEAM
  座位，结果写 `plane: "unfenced"`（该接缝同时清掉显式围栏与 `mode: "checkpoint"` 窗口）。没有该接缝时，
  结果写 `plane: "absent"`，并在 `planeReason` 里说明 TEAM 座位**没有**被重新打开——cell 行的修复照常成立，
  答复绝不假装两边都落地；`plane: "refused"` 会带上团队平面自己的原话。只存在于 TEAM 记录上的围栏是另一种
  情况：接缝会清掉它，而 CELL 行保持原样，因此结果携带 `cellRow: "untouched"`，`unfenced` 只反映平面的
  那一半。`unfence` 与 `reassign` 可以放在**同一次**调用里（解围先跑，因此这一趟可以把行交给它刚重开的
  成员），两者互不干扰；解围**之后**的拒绝仍会报告解围改动了什么。杠杆只清记录；它不会重建一个已死的
  session。

## 配置

每个数字都是 `cellwork.<key>` 旋钮。**优先级为项目文件 > 行配置 > 随包发布的默认值**：
`<workspace>/.mpd/mpd.jsonc` 优先于 bundle patch 的 `config:` 块，后者优先于文档默认值。不是有限数字或
超出取值规则的声明会被**替换为默认值**，并在该行的日志里报告
（`<workspace>/.mpd/logs/mpd-cellwork.log`）。

`depthMax` 3 · `checkpointRatio` 0.5 · `windowFraction` 0.25 · `fixedOverheadTokens` 32000 ·
`fixedOverheadByRoute` {} · `toolSchemaChars` 0 · `outputReserveTokens` 8192 ·
`compactionHeadroomTokens` 65536 · `compactionRetries` 3 · `idleBarrierDelayMs` 200 ·
`checkpointPendingMaxMs` 900000 · `asciiCharsPerToken` 3 · `cjkCharsPerToken` 1 · `contractGates` [] ·
`windowOverride` null。

六个**座位与并发**键是 `cellwork.seats.maxPerRole`（8，`1..32`）、`cellwork.seats.max`（32，`1..64`）、
`cellwork.consultMax`（32，`1..256`）、`cellwork.planning.analysts`（2，`0..8`）、
`cellwork.delegate.maxTasks`（32，`1..64`）与 `cellwork.recon.maxQuestions`（16，`1..64`）。`seats.*`
是**嵌套**键（`cellwork.seats.maxPerRole` / `cellwork.seats.max`）；越界或畸形的值会回退到默认值，并在该行
日志里用**一条**行点名真正的点号路径。

邮件上限是这张表**唯一**的例外：`mail.maxUndelivered`（默认 8，`0` 表示关闭；缺失或不可用的值回退到 8）是
`mail.*` 键，因为**两个**邮件工具都读它，并且经同一个共享存储执行（见下文「邮件与重种边界」）。

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
- **切分告警不致命，空写作用域绝不沉默。** `cellwork_split` 返回 `warnings` 列表 —— 一个**被排除在 `accepted`
  谓词之外**的通道 —— 按切分键点名每个 `writeScopes` 为空的 `work`/`repair`/`integration` 任务。确实什么都不写的
  切分仍然通过；它拒绝的只是**沉默**。冻结合约里「(none declared — this task produces no code)」那一行带着补救：
  **第一次写入之前**向队长申请扩展作用域。团队面的 `agent_teams_plan {action:"create_task"}` 在暂存时适用同一条
  规则。
- **B7 仅声明的所有者派发。** 就绪任务**只**配给它声明的所有者；所有者忙、缺席或**被围栏**时如实报告、
  任务保持待派发——绝不替换。成员在以下任一情况下**被围栏**：记录的 `mode` 是 `checkpoint`、它写下的交接
  仍在等待压缩屏障、或屏障放弃并记录了 `fenced: true` + `fencedReason`；被围栏的成员绝不被发消息。
  两条修复杠杆：`cellwork_dispatch {reassign:[{task_id, owner}]}` 移动**行**，
  `cellwork_dispatch {unfence:[…]}` 清除**已放弃**的围栏（见「成员」）。对每一对改派，在派发**之前**先把
  该行在看板上 claim 给那个成员、记 `task-reassigned`（from → to），然后投递——失败会报告在
  `reassigned`/`reassignInvalid` 里、绝不抛错；终态行、未知成员或被围栏的**目标**一律拒绝（先解围，或换
  一个成员）；**启动失败**（FAILED）或仍在**启动中**（PROVISIONING）的目标同样拒绝（为它 claim 的行永远
  不会被接手），投递 handle
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
- **邮件日志格式变了，且单向兼容。** 记录如今住在 **workspace 邮箱**
  （`<workspace>/.mpd/team/mailbox.jsonl`）里，盖上 `teamId` + `cellId`（跨 cell 发送还盖 `fromCell`），
  于是 cell 视图与团队面读的是同一条流。`send` 行带着旧拼写 `wakeSent: false`，唤醒结果作为**单独的**
  `wake` 记录（`t:"wake"`、`sent`、`reason?`、`at`）追加在其后。本构建能正确折叠更旧的日志（`wake` 之前的
  行保留自己的 `wakeSent`，统一之前的 `<cell>/mail.jsonl` 仍会被读取并按 `at` 顺序合并）；来自**旧构建**的
  读者会把新行读成"未唤醒"——并且在 cell 文件里根本找不到它。一条「一个 bundle 一个 workspace」的边界，
  如实写明而非隐藏。
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
- **重切分会说明它保留了什么。** 一次修订保留了任务时，`cellwork_activate` 返回 `notice`：多少保留任务复用其看板
  行、它们的冻结合约**不会**被重写（验证者可能正在读的字节保持首次冻结的样子）、扩展作用域需要**手工重新冻结**加
  一个新的验证循环且应落在一个**新的**切分修订里，以及本次激活以**仅声明所有者**的方式派发了多少就绪行。**第 4
  阶段例外**写在同一条 notice 里：保留任务的循环从未被记录，是保留合约被重建的**唯一**情形，重建会补上验证循环
  id —— 发生时会点名这些键。这条 notice 刻意是结果里的散文：队长不必从计数里自行推断任何一条。
- **无损的工具结果。** cellwork 的每个工具结果都能通过 harness 的无损 JSON 走查：任务投影绝不带 `undefined`
  自有键（可选的 `owner` 直接省略，绝不写成 `undefined`），结果里也没有非有限数、负零或环。
- **B5 侦察边界。** `cellwork_recon` 用精确的 `Explorer`/`Researcher` 标签启动只读子代理——不传绝对上限，
  因为名册会把子代理放在调用者下方一层、作为叶子——因此子代理人格接缝会施加名册的拒权清单。若该接缝不存在，
  只读仅由**提示词**保证，结果会报告 `personaInjected:false`。
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
- **压缩结果必须分类，而且能触及的成员会原地压缩。** `agent/turn-stopping` 监听器**返回**屏障的 promise，于是
  宿主的串行派发会 **await** 它，而不是与一个已脱离的屏障赛跑。屏障**不会**等待空闲的 agent：它最多做
  `compactionRetries` 次尝试，在两次之间 sleep `idleBarrierDelayMs`（**第一次**之前没有 sleep），然后**在**任何
  sleep **之前**、在查注册表**之前**，从事件携带的**活跃**成员 handle 解析引擎
  （`compactionEngineForLiveAgent`），因此一个已从 `ctx.agents` 脱离的成员仍能到达它自己领域里的引擎；只有该
  handle 没带引擎时，才轮到按 id 的 `compactionEngineForAgent`。引擎带真实的 `AbortController` 信号驱动；写入
  journal 的原因**以** `compacted` | `no-safe-range` | `busy` | `aborted` | `failed` | `no-engine` 其中**一个分类
  开头**，重试预算用完绝不是一次静默的空操作。**这个 reason 是「分类 + 适用时的 `; ` 子句」**（NIT 5）：重种会在
  它后面追加宿主边界说明，所以「每次都 `busy`」的形态写的是
  `busy; the engine reported \`busy\` on every attempt: …`——把整串去和六个取值逐一相等比较的读者，恰好会漏掉本
  bundle 实测到的那个形态。**每次尝试都是 `busy` 是宿主自身的边界，reason 会写明（R4.0）：**
  `compactNow` 跑在 `agent.runMaintenance` 里，后者拒绝除 idle 之外的任何阶段，而 `agent/turn-stopping` 是在
  回合内部派发、监听器会被 await 的——原地压缩无法在那个事件上运行，因此重种是唯一出路，reason 文本会记录这
  一点而不是把 `busy` 留成无人解释的话。结果并集恰好是 `promoted` | `reseeded` | `refused`，而 `compacted` 的
  答案走 `promoted`，且是**同一个** agent —— 不打断、不重种。**只有落盘那一行确实重开了 CELL 座位的屏障轮次，才
  重开 TEAM 座位**：判据是那一行（`fenced !== true`），而不是原始结果——以队长身份调用平面的 `unfence` 接缝，记
  `member-unfenced` 且 `by: "barrier"`，并报告 `plane: "unfenced" | "absent" | "refused"`（接缝的三种答复）；
  而到达重试上限的 `reseeded` 轮会在同一轮**围栏** CELL 行、什么都不重开，改记 `plane-reopen-skipped`，其
  `plane: "skipped-fenced"`——屏障 `plane` 枚举的第四个取值。重种会记 `member-reseeded`，带上两个 session id、退役事实与平面
  那一半。**退役由活跃祖先授权（R5.1）**——就是这次重种所用的那个 session（成员的持久父会话活跃时用它，否则用
  该 cell 的队长），**绝不是**成员自己的 handle：宿主会在祖先检查之前以 `UNAUTHORIZED "cannot interrupt itself"`
  拒绝它。记录写的是宿主真正做过的事：`retired:true` 只在 `retirement:"accepted"` 时出现；注册表在该 id 下没有
  活跃 session 时是 `"nothing-to-retire"`（绝不算退役）；宿主拒绝时是 `"refused"`，原话在 `retirementReason`；
  组合没有接缝时是 `"unavailable"`。以 `refused` 结束的平面那一半会带 `retry`（那个仅队长可用的确切 verb）。
  重种**不是**「子代理能工作」的证明：`checkpointSince` 会跨重种保留，而带时间戳的座位只有在注册表
  **存在**、其**队长锚点**可解析、且记录的 session 查不到时，才会被 `cellwork_supervise` 标成 `suspect`
  （注册表存在却解析不了锚点时答案是 `unknown`，什么都不标记）。有界的强制杠杆
  （`unfence: [{member, force: true}]`）是最后手段：活跃 session 与缺失的书面边界（`barrierFailures` 达到
  `compactionRetries`，或窗口早于 `checkpointPendingMaxMs`）都会被失败即拒绝；它把座位重开是为了重新分配，
  不是为了工作。
- **重种契约（R1–R5、F1–F3）速览。** R1：只有新 handle 已同时写进 TEAM 成员行、旧 handle 名下所有**非终态**
  看板行（或以该座位自己的名字拼写的行）和 CELL 行，才允许记 `reseeded`；否则整轮拒绝
  （`checkpoint-unrecoverable` + `surface`）、围栏座位，并**尝试**通过 `dispose()` 接缝释放子代理（接缝缺失或抛错会
  被如实报告，绝不冒充一次释放）。**无平面例外**：workspace 里**根本没有
  team 记录**时没有 TEAM 行、也没有看板，重种可以在**没有**它们的情况下成功（`plane: "absent"`）——不存在
  不等于不可读（F1）。绑定若在回读验证时抛错或读到的 handle 不符，会**回滚**到绑定前的 TEAM 行与看板 owner；
  若期间已有别的写入者提交，回滚**拒绝覆盖**并如实报告。**回滚被拒时一律保留子代理（A11；第二轮放宽）：**
  最常见的并发形态会保留本次绑定的新 `executorRef`；而且即使**当时读到的文档点的是另一个 handle**，并发的读-改-写
  （team-core 的 `cancelTasks`）也可能在之后才提交它**在本次绑定进行期间**读到的名册——那份文档点的正是新 handle。
  只有真正把绑定前行**恢复**（`restored`）的回滚才释放子代理。保留体现在 journal 行的 `orphanChild` +
  `reconcileRequired` 上；`rollback:"failed"` 是同样的「未证明」状态，同样保留。失败文案交出 `cellwork_dispatch {rebind:[{member, handle}], unfence:[member]}`——
  `rebind` **先执行**，是**唯一**能重新指向 `executorRef` 的动词（并把 handle 镜像进 CELL 行）；`unfence` 单独用永远不碰
  handle，`reassign` 只移动看板行。**合并调用里的 `unfence` 只在每个 `rebind` 条目都答复 `rebound:true` 且 CELL 镜像确认
  之后才执行**：否则所有点名围栏保持**关闭**、不执行任何 `unfence`、journal 记 `dispatch-unfence-withheld`，答复里的
  `unfenceWithheld` 写明 `fence stayed closed` 并给出下一步。落地的重指若 CELL 镜像失败，仍是 `rebound:true`，但会带
  `cellRow:"failed: …"`——**必须检查 `cellRow`**：只有它缺席才代表两份记录一致，镜像失败同样会扣住 `unfence`。恢复路径不会被再次进入：当 TEAM 行已点名一个注册表证明**活着**、且不同于 CELL 行
  session 的 handle 时，屏障**不 spawn**，只记 `barrier-skipped`（`branch:"reseed-already-bound"`）并给出同一个
  `rebind` 修复。R2：晋升指令是经执行器的 `send` 向**新** handle
  **尝试投递**；投递抛错会记 `directiveDelivered:false` + `directiveError`，且不撤销绑定。R3：status /
  supervise 报出每个座位的 `liveness`（`live`/`dead`/`unknown`），且对 `unknown` 绝不隐藏
  `fenced[]`/`forceEligible`。R4：没有只 warn 的分支——记录重读失败与 spawn 之后抛出都各记一行，后者还会
  dispose；读不出的记录无法接受的围栏会如实记成 `fenced:"not-persisted"`，绝不假装已围栏；强制杠杆只对**带书面
  bound** 的座位点名，而这条分支一条都没写，因此修好记录并写下 bound 之前它不可用。R5：spawn 没给出
  child id 时 dispose 它的激活；**原**会话的中断（interrupt）是**尝试**，不是保证——宿主拒绝或根本没有该
  能力（`retirement:"refused"`/`"unavailable"`）都会进 journal，重种仍继续。F1：`absent`（无记录）≠
  `unreadable`（存在但读不出，这是拒绝）。F2：绑定是对记录**完整字节**的 compare-and-set；**在比较时检测到**
  的变化会被拒绝（`team-record-changed`），字段只用于说明什么变了——但**比较之后、rename 之前**跨进程提交的
  写入仍可能被覆盖：这条跨进程残余是收窄，不是消除。F3：终态行（`completed`/`failed`/`cancelled`）保留原
  owner——历史绝不重指。**`rebind` 会校验它的 handle，并记录它自己的结论（M1/N1/F1）：** handle 先 trim，必须是宿主铸造的
  8-4-4-4-12 UUID 形态，且必须被本座位**当前的记录**点名——TEAM 行或 CELL 行；**当两条当前行都没有点名任何 handle
  时，journal 的最新一条交接行同样可以作证**。**当前记录优先，journal 只作
  佐证：** journal 的「最新一条」只在**两条当前行都没有点名任何 handle** 时才参与判定，且绝不能否决任一当前行
  点名的 handle。因此，记录写入晚于最后一次交接、且自身没有 journal 行时，该 handle 会被接受并标记
  `handleRecordCurrent:true` 与（能证明写入更晚时）`journalHandoverOlder:true`，而不是被判
  `handle-superseded` 并反向建议。只有更早交接行点名的 handle 会拒绝为 `handle-superseded` 并点名后来的
  那一行；文案只陈述两方事实，绝不替操作员选择方向（注册表只证明**存活**，从不证明**归属**，存活也不能让旧
  handle 变回当前）。每条结果都带 `namedBy`（`team`/`cell`/`journal:<event>`）；
  `previousSessionId`/`previousSessionIdLiveness`（`live`/`unproven`/`unknown`）**只在 TEAM 行可读时**报告，
  TEAM 记录缺失或不可读时会**省略**（没有可报告的被替换 handle）。真正落地的重指会带上与重种绑定
  相同的 `displacedExecutorRef`/`displacedUnproven`，每一条失败条目（包括参数拒绝，会记下请求的 `handle`）都记
  `member-rebind-failed`；被重种**顶掉**的 handle 会以 `displacedExecutorRef`/`displacedUnproven` 记在
  `compaction`、`seat-rebound` 与 `member-reseeded` 三行上。`docs/cellwork.md` 是权威。
- **邮件与重种边界。** cell 邮件先落盘（持久），唤醒尽力而为。`cellwork_send` 在 cell 树里解析收件人 ——
  成员名、`captain`，或跨 cell 形式 `"<cellId>/<captain|member>"`，其中 `<cellId>` 必须是**本** cell 登记过的
  子 cell 或本 cell 的父 cell（`cell.subcellIds` / `cell.parentCellId`），其它一律以
  `"not in this cell's tree"` 拒绝。显式给出的名字既不是 `captain`、也不是**目标 cell** 的成员时会被
  **拒绝**——答复列出该 cell 的成员——绝不悄悄投进调用者自己的收件箱。一次发送通过共享存储的原子扇出写入 **workspace 邮箱**，盖上该 cell 的
  `teamId` 与视图用于筛选的 `cellId`；**发送方**的 journal 会以 `cell:<cellId>` 戳并带 `toCell:<target>`
  记录这次发送。`cellwork_send` 同时说这套结构化协议——`kind`（有问题 `options` 时推断为 question，有
  `selected`/`custom` 时推断为 answer）、`options` + `multiSelect`、`replyTo`、`selected`/`custom`、
  `questionId`，以及 `broadcast: true`（目标 cell 的每个席位一行，排除发送者）；未知标签会被拒绝，并附上
  完整的合法标签列表。收件人已有 `mail.maxUndelivered` 条未投递（默认 8，`0` 表示关闭）时会被**拒绝** —— 该上限
  经同一个存储与 `agent_teams_mail` **共享**，所以换工具不是逃生门 —— 拒绝会点名收件人、当前条数、上限与两条恢复
  路径：确认它的收件箱（`cellwork_inbox`），或改派它身后的行（`cellwork_dispatch {reassign:[…]}`）。跨 cell 的行会镜像 `fromCell`，只做持久投递——跨
  cell 不尝试唤醒——并出现在**那个** cell 的 `cellwork_supervise` 上。Lead 没有 executor handle，成员 → 队长的
  行由队长在 `cellwork_inbox` 读取（并在 `cellwork_supervise` 上呈现）；唤醒从未发出的行保持**未投递**状态，
  同样会在那里呈现（`unreadMail` 加上 `wakeFailures[]` 行，每行 `{id,to,subject,reason}`），而不只是出现在
  待办看板上。压缩屏障无法压缩时，代理会从交接文档重种 —— 但绝不用它自己那个已死的 Agent 当父级：重种的父级
  依次是成员记录的 `parentSession`（解析为活跃会话）、该 cell 的队长，两者都不活跃时屏障以**独立**原因
  `reseed-parent-unavailable` 拒绝。真正用到的父级会记入 journal（`parentSource` + `parentSessionId`），因此
  血缘由可观测取代推断。原生后端不暴露已落地激活的 dispose，因此旧子代理只做尽力中断，新 handle 记录在 cell 上。

**配置优先级（两种语言同述）：** 项目文件（`<workspace>/.mpd/mpd.jsonc` 的 `cellwork.*`）> 行配置
（bundle patch 的 `config:` 块）> 随包发布的文档默认值。

### 子单元渲染为嵌套分组

子单元在共享 DAG 里被画成一个**分组盒子**：盒子的内部就是该子单元自己的图，来自外部的依赖附着到盒子的帧上、
而不是盒内某个任务上，并且嵌套会递归。本包提供的是这张图所依据的**事实**，而不是图本身。
`cellwork_subteam` 把父 cell 的**实时** team id 写到新 cell 的 `CellState.parentTeamId` 上，并把
`subcell-created` 连同它写进 journal，且**不传**任何父级 id：团队平面在批准时从父 team 自己的名册推导这条
链接（`deriveParentTeam`），因为登记子 team 的 session 本身就是它的成员。本波次画盒子的是 TUI；web DAG 的分组帧
是已声明的后续工作（`docs/cellwork.md` 的"声明边界"）。

### 咨询作为 DAG 节点

座位发起的咨询也是画面的一部分：每次启动都通过 `mpdTeamActions.upsertConsult` 往该 cell 的 team 记录上写**一行**
`running`，而团队平面用这条记录构建图、并按变更 feed 的修订号缓存，于是它画在 cell 的分组盒子里。没有第二个存储、
没有第二个 watcher、团队平面也从不读 `.mpd/cellwork/**`。

- **落定的咨询不需要座位来过问就会被记录。** `mpdConsults.start` 接受一个可选的 `onSettled` 观察者，名册行在记录
  离开 `running` 时**恰好**触发一次；cellwork 为每个咨询传一个，并据它 upsert 终态行。`wait`/`collect`/`cancel` 的
  回答作为**第二个**、幂等的写入源（upsert 以 `consultId` 为键）写同一行，所以观察者那次写没落地，也会在下一次有人
  查看时被纠正。
- **没有活跃 team 的 cell 什么都不记**（`teamId === ""`）：没有记录可画，于是调用写一行 `consult-unattached`，
  回答不变。平面收不下这次写时同样只记 `consult-unrecorded` —— 写入失败绝不会把一个已经启动的子会话变成失败的
  工具调用。
- **`cellwork_stop` 会清掉它们，并中断它们的子会话。** 停止（含强制停止）**先**删掉内存 consult book 里该
  cell 的键——这正是结算观察者读取的**停止标记**——再通过 `mpdConsults.cancel` 中断那个键仍记着的每一个
  咨询（每个子会话写一行 `consult-cancelled`；接缝不存在或调用抛错时写带原因的 `consult-cancel-skipped`），
  最后才对该 cell 的 team 调用 `mpdTeamActions.clearConsults`，于是图不再画它们，**并且**之后才落定的子会话
  只写 journal（`consult-late-settlement`），不会重新造出一行。没有活跃 team 的 cell 同样会执行上面的取消
  ——子会话是进程本地的，不属于平面。
- **行有留存上限，不是无限增长。** 团队平面每个 team 最多留 50 行，先丢**最旧的已结算**行，绝不丢 `running` 行；
  因此一个永不清停的 cell 只会自然老化，而不是无限膨胀。
- **这里没有任何东西是任务。** 咨询不占 `T<n>`，不被派发，也被排除在看板统计、`readyTasks`、干净终止规则与验证者
  范围之外。

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
- **被委派的写作角色在 cell 看板之外工作**：没有冻结合约、没有验证循环、没有看板行。看板规模的工作属于
  `cellwork_split` + `cellwork_activate`；后台委派是给有边界的副业用的。
- **咨询账本在内存里**（cell id → consult id，不含报告、不含上限），与监督器自己的记录一样：重启会同时丢掉
  两者，而 `cellwork_consult` 会如实说明，而不是回一个过期 id。座位直接通过 `mpd_role_consult` 收走的咨询
  会离开本 cell 的清单。
- **智能体委派深度与 CELL 树深度是两套不同的刻度**——`cellwork.depthMax` 只约束嵌套的 cell/team，**绝不**传给
  咨询。三个咨询动词经 `mpdConsults` 服务启动，子会话的智能体深度交给名册自己的 `spawnMaxDepthOf(exec.agent)`
  规则（调用者深度 + 1，一个叶子），该路径刻意不施加名册工具侧的深度下限。这条豁免今天只有**一个**消费者：
  cellwork，其平面由 `cellwork.depthMax` 约束；第二个消费者必须先论证这次绕过。
- **通用 team 动词默认是仅声明 owner 的；只有它显式的名册模式才会替换。** `agent_teams_dispatch` 会把
  就绪任务配给**声明的** owner，按位置的回退需要显式 `mode:"roster"`——正是**那个**模式把一条 REVIEW 任务
  交给了写过被审泳道的成员。队长立即释放
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
`split-refused`、`requirements-subheadings`、`dispatch-fenced`、`dispatch-reassign`、
`member-adoption`、`dispatch-unfence`、`mail-order`、`planner-guard`、`band-parity` 与 `status-reconcile`。

本包的接缝规则就是仓库的规则：所有对 harness 的接触都经 `resolveDshAdapter(ctx)`，设计背景见
[插件编写参考](../../agent-references/plugin-authoring.md)。


## 它共享的团队平面与 `cellwork_open`（波次 W2）

**`cellwork_open {objective, mandate?}`** 是 autoproject 升级流程使用的程序化入口。它**拒绝**非 captain 的
调用者、已存在的活动 cell，以及 `mandate` 指向的 `<workspace>/.mpd/autoproject/<runId>/escalation.json`
不在磁盘上的情况。`/cellwork` 是**同一条**开启路径上的薄处理器，因此命令与工具不可能分叉。工具没有
`invocation.submit`，所以工具路径**返回**激活指令而不是提交它 —— 这是明确写出的边界，不是隐藏的。

**团队级逻辑属于团队平面**，以服务方式访问（无跨包 import）：`cellwork_context` 读
`mpdTeams.memberContext`；`cellwork_subteam` 读 `mpdTeams.depthBudget`（同一个 `cellwork.depthMax` 上界；
服务缺席时以 cell 记录为有据可查的回退）；`cellwork_dispatch` 与 handoff 路径通过
`mpdTeams` / `mpdTeamActions` 读写团队记录。cell **模式**的引擎（requirements、split、activate、recon、
budget）留在本包：它们是**写**看板的工作流层。

**磁盘状态不变且向后可读：** `.mpd/cellwork/**` 仍是 version 1（无迁移），保留每 cell 的 journal 与邮件。
一个波次的**冻结契约**存放在看板任务描述里，因此 owner claim 的那一行就带着它被评判的验收文本。

## consult 工具、强制目标与 CELL 记录（2026-11-05）

名册一侧 verifier 的只读拒绝清单仍为 **十个**名字（含 `mpd_role_spawn_async` 与 `mpd_role_consult`），
本包自己的 `VERIFIER_DENY_TOOLS` 则是 **十一** 个（那份十减去 verifier 保留的 `bash`，再加上
`cellwork_delegate` 与 `cellwork_consult`），而 no-delegation 清单带 **六** 个（两个 spawn 工具、两个名册
consult 工具，以及本包的两个 consult 动词）：无论 verifier 席位伸手去够哪种拼写，它既不能委派，也不能
取消另一个 consult。cell 席位**就是**团队成员，因此团队 watchdog 的强制监督器通过该团队成员身份、
按**先宽限后强制**的顺序将其作为强制目标（宽限指令、采用成员自己写的 handoff，然后才是 interrupt、
requeue、split），而 `mpd-team-core` **绝不**写 CELL 记录
—— 席位事后通过既有的 `cellwork_dispatch` / `cellwork_split` 动词修复自身。
