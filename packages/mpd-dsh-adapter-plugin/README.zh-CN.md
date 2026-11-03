# mpd-dsh-adapter-plugin

**中文** | [English](./README.md)

本 bundle 与 DeepSeek Harness 的**唯一接触面**。所有 mpd 插件都经由该适配器调用，而不是直接使用原始 `ctx` 服务；这样 Harness 版本更名或改变某个接缝（seam）时，只需改动这一个包（一个文件、一次构建），而不必逐个插件改。

## 封装的接缝

| 接缝 | 适配器调用 | 归一化内容 |
|---|---|---|
| `ctx.tools.register` | `registerTool(def)` / `registerTools(defs)` | 缺省的对象根 `parameters`、缺省 `output.render`（文本块）、始终传入对象形态的 `(args, exec)`、disposer 透传 |
| `ctx.tools.guard` | `guardTool(fn)` | 始终对象化的 `exec`、disposer |
| `ctx.on("tools/pre-execute")` | `onPreToolExecute(listener)` | **只观察**：由适配器调用 `next()`，并**原样**返回下游闸门决策（因此 listener 既不能改变也不能否决调用），listener 自身的返回值被丢弃；listener 收到 `(exec, decision)`，其中 `decision` 是宿主将采用的 `{kind:'allow'\|'ask'\|'deny'}`；listener 抛错会被兜住；无事件总线时为空操作 |
| `ctx.on("tools/post-execute")` | `onPostToolExecute(listener)` | 由适配器调用 `next()`；listener 收到 `(exec, result, downstream)`，返回决策或 `undefined` 表示放行；无事件总线时为空操作 |
| `ctx.tools.get` / `ctx.tools.execute` | `hasTool(name)`、`toolRuntime()`、`executeTool({name, arguments, callId?, signal?})` | 能力探测、缺省 callId + 超时 signal、归一化 `{ok, isError, value, error}` 结果 |
| `ctx.subagents.start("spawn", …)` | `spawnAgent(spec)` | 字符串 prompt → 内容块；扁平 `provider`/`model` 或 `agentOptions`；`run.result` 无论是 Promise 还是对象都会 await；归一化 `{output, structured, stopReason}` |
| `ctx.skills.registerProvider` / `list` / `get` | `registerSkillProvider`、`listSkills`、`loadSkill` | disposer 透传、缺省参数 |
| `ctx.agentPresets.resolve` | `resolvePreset(id)` | 归一化 `{id, path, trust, broken}` |
| `ctx.llm.listProviders` / `listModels` / `resolveModelInfo` | `llmCatalog()` | 把宿主的实时模型目录投影为 `{ providers: [{ id, name, models: [{ id, name, description?, efforts: [{ id, name, description? }], defaultEffort?, contextWindow: number | null, maxOutputTokens: number | null }] }], degraded }` —— reasoning 块被**摊平**到模型上，`efforts` 始终是数组；只读且从不抛错 |
| `ctx.tools.register`（**逐字节**） | `registerHostTool(def)` | 把**已经是 Harness 形态**的定义原样转发 —— 同一个对象引用抵达 `tools.register`（端到端 `Object.is` 成立），disposer 透传。`registerTool` 会做归一化（因而会丢掉 `finalizeContent`/`presentCall`/`presentResult`/`isConcurrencySafe`），本方法刻意不做。接缝缺失时抛错 |
| `ctx.subagents`（运行时对象） | `subagentRuntime()` | 保持同一性的运行时对象（`startContinuable`/`interrupt`/`getProvider`/`list`）；缺失时为 `undefined` |
| `ctx.subagents.getProvider` | `subagentProvider(name)` | 薄转发；缺失时为 `undefined`（调用方自己的检查会抛出同样的错误） |
| `ctx.subagents.list` | `subagentProviders()` | 缺失时为 `[]` |
| `ctx.subagents.startContinuable` | `startContinuableAgent(spec)` | **抛错**转发 —— 无法 spawn 的成员必须响亮失败 |
| `ctx.subagents.interrupt` | `interruptAgent(targetSessionId, authority)` | **抛错**转发 |
| `ctx.llm.listModels` | `llmListModels(provider)` | **抛错**转发（单个 provider 的模型列表，与容错的 `llmCatalog()` 投影不同） |
| `ctx.llm.resolveCallConfig` | `llmResolveCallConfig(config, signal?)` | **抛错**转发，signal 透传 |
| `ctx.systemPrompt.section` | `registerPromptSection(section)` | disposer 透传；接缝缺失时在调用点抛错（调用方的 usage 段落是必需的） |
| 活跃 agent 自有的 scoped ctx | `agentScope(agent)` | 由 `agent.ctx` 构造 `{ context, tools.restrict, on, effect }`；承诺的成员缺失时返回 `undefined`，调用方按次回退 |
| `ctx.agents.get(id)` / `ctx.agents.list` | `liveAgent(agentId)` / `liveAgents()` | 活跃会话注册表：按 id 取一个 Agent（先问注册表自己的 `get`，再扫 `list`），或 `[]`；注册表缺失、读取抛错、答复不是数组时降级为「没有条目」；从不抛错 |
| `agent.ctx.get("compaction")`（经注册表） | `compactionEngineForAgent(agentId)` | 该 id 所指活跃 Agent 的压缩引擎，按 Agent **对象**记忆化；没有活跃 Agent 拥有该 id、或其作用域没有引擎时为 `undefined` |
| `agent.ctx.get("compaction")`（调用方已持有的 handle） | `compactionEngineForLiveAgent(agent)` | **同一段**记忆化实现，直接从调用方自己的 Agent handle 解析，**绝不查**活跃会话注册表 —— 这是压缩屏障的**首选**，因此一个在屏障运行前就已从 `ctx.agents` 脱离的成员仍能**原地**压缩，而不是被围栏；handle 没有引擎时为 `undefined`；从不抛错 |
| `agent.followup` | `startAgentTurn(agent, message)` | **抛错**逐字节转发（绝不吞成布尔值或 `undefined`） |
| `agent.cancel` | `cancelAgentTurn(agent, cause, options?)` | **抛错**逐字节转发 |
| `agent.steer` | `steerAgentTurn(agent, message)` | **抛错**逐字节转发 —— 最近步（nearest-step）转向，区别于 `followup` 的新回合 |
| `agent.inject` | `injectAgentMessage(agent, message)` | **抛错**逐字节转发 —— 收件箱接缝 |
| `ctx.subagents.registerProvider` | `registerSubagentProvider(provider)` | provider **逐字节**转发、disposer 透传（注册表返回非函数时降级为空操作）；接缝缺失时在调用点抛错 |
| `ctx.agentTeams`（官方 TeamService） | `teamService()` | 原始服务；当前组合没有 team 行时为 `undefined` —— 与下列强类型方法并存的逃生通道 |
| `ctx.agentTeams.tryMembership` | `teamMembership(agent)` | 投影为 `{teamId, role, name}`；**从不抛错** —— 非成员、过期身份、未知角色或接缝缺失一律为 `undefined` |
| `ctx.agentTeams.listMembers` / `listTasks` | `teamListMembers(agent)` / `teamListTasks(agent)` | 行被投影为 `DshTeamMemberView` / `DshTeamTaskView`（`diagnostics`、`blockedBy`、`writeScopes`、`writeScopeWarnings` **始终**是数组）；接缝缺失时抛错 |
| `ctx.agentTeams.createTask` / `getTask` / `updateTask` | `teamCreateTask(caller, req)` / `teamGetTask(caller, id)` / `teamUpdateTask(caller, req)` | 调用方与请求对象均**按同一性**转发，Promise 原样传递，只投影返回值；接缝缺失时抛错 |
| `ctx.agentTeams.sendMessage` / `waitForChange` | `teamSendMessage(caller, req)` / `teamWaitForChange(caller, timeoutMs, signal?)` | 同样的转发纪律；持久化应答归一化为 `{messageId, status: 'accepted'\|'queued'}` / `{timedOut}` |
| `ctx.agentTeams.spawnTeammate` / `interrupt` | `teamSpawnTeammate(caller, req)` / `teamInterrupt(caller, targetName)` | 同样的转发纪律；成员行被投影 / 返回**取消之前**采样的状态 |
| 活跃团队折叠 | `teamLiveTeams()` | 每个活跃 **Lead** agent 一项（`{teamId, leadName, leadSessionId, members, tasks}`）；服务或 agent 注册表缺失时为 `[]`，单个 agent 读取失败只让该项为 `[]`，不会拖垮整个折叠 |
| `ctx.on("agent/pre-step")` | `onAgentPreStep(listener)` | 由适配器调用 `next()`；listener 收到 `(payload, downstream)`，可返回**修改后的**决策（建议性通知正是这样注入的），或返回 `undefined` 表示放行；listener 抛错会被兜住；无事件总线时为空操作 |
| 活跃 agent 自有的 scoped `ctx.systemPrompt.section` | `agentPromptSection(agent, section)` | 段落被**逐字节**转发到**该 agent 自己的** scope（绑定接收者、disposer 透传），因此该贡献只送达某一个 preset 的 session，而不是本进程服务的所有 session；agent scope 无此接缝时在调用点抛错 |
| `ctx.sessionProjections.stateOf` / `.snapshot` | `contextPressure(target)` | 单个活跃会话的已占用上下文，归一化为 `{usedTokens, windowTokens, ratio, provenance}`：`usedTokens = projectedTokens ?? pressureTokens`，`windowTokens` 取自模型自报的 `contextWindow`（**绝不**设默认值），仅当两者都是大于 0 的数字时才给出 `ratio`，provenance 为 `observed \| no-window \| unavailable`；同步、绝不抛错；接受活跃 Agent、Session 对象或 session id |
| `ctx.userQuestions.ask` | `askUserQuestion({ questions, signal? })` | 输入本 bundle 自己的 `DshQuestionItem[]`，输出 `DshQuestionAnswer[]`（按 label，绝不按索引）；服务缺失、或 `ask` 不可调用时**抛错** `ask_user_question failed: no user-questions service`；服务拒绝时重新抛为 `ask_user_question failed: <message>`，并把 Harness 的 `code`（存在时）复制到新错误上 |
| `ctx.on("user-questions/request")` | `onUserQuestionRequest(handler, label?)` | WATERFALL 应答器：`handler(request, next)`，`next()` 按**同一对象**解析**下游**应答器的 `{ answers: [...] }` **信封**（绝不重映射成裸数组），瀑布未提供后续时 reject；handler 自己的返回值原样交回 cordis，其 reject **原样**传播；无事件总线 → 空操作 disposer + **一行**日志点名 label |
| `ctx.dshGo`（存在性） | `dshGoPresent()` | 此刻桥接服务是否已绑定 —— `capabilities().dshGo` 的按次调用形式，走同一个探针 |
| `ctx.dshGo.panel` | `dshGoPanel(id, spec)` | `view`/`data`/`actions` **逐字节**转发（它们是桥接层自己的契约）；仅当调用返回时为 `true`，桥接缺失或调用抛错时返回 `false` + **一行**警告 —— 绝不抛错 |
| `ctx.dshGo.refresh` | `dshGoRefresh(id)` | 尽力而为的重渲染；桥接缺失时静默空操作，绝不抛错、绝不写日志（轮询调用方不得看到被 reject 的 tick） |
| `ctx.dshGo.on` | `dshGoOn(id, handler)` | `service.on(id, handler)`；处理函数的返回值就是桥接层自己的效果词汇，**原样**转发；仅当调用返回时为 `true`，桥接缺失、没有暴露 `on()` 或调用抛错时返回 `false` + **一行**警告 |
| `ctx.dshGo.strip` | `dshGoStrip(id, dataFn)` | `service.strip(id, dataFn)`；桥接层驱动 `dataFn(scope, emit, caps)` 并持有它返回的取消句柄；降级形态与 `on` 相同 |
| 桥接层的能力 | `dshGoCaps()` | 先探测 `caps()` 方法，再探测 `caps` / `capabilities` 属性（1.0.9 桥接**没有**文档化的 `caps()` 成员），只收窄 `app` / `locale` / `components` / `surfaces` 四个字段、不虚构字段；无法回答时返回 `null` + **一行**警告 |
| 能力探测 | `capabilities()` | 每个接缝一个布尔值，调用方据此降级而不是崩溃 |

上表中从 `registerHostTool` 到 `injectAgentMessage` 这十四个接缝只有一个消费方：当时采纳的
`agent-teams` 插件。其桥接模块曾是
`packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.ts`（mpd 自有，命名规则 `lib/mpd-*.js`），在
`apply` 顶部只构建一次门面，把六个已桥接的采纳文件都接到这些方法上。该插件与其桥接模块均已由
`de-vendor-and-verify-law` 波次**删除**；下面这段保留为“一条已关闭边界”的记录。每个方法都在一个
`capabilities()` 标志之后（一个标志可覆盖两个方法；`subagentRuntime` 复用既有的 `subagents`
标志），因此桥接层按接缝降级，而不是让整棵插件树失败：`toolsRegisterHost`、
`subagents`、`subagentsProvider`、`subagentsContinuable`、`subagentsInterrupt`、`llmListModels`、
`llmResolveCallConfig`、`systemPromptSection`、`agentScope`、`commandsRegister`、
`agentTurnStart`、`agentTurnCancel`、`agentTurnSteer`、`agentTurnInject`（后两个
`agentTurn{Steer,Inject}` 是实时名册探针：只有当某个
活跃 agent 暴露 `steer` / `inject` 时才为 `true`）。

其下的团队平面诸行各自报告**四个新标志** —— `team`、`teamTasks`、`teamMessages` 与
`subagentsProviderRegister` —— 且绝不更名既有标志。两个 **AGENT 作用域**的行
（`onAgentPreStep`、`agentPromptSection`）报告 `agentPreStep`（事件总线）与
`agentPromptSection`（实时探针：某个活跃 agent 自己的 scope 带有 `systemPrompt.section`）。

五个**驱动面**接缝各自报告**两个新标志** —— `askUser`（探测时能解析到 `userQuestions` 服务）与
`dshGo`（桥接服务已绑定）—— 且绝不更名既有标志。`askUser` 刻意**不是**瀑布标志：
`onUserQuestionRequest` 走事件总线（`events`），所以一个组合可以「接受别人问的问题」，却无法「自己发起提问」。

### 单个活跃会话的上下文压力（`contextPressure`）

`contextPressure(target)` 读取 Harness token meter 的 `sessionProjections` 单元
`contextPressure` —— 与宿主自身状态显示所用的是**同一个**投影 —— 针对**一个**会话。读取
**状态**（`stateOf`）得到已观测到的窗口（`contextWindow`，来自 provider 的 `request/context`）
与 provider 上报的 `pressureTokens`；读取**客户端视图**（`snapshot`）得到状态里没有的前瞻值
`projectedTokens`。返回

```ts
{ usedTokens: number | null, windowTokens: number | null, ratio: number | null,
  provenance: "observed" | "no-window" | "unavailable" }
```

规则如下，任何一条都不得放宽：

- `usedTokens = projectedTokens ?? pressureTokens` —— 优先采用投影的前瞻值；投影值 `0` 是真实观测，
  不是缺失；
- `windowTokens` 是模型在运行时**上报**的窗口，**绝不**设默认值：不会出现 `1_000_000`、`262_144`
  或任何配置值。首个 `request/context` 事件之前，`no-window` 才是诚实答案；
- 仅当**两者**都是大于 0 的数字时 `ratio = usedTokens / windowTokens`，否则为 `null`；
- `provenance` 是机器可读的：`observed`（投影存在且有窗口）、`no-window`（投影存在、窗口缺失）、
  `unavailable`（无注册表、无会话或无状态）；
- 读取是**同步**的且**绝不抛错** —— `sessionProjections` 服务缺失、会话无法解析、投影尚未物化、
  读取抛错，一律返回 `unavailable`。

`target` 可以是活跃 Agent（使用其自身的 `session`）、Session 对象，或 session id（经 Harness
`sessions` 存储解析，失败时回退到活跃 agent 注册表）。不做任何缓存：每次调用都重新读取投影，
因此检查点决策绝不会基于过期数字。

## 驱动面——提问与 DSH Go 面板

八个接缝让「不是模型回合」的客户端也能驱动 Harness：发起一个结构化提问、通过瀑布回答一个提问、
发布或刷新一个 DSH Go 原生面板。下面所有形状都是本 bundle **自己的纯数据** —— 没有任何 Harness
类型越过适配器（AGENTS.md §6），因此消费方永远不需要 import 它们：

```ts
export interface DshQuestionOption { label: string; description?: string }
export interface DshQuestionItem { id: string; question: string; header?: string; options?: DshQuestionOption[]; multiSelect?: boolean }
export interface DshQuestionAnswer { id: string; selected: string[]; custom?: string }
export interface DshQuestionAnswerEnvelope { answers: DshQuestionAnswer[] }
export interface DshUserQuestionRequest { questions: DshQuestionItem[]; sessionId?: string; signal?: AbortSignal }
export interface DshAskUserQuestionInput { questions: DshQuestionItem[]; signal?: AbortSignal }
export type DshGoPanelView = DshGoView | ((scope: DshGoScope, caps: DshGoCaps) => DshGoView | Promise<DshGoView>)
export interface DshGoPanelSpec { view: DshGoPanelView; data?: unknown; actions?: Record<string, unknown> }
```

- **`askUserQuestion(request): Promise<DshQuestionAnswer[]>`** 驱动 `userQuestions` 服务的 `ask`，
  把 `questions` 与 `signal` 原样转发，并把返回批次投影为 `DshQuestionAnswer[]` —— 只保留带字符串
  `id` 的条目、只保留 `selected` 中的字符串 label，且仅当 `custom` 是字符串时才写入它（缺失的
  `custom` 被丢弃）。服务缺失 —— 或服务的 `ask` 不可调用 —— 会**抛错**
  `ask_user_question failed: no user-questions service`：返回空数组会被读成「人什么都没答」。
  服务 reject 时重新抛为 `ask_user_question failed: <message>`，当 Harness 的 `code`
  （`NO_PROVIDER`、`ASK_ABORTED` 等）是非空字符串时复制到新错误上，于是调用方能区分「没有应答器」
  与「调用形态不对」，且无需 import Harness 的类。
- **`onUserQuestionRequest(handler, label?): () => void`** 在 `user-questions/request` 上注册一个
  WATERFALL 应答器。`handler` 收到 `(request, next)`：它自己的返回值**原样**交回 cordis，而
  `await next()` 按**同一对象**解析**下游**应答器的回复 —— Harness 的
  `DshQuestionAnswerEnvelope` `{ answers: [...] }`：绝不投影成裸数组，也绝不重新构造一个对象。
  这不是装饰：cordis 的 `waterfall()` 返回**最外层** listener 的返回值，而本行在启动时就注册，
  `dsh-tool-ask-user` 又按 `result.answers.map` 消费，所以裸数组（或重建的信封）会替换掉 Harness
  自己的值，让每一次被回答的提问都崩掉。下游给出的值若**不是**信封也同样原样转发 —— 那是 Harness
  自己的错误面，伪造一个替代值只会把它藏起来。事件没有携带后续函数时，`next()` 以
  `ask_user_question failed: the user-questions waterfall supplied no next()` reject。`handler` 的
  reject 会**原样**传播 —— Harness 必须看到一个坏掉的应答器，而不是一个编造的答案。降级：`ctx.on`
  缺失或抛错时，只写**一行**警告并点名 label（`onUserQuestionRequest(<label|anonymous>) degraded — …`），
  返回的 disposer 是空操作，因此插件行仍能启动。事件总线不接受 label；label 只用于这条诊断。
- **`dshGoPresent(): boolean`** 在 `dshGo` 服务已绑定时为 true，走与 `capabilities().dshGo`
  **同一个**探针、且每次调用重新读取，因此「插件行 apply 之后才绑定」的桥接也能被看到。
- **`dshGoPanel(id, spec): boolean`** 调用 `service.panel(id, spec)`，`view`/`data`/`actions`
  **逐字节**转发 —— 它们是桥接层自己的契约，在这里重塑会把适配器钉死在某个桥接版本上。仅当调用
  未抛错地返回时为 `true`；桥接缺失（或没有暴露 `panel`）与调用抛错都返回 `false` 并写**一行**警告，
  两者都不会拖垮发布面板的插件行。
- **`dshGoRefresh(id): void`** 在 `service.refresh(id)` 可调用时调用它，否则静默空操作。它绝不抛错、
  绝不写日志：调用方是轮询路径，桥接缺失或刷新失败都不能变成每个 tick 一条诊断。
- **`dshGoOn(id, handler): boolean`** 通过 `service.on` 订阅清单里声明的某一个动作 id。处理函数收到
  `(scope, event)`，其返回值 —— 桥接层的效果对象，含 v1.1 的延迟形态 `{ pending, result }` —— **原样**
  转发。桥接缺失、没有暴露 `on()` 或调用抛错时返回 `false` + **一行**警告。
- **`dshGoStrip(id, dataFn): boolean`** 发布某条输入区状态条的 `dataFn(scope, emit, caps)`；返回的取消
  句柄归桥接层所有。降级形态与 `dshGoOn` 相同。
- **`dshGoCaps(): DshGoCaps | null`** 读取「App 能画什么」。1.0.9 桥接把 `caps` 作为**参数**交给每个
  view/data 函数，并没有文档化的 `caps()` 成员，因此该接缝同时探测 `caps()` 方法与 `caps`/`capabilities`
  属性，只收窄四个已知字段、绝不虚构；已经从参数拿到 `caps` 的调用方必须使用**那个**对象。桥接无法回答时
  返回 `null` + **一行**警告。
- **`dshGoPanel(id, spec)`** 的 `view` 还接受函数 `(scope, caps) => view`（或其 Promise）：桥接层每次
  渲染都会调用它，面板因此能按 App 能力自适应。

**边界。** 接缝不是挂载。`dshGoPresent()` 为 true 只证明那一刻有服务被绑定；它不证明某个插件行已启动、
不证明有 DSH Go 引擎接入、也不证明任何面板渲染过。同理，`askUserQuestion` 证明的是通往服务的调用路径，
不是「有人、或任何界面，正在看这个提问」。这些接缝都不证明真实的挂载或启动；那需要一次真正**挂载**这些
插件行的启动，属于另一种测量。

## DSH Go 视图套件（`src/dshgo-view.ts`）

`src/dshgo-view.ts` 是本 bundle 的**纯**、无 Harness 依赖的 DSH Go 视图套件 —— 面板、输入区状态条与工具卡
共用它。它没有 ctx、没有 I/O，也不依赖私有的 `@dsh-go/plugin-kit`；插件以
`../../mpd-dsh-adapter-plugin/src/dshgo-view` 导入它，App 的形状因此由一个文件拥有，而不是每个车道各自
手写 JSON。

| 导出 | 作用 |
|---|---|
| `bind(path)` | 一个 `data.…` 绑定：`data` 前缀只加一次、绝不重复 |
| 构造器 | `stack`、`row`、`text`、`metric`、`chart`、`table`、`keyValue`、`list`、`progress`、`callout`、`steps`、`actions`、`tabs`、`grid`、`timeline`、`form`、`textField`、`select`、`toggle`、`emptyState`、`avatar`、`badge`、`tag`、`divider`、`spacer` —— 每个都产出 App 认可的节点；超过 App 自己的列表上限时**抛错**而不是截断，并拒绝 App 会静默忽略的属性（`grid` 的 style、`emptyState` 的 `text`、没有 `src` 的 `avatar`、空 tab） |
| `style(tokens)` | 封闭的 v2 样式集合：`card` / `padding` / `gap`（仅 S / M / L）/ `align` / `columns` / `dividers` / 文字 `size` / `weight` / `color: "accent"` / `maxLines`。数字型 padding 或 gap、命名色与 `#RRGGBB` 一律**拒绝**，不转发 |
| `panelView({ children, style? })` | 面板根：`v: 2`、`accent: "app"`，一个承载 tabs 的 stack。accent 只在这里写、别处不写，因此跟随主题的面板不可能带命名色或十六进制 accent；第二个 `style: "primary"` 动作会被拒绝 |
| `measureView` / `countViewNodes` / `viewDepth` | App 自己的三个计量单位：UTF-8 JSON 字节数、组件节点数、组件嵌套深度（根为 1） |
| `BUDGETS` / `fitsBudget` | toolCard 8 KiB / 40 / 6，panel 32 KiB / 120 / 8，strip 2 KiB / 8 / 3 |
| `toolCard(build)` | 工具的 `presentationMeta`：绝不抛错，返回 `{ "dsh-go/view": … }`；构造器抛错、超预算、v2 根、v2-only 组件、绑定或 accent 都会降级为 `{}` |
| `adaptView(view, caps)` | v1 回退：`tabs` → 带标题的 stack，`grid` → list（metric 的**数字**保留在行的 `trailing`），`timeline` → `steps`，`badge`/`tag`/`avatar` → `text`，`emptyState` → 其文案，`divider`/`spacer` 删除，所有 `style`/`accent` 移除，根 `v: 1`；幂等且绝不修改入参 |
| `lintDesign(view, { version })` | App 检查器留空的静态设计门。版本 2（面板）报告十六进制/命名色、数字间距、保留的装饰键、第二个 primary 动作、写成 `children` 的 `tabs`、写成 `text` 的 `emptyState`、带容器 style 的 grid、没有 `src` 的 avatar、没有文字的 badge，并检查**正向**规则：每个 tab 恰好一个 `tinted` hero、每个 `metric` 都在 `grid` 内、无数据的 tab 必须带 `emptyState`、过长或绑定的 text 必须设 `maxLines`。版本 1（静态回退）断言：不残留 v2 组件、不残留 `style`/`accent`、每个 `text` 都有非空文字 |

**边界。** App 侧渲染在本工作区**无法证明**：这里没有 Flutter App 去画视图树。套件能证明的是：视图树
v2 合法、在 App 预算之内、且只用主题令牌 —— 由 `lintDesign` 与钉住的 1.0.9 `check.mjs` 证明。
`accent: "app"` 在检查器里总会产生**一条**深色模式对比度提示（`#4B67B4 → #7B8FC8`）：那是对比度校正
在正常工作，不得用十六进制值去「修」它。

## 官方 Agent Teams 平面

Harness 以三个官方包提供 Agent Teams（`@deepseek-ai/dsh-experimental-agent-team`、
`…-tool-agent-team`、`…-client-ui-agent-team`），其服务为 `ctx.agentTeams`。
**`docs/plan-0.1.7-adaptation.md` 的 D6 规定：本适配器是 mpd 插件接触它的唯一入口** ——
在 `packages/mpd-dsh-adapter-plugin` 之外直接读取 `ctx.agentTeams`，或直接调用
`ctx.subagents.startContinuable`，都是缺陷。

其纪律与 `registerHostTool` 相同：

- **调用方 Agent**（授权该操作的精确活跃 Agent）与**请求对象**都**按同一性**转发 —— 不复制、
  不改写键 —— 因此本适配器未建模的宿主字段依然能抵达服务，宿主的校验与拒绝也保持响亮；
- 只投影**返回值**（`teamMemberView` / `teamTaskView`）：声明的 `diagnostics`、`blockedBy`、
  `writeScopes`、`writeScopeWarnings` 始终是数组，未知状态降级为安全值，不泄漏任何未声明的键；
- 每个方法都做能力探测，且**构建与探测阶段绝不抛错**：接缝缺失时给出的正是"哪件事做不到"
  （`mpd-dsh-adapter: harness service "agentTeams" is unavailable — cannot create team task "…"`），
  而 `teamMembership` 完全不抛错（它是调用方用来问"这个 agent 在团队里吗？"的过滤器）。

`teamLiveTeams()` 只是运行官方执行器（official executor）的组合里那条受限的**兜底**读取 ——
在那种组合中由 Web 路由、TUI 场景或看门狗使用。MPD 的团队**记录**（`.mpd/team/teams/<id>.json`，
经 `mpdTeams` 提供）在所有 mpd 表面上都是权威。它折叠活跃 agent 注册表，每个 Lead 保留一项，
缺失时降级为 `[]`，绝不抛错。

**teammate 路径上的模型路由（方案 §3）：** `teamSpawnTeammate` 就是 Harness 自己的
`spawnTeammate`，其 `SubagentStartRequest` 不携带 `agentOptions`、`persona` 或 `toolFilter`。
那是**官方回退**路径：请求按原样（by identity）透传，所以只有 `mpd-roster-provider-plugin` 的
官方通道路由能作用于它，而发起该路径的 `spawn_teammate` **工具**现已在工具边界被**拒绝**
（仅历史/回退）。**默认**的原生 `TeamExecutor.spawn` 会**自己**解析成员**自己的** `agentRoutes` 条目，按
身份优先级 `role` → `description` 的头部 → 整个 `name`：匹配到且路由可用的成员跑在该路由上
（其 `fallbacks` 只消费一次）；匹配不到的成员、路由未配置或格式错误的成员，或没有 `mpdConfig` 服务的组合，
则**继承暂存它的会话的路由**（顶层 spawn 是 captain 的，team-lead spawn 是 Lead 的），只记一行
日志、**绝不抛错** —— `approve` 会循环升起 N 个成员，路由绝不会让团队半途而废。逐 agent 路由同样作用于
单次咨询路径（`mpd_role_spawn` / `mpd_workmate_spawn`），因为它们自行传入 `agentOptions`；那些
应用方会用 `AGENT_UNCONFIGURED` **拒绝**不可用的路由（本包导出该错误码与那句唯一的规范句子，镜像自配置行）。该咨询是**一次性（one-shot）**的：在暴露
`startActivation` 的宿主上，报告落定后 `spawnAgent` 会释放（dispose）**这次**激活（尽力而为；
清理失败绝不改写报告），因此活着的子会话被释放而不是被不断堆积；旧版 `start` 回退路径只返回
`run.result`，没有可供释放的 activation。诚实边界（harness 0.2.1-rc.2）：`dispose()` 只结算并
释放**活动中的**激活，且子会话目录是只追加的 —— 已完成的子会话可能仍以 `inactive` 列出，
技术上可被冷恢复。尽管如此，契约仍是一次性的：新问题就用新的咨询（需要持久连续性则用 workmate，
其记录才是持久载体），绝不对已完成的子会话 `send_message`。团队 member 不受影响 —— team 路径
继续使用独立的持久接缝（`startContinuableAgent`）。

### 团队执行器的深度上限（`maxDepth`）

`DshTeamSpawnRequest` 接受可选的 `maxDepth` —— 成员自身激活的**绝对**委派深度上限（即 Harness
`startActivation` 请求的 `maxDepth`，按非负安全整数校验）。这是 cellwork 升起 depth-2+ 子队长
（subcaptain）的**唯一**途径（能力事实 F1），因为 `subagent` 工具自身的服务默认值永远不会超过 1。

- **原生**后端：**仅当调用方提供了值**时，才把它作为 `request.maxDepth` 转发。未提供的上限保持
  **缺失** —— 键被省略，绝不写成 `undefined` —— 这样 Harness 会采用自己的默认值，而不是一个被转换
  或猜测出的值。
- **官方**后端：`maxDepth` 被**忽略**且不抛错。官方服务拥有自己的名册，且没有按次调用的深度通道；
  运行该后端的组合不应指望该上限生效。

### D6 静态闸门（`test/no-direct-team-access.test.ts`）

该静态闸门扫描 `packages/mpd-*/src/**/*.ts`（本包除外）中的字面标识符 `agentTeams` 与
`startContinuable`，失败时指出文件与行号；它先剥离注释（"绝不要碰 `ctx.agentTeams`" 这类说明
不算违规），并把 `*.ts` 波段之外文件中的命中放在醒目的 `NOT COVERED` 段落里报告，而不是静默
跳过：

```bash
node packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts            # 扫描
node packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts --self-test # 反向对照
```

它同时是一个 `bun test` 用例，因此 `bun test packages/mpd-dsh-adapter-plugin` 也会运行它。

## 模型目录接缝（`llmCatalog`）

`packages/mpd-tui-plugin` 在**注册时**读取该接缝，为三十三个 `agentRoutes` 叶子（每个名册 agent 三片叶子 —— 共享声明 47 个 knob 中的 33 个）生成选项 ——
因为宿主渲染 `select` 的方式是循环遍历一份被深度冻结的选项列表（没有选择对话框）。该读取是
**全量兜底**的：

- `ctx.llm` 缺失，或缺少三个方法中的**任意一个**，解析为 `{ providers: [], degraded: true }`，
  并只记录**一条** warn-once 日志指名缺失的接缝 —— 绝不抛错，绝不 reject；
- 某个 provider 的 `listModels` reject，或某个模型的 `resolveModelInfo` reject，会被**跳过**
  （目录仍然存活，`degraded: true`）；
- 解析信息里没有 reasoning 块的模型依然出现，`efforts: []` 且没有 `defaultEffort`；
- 每个模型都携带**Harness 自己解析出的**窗口：`contextWindow` 来自
  `resolveModelInfo().context.contextWindow`，`maxOutputTokens` 来自 `.defaultMaxTokens`，类型均为
  `number | null`。两个键**始终**写入：`null` 表示"Harness 没有解析出任何值"，绝不是兜底常量，而它
  正是拆分阶段预算唯一诚实的输入；
- 这两个字段在**类型**层面是可选的，以兼容早于它们存在的目录替身：`undefined` 表示"该生产者未上报
  此字段"，`null` 表示"Harness 没有解析出任何值"；
- `capabilities().llmCatalog` 报告该接缝（三个方法都存在时才为 true），这正是调用方分支所依
  赖的标志。

该接缝仅由这三个调用构成，别无其他 —— 没有新增运行时依赖。

### 建立在该接缝上的推理强度适配（`withSupportedEffort`）

逐 agent 的路由叶子可以声明一个推理强度，而 `agentRoutes` 子树**没有**任何 schema 默认值，因此若某条路由的模型完全没有推理等级，就会把
provider 无法接受的关键字交给它、令调用失败。导出的 `withSupportedEffort(dsh, route)` 是做出该判断的
**唯一**位置（其背后的纯谓词是 `modelDeclaresNoEffort`），它读取的正是该接缝：

- 当模型声明了推理等级、provider 或 model 未被列出、没有 `llmCatalog` 接缝、读取被 reject，或路由本身
  不带等级时，**按对象身份原样返回**该路由；
- 当目录把该模型列为 `efforts: []` 时，返回**一份去掉了 `reasoningEffort` 的新副本**，并记录这次丢弃，
  因此被适配的调用绝不静默；
- **绝不抛错**，也绝不把等级替换成别的值 —— 替换即为 clamp，是契约禁止的。

两个携带推理强度的调用方都使用它：`mpd-roles-plugin`（role spawn 路径）与
`mpd-roster-provider-plugin`（官方 `spawn_teammate`）。接缝仍是唯一的接触面。

## 为什么存在

Harness 更新是常态，但“每次更新都改所有调用点”不是。本包是仓库中**唯一**允许直接触碰 Harness 服务的文件。该规则具有约束力（AGENTS.md §6）：**插件行不得自行调用 `ctx.tools`、`ctx.subagents`、`ctx.skills`、`ctx.agentPresets`。**

**采纳插件的路由（原“边界”，已于 2026-09-19 关闭；本段现为历史记录 —— 它所描述的插件已由
`de-vendor-and-verify-law` 波次删除）：** 采纳的 `agent-teams` 插件
（`packages/mpd-agent-teams-plugin`）曾是升级时从上游重新 vendor 的 MIT 主代码，它经由**本适配器**
接触 Harness 接缝 —— 通过其 mpd 自有的桥接模块 `lib/mpd-adapter-ctx.ts` 惰性解析已挂载的
`mpdDsh`，适配器缺席时 warn-once 回退（每个插件实例一行缺失日志）。本地适配保持不变
（`registerContinuableSetup` 启动安全守卫、workmate persona 注入、`mpd-delta` 区域）。
该关闭状态及其残留清单写在 AGENTS.md §6。所有自研 mpd 插件都经由本适配器——TUI 版本也一样：`packages/mpd-tui-plugin` 从这里导入 `createDshAdapter`，并通过已挂载的 `mpdDsh` 服务取得工作区根并集，与其他所有自研行完全一致。

适配器刻意不声明 `inject`：每个接缝都在调用时惰性解析并做防御性探测——因为 loader 会并发应用同级行（在 `apply` 时取快照会漏报），且 Cordis 中把未注入的服务当属性读取会抛错。接缝缺失时：调用点给出可操作的错误，或由 `capabilities()` 暴露标志供调用方分支处理。

## 用法

```js
import { resolveDshAdapter } from '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js'

export function apply(ctx) {
  // 本组合提供了已挂载的 `mpdDsh` 就用它，否则回退到本行私有适配器
  const dsh = resolveDshAdapter(ctx)
  dsh.registerTool({ name: "mpd_x", description: "…", execute: async (args, exec) => ({ ok: true }) })
  dsh.guardTool((exec) => (exec.name === "write" ? "denied" : undefined))
  // 只观察：无论这个 listener 做什么，闸门决策都会原样返回
  dsh.onPreToolExecute((exec, decision) => { if (decision?.kind === "allow") started(exec.name, exec.callId) })
  dsh.onPostToolExecute((exec, result, downstream) => (exec.name === "bash" ? { ...downstream, content: trimmed } : undefined))
  const run = await dsh.spawnAgent({ label: "role-oracle-1", prompt: "…", provider: "deepseek-official", model: "deepseek-v4-pro" })
  const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
}
```

`resolveDshAdapter(ctx)` 在 `mpd-dsh-adapter` 行（由 bundle patch 插在所有 mpd 行之前）已提供实例时返回该实例，否则用 `createDshAdapter(ctx)` 构造等价实例——因此插件在单元测试与部分安装场景下都能独立工作，而且这条规则每个行只写一次。该兜底路径**会出声**：每次解析都会写一行诊断，说明属于哪种未命中（服务已注册但 fiber 尚未 ACTIVE，或该组合根本没有适配器）并报出 `adapterIdentity`，因为挂载实例之外的第二份实例会绕过"唯一接触面"规则。若某行还必须扛住**瞬时**未命中（服务已注册但其 fiber 尚未 ACTIVE），则调用 `createLazyDshAdapter(ctx, { label })`：它每次使用都重新探测。

### 共享工具

该包同时承载 bundle 的纯工具（不触碰任何接缝）——`src/shared.ts`，并从同一个入口再导出——因此一行只需一个 import 即可同时拿到接缝面与这些工具：

| 工具 | 说明 |
|---|---|
| `isRecord(value)` | 普通对象守卫（`typeof === "object"`、非 null、非数组） |
| `errorMessage(error)` | 任意抛出物的 `Error#message`，遇到非 Error 也不会抛错 |
| `bundleRootOf(import.meta.url)` | `<bundle>/packages/<pkg>/{src,dist}/<file>` 形态模块的 bundle 根 |

它们不触碰任何 Harness 接缝，因此放在接缝面**旁边**而非其中：`src/index.ts` 仍是 AGENTS.md §6 要求的唯一接触面。

## 配置

| Key | Type | Default |
|---|---|---|
| `defaultTimeoutMs` | number | `120000`（内部 `executeTool` 在调用方未传超时时的缺省值） |
| `quiet` | boolean | `false`（关闭启动时那一行日志） |
