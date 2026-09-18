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
| 能力探测 | `capabilities()` | 每个接缝一个布尔值，调用方据此降级而不是崩溃 |

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

**边界：** 采纳的 `agent-teams` 插件（`packages/mpd-agent-teams-plugin`）是升级时会从上游重新
vendor 的 MIT 主代码，因此保留自己的 `ctx.*` 调用（唯一本地适配是 `registerContinuableSetup`
启动安全守卫）。所有自研 mpd 插件都经由本适配器——TUI 版本也一样：`packages/mpd-tui-plugin` 从这里导入 `createDshAdapter`，并通过已挂载的 `mpdDsh` 服务取得工作区根并集，与其他所有自研行完全一致。

适配器刻意不声明 `inject`：每个接缝都在调用时惰性解析并做防御性探测——因为 loader 会并发应用同级行（在 `apply` 时取快照会漏报），且 Cordis 中把未注入的服务当属性读取会抛错。接缝缺失时：调用点给出可操作的错误，或由 `capabilities()` 暴露标志供调用方分支处理。

## 用法

```js
import { createDshAdapter } from '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js'

export function apply(ctx) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  dsh.registerTool({ name: "mpd_x", description: "…", execute: async (args, exec) => ({ ok: true }) })
  dsh.guardTool((exec) => (exec.name === "write" ? "denied" : undefined))
  // 只观察：无论这个 listener 做什么，闸门决策都会原样返回
  dsh.onPreToolExecute((exec, decision) => { if (decision?.kind === "allow") started(exec.name, exec.callId) })
  dsh.onPostToolExecute((exec, result, downstream) => (exec.name === "bash" ? { ...downstream, content: trimmed } : undefined))
  const run = await dsh.spawnAgent({ label: "role-oracle-1", prompt: "…", provider: "deepseek-official", model: "deepseek-v4-pro" })
  const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
}
```

`ctx.get("mpdDsh")` 返回已挂载实例（由 bundle patch 在所有 mpd 行之前插入的 `mpd-dsh-adapter` 行提供）；`createDshAdapter(ctx)` 构造等价实例，因此插件在单元测试与部分安装场景下也能独立工作。

## 配置

| Key | Type | Default |
|---|---|---|
| `defaultTimeoutMs` | number | `120000`（内部 `executeTool` 在调用方未传超时时的缺省值） |
| `quiet` | boolean | `false`（关闭启动时那一行日志） |
