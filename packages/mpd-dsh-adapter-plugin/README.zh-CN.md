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
| `ctx.llm.listProviders` / `listModels` / `resolveModelInfo` | `llmCatalog()` | 把宿主的实时模型目录投影为 `{ providers: [{ id, name, models: [{ id, name, description?, efforts: [{ id, name, description? }], defaultEffort? }] }], degraded }` —— reasoning 块被**摊平**到模型上，`efforts` 始终是数组；只读且从不抛错 |
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
| 能力探测 | `capabilities()` | 每个接缝一个布尔值，调用方据此降级而不是崩溃 |

上表中从 `registerHostTool` 到 `injectAgentMessage` 这十四个接缝只有一个消费方：采纳的
`agent-teams` 插件。其桥接模块
`packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.ts`（mpd 自有，命名规则 `lib/mpd-*.js`）在
`apply` 顶部只构建一次门面，把六个已桥接的采纳文件都接到这些方法上。每个方法都在一个
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

`teamLiveTeams()` 是 Web 路由或 TUI 场景用来替代 `.mpd/team` 记录的只读视图（该记录已不存在：
团队状态保存在 Lead 的 Session 日志中，并作为 `agentTeam` Session projection 发布）。它折叠
活跃 agent 注册表，每个 Lead 保留一项，缺失时降级为 `[]`，绝不抛错。

**teammate 路径上的模型路由（方案 §3）：** `teamSpawnTeammate` 就是 Harness 自己的
`spawnTeammate`，其 `SubagentStartRequest` 不携带 `agentOptions`、`persona` 或 `toolFilter`；
因此 teammate 继承 Lead 的路由，`teamModels.slot*` 契约以显式指引的形式写在 spawn prompt 里。
按成员路由在一次性咨询路径（`mpd_role_spawn` / `mpd_workmate_spawn`）上仍可机械生效，因为它们
自行传入 `agentOptions`。

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

`packages/mpd-tui-plugin` 在**注册时**读取该接缝，为十二个 `teamModels` 槽位 knob 生成选项 ——
因为宿主渲染 `select` 的方式是循环遍历一份被深度冻结的选项列表（没有选择对话框）。该读取是
**全量兜底**的：

- `ctx.llm` 缺失，或缺少三个方法中的**任意一个**，解析为 `{ providers: [], degraded: true }`，
  并只记录**一条** warn-once 日志指名缺失的接缝 —— 绝不抛错，绝不 reject；
- 某个 provider 的 `listModels` reject，或某个模型的 `resolveModelInfo` reject，会被**跳过**
  （目录仍然存活，`degraded: true`）；
- 解析信息里没有 reasoning 块的模型依然出现，`efforts: []` 且没有 `defaultEffort`；
- `capabilities().llmCatalog` 报告该接缝（三个方法都存在时才为 true），这正是调用方分支所依
  赖的标志。

该接缝仅由这三个调用构成，别无其他 —— 没有新增运行时依赖。

## 为什么存在

Harness 更新是常态，但“每次更新都改所有调用点”不是。本包是仓库中**唯一**允许直接触碰 Harness 服务的文件。该规则具有约束力（AGENTS.md §6）：**插件行不得自行调用 `ctx.tools`、`ctx.subagents`、`ctx.skills`、`ctx.agentPresets`。**

**采纳插件的路由（原“边界”，已于 2026-09-19 关闭）：** 采纳的 `agent-teams` 插件
（`packages/mpd-agent-teams-plugin`）是升级时从上游重新 vendor 的 MIT 主代码，它经由**本适配器**
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

`resolveDshAdapter(ctx)` 在 `mpd-dsh-adapter` 行（由 bundle patch 插在所有 mpd 行之前）已提供实例时返回该实例，否则用 `createDshAdapter(ctx)` 构造等价实例——因此插件在单元测试与部分安装场景下都能独立工作，而且这条规则每个行只写一次。若某行还必须扛住**瞬时**未命中（服务已注册但其 fiber 尚未 ACTIVE），则调用 `createLazyDshAdapter(ctx, { label })`：它每次使用都重新探测。

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
