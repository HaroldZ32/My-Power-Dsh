# mpd-team-core-plugin

[English](./README.md) | **简体中文**

官方 Agent Teams 运行时之外的**工作流**。Harness 0.1.7-rc.2 的官方插件只管团队本身——名册、共享看板、信箱、
可续接的队友——别的都没有。而被退役的自研体还带有队长真正要用的那些评审点：一支在**任何人存在之前**就能被阅读、
编辑、批准的暂存计划，认领时冻结的任务契约，暂停，以及归档。这些东西现在住在这里。

名册与看板**绝不**复制：它们始终属于官方服务，经 `mpd-dsh-adapter` 读写。本插件只保存官方服务没有字段承载的
东西，位置是 `<workspace>/.mpd/team/`。

## 工具

| 工具 | `action` 取值 | 作用 |
|---|---|---|
| `agent_teams_plan` | `create`、`add_member`、`create_task`、`edit`、`approve`、`delete`、`status` | 把团队暂存成**计划**；`approve` 通过**团队执行器**执行它（原生后端 `ctx.subagents.startContinuable` 是**默认**，官方 `dsh.team*` 调用是**回退**），并按 mpd 记录解析 `blocked_by`/`owner`；0 成员且 0 任务的计划会被**拒绝**；`delete` 归档；`status` 在该后端生效时把记录与官方读数并排给出 |
| `agent_teams_task` | `claim`、`contract`、`release` | 在官方看板认领**并**冻结契约（单调 `attempt`）；读回契约；释放已派发任务 |
| `agent_teams_dispatch` | `run`、`release` | 把就绪任务与空闲成员配对、通知成员、并**记录配对** |
| `agent_teams_mail` | `send`、`unread`、`read`、`summary` | 团队信箱：durable，且带官方**给不了**的已读状态 |
| `agent_teams_control` | `halt`、`resume` | 只停派工、别的什么都不做的暂停 |

`/agent-teams <这支团队是干什么的>` 按当前目标暂存计划。

**为什么用 action 而不是更多工具。** 每个工具的名字、描述和参数 schema **每一轮**都在模型上下文里。手写的界面一度长到
**14 个工具、7,643 字符（约 1,900 token）**——还一个字都没提任务；而这些动作本就是**同一条工作流的步骤**，所以现在是
`action` 取值：**5 个工具、4,717 字符（约 1,180 token）**。`test/tool-surface.test.ts` 同时钉住预算和 action 集合，
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

- **计划是评审点，不是队列。** `agent_teams_create` 只写计划就返回；唯一能造出队友的动作是 `agent_teams_approve`。
  `dry_run: true` 会如实报告批准将要做什么，但什么都不做。
- **每个会话只有一份暂存计划。** 再次暂存会替换未批准的那份（旧的进归档）；替换**已批准**的计划需要
  `replace: true`，因为那是一个刻意的动作。
- **批准的"报告"是事务性的，"效果"不是。** 先起成员，再投任务，其中 `blocked_by` 由计划里的主题解析为已投任务的
  id，`owner` 由暂存成员名解析为已生成的 id。失败即停下并指明停在哪一步——已完成的部分保留并上报，**绝不回滚**，
  因为已经起来的队友无法"取消生成"。
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

## 配置

无。本插件只声明 `tools` 与 `commands`，并全部经 adapter 解析。

## 已知边界

- 暂停会**停住派工**（`agent_teams_dispatch` 整趟拒绝并说明原因），别的什么都不做：不打断成员，也不改任务。
- `agent_teams_dispatch` 每趟只把一个任务配给一个成员，并把配对记进 `.mpd/team/dispatch.json`，所以第二趟不可能把同一个
  任务再交给另一个队友——**消息不是台账**。被删除或已在外部完成的任务，其台账条目会先被清理，成员因此永远不会被"永久占用"。
  它由队长或调度 lane 调用时运行，**不是一个后台定时器**。
- `agent_teams_approve` 无法回滚。
- 信箱没有未读数：官方收件箱不暴露已读状态，硬造一个只会报错数。
