# mpd-team-watchdog

[English](./README.md)

一个 DSH cordis 插件，用于发现 AgentTeams 团队中**卡死的回合**：某个成员（或队长）不再推进，
却也永远不会结束。它按**模型步**和**工具调用**写入心跳，把静默升级为 **WARN**，对同一
task+attempt 连续三次 WARN 升级为 **ESCALATE**，保存可恢复的**现场快照**，并且只为受影响的
那一个团队写下持久的、**保留现场**的 hold。

本包是该能力的**核心**，刻意保持窄范围：它只负责写入器、状态机、存储和自己的动作。真正让
hold 生效的 adopted 派发闸门、以及展示它的 Web/TUI 界面，属于后续任务。

## 为什么需要它

这个插件针对的实测事故：某成员最后一次产物写入发生在 16:32:37，而运行时仍报告 `running`、
也没有残留子进程，直到 16:52:49 才被人发现——大约二十分钟里没有任何人在驱动这个团队。当时
已有的两个机制都不会报警：provider 的 `idleWatchdog` 只在流尚未返回时武装，而调度器的 idle
边沿因为运行时仍报 `running` 从未触发。唯一能见证这种形态的，是一个读取**持久化**心跳的
进程级 tick。

## 状态存放位置

所有内容都位于**当前会话的工作区**之下（每次调用都通过 adapter 解析——绝不缓存，也绝不
假设是 `process.cwd()`），与 adopted 的团队记录并列。adopted 的 `team.json` 始终只有
`state.js` 一个写入者；本包只读它。

```
<workspace>/<stateDir>/<teamId>/team.json                          adopted，本包只读
<workspace>/<stateDir>/watchdog/heartbeat/<memberKey>.jsonl        每行一条心跳
<workspace>/<stateDir>/watchdog/scene/<teamId>/<iso>.json          每次事件一个不可变文件
<workspace>/<stateDir>/watchdog/scene/<teamId>/latest.json         重启后读取的指针
<workspace>/<stateDir>/watchdog/hold/<teamId>.json                 持久 hold 副文件
<workspace>/<stateDir>/watchdog/incidents.jsonl                    每次 WARN/ESCALATE 一条记录
<workspace>/<stateDir>/watchdog/read-watermark.json                每个读取者的确认水位
```

`<stateDir>` 默认为 `.mpd/team`（与 adopted 插件相同的默认值），可在本行配置中修改。

## 心跳

| 时机 | 宿主信号 | 记录 |
|---|---|---|
| 每个模型步 | `agent/pre-step` | `{kind:'step', at, member, taskId, attemptId, …}` |
| 每次工具调用完成 | adapter 的 POST 钩子（`onPostToolExecute`） | `{kind:'tool', at, tool, callId, …}` |
| 回合开始 | `agent/session-start`（或首个 step） | `{kind:'turn-start', …}` |
| 回合结束 | `agent/turn-stopping` | `{kind:'turn-end', …}` |

成员**和队长**走的是同一段代码：依据 agent id / `captainSessionId` 在团队记录中解析出成员名
（或 `captain`），任务则取该成员当前未终结的任务。不属于本工作区任何团队的 agent 也会被
记录，只是落在按会话生成的键下——文件名键始终互不冲突。

心跳文件在 `turn-end` 时轮转：只保留最近 `keepGenerations`（默认 3）代，因此长时间运行的
成员不会让文件无限增长。

### step 记录的诚实边界

`agent/pre-step` 在该步的模型调用**之前**触发，所以一条 `step` 记录只表示“这一步开始了”，
不表示“模型回答了”。流在中途卡住时，最近仍会有一条 step 记录。这个盲区宽度为一步，这里
如实写出而不是隐藏；静默判断取**任意类型**的最新记录，而真正卡死的回合同样不会再产生新的
step。

工具记录**只在调用完成后**写入。本包没有派发前记录：adapter 的 `onPostToolExecute` 在调用
返回后触发，而派发前记录需要在 adapter 里包装 `tools/execute`（属于后续任务）。

## WARN → ESCALATE 状态机

```
OBSERVE（每个 tickIntervalMs）
  silence = now - newestStamp(owner, task)
  若该 owner 的回合仍在进行中 且 silence > warnSilenceMs：
      WARN(task, attemptId)     -> 现场快照 + 事件记录
      streak[task+attempt] += 1
      若 streak >= warnStreakToEscalate：
          ESCALATE(task, attemptId) -> 快照 + HOLD(team) + 事件记录
          该键此后终结：不会出现第四次 WARN，也不会出现第二次 ESCALATE
  否则：
      streak[task+attempt] = 0
```

streak 以 `<taskId>\0<attemptId>` 为键，因此换用新 attempt 的重试从零开始。**静默候选不是
所有未终结任务**：一个 `claimed` 任务若其 owner 本就处于回合之间，它的静默是设计使然，对它
连续三次 WARN 会把健康团队误升级。因此候选要求 owner 至少为该任务写过一次心跳；一次都没有
写过的 claimed 任务会被报为 `never-started`——这是派发问题的观察，永不升级。

### 旋钮

`mpd` settings 命名空间是实时权威，本行配置是默认层。五项都会在**每个 tick**以及
`settings/document-updated` 时重新读取，因此热修改无需重启宿主即可生效，而改变节奏会替换
那唯一的定时器。之所以按 tick 重读是有意为之：`mpd` 命名空间是**延迟注册**的（mpd-config
把注册挂在 settings 服务上），若本行先完成 apply，在此之前就只能停留在自身默认值上，直到
有人编辑 settings。

| 旋钮 | 默认值 | 含义 |
|---|---|---|
| `watchdog.warnSilenceMs` | `90000` | 静默超过该值即 WARN |
| `watchdog.tickIntervalMs` | `15000` | tick 周期；`>= warnSilenceMs` 时会被**收敛** |
| `watchdog.warnStreakToEscalate` | `3` | 同一 task+attempt 连续 WARN 次数达到即 ESCALATE |
| `watchdog.actionOnEscalate` | `pause` | `pause` 写 hold；`warn-only` 只记录 |
| `watchdog.enabled` | `true` | 总开关（`MPD_DSH_TEAM_WATCHDOG=off` 可强制关闭） |

这些旋钮在 `mpd-config` schema 与 Web 卡片自身 `FIELDS` 列表中的声明属于**那些包**，不在
本包。由于 schemastery 会保留未知键，在该声明落地之前，`watchdog` 段就已经可以经由命名空间
读取；那项声明的作用只是让两个前端能显示与编辑它。

## 现场快照

每次事件一个不可变文件，外加一个 `latest.json` 指针；写入采用临时文件 + rename，因此不可能
读到撕裂内容；字节完全相同时直接跳过（同一状态写第二次不改变任何字节）。字段集恰好为：

```
{ schemaVersion, at, reason:'warn'|'escalate', cause:{kind:'silence', ms},
  team:{ id, name, phase, halted, haltedAt, hold },
  tasks:[{ id, status, assignee, attempt, attemptId, lastSeen, streak }],
  members:[{ id, name, status, unread, currentTask, lastSeen }],
  mailbox:{ <reader>: watermark },
  parkedAttempts:{ <memberId>: <attemptId> },
  incidents:[{ id, kind, at, taskId, attemptId, scene }] }
```

若快照位置不可写，失败是**响亮但非致命**的：一条具名告警带上路径与 errno，hold 仍会被尝试，
事件记录仍然写入——因为拿不到快照的用户仍然必须知道团队已被 hold。

有两个字段是诚实的投影，而非 adopted 插件自身的状态：

* `members[].unread` 镜像 adopted 的未读判定（`state.js:845-855`），因为 adapter 没有暴露
  对应的接缝。
* `parkedAttempts` 是**持久化**投影（每个未终结任务的 assignee → attemptId）。adopted 调度器
  的进程内 `Map` 无法经 adapter 访问，而设计本身也把它视为参考信息。

## hold、事件记录与水位

* `hold/<teamId>.json` = `{id, teamId, since, cause, taskId, attemptId, sceneAt}`。写入采用
  临时文件 + rename，以 `id` 幂等，并且是一个**保留式** hold：它的存在是为阻止向某一个团队
  派发**新**工作，绝不用于取消已有工作。它不是 `agent_teams_halt`（后者会取消所有未终结任务）。
* `incidents.jsonl` = 每个 WARN/ESCALATE 一条记录，含原因、task/attempt、所写快照路径，以及
  `hold: 'applied' | 'not-applied' | 'not-requested'`。
* `read-watermark.json` = `{<reader>: <lastAckedIncidentTs>}`。只有显式确认才会推进水位，因此
  没有确认时就是永久重放——这是设计使然，并且明确写出。

已被 hold 的团队**不会再写第二个快照、也不会再写第二个 hold**；事件记录仍会写入。

## hold 的执行机制 —— w7 查询的读取器

**明确选择方案 (b)**（计划 AMENDMENT 2 的 A2-1）：单独的副文件**无法**真正执行暂停，因为
`state.js` 拥有 `team.json`、所有读取路径都经过 `readTeam`，调度器的三个拒绝闸门对副文件
完全不可见。因此本包把副文件保留为**持久且权威**的记录，**并通过 `mpdWatchdog` 服务发布一个
稳定的同步读取器**。方案 (a) 在 adopted 锁定路径上的写入属于 w7 的工作，不属于本包。

闸门必须使用的确切调用形式：

```js
const watchdog = ctx.get("mpdWatchdog", false)          // 本行缺失时为 undefined
const hold = watchdog?.isHeld(teamId, workspace)         // 同步，绝不抛异常
if (hold?.held) return noteDispatchDecline(/* … */, "held by the team watchdog")
```

读取器契约：

| 成员 | 签名 | 含义 |
|---|---|---|
| `isHeld` | `(teamId, workspace?) => { held, holdId, at, reason, taskId, attemptId, workspace, source }` | 闸门据以分支的答案（`held` 是它**必须**测试的唯一字段） |
| `holds` | `(teamId, workspace?) => boolean` | 简洁形式 |
| `list` | `() => Array<{workspace, teamId, holdId, since, cause, taskId, attemptId}>` | 只读诊断 |
| `hydrate` | `(roots?) => number` | 重新扫描 hold 目录；apply 时调用，也可按需调用 |
| `hydratedRoots` | `() => string[]` | 已扫描过的工作区 |
| `gateCall` | `string` | 文档化的闸门表达式，使契约随代码一起流动 |

闸门可以依赖的三条性质，均被明确写出而非暗示：

* **失败开放（fail-open）。** 本行缺失时服务即缺失，`isHeld` 永不被调用，派发行为与今天
  **完全一致**。watchdog 只能**追加**一次拒绝，绝不会因为自己的行加载失败而让团队一直停着。
  出于同样原因，每个成员都保证不抛异常——拒绝闸门运行在调度器的热路径上。
* **跨进程。** 内存映射在 apply 时从本进程已知根目录下的所有 hold 文件水合，并在本进程每次
  hold/resume 时更新。映射未覆盖的团队会用**一次**小文件读取来回答，这正是**第二个**进程
  得知另一个进程写入的 hold 的方式（无需重启，也不要求写入方还活着）。
* **请传入工作区。** 一个宿主服务多个会话，而团队 id 只在其工作区内唯一；
  `isHeld(teamId)` 不传工作区时只依据内存回答，仅在单工作区宿主上正确。

## 插件自己的动作

通过 adapter 的工具接缝注册，因此 w7 可以驱动它们，而本包无需触碰 adopted 插件：

| 动作 | 契约 |
|---|---|
| `session-watchdog-hold` | 为一个团队写入保留式 hold；无法写入时返回 `applied:false`（绝不抛异常），因此调用方无法把未落地的暂停报告成已生效 |
| `session-watchdog-resume` | 清除它；未处于 hold 的团队是**无操作**（`reason:'not-held'`），绝不是错误 |
| `session-watchdog-status` | 只读：本工作区的 hold、心跳尾部、事件记录与水位 |

tick 在 ESCALATE 时经由 adapter 的内部工具接缝调用 `session-watchdog-hold`（只有在接缝不可达
时才回退为直接写入，并给出告警）。

## 失效保护

* tick 主体绝不向外抛异常：任何错误都会被捕获、计数并记录；
* 只有一个 interval 掌管节奏，并通过 `ctx.effect` 清理；
* 上一次 tick 尚未结束时启动的 tick 会被**跳过**，绝不排队；
* 状态没有变化的 tick 不写任何内容（没有写入循环）；
* 心跳或快照位置不可写时降级为计数失败 + 具名告警；
* 幂等 hold 在无法持久化时绝不会被宣告为已生效。

## 未声明项（本包刻意不做的事）

* **不做派发闸门。** 在 adopted 调度器各拒绝点让 hold 生效、以及在 hold 期间拒绝认领的工具
  边界守卫，都是 **w7** 的工作。本行只落地 hold、其持久记录，以及使它可被执行的读取器；
  adopted 树中没有被修改。
* **不做通知界面。** Web 横幅/活动记录与 TUI 状态行、对话框属于后续任务。这里的“记录即通知”
  就是持久事件记录，供那三个读取者消费。
* **没有派发前的工具记录**（只有 POST，见上文）。
* **不中止正在进行的回合。** hold 只阻止新派发；只有真正的聊天打断才能结束卡死的回合。ESCALATE
  之后恢复过来的成员会发现团队处于 hold、无法推进——这正是预期结果。
* **这里不做真实卡死验证。** 单元测试用注入时钟与 stub adapter 驱动机器；故障注入与真实卡死
  通道属于其他任务。
* `parkedAttempts` 与 `unread` 是上文所述的投影。

## 验证

```
bun run typecheck
bun test packages/mpd-team-watchdog-plugin
node scripts/verify-rows-parity.mjs
bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
node skills/dsh-qa/scripts/preset-conformance.mjs
```

## 文件

| 路径 | 作用 |
|---|---|
| `src/index.ts` | cordis 行：仅 `name` / `Config` / `apply` |
| `src/engine.ts` | 写入器、tick 与 WARN/ESCALATE 扇出 |
| `src/machine.ts` | 旋钮与 WARN→ESCALATE 算术 |
| `src/store.ts` | 心跳文件、轮转与原子写入 |
| `src/team.ts` | 对 adopted 团队记录的只读视图 |
| `src/scene.ts` | 现场文档、原子写入与未读镜像 |
| `src/sidecars.ts` | hold、事件日志与读取水位 |
| `src/actions.ts` | 三个工具动作 |
| `src/paths.ts` | 所有路径，按调用解析 |
