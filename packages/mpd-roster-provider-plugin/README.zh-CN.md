# mpd-roster-provider-plugin

[English](./README.md) | **简体中文**

为**官方 Agent Teams 回退路径**提供逐成员模型路由。本行是**历史**接线：在**默认**组合里它**不路由
任何东西**，因为原生 `TeamExecutor` 自己解析团队成员**自己的** `agentRoutes` 条目，而抵达本包 provider
的官方 `spawn_teammate` **工具**已在工具边界被**拒绝**。默认规则是：成员**自己的** `agentRoutes` 条目按
身份优先级 `role` → `description` 的头部 → 整个 `name` 解析；匹配不到的成员、或没有可用路由的成员，会
**继承暂存它的会话的路由**（顶层 spawn 是 captain 的，team-lead spawn 是 Lead 的），只记一行日志、绝不
抛错。本包仍是“运行官方执行器、且其**行**直接经团队服务升起队友”的组合里那条受限回退：在那里官方
`TeamService` 只转发 `{ prompt, parent }`，所以它在队友的描述符 label 点名某位成员时施加该成员的路由。

**边界。** 五个官方**创作类**动词 —— `spawn_teammate`、`team_task_create`、`team_task_list`、
`team_task_get`、`team_task_update` —— 在工具边界被**拒绝**，且 mpd **记录**是唯一的任务板（入口是
`agent_teams_plan`，由 `agent_teams_task` / `agent_teams_dispatch` 驱动）。因此这里的路由服务于
**行**直接调用团队**服务**所升起的队友（官方执行器回退路径）：那不是工具调用，**不受**这道门约束 ——
而**默认**（原生执行器）组合根本不会走这条路径。

agent 路由是**唯一**的路由来源（契约 `.mpd/plans/agent-routes-per-agent.md`）：不存在持久化的槽位，四个
分组只是 `/mpd-model` 的批量编辑快捷方式，会写入每个成员自己的条目。在**这条路径上**，名册成员的路由
未配置或格式错误时，会用结构化的 `AGENT_UNCONFIGURED` 失败**拒绝** spawn —— 在 `base.start` 之前抛出，
因此本组合自己的 provider 根本不会被触达、也不会启动任何子会话；该 agent 自己的 `fallbacks` 链在应用
路由前只消费一次（目录正面列出的第一条胜出）。label 没有点名任何名册成员的队友按原样透传（继承），而
由扩展贡献的 role 属于 `unrouted` —— 它保留自己的链并照常 spawn。**默认**的原生执行器不抛错：它会继承
暂存会话的路由，只记一行日志。

## 原理

harness 本身（不同于它的 team service）并不是限制所在：

- `SubagentContinuationManager.startContinuable` 会把 `request.agentOptions` 解析成
  provider/model/reasoningEffort 并交给 **provider**，而构造这次 run 的正是 provider；
- provider 是一个插件自己能注册的小类（`ctx.subagents.registerProvider`）；
- provider 的**名字来自行配置**，不是工具参数：官方 `spawn_teammate`（现已在工具边界被**拒绝**）
  永远发送 `provider: context === "fork" ? config.forkProvider : config.freshProvider`，而直接经团队
  服务升起队友的行解析同一份行配置。

因此本包注册一个名为 `mpd-roster` 的 provider，它**委托给组合里原有的 provider**，并在途中施加该成员的槽位路由；
bundle 把自己那条 `mpd-tool-agent-team` 行的 `freshProvider` 指向它。

## 队友是哪个成员

team service 不转发任何名字——`request` 只有 `{ prompt, parent }`——所以**这条路径上**的身份通道是描述符的
**label**，也就是队友的 `description`，而且只读取它的**头部**。**默认**的原生路径有三条通道，按此顺序读取：
`role` → `description` 的头部 → 整个 `name`。适配器里的 `rosterNameHead` 是**唯一**的头部切分实现，
因此两条路径不可能对“description 的头部”有不同的理解。契约为：

> 身份点名了名册成员的成员，按该成员的槽位路由；匹配不到的成员、或槽位未配置的成员，会**继承暂存它的
> 那个会话**的路由（顶层 spawn 是 captain 的路由，team-lead spawn 是 Lead 的路由）。提示词文本无法创造身份。

名字取第一个分隔符（`—`、`–`、`:`、`|`、` - `）之前的文本，大小写不敏感、**长名优先**：所以
`"Senior Engineer — implements the parser"` 会路由 Senior Engineer，而 `"check the vendored corpus"`
谁也不路由。匹配刻意保守：猜错就等于把一个队友悄悄换到没人选的模型上。

## 成员属于哪个槽位

直接**导入** `mpd-config-plugin` 的 `TEAM_MODEL_SLOT_GROUPS`——也就是两个设置前门渲染的**同一份**声明，
绝不重述：

| 槽位 | 成员 |
|---|---|
| `slot1` | Architect、Planner、Reviewer、Lead、Senior Engineer |
| `slot2` | Researcher、Explorer、Plan Reviewer |
| `slot3` | Deep Worker、Junior Engineer |
| `slot4` | Vision Analyst |

## 失败行为

在官方**服务**路径上，成员**有**槽位、但该槽位的 provider 或 model 未设置时：**那次 spawn 大声失败，
点名成员与槽位**，不写任何状态，**绝不 clamp effort** —— 一次性路径早已遵守的规则。在**默认**的原生
组合里，槽位绝不可能让队友失败：不可用的槽位只记一行日志，该成员继承暂存会话的路由。身份没有点名任何
名册成员的队友不会被本包路由：它按原样透传。

### 推理强度适配

槽位是按 schema 默认值**物化**读取的，因此若队友被路由到的模型在实时目录里**完全没有**推理等级，
它本会拿到槽位的默认 `max`/`high` —— 这是任何 provider 都无法接受的关键字，会让该次调用失败。
委托之前，`start()` 会把解析出的路由交给适配器的 `withSupportedEffort`：它**只丢弃**这一个关键字
（并记日志），其余路由一律不动 —— 声明了推理等级的模型即使该等级不被支持也照旧保留，因为那属于
应当被看见、而不是被掩盖的配置错误；而模型未知或目录读取降级都不构成任何证据。该等级**永远不会**
被替换成别的值，因此这不是 clamp。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `baseProvider` | `spawn` | 委托真正落到组合里的哪个 provider |
| `enabled` | `true` | 设为 `false` 则不注册 provider（所有队友都继承） |

## 已知边界

- 路由在 **spawn 时**按当时配置解析；改槽位影响的是下一个队友，不是已经在跑的那个。
- 身份没有点名任何名册成员、或槽位未配置的队友，会**继承暂存它的那个会话的路由**，原生执行器只记一行
  日志。在这条官方路径上，唯一的身份通道是 team service 转发的描述符 label，所以提示词文本无法创造身份。
- 在**默认**组合里本包不路由任何东西：决策归原生 `TeamExecutor`。
