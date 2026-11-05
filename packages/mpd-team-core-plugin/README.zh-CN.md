# mpd-team-core-plugin

[English](./README.md) | **简体中文**

官方 Agent Teams 运行时之外的**工作流**。Harness 0.1.7-rc.2 的官方插件只管团队本身——名册、共享看板、信箱、
可续接的队友——别的都没有。而被退役的自研体还带有队长真正要用的那些评审点：一支在**任何人存在之前**就能被阅读、
编辑、批准的暂存计划，认领时冻结的任务契约，暂停、结束，以及归档。这些东西现在住在这里。

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
| `agent_teams_mail` | `send`、`unread`、`read`、`summary`、`permit`、`wait` | 团队信箱：**一条** durable 流，承载 `message`/`question`/`answer` 记录，且带官方**给不了**的已读状态；`permit` 签发等待授权（仅本队 Lead），`wait` 在该授权内阻塞——完整协议见 [`docs/mail.zh-CN.md`](../../docs/mail.zh-CN.md) |
| `agent_teams_control` | `halt`、`resume`、`fence`、`unfence`、`end` | 只停派工、别的什么都不做的暂停；`fence`/`unfence` 只关闭一个席位；`end` 彻底结束团队（仅 Lead、幂等） |

`/agent-teams <这支团队是干什么的>` 按当前目标暂存计划。

**依赖守卫（mpd 记录面）。** 每次 `create_task` **必须**声明它的依赖答案——`blocked_by: [...]`（数组，可为空：显式声明为根）或 `independent: true`；两者都不给、给非数组、两个别名互相矛盾、自环或有环，一律**拒绝**并点名该任务。`approve` 会**拒绝**两个写作用域重叠（去掉尾部 `/**` 后相等，或在**段边界**上互为前缀；`**` 与 `.` 覆盖全部；空作用域列表永不重叠）、且彼此之间**没有**依赖路径的任务，并引用这一对任务与两种补救：补一条边，或让作用域互不相交。`claim` 会**拒绝**声明阻塞尚未满足的任务，用的是 `agent_teams_dispatch` **同一套**就绪判定；`complete`/`fail`/`release` 仍保持可用；按 OPT-1，**失败**的阻塞仍然释放其依赖方。**这道门在工具边界上已经关上：** 团队之门守卫按完整名称**拒绝**官方五个创作动词——`spawn_teammate`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`——因此没有任何**工具**能在官方看板上创作任务（`send_message`、`list_agents`、`wait_agent`、`interrupt_agent` 保留，用于 agent 之间的通信）。**这条边界只说一次：**直接调用团队**服务**的插件行（官方执行器回退路径）不是工具调用，**不**受这道门约束。**这道门对每一个 agent 都拒绝，且没有任何 preset 豁免——这是刻意的（R18）。** 委派门会放行一个外 preset 的顶层会话；这道门不放行，因为它的对象是**工作区作用域**的看板——每个工作区一份 `.mpd/team/teams/<id>.json` 记录——放行外 preset 会话会让官方看板与 mpd RECORD 在**同一个**工作区里分叉；而且本仓库自己的测量（T-92，`complexity-gate.ts`）表明：部署的顶层会话带有 `agentPreset: "cordis"`，按 preset 放行恰好会放行这道门必须约束的那个会话。mpd RECORD 仍然是唯一的看板，所以以上每条规则都作用于会话通过这些工具能创建的每一个任务。

**空写作用域不再沉默（C4）。** 一个 `work`/`repair`/`integration` 行在暂存或追加时没有 `write_scopes`，
**仍然会创建**，但结果里会带一条 `warning`（渲染在结果自己的句子下方，并声明在输出 schema 里）：它点名
后果——冻结合约不允许任何路径，写作者必须在第一次编辑时停下并向队长请示——与补救——现在就声明作用域，或在
第一次写入之前修改合约，因为批准后再加作用域需要重新冻结并开一个新的验证循环。`requirement`/`review` 行不写
文件、因此豁免，这个字段不会变成噪音。

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

### 原生工具卡片（dsh-Go）

`agent_teams_plan`、`agent_teams_task` 与 `agent_teams_dispatch` 都带有 `output.presentationMeta`，
因此 dsh-Go 客户端会把它们画成聊天记录里的**原生卡片**，而不是通用的工具行：计划工具给出成员数、
任务数、名册与看板；任务工具给出该行、attempt/revision 与依赖方；派发工具给出配对、跳过与移交。
每张卡片都是一棵 **v1** 视图树（带标题的 `stack`，随后是 metric、`keyValue`、表格与短文本），
**没有 `$` 数据绑定、没有 `actions`，也没有 `style` 键** —— 聊天记录既没有数据模型也没有动作通道，
而且更旧的客户端仍然必须能画出来。接缝是
`packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts` 的 `toolCard()`：构建失败、出现 v2 组件，或任一维度超过
**8 KiB / 40 节点 / 深度 6**，都会退化成 `{}`，客户端回落到通用工具行 —— 所以卡片永远不会弄坏一次工具调用。
构建器是 `src/tool-cards.ts` 里的纯函数，单元测试跑的是注册所包装的**同一个**包装器。

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
同一家族里的两条**变更**路由 —— `POST /plugins/mpd-team/approve` 与 `POST /plugins/mpd-team/dispatch`
—— 记录在下面的**动作平面**一节；本节只讲读取/事件流家族。

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

## 动作平面——免 exec 的动作与两条路由

这两段函数体过去内联在 `agent_teams_plan` / `agent_teams_dispatch` 的处理器里，于是唯一能驱动它们的
界面，是带着活的工具调用上下文（`exec.agent`）去 spawn 与 send 的模型回合；浏览器面板、手机、DSH Go
原生面板都没有这种上下文。现在 `src/team-actions.ts` 以两个**免 exec** 的函数持有这两段函数体 ——
相同的校验顺序、相同的存储写入、相同的返回字段 —— 于是同一套序列有三种入口：工具处理器、
`mpdTeamActions` 服务，以及两条 HTTP 路由。这正是「一个按钮」（浏览器面板、手机、DSH Go 原生面板）
能够驱动团队的原因。

### 服务（`mpdTeamActions`）

行以 id `mpdTeamActions`（导出的常量 `TEAM_ACTIONS_SERVICE`）在**工具之前**发布它，因此在本行
激活期间解析该服务的消费方，拿到的一定是活着的成员。

| 成员 | 签名 | 契约 |
|---|---|---|
| `approve` | `(input: { sessionId: string }) => Promise<TeamActionResult<TeamApprovePayload>>` | 以 `sessionId` 那个会话的活 agent 身份，批准它暂存的计划 |
| `dispatch` | `(input: { sessionId: string; limit?: number; dryRun?: boolean }) => Promise<TeamActionResult<TeamDispatchPayload>>` | 为该会话的团队跑**一次**派发；`limit` 为 `0` 或缺省表示不限，`dryRun` 只做配对决策、不发送 |

`TeamActionResult<Payload>` 是 `({ ok: true } & Payload) | { ok: false; error: string; unexpected?: true }`
—— 是**结果**、绝不是 reject：路由必须作答而不是把异常抛进宿主，面板也要能渲染拒绝理由。`unexpected`
标记被捕获的**抛错**（见下文「同一工作区 + 会话同时只跑一个动作」）：句子仍留在 `error` 里供本行日志与
工具路径使用，而路由改为回答通用 `500`，不再转发它。

- `approve` 的载荷：`plan`（真实批准时是已持久化、标记为已批准的计划；`dryRun` 预览时是原样的暂存
  计划）、`team`（它写入的记录；**仅**在 `dryRun` 上缺席）、`created`
  （`{ members: [{ name, id }], tasks: [{ subject, id }] }` —— 批准时是真实 id，预览时为空串 ——
  当某个 blocker 没有指向任何任务时另有 `unresolved`），以及 spawn 中途停下时的 `stoppedAt`。
- `dispatch` 的载荷：`pairs`（传输层真正接受的配对 —— `taskId`、`subject`、`memberId`、
  `memberName`，可选 `note`）、`skipped`（每个未派发的任务，带 `taskId`、`subject`、`reason`），
  以及按需出现的 `forgotten`、`holdRead`、`reaped`、`halted` 或 `refused`。
- **「不活跃」是一个答案，不是抛错。** 活跃注册表不认识的会话，两个成员都答
  `{ ok: false, error: "session <id> is not live" }`；会话无法归属到某个工作区时答
  `{ ok: false, error: <解析器给出的消息> }`。两个成员都不会因为一个坏 session id 抛错。
- **活跃性按会话匹配，而不只按 agent id。** `dsh.liveAgent(sessionId)` 是按 **agent id** 匹配的，因此服务
  与两条路由都会退回到 `liveAgents()` 扫描并匹配 `session.id` —— 这正是 `workspaceRootForSessionOf`
  与 TUI 适配器已有的回退。宿主给 agent 的 id 与它所属会话的 id 不同时，所有界面都认为它活着；拒绝句子
  仍是 `session <id> is not live`，保持不变。
- **caller 就是工具路径的 caller。** 工作区、会话 id、`lineage` 与会话 TITLE 都完全按 `where(exec)` 的推导方式、
  从解析出的活 agent 得出：恢复或被 fork 的 Lead 会带上 harness 记录的父会话，因此服务（以及两条路由）
  解析到与它自己的工具调用**相同**的团队；被记录的**委派子会话**贡献**空** lineage，绝不继承其队长的团队。
- **名册席位由 RECORD 识别，绝不靠猜。** `team-store.ts#memberIdentityOf` 是所有 Lead 校验共用的**唯一**收窄：
  先看会话自己的 id（成员的 `name`/`executorRef`），再看**记录中的祖先**（恢复的会话以成员旧会话为父），最后看
  persona TITLE 是否命中席位的 **role**，其次才是席位的**存储名**（W3-C 绑定的席位里，这个存储名就是 workmate slug，
  所以标题若原样包含它，就认作该席位）。**最长匹配优先**——`Plan Reviewer` 的标题会认作 Plan Reviewer，而不会与
  `Reviewer` 撞车；长度相同的真正歧义仍会判为"是成员、但认不出具体席位"，因此既不借 Lead 祖先、也不能冒充某个席位。
- **被记录的 Lead 绝不会因为标题而被当作成员解析：** 队长身份在标题分支之前判定，所以队长人设里即使出现 roster role，
  也绝不可能被用成员 id 寻址。（被 fork 的 Lead 的新 session id 只有在 churn heal 运行时才会被记录——而 heal 会跳过
  身份面认定为成员的会话，所以标题点名席位的 fork 在该记录上**永远不会**被 heal，会一直按该席位处理（fail-closed），
  只要标题还点名该席位。这是已声明的边界。）

**这两个函数是免 exec 的。** `approveTeam(deps, caller)` 与 `runDispatch(deps, caller, input)`
不读取任何 cordis 上下文、也不读取工具 exec：时钟、执行器、批准副作用、团队解析器、watchdog 读数、
服务查找、行日志、空闲守卫的派发窗口，以及两道批准期守卫，全部经 `TeamActionDeps` 显式传入。
caller 同样是显式值 —— `{ workspace, sessionId, lineage, title?, agent?, signal? }`。动作面带来的差异之一是 agent
缺失：当 `caller.agent` 缺席时，两个函数都在**第一次写存储之前**回答
`{ ok: false, error: "approve needs a live agent" }` / `"dispatch needs a live agent"` —— 不写记录、
不 spawn、不跑批准副作用、不开派发窗口。工具调用方永远带着 agent，因此其行为不变。这道拒绝也正是
路由得以安全存在的原因：路由没有可继承的工具调用上下文，因此它绝不能在「发现自己无法行动」的过程中
去 spawn、send，或把团队写了一半。

**同一工作区 + 会话同时只跑一个动作。** 两个函数都持有一个进程内 in-flight 槽，键为
`workspace + sessionId`，在**第一个 `await` 之前**检查、在 `finally` 中释放。第二个调用方会被**拒绝** ——
`an approval for this session is already running` / `a dispatch pass for this session is already running`
—— 而不是排队：排队会把重复隐藏起来，让操作者看不见。正是它让两次并发批准无法从同一份暂存计划铸出
**两个**团队，也让两次并发派发无法在任何 compare-and-set 拒绝之前把同一配对投递两次。该槽是
**进程内**的：它不协调共享同一工作区的两个 dsh 进程 —— 这是一条明说的边界。

**策略拒绝与意外失败是两种回答。** 函数体返回的那些句子（校验与策略）保持 `{ ok: false, error }`，
路由以 `400` 和该句子作答。任何走到 catch 的异常都会被标记 `unexpected: true` 并保留原消息：存储失败的
文本可能带着文件系统路径，因此 `POST` 路由回答文档化的通用 `500` 并把细节写进本行日志，而**工具**路径
仍然原样抛出真实句子。

### 两条路由（`POST /plugins/mpd-team/approve`、`POST /plugins/mpd-team/dispatch`）

| 路由 | 请求体 | 成功（`200`） |
|---|---|---|
| `POST /plugins/mpd-team/approve` | 会被解析、随后**忽略**；空体或 `{}` 均可 | `{ ok: true, team: { id, name, memberCount, taskCount }, created: string[] }` —— `created` 先列成员的执行器句柄，再列看板任务 id |
| `POST /plugins/mpd-team/dispatch` | `{ limit?: number, dryRun?: boolean }`；`limit` 为 `>= 0` 的有限数字，`dryRun` 为布尔值；空体表示一次不限量的派发 | `{ ok: true, pairs: [{ taskId, memberId, memberName }], skipped: [{ taskId, subject, reason }] }` |

- **会话只来自 `?sessionId=`，不来自别处。** 它由读取路由所用的同一个 `workspaceForRequest` 解析，
  因此请求只会作用于该会话自己的工作组；请求体字段**不能**选择会话（边界处多余的字段会被丢弃）。
  没有点名任何会话的请求是 `400`。
- **顺序就是契约。** 宿主围栏（`dsh.webRequestRejection`，经适配器委托）在方法守卫、请求体流、
  会话查找和存储**之前**先答 `401`/`403`；随后是本模块自己的 `405`（带 `allow: POST`）；再是字节上限；
  再是 JSON 解析与派发体的字段校验；再是会话存在性与活跃性；最后才执行动作。这就是已发布的
  `mpd-team-watchdog-plugin/src/web.ts` 纪律，套用到一次变更操作上。
- **上限是 64 KiB，按原始字节计**（`MAX_ACTION_BODY_BYTES = 64 * 1024` = 65,536 字节），在流式读取时、
  且**在任何解析之前**执行：超限的请求体得到 `413`，永远不会变成 JavaScript 值。空请求体按
  `undefined` 接纳。
- **成功载荷就是上面的窄投影** —— 绝不是存储对象，绝不含路径。

| 状态码 | 何时 |
|---|---|
| `200` | 动作成功；返回上面的投影 |
| `400` | JSON 非法、派发体非法（`limit`/`dryRun`，或请求体不是 JSON 对象）、请求没有点名会话，或动作拒绝（包括工作区无法归属） |
| `405` | 任何非 `POST` 方法；应答带 `allow: POST` |
| `409` | 点名的会话没有活 agent —— 动作**绝不会**执行 |
| `413` | 请求体超过 65,536 字节，未解析即拒绝 |
| `500` | 意外抛错，或动作结果被标记 `unexpected`；客户端只得到**一句**通用话、且不含路径（细节进本行日志） |

两条路由都委托给已发布的 `mpdTeamActions` 成员，而不是第二份序列，因此一个按钮与一次工具调用跑的是
同一个批准或派发过程。只有当组合提供动作面（`actions`）时它们才被注册：一个无法行动的插件行不该
对外宣告一个只会失败的端点，只读组合只挂载读取路由。

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
- **暂停不是结束，`end` 才是。** `halt` 只记录一次 hold：不打断任何成员，也不归档任何东西，因此名册、看板与绑定都还在，`resume`
  可以撤销。`end`（`agent_teams_control {action:"end", team_id?, reason?}`，仅 Lead 可调用）是终局动词：它**经由 store**
  （`endTeamRecord`，即 `writeTeam`）在 mpd 记录上盖下 `phase: "ended"`、`endedAt` 与 `archivedReason`，此后这个团队对所有席位都不再解析——
  派工、认领与邮件都再触不到它，而记录本身作为历史留在磁盘上。重复调用 `end` 是会被报告的 no-op（`changed: false`），
  保留首次结束的时刻与原因。
- **信箱是我们自己的**，因为官方那个答不了队长真正要问的问题。它持久化的只有 `messages` 和 `delivered`，
  "已读"在它那里**无处可观测**，所以"对方到底**看见**没有"没有答案。`agent_teams_mail` 自己拥有
  `sent → delivered → read` 全生命周期：记录写在 `<workspace>/.mpd/team/mailbox.jsonl`（**只追加**，所以崩溃最多丢最后一行、
  绝不丢整个文件），投递仍走官方传输以保证成员真的收到，而 `read` 是接收方的**显式确认**。
- 从官方实现**吸收**的精华（每一条都是在那边吃过亏换来的）：消息**定向**给按名字解析出的活成员；成员不能给自己发；
  成员的**未投递积压有上限**（官方是 `TEAM_MAILBOX_FULL`）；队列保持插入顺序。
- **未投递上限按团队计算，是 workspace 旋钮，而且确认与投递都会释放一个槽位。** 上限是
  `mail.maxUndelivered`（默认 8，`0` 表示关闭；缺失、读不出或不可用的值回退到 8），每次调用都经配置层在
  `cellwork_send` 与 `agent_teams_mail` **共用**的**同一条** `sendMany` 路径上读取 —— 因此两个工具不可能给出
  不同的上限，「改用另一个邮件工具」不是逃生门。拒绝会点名收件人、当前条数、上限与**两条**恢复路径：确认
  收件箱（`agent_teams_mail {action:"read"}` / `cellwork_inbox`），或改派它身后的行
  （`cellwork_dispatch {reassign:[{task_id, owner}]}`）—— 并且不写入任何内容。它统计的是既未被投递、也未被
  确认的行——**一个**共享的 outstanding 谓词同时供发送上限、`summary` 的 `undelivered` 列与 mail 工具的
  `unread` 分支使用，因此三者不可能对「哪些行仍未完成」产生分歧。该上限只统计**认领它的那个团队**的行：退休团队的积压永远
  不能拒绝一个新团队的邮件（成员 id 从 `M1` 重新开始），未打团队戳的历史行不算任何人的。一次传输投递释放恰好
  一个槽位；一次显式 `read`/确认按每个被确认的行释放恰好一个槽位（这是运维唯一可用的释放阀门，不能依赖一个
  卡住的成员永远不会触发的投递）。不带成员名的 `unread` 解析**调用者自己**的成员 id，因此自读不可能悄悄返回
  别人的队列。显式给出的 `member` **必须能解析**：未知名字会被**拒绝**，拒绝信息点名该值并列出名册
  （`"<name>" is not a member of this team (members: …)`），且**不返回任何邮件**——拼写错误绝不会回退到
  调用者自己的收件箱。
- **一条流，三种 kind。** 记录带 `kind`（`message` | `question` | `answer`），外加 `replyTo`/`threadId` 及
  其 kind 指定的载荷；没有 `kind` 的旧记录折叠为 `message`。问题提供**标签**，答案逐字回显这些**标签字符串**
  ——任何地方都没有选项序号，这就是 2026-10-31 relay 缺陷的机械修复。信封、校验器与容错折叠在
  [`mpd-mail-protocol`](../mpd-mail-protocol/README.zh-CN.md) 里；使用者视角、寻址规则与已声明边界见
  [`docs/mail.zh-CN.md`](../../docs/mail.zh-CN.md)。
- **寻址**接受成员 id、成员名、`captain`/`lead`（记录中的 `leadSessionId`，记为 `toName: "captain"`），
  或 `"*"`——广播会为**每个收件人**铸造**一条**记录（全部成员加 lead，排除发送者、去重），共享同一信封与
  线程。没有「多收件人记录」，因此按收件人确认与按收件人上限才诚实；解析结果为空时会被拒绝，而不是回答
  「已发送 0 条」。判断「自己」会同时比对发送者的**两种写法**（roster id 与会话 id），因为记录按 roster id
  寻址，而会话按自己的会话 id 命名自己。
- **确认属于收件人。** `read` 记录 `by`（确认者显示名，折叠为 `readBy`），并拒绝指向他人的 id——**没有**管理
  员后门。后果明说：队长不能代停滞成员清理积压；permit 授予的是**等待**，从不是确认。确认身份是调用者的
  **ROSTER id**（`ownMember.id`；没有 roster 行的 lead 用会话 id）。
- **唤醒是一条 durable 记录，不是进程日志。** 每条记录写入后才会尝试尽力而为的唤醒，其结果追加为
  `{t:"wake", id, sent, reason?, at}`——`sent` 为 false 时 `reason` 必填；没有任何 wake 记录的行意味着尝试
  从未发生（读者必须按「未唤醒」处理）。该形状与 cellwork 面的记录互为规范孪生；两侧各自写哪些原因，在
  [`docs/mail.zh-CN.md`](../../docs/mail.zh-CN.md) 里逐条列出。
- **折叠的问题列表是被暴露的。** 重复的 send id 保留**第一条**写入并**报告**（I8）：异常随折叠状态以
  `problems` 暴露，web 投影会渲染它们。`problems` 在状态上是**可选**的（调用方构造的、只是消息列表的视图不是
  折叠结果），并有三条补偿保证：`fold`/`readMailbox` 总是填充它，`scopeToTeam` 会带着它穿过，两条测试臂
  断言干净日志得到 `{messages: [], problems: []}`。
- **已声明的边界。** 工具从 `question`/`answer` 载荷**推断** `kind`，不提供 `kind` 或 `threadId` 参数（回复
  通过 `replyTo` 归入线程）；直接构造记录的调用方仍可向存储 API 显式传入二者。已注册的工具表面由一条实测
  预算断言：`permit`/`wait` 落地后为 **5,600 → 6,400 字符，实测 6,289**——任何进一步放宽都必须**先**获得队长
  批准。
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

## 空闲成员守卫——没有看板任务的成员不得行动

团队成员唯一的授权来源是看板任务，而这一行把规则落在**工具边界**上，而不是提示词措辞里。如果一个 session 是
某个活跃团队的成员、且**没有**处于打开状态的任务——没有哪条任务的 `owner` 等于它的成员名或 executor handle，
且状态为 `pending`/`claimed`/`in_progress`——逐个 agent 的 `agent/pre-step` 监听就会把它标记为空闲。它只会
收到**一条**指令——"You have no board task. Do not read, run, write, message or claim. End your turn
now."——并且它尝试的**每一次**工具调用都会被拒绝，返回 `[mpd-team] no board task is assigned to you; end
your turn and wait for a dispatch`。由于拒绝本身就是**工具结果**，没有任务的成员无法读源码、跑 shell、写文件、
发邮件、claim、complete 或 reopen 任何东西，直到看板把工作交给它。

- **标记在每一步 pre-step 上双向重估。** 有打开任务就**清除**标记——包括通过本行观察不到的路径送达的任务
  （cellwork 的派发走 `TeamExecutor.send`）——没有打开任务则重新标记。团队记录进入终态（停止/归档）或
  session 已不在名册上，同样会清除。可靠清除点是 pre-step，而不是派发/claim 钩子。
- **正在被派发的成员绝不会被标记。** 唤醒成员的派发 pass 会在整段配对——发送、重读、compare-and-set——
  外开一个带计数的**派发窗口**：native 执行器在发送时会冷启动一个不在线的子代理，而该子代理的第一次
  `agent/pre-step` 可能在 owner 写入之前运行。窗口内守卫既不标记也不拒绝（在这里拒绝 claim 会丢掉正要
  交付的工作）；窗口在 pass 的 `finally` 中关闭，之后的重估就能看到已被 claim 的任务。真正没有任务的成员
  不会进入任何窗口，硬拒绝照旧。
- **保守判定。** 不在任何活跃团队里的 session、团队记录读不出来的 session、团队的 Lead，以及显式登记的
  **控制席位**，都不会被标记。控制席位是 `mpdTeams` 服务上的 `registerControlSeat(sessionId)`——cell 的
  dispatcher 或被晋升的副队长在没有看板任务时需要的那次登记（cellwork 的调用点随 dispatcher 落地）；一个名字
  恰好是 `cell-*` 的普通成员不会因此获得豁免：豁免来自登记，绝不来自名字前缀。
- **已分配但尚未 claim 的任务会保持工具开放。** `pending` 是打开状态；这个不对称是刻意的，因为派发回合必须能
  调用 `agent_teams_task claim`。只有 `completed`、`cancelled` 或 `failed` 任务的成员算空闲。`review` 任务
  按它自己的 `owner` 计数：看板上没有单独的"声明验证者"字段。
- **spawn 前置语是书面层。** `approve` 以及运行中 `add_member` 拉起成员时交给执行器的每一条提示词都会加上同一
  规则的前缀——"You are a team member. You have NO board task yet unless this spawn carries one…"——因此
  spawn 时的回合一开头就能看到它。工具拒绝才是保证；前置语是更便宜的第一层。
- **按 agent 注册，不挂在行上下文上。** `agent/pre-step` 通过 agent 自己的 scope 载体派发：装在**行**上下文上
  的监听在六次真实启动里被实测为静默（2026-09-27）。因此守卫对每个 `liveAgents()` 条目注册，在
  `agent/created` 时补挂、在 `agent/disposed` 时释放；每个回合只注入一条指令（harness 不报告回合序号时按一次
  标记注入一条），所以同一回合里重复的 step 不会再追加第二条。活跃注册表、事件总线或 `tools.guard` 接缝缺失
  时，会降级为一条已报告的缺失，而不是让启动失败。

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
- **空闲标记是进程内的，靠重新检测而不是持久化。** 重启后每个成员会在下一次 pre-step 重新检测；标记期间派发的
  任务会在该成员下一次 pre-step 时清除；派发与清除之间崩溃也会以同样方式重新检测。
- **没有这一行的组合没有守卫。** 检测与拒绝都在本插件里；没有 `mpd-team-core` 的团队只剩下 spawn 前置语那一层
  书面约定。
- **没有惰性 spawn 时，spawn 回合仍要花一次模型回合。** 守卫把它变成一次只有一条指令、零工具的回合，而不是免费
  的回合；惰性 spawn 未实现。


## owner-only 派发、fence、handoff 与占用读数（波次 W1-A）

五个工具**名称**不变，增长的是 `action` 与记录字段。本节就是这些新增能力的契约。

**派发默认 owner-only。** `agent_teams_dispatch` 把就绪任务配给它**声明的** owner。owner 忙碌、缺席、被
fence 或已失败时，该行会被**报告**并保持 pending —— 绝不替换。两个逃生口都仅限 Lead：`mode: "roster"`
恢复按序回退；`reassign: [{task_id, owner}]` 先为该成员在板子上 claim 这些行、记 `task-reassigned`，再投递。
**被阻塞（BLOCKED）的行不可 reassign。值得记住的后果：** `release` 会**清除** owner，所以「先 release
再 dispatch」必须走 `reassign`（或 `mode: "roster"`）—— 这是两个动词的组合语义，不是缺陷。

**席位动词。** `agent_teams_task {action:"context"}` 回答调用者自己的占用与席位状态，且从不猜测窗口：
`provenance` 报 `observed`、`no-window` 或 `unavailable`。`{action:"handoff"}` 校验七段式文档，写入
`.mpd/team/handoff/<teamId>/<member>-<n>.md`，把该成员切到 `mode:"checkpoint"` 并记 `handoff-written`。
`agent_teams_control {action:"fence"|"unfence", member}` 关闭或重开**一个**席位（仅 Lead）；被 fence 的席位
永不被投递，它的行通过 `reassign` 修复。

**服务面。** `mpdTeams` 新增 `memberContext`（单个席位的占用）、`depthBudget`（带环检测的有界父链遍历，
上限取自 `cellwork.depthMax`，默认 3）、`archivedPlans` 与 `cancelTasks`。`mpdTeamActions` 承载无 exec 的
动作 `fence`、`unfence`、`handoff`、`dispatch`，因此面板按钮、服务调用与工具走同一条序列。

**workmate 绑定字段。** 已暂存成员会记录 `workmate`、`workmateMode`（由哪条分支绑定）与
`workmateReason`（原因）；`fenced: false` 会**删除** fence 键，所以「未 fence」在磁盘上只有一种写法。

**工具面预算是一个上界，不是承诺：** 五个 action 型工具加一条命令必须保持在 6,400 字符以内
（`test/tool-surface.test.ts`；A6b 收尾时实测 6,399），且每个工具的**描述**必须低于 700。
