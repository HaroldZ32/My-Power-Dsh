# mpd-roster-provider-plugin

[English](./README.md) | **简体中文**

为**官方 Agent Teams 队友**提供逐成员模型路由。用 `spawn_teammate` 起的队友会继承 **Lead 的**模型路由，
因为官方 `TeamService` 只转发 `{ prompt, parent }`——于是能路由一次性咨询路径的 mpd `teamModels`
槽位，对队友毫无作用。本包在不 fork 官方插件的前提下补上这一点。

## 原理

harness 本身（不同于它的 team service）并不是限制所在：

- `SubagentContinuationManager.startContinuable` 会把 `request.agentOptions` 解析成
  provider/model/reasoningEffort 并交给 **provider**，而构造这次 run 的正是 provider；
- provider 是一个插件自己能注册的小类（`ctx.subagents.registerProvider`）；
- provider 的**名字来自行配置**，不是工具参数：官方 `spawn_teammate` 永远发送
  `provider: context === "fork" ? config.forkProvider : config.freshProvider`。

因此本包注册一个名为 `mpd-roster` 的 provider，它**委托给组合里原有的 provider**，并在途中施加该成员的槽位路由；
bundle 把自己那条 `mpd-tool-agent-team` 行的 `freshProvider` 指向它。

## 队友是哪个成员

team service 不转发任何名字——`request` 只有 `{ prompt, parent }`——所以身份通道是描述符的 **label**，
也就是队友的 `description`。契约为：

> 描述里**点名**了名册成员，就路由该成员；没有点名就继承 Lead 的路由。

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
**绝不 clamp effort**——一次性路径早已遵守的规则。没有槽位的成员则继承，也就是本行存在之前所有队友的行为。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `baseProvider` | `spawn` | 委托真正落到组合里的哪个 provider |
| `enabled` | `true` | 设为 `false` 则不注册 provider（所有队友都继承） |

## 已知边界

- 路由在 **spawn 时**按当时配置解析；改槽位影响的是下一个队友，不是已经在跑的那个。
- label 没有点名任何名册成员的队友不会被路由。这是 team service 唯一转发的身份通道的性质，不是策略选择。
