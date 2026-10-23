# mpd-roster-provider-plugin

[English](./README.md) | **简体中文**

为**官方 Agent Teams 队友**提供逐成员模型路由。队友跑在**暂存它的那个会话**的路由上，而官方
`TeamService` 只转发 `{ prompt, parent }`——于是能路由一次性咨询路径的 mpd `teamModels`
槽位，没有通道能作用到队友身上。本包在不 fork 官方插件的前提下补上这一点：当队友的 `description`
**点名**某位成员时，就施加该成员的槽位路由。

**边界。** 五个官方**创作类**动词 —— `spawn_teammate`、`team_task_create`、`team_task_list`、
`team_task_get`、`team_task_update` —— 在工具边界被**拒绝**，且 mpd **记录**是唯一的任务板（入口是
`agent_teams_plan`，由 `agent_teams_task` / `agent_teams_dispatch` 驱动）。因此这里的路由服务于
**行**直接调用团队**服务**所升起的队友（官方执行器回退路径）：那不是工具调用，**不受**这道门约束。

槽位是**唯一**的路由来源（契约 `.mpd/plans/slot-single-source.md` §6）：`agentRoutes` 已删除；槽位未配置
或格式错误时，会用结构化的 `SLOT_UNCONFIGURED` 失败**拒绝** spawn —— 在 `base.start` 之前抛出，因此本
组合自己的 provider 根本不会被触达、也不会启动任何子会话；槽位自己的 `fallbacks` 链在应用路由前只消费
一次（目录正面列出的第一条胜出）。`description` 没有点名任何名册成员的队友按原样透传：继承，保持不变。

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

team service 不转发任何名字——`request` 只有 `{ prompt, parent }`——所以身份通道是描述符的 **label**，
也就是队友的 `description`。契约为：

> 描述里**点名**了名册成员，就路由该成员；其他队友跑在**暂存它的那个会话**的路由上（顶层 spawn 是
> captain 的路由，team-lead spawn 是 Lead 的路由），且提示词文本无法改变路由。

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

成员**有**槽位、但该槽位的 provider 或 model 未设置时：**spawn 大声失败，点名成员与槽位**，不写任何状态，
**绝不 clamp effort**——一次性路径早已遵守的规则。label 没有点名任何名册成员的队友则完全不被路由：
它跑在暂存会话的路由上，也就是本行存在之前所有队友的行为。

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
- label 没有点名任何名册成员的队友不会被路由：它跑在暂存它的那个会话的路由上。这是 team service 唯一
  转发的身份通道的性质，不是策略选择，且提示词文本无法改变它。
