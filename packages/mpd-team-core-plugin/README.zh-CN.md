# mpd-team-core-plugin

[English](./README.md) | **简体中文**

官方 Agent Teams 运行时之外的**工作流**。Harness 0.1.7-rc.2 的官方插件只管团队本身——名册、共享看板、信箱、
可续接的队友——别的都没有。而被退役的自研体还带有队长真正要用的那些评审点：一支在**任何人存在之前**就能被阅读、
编辑、批准的暂存计划，认领时冻结的任务契约，暂停，以及归档。这些东西现在住在这里。

**mpd 记录才是团队的权威真相。** 名册与看板存放在 `<workspace>/.mpd/team/teams/<teamId>.json`，由本插件读写；
官方 Agent Teams 服务只是运行官方执行器的组合里的**回退**，且只经 `mpd-dsh-adapter` 访问——这里没有任何界面把
`dsh.teamLiveTeams()` 当作真相。`<workspace>/.mpd/team/` 下的边车文件是环绕该记录的**工作流状态**，绝不是它的
第二份拷贝。

## 工具

| 工具 | `action` 取值 | 作用 |
|---|---|---|
| `agent_teams_plan` | `create`、`add_member`、`create_task`、`edit`、`approve`、`delete`、`status` | 把团队暂存成**计划**；`approve` 通过**团队执行器**执行它（原生后端在被钉住的宿主上（harness 0.2.1+）经 `ctx.subagents.startActivation` 拉起持久子会话，只把已退役的 `ctx.subagents.startContinuable` 留作老宿主的回退 —— `CONTINUABLE_START_MEMBERS`，由 `continuableStartMember` 从新到旧探测；官方 `dsh.team*` 调用是**回退**），并按 mpd 记录解析 `blocked_by`/`owner`，持久化声明的 `kind`（取自 `task.kind` 或其顶层别名，未知词会被**拒绝**）；0 成员且 0 任务的计划会被**拒绝**；`delete` 归档；`status` 在该后端生效时把记录与官方读数并排给出 |
| `agent_teams_task` | `claim`、`contract`、`release`、`complete`、`fail`、`depend` | 在 mpd 记录上认领任务**并**冻结契约（单调 `attempt`）；读回契约；`release` 释放配对并把任务行退回 `pending`；`complete`/`fail` 是终结动词（仅所有者或队长可用，可带 `note`/`expected_revision`，`FAIL` 会释放其依赖方）；`depend` 只向**既有**行**追加** `blocked_by` 依赖边——重复添加是幂等空操作（会如实报告），已终结的行、未知的 `task_id`、既非该行所有者又非队长的调用者、以及**自环**或**任何环**（双节点或传递环）都会被**拒绝**；所有拒绝都在**任何写入之前**返回，`blockedBy` 与 `revision` 保持原样——成环的边永远无法满足就绪规则，而 `depend` 只会追加、永不删边，任务行会因此永久 not-ready——并报告点名不到任何任务的引用：按原文保留在 `blockedBy`、在结果里点名、并持久化为该行的 `unresolvedBlockers` |
| `agent_teams_dispatch` | `run`、`release` | 把就绪任务与空闲成员配对、通知成员、并在**按团队分键的台账**里记录配对；`release` 释放配对并重开任务行 |
| `agent_teams_mail` | `send`、`unread`、`read`、`summary` | 团队信箱：durable，且带官方**给不了**的已读状态 |
| `agent_teams_control` | `halt`、`resume` | 只停派工、别的什么都不做的暂停 |

`/agent-teams <这支团队是干什么的>` 按当前目标暂存计划。

**依赖守卫（mpd 记录面）。** 每次 `create_task` **必须**声明它的依赖答案——`blocked_by: [...]`（数组，可为空：显式声明为根）或 `independent: true`；两者都不给、给非数组、两个别名互相矛盾、自环或有环，一律**拒绝**并点名该任务。`approve` 会**拒绝**两个写作用域重叠（去掉尾部 `/**` 后相等，或在**段边界**上互为前缀；`**` 与 `.` 覆盖全部；空作用域列表永不重叠）、且彼此之间**没有**依赖路径的任务，并引用这一对任务与两种补救：补一条边，或让作用域互不相交。`claim` 会**拒绝**声明阻塞尚未满足的任务，用的是 `agent_teams_dispatch` **同一套**就绪判定；`complete`/`fail`/`release` 仍保持可用；按 OPT-1，**失败**的阻塞仍然释放其依赖方。**这道门在工具边界上已经关上：** 团队之门守卫按完整名称**拒绝**官方五个创作动词——`spawn_teammate`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`——因此没有任何**工具**能在官方看板上创作任务（`send_message`、`list_agents`、`wait_agent`、`interrupt_agent` 保留，用于 agent 之间的通信）。**这条边界只说一次：**直接调用团队**服务**的插件行（官方执行器回退路径）不是工具调用，**不**受这道门约束。**这道门对每一个 agent 都拒绝，且没有任何 preset 豁免——这是刻意的（R18）。** 委派门会放行一个外 preset 的顶层会话；这道门不放行，因为它的对象是**工作区作用域**的看板——每个工作区一份 `.mpd/team/teams/<id>.json` 记录——放行外 preset 会话会让官方看板与 mpd RECORD 在**同一个**工作区里分叉；而且本仓库自己的测量（T-92，`complexity-gate.ts`）表明：部署的顶层会话带有 `agentPreset: "cordis"`，按 preset 放行恰好会放行这道门必须约束的那个会话。mpd RECORD 仍然是唯一的看板，所以以上每条规则都作用于会话通过这些工具能创建的每一个任务。

**依赖图是可见的。** `agent_teams_plan {action:"status"}` 保留原来的一行摘要
（`plan <id> · members N · tasks N · hold …`），并**每个成员一行**（`id`、`name`、`status`）、
**每个任务一行**（`id`、`owner`、`status`、`kind`、`blockedBy`——没有则 `-`——以及 `subject`），
于是扁平看板与接好线的看板不再长得一样。`edit` 的读取形式会打印暂存任务及其 `subject`、`owner`、
`blockedBy`，且每行都是 `id=-`：`T1…` 这样的 id 是批准时才铸造的。因为 `create_task` 只能新造一行、
批准只写一次 `blockedBy`，`agent_teams_task {action:"depend"}` 就是那条**只追加**的动词，让中途新增的
任务接入既有 DAG，而不是又变成一条孤立的行。

**为什么用 action 而不是更多工具。** 每个工具的名字、描述和参数 schema **每一轮**都在模型上下文里。手写的界面一度长到
**14 个工具、7,643 字符（约 1,900 token）**——还一个字都没提任务；而这些动作本就是**同一条工作流的步骤**，所以现在是
`action` 取值：**5 个工具、4,971 字符 / 5,000 预算（约 1,240 token，2026-10-23 实测）**。`test/tool-surface.test.ts` 同时钉住预算和 action 集合，
所以将来新增工具必须对这个数字交代。

`/agent-teams <这支团队是干什么的>` 会按当前目标暂存一份计划。

## 变更推送——不再轮询

每一次团队改动都会**被推送**。`<workspace>/.mpd/team/teams/<teamId>.json` 是团队唯一的事实来源，现在它会自己宣告变化，
于是各界面是在"真的发生了事情"时重读，而不是每 1000–2000 ms 读一次。

### 服务（`mpdTeams`）

| 成员 | 签名 | 契约 |
|---|---|---|
| `subscribe` | `(workspace: string, listener: () => void) => () => void` | 每个变更窗口最多回调一次，且**绝不在写入方的调用栈里**同步回调。返回的释放函数可重复调用。 |
| `revision` | `(workspace: string) => number` | 本进程为该工作区**已观测**到的变更窗口数，单调递增。从未见过的工作区为 `0`。重连的客户端拿自己的号与流的 `hello` 帧比对，即可发现漏掉的通知。 |

- **不论是谁写的。** 本进程自己的写入（`writeTeam`、`writeTeamsIndex`、`deleteTeam`）经 store 上的钩子通知；
  **另一个进程**的写入——第二个会话、CLI、容器 lane——由 `<workspace>/.mpd/team`（索引）与
  `<workspace>/.mpd/team/teams`（记录）上的**非递归** `fs.watch` 看到。两条来源汇入同一个按工作区的窗口。
- **合并。** 一个窗口内的突发只回调**一次**，`revision` 数的是窗口而不是其中的写入次数。窗口是**固定**的
  （默认 50 ms），不会因为迟到的观测而延长，所以持续繁忙的团队不会无限推迟自己的通知。突发的**第一笔**写入
  自己就会触发通知：窗口正是它打开的。
- **包容。** 抛异常的回调在该次调用中被吞掉并只报告一次；它无法破坏写入方、其他回调或启动过程。
- **懒加载并会释放。** 某工作区的 watcher 在第一个订阅者出现时装载，在最后一个订阅者离开时关闭；所有 watcher、
  定时器与钩子都在插件 dispose 时释放。
- **降级而非失败。** 若 `fs.watch`（或工作区本身）拒绝，事件流**仍然**投递进程内通知，并且每个工作区只写**一行**
  有界日志说明 watch 已关闭。被拒的装载会在下一个订阅者或下一次变更时重试，因此"后来才出现的目录"不会永远无人看守。

### 路由（`GET /plugins/mpd-team/events`）

Server-Sent Events，与四个 JSON 路由同属 `/plugins/mpd-team/*` 家族（宿主遇到重复的 exact 路由会抛错，
而 `/plugins/events` 属于 harness 自己的 HMR 行）。工作区与会话**按请求**解析，与 JSON 路由的解析方式完全一致。

```
HTTP/1.1 200 OK
content-type: text/event-stream; charset=utf-8
cache-control: no-store, no-transform
connection: keep-alive
x-accel-buffering: no

retry: 1000

event: hello
data: {"rev":7}

data: {"rev":8}

: ping
```

- 连接时：`retry: 1000`，随后一个携带当前 revision 的 `event: hello` 帧；响应头被显式 flush，所以客户端在
  任何变更发生之前就已报 OPEN。
- 每次 feed 变更：一个不带事件名的 `data:` 帧（浏览器 `EventSource` 默认的 `message` 事件）。
- 每 15 s 一个 `: ping` 注释，避免代理丢弃空闲流。
- `req.on("close")` 释放订阅并清掉定时器；客户端离开后不留下任何东西。
- **没有 feed** 的组合会回 `503` 加一个 JSON 体，而不是把一条死流挂着。

### 明说的边界

- watch 是每个已装载工作区**两个非递归目录监听**：Linux inotify 没有递归模式，而记录是 `teams/` 的子项、
  索引是 `.mpd/team` 的子项。
- 订阅会**创建**这两个目录，这是有意的副作用（不存在的路径无法被监听），所以订阅某个工作区的界面可能会创建
  空的 `<workspace>/.mpd/team/teams/`。
- 在网络文件系统上，或内核 inotify watch 上限被耗尽时，watch 的降级方式与"工作区不可写"完全一样：
  只有进程内通知，外加一行日志。
- 事件流跟随的是**团队记录与 teams 索引**。sidecar 文件（暂存计划、契约、hold、信箱）不由它推送。
- `revision` 是**按进程**的。两个进程服务同一个工作区时，各自数自己的窗口。

## 语义

- **计划是评审点，不是队列。** `agent_teams_plan {action:"create"}` 只写计划就返回；唯一能造出队友的动作是 `agent_teams_plan {action:"approve"}`。
  `dry_run: true` 会如实报告批准将要做什么，但什么都不做。
- **每个会话只有一份暂存计划。** 再次暂存会替换未批准的那份（旧的进归档）；替换**已批准**的计划需要
  `replace: true`，因为那是一个刻意的动作。
- **批准的"报告"是事务性的，"效果"不是。** 先起成员，再投任务，其中 `blocked_by` 由计划里的主题解析为已投任务的
  id，`owner` 由暂存成员名解析为已生成的 id。失败即停下并指明停在哪一步——已完成的部分保留并上报，**绝不回滚**，
  因为已经起来的队友无法"取消生成"。
- **一次批准同时启动三套机制。** 团队记录写好——这是批准返回前的最后一个动作——之后，批准还会经可选的 `mpdGoal` 服务锚定本 wave 的
  **持久化目标**（objective 取 `plan.description || plan.name`，source 为 `team`），并在调用方自己的视图里注册了
  `todo_write` 时，按每个暂存任务各写一条 `pending` 待办。两者都是**在批准已经成功之后追加**的效果：只有真正执行
  `approve` 的路径才会走到（`create`、`dry_run` 和空壳拒绝都到不了这里），被拒绝或抛错只写**一行日志**，
  绝不让批准失败。待办写入是**整表替换**——在批准这一刻是正确的，因为它开启新的 wave——所以没有任务的计划不会写入，
  也就不会清掉队长已有的清单。
- **契约是任务被认领那一刻的"含义"。** `attempt` 按任务单调递增，是"这是 t4 的第几次尝试"唯一的答案：官方看板的
  `revision` 会因任何改动而前进，因此不能替代 attempt。
- **暂停不是结束。** 它只记录一次 hold；不打断任何成员，也不归档任何东西。
- **信箱是我们自己的**，因为官方那个答不了队长真正要问的问题。它持久化的只有 `messages` 和 `delivered`，
  "已读"在它那里**无处可观测**，所以"对方到底**看见**没有"没有答案。`agent_teams_mail` 自己拥有
  `sent → delivered → read` 全生命周期：记录写在 `<workspace>/.mpd/team/mailbox.jsonl`（**只追加**，所以崩溃最多丢最后一行、
  绝不丢整个文件），投递仍走官方传输以保证成员真的收到，而 `read` 是接收方的**显式确认**。
- 从官方实现**吸收**的精华（每一条都是在那边吃过亏换来的）：消息**定向**给按名字解析出的活成员；成员不能给自己发；
  成员的**未投递积压有上限**（官方是 `TEAM_MAILBOX_FULL`）；队列保持插入顺序。
- **一切按工作区定位**，经 `dsh.workspaceRoot(exec)`，绝不用进程 cwd。

### 嵌套团队（子单元）

团队**记录**可以携带 `parentTeamId`，这一个增量字段就是全部拓扑：它命名本团队所属的上级团队，而**缺省**即根团队
——完全不写这个键，所以嵌套团队出现之前创建的记录读起来与从前一致。嵌套团队的其它一切都不变：名册、看板、阶段与
生命周期都属于它自己。

**接缝是推导出来的，不是传进来的。** 没有任何 `agent_teams_plan` 动作接受父级参数。审批时按记录推导父级，三条规则
各有测试：

- 被上级团队**名册**记录的会话（按执行器给它铸的 handle，或按成员名）新建的团队嵌套在它之下——这正是被晋升的副队长
  的情形；
- **领导**某团队的会话永远不会嵌套进自己的团队，因此队长的下一波是**兄弟**，而不是上一波的子级；
- **非存活**的团队（已结束，或其暂存计划未经批准就被归档）永远不会成为父级，所以子团队不会出生在已收尾的一波里。

一个会话被**多个**存活名册记录时，盒子就是歧义的，审批会**拒绝**并点名这些团队，而不是猜。被手工改成环状的父链
（任何工具都写不出）同样拒绝并点名环，否则投影将永不终止。

**投影是一棵盒子树。** `mpdTeams.graph(workspace, teamId)` 遍历记录，把每个存活后代转成 `GraphGroupInput`，交给
`mpd-graph-core` 合并：`GraphModel.groups` 扁平且浅层在前，每个组同时是其父框架里的伪节点（`visual: "group"`），
内部节点的 `depth` 是它在**自己框架内**的列，而 `ranks` 仍只装根框架——因此 `/plugins/mpd-team/state` 上某个任务的
`rank` 依旧是**外层** rank。没有存活子团队时不提供任何分组，其模型与本行在嵌套团队出现之前提供的模型逐字节相同。

**ID 需要限定，因为每个团队都从 `T1..Tn` 铸号。** 嵌套团队的行以 `<teamId>::<taskId>` 进入模型（与
`dispatch.ts#ledgerKey` 同一拼法），根框架的 ID 保持**裸**；指向同一框架内任务的 blocker 随之一同限定，其余
原样保留——它们本就是跨框架引用，正是锚定到盒子边框的那条边的落点。子单元的**计划文档**不会合并进它的盒子：
计划 markdown 是工作区文档，把父级的计划幽灵画进子级会歪曲该子级自己声明过的东西。

cellwork 在被晋升的副队长注册子单元时，把父**单元**的 team id 记到子单元上（`parentTeamId`），于是单元日志可以
对照着读；子团队自身的链接仍然是团队平面的推导结果，绝不是第二份副本。

## 配置

无。本插件只声明 `tools` 与 `commands`，并全部经 adapter 解析。

## 已知边界

- 暂停会**停住派工**（`agent_teams_dispatch` 整趟拒绝并说明原因），别的什么都不做：不打断成员，也不改任务。
- `agent_teams_dispatch` 每趟只把一个任务配给一个成员，并把配对记进 `.mpd/team/dispatch.json`，所以第二趟不可能把同一个
  任务再交给另一个队友——**消息不是台账**。台账**按团队分键**（每行 `teamId::taskId`），所以同一工作区里两个团队即使铸造出
  相同的任务 id 也不会互相遮蔽；团队记录进入终态后其台账行会被清理，分键之前留下的裸键行会在第一趟被丢弃并报告。
  `release` 释放配对，**同时**把任务行退回 `pending`（清空负责人与开始时间），被释放的任务因此可以重新派工。
  **谁能释放，用的就是关闭闸那把尺：该团队的 Lead，或任务自己的负责人。** 未获授权的释放会在释放配对**之前**被拒绝，
  所以队友既不能重开、也不能注销别的成员的任务行。
  被删除或已在外部完成的任务，其台账条目会先被清理，成员因此永远不会被"永久占用"。**成员结算**会在成员不再持有任何未关任务时
  把它写成 `inactive`——`complete`/`fail` 之后确定性地做一次，以及在该成员自己的回合边界上做一次——这正是推导出的阶段能到达
  `idle`、压缩流程能看见"已完成的团队"的前提。它由队长或调度 lane 调用时运行，**不是一个后台定时器**。
- `agent_teams_plan {action:"approve"}` 无法回滚。
- **官方**收件箱没有未读数：它的持久状态是 `messages` + `delivered`，已读状态在其中任何地方都不可观测，因此从**那个**平面硬造一个计数只会报错数。这只是官方平面的限制：mpd 自己的信箱会统计未读（`unreadOf`、`summarise` → `MailSummary.unread`，按最旧优先计算），并由 `agent_teams_mail {action:"unread"|"summary"}` 报告出来。
