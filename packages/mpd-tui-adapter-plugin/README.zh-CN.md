# mpd-tui-adapter-plugin

[English](./README.md) | **中文**

本 bundle 与 **DSH-TUI 平面**之间的**唯一接触面**。任何需要 `tui*` 服务、harness 命令注册表或
harness settings provider 的 mpd 插件都经由本适配器调用，因此 dsh-tui 发布版重命名或重塑某个接缝时，
改动只在**这一个包**内消化（一个文件、一次重建），而不是散落在十三个文件里。

行 id：`mpd-tui-adapter`。服务名：`mpdTui`（`ctx.get("mpdTui")`）。包名：`@mpd-dsh/tui-adapter`。

## 封装的接缝

接缝 id 表就是 `TUI_SEAMS`——全 bundle 中唯一出现 DSH-TUI 服务名的地方。消费方用**键**（`scenes`、
`status`、`pluginHost` …）寻址接缝，永远不直接写服务 id。该表承载**十五个** `tui*` 服务——dsh-tui 自
0.12.0 起提供的十四个，加上 0.13.0 新增的 `tuiPanels` 侧栏面板注册表——另有 `tuiPrompt`（每一个实测版本
都不提供）以及 harness 的 `commands` 注册表与 `settings` 提供者。

| 接缝键 | 服务 | 类型化成员 | 注册 |
|---|---|---|---|
| `scenes` | `tuiScenes` | `scenes()` | `registerScene(descriptor, identity?)` → 句柄带 `openScene(id)` / `closeScene(id)`；适配器上也有 `openScene(id)` / `closeScene(id)` |
| `status` | `tuiStatus` | `status()` | `setStatus(key, text, identity?)`；`registerStatusView({key, render, intervalMs?, identity?, label?, onError?})` |
| `renderers` | `tuiRenderers` | `renderers()` | `registerRenderer(type, renderer, identity?)` |
| `settingsSections` | `tuiSettingsSections` | `settingsSections()` | `registerSettingsSection(sectionOrThunk, identity?)` |
| `shortcuts` | `tuiShortcuts` | `shortcuts()` | `registerShortcut(combo, {description, handler}, identity?)` |
| `dialogs` | `tuiDialogs` | `dialogs()` | 请求式接缝：`dialogs()` 提供 `select` / `confirm` / `input` |
| `commandTrees` | `tuiCommandTrees` | `commandTrees()` | `registerCommandTree(provider)` |
| `pluginHost` | `tuiPluginHost` | `pluginHost()` | `requestDecisionEvent(event, listener, options?)`；`grantsAllows(permission, scope, identity?)` |
| `toast` | `tuiToast` | `toast()` | 已绑定并如实上报；目前没有 mpd 界面注册 toast |
| `themes` | `tuiThemes` | `themes()` | 已绑定并上报；只作读面 |
| `pluginStorage` | `tuiPluginStorage` | `pluginStorage()` | 已绑定并上报；只作读面 |
| `messageObserver` | `tuiMessageObserver` | `messageObserver()` | 已绑定并上报；只作读面 |
| `effectLedger` | `tuiEffectLedger` | `effectLedger()` | 实测在插件激活中**不可达**；仍绑定并上报，但绝不据此推断 |
| `workspaces` | `tuiWorkspaces` | `workspaces()` | 已绑定并上报；只作读面 |
| `panels` | `tuiPanels` | `panels()` | dsh-tui 0.13.0 **新增**（宿主行 `dsh-tui-panels`，导出 `@deepseek-harness-tui/dsh-tui/panels`）：`registerPanel(descriptor)` → 句柄带 `id()`（从宿主**回读**得到的**最终**宿主 id）/ `dispose()` / `outcome()`；适配器上还有 `openPanel(id)`；`panelSeamBound()` 是本 bundle 两个面板界面之间的**仲裁者**。该接缝的**缺席**正是旧 `Ctrl+A` 宿主输入接触面的启用判据 |
| `prompt` | `tuiPrompt` | `prompt()` | 每一个实测版本都**不提供**（`docs/tui.md` 接缝 2）：只上报缺失，不作任何声明 |
| `commands` | `commands` | `commands()` | `registerCommand(definition)` |
| `settings` | `settings` | `settings()` | `registerSettingsNamespace(ns, schema, options?)` |

除接缝成员外，适配器还提供两个读面与两个辅助：

- `capabilities()` → `{ seams: Record<TuiSeamKey, boolean>, bound, total }`，调用时采样；
- `seamOutcomes()` → 每个接缝键一条 `{id, state, detail?}`，按表内顺序；
- `whenBound(key, setup)` → 接缝绑定时（已绑定则立即）执行 `setup(service, scope, handle)`，并把句柄交给
  消费方，让它用 `record({state, detail})` 记录自己实测的结果。这是消费方专有工作的逃生口——对宿主事实的
  循环、异步前置条件、就绪信号；
- `skipped(key, detail)` → 调用方**故意不激活**的接缝（配置开关）的结果，使聚合行仍然点名它。

每个注册都返回句柄，其 `outcome()` 为 `{id, state, detail?}`，沿用本 bundle 既有的词汇：`confirmed`
（宿主回读证明）· `requested`（宿主接受了调用，但无回读）· `available`（请求式接缝，无需注册）·
`absent`（从未绑定）· `refused`（调用抛错，或缺方法）。**绝不**仅凭 disposer 的类型判断“已注册”。

### `panels` 接缝全貌（dsh-tui 0.13.0 新增）

dsh-tui 0.13.0 用一个官方接缝回答了本 bundle 早先提出的面板诉求，而不再依赖那处被计数的宿主输入接触面：
宿主行 `dsh-tui-panels` 提供 `ctx.tuiPanels`，其模块导出为 `@deepseek-harness-tui/dsh-tui/panels`，
插件据此贡献一个右侧栏面板。在 0.13.0 之前的宿主上，该服务**根本不存在**，因此这个接缝什么也不绑定、
与其它可选接缝一样上报 `absent`——既无特判，也不做版本嗅探。

该接缝为适配器新增四个成员：

- `panels()`——已绑定的注册表（`TuiPanelsLike`）；0.13.0 之前的宿主上为 `undefined`；
- `registerPanel(descriptor)` → 一个 `PanelRegistrationHandle`，携带 `outcome()`（只有宿主的**回读**证明了
  注册，其 `state` 才是 `confirmed`）、`bound()`、`record()`、`id()` 与 `dispose()`。该调用在 **apply 时**
  是安全的：延迟绑定器会把它**入队**，在接缝绑定时执行；宿主没有该接缝时结算为 `absent`。`id()` 是
  **最终**宿主 id —— `<pluginId>:<slug>`，**从宿主自己的 `list()` 回读中发现**（真机实测：`act1:team`），
  绝不在这里拼装：插件 id 那一半来自本 bundle 的普通 loader 行**不携带**的 Component 身份。在接缝绑定且
  回读证明之前，它一直是 `undefined`；
- `openPanel(id)` → 一个 `PanelOpenResult`。调用时若接缝**已绑定**，`opened()` 就是宿主自己的答复：`true`
  表示请求送达侧栏面板，`false` 表示被拒（不是本次激活的面板、每个插件每 5000 ms 只允许一次打开、或没有
  活的消费者）。接缝当时尚未绑定时，请求被**入队**，`opened()` 为 `undefined`——因此需要**同步**路由决策的
  消费方先读 `panelSeamBound()`，绝不把入队当成被拒；
- `panelSeamBound()`——侧栏注册表此刻是否已绑定。这**不是**能力上报，而是本 bundle 两个面板界面之间的
  **仲裁者**：为真走侧栏面板，为假走旧的**全屏场景**。消费方除了在 apply 时读它，**每次按键**也会重读：
  接缝是经**延迟注入**绑定的，晚于该行 apply 才落地的绑定，必须仍然让旧的 `Ctrl+A` 接触面保持解除武装。

宿主强制的描述符规则（`TuiPanelDescriptorLike`）：`apiVersion` 必须**恰好**为 `1`；`id` 是宿主会加前缀的
单个小写 slug；`title` 非空（宿主会把它清洗到最多 80 个 cell），`icon` 可选且**显示宽度必须恰好一个
cell**；`component` 与/或 `compact` 必填；`minColumns` 是宿主自己 12..64 区间内的整数（其默认值为 28）；
`order` 是可选排序提示；每个插件最多 4 个面板、全局最多 32 个。注册随激活一并释放。**0.13.0 会校验并保存
`compact`，但不挂载它的渲染槽位**（宿主自己的 `TODO §18.1`），因此本 bundle 只声明 `component`。

## 绑定纪律

实测而非自选（T4-INERT-1，`evidence/tui/plugin/20260915T054343Z/mount-instrumentation/`）：插件上下文只能
触达它**注入过**的 DSH-TUI 服务。因此适配器：

- 每个接缝**各用一次**延迟的 `ctx.inject([id], scoped => …)` 绑定——**绝不批量**，因为 cordis 对依赖
  列表是“全有或全无”，一个缺席的可选接缝会压掉整批里其它所有接缝；
- 用 `ctx.get(id, false)` 探测，且探测**绝不**自行绑定接缝——`pluginHost` 例外，它遵循**宿主自己**的规则
  （先软探测、延迟注入作后备），且仅当该上下文确有注入通道时；
- 把在接缝绑定**之前**发起的注册入队，并在绑定时排空，因此先 apply 的行依然完成注册；
- 把每个宿主句柄交给**注入作用域**上的 `scoped.effect(() => release(), label)`，卸载或热重载都不会留下
  陈旧注册；
- 宿主 API 接受尾部 `identity` 参数时，传入**消费方**的上下文，使效果账本把注册归因到真正激活它的行；
- 绝不让启动失败：从未绑定的接缝上报 `absent`，并只贡献**一行**聚合警告。web 或 headless 组合里这些服务
  全都不存在，整个行保持惰性。

### A2.2 静态闸门（`test/no-direct-tui-access.test.ts`）

接缝闭包是被**强制**的，不只是写在文档里：闸门扫描 `packages/mpd-*/src/**/*.ts`（排除本包），对十五个
`tui*` id 的**三种拼法**——`ctx.tuiScenes`（属性式，含别名接收者）、`ctx.get("tuiScenes")` /
`ctx.inject(["tuiScenes"])` / `onService(ctx, "tuiScenes")`（字符串式）、以及任何裸出现（兜底）——失败时
逐条给出文件名、行号与**原始**行文本。匹配前先剥离注释，被扫描 `src/` 下的所有非 `.ts` 文件在醒目的
NOT COVERED 段落里打印，而不是静默放过。闸门自带 `--self-test`（七条断言、五处植入违规的夹具树）。

### 宿主输入接触面——唯一一处被计数的例外（2026-10-05）

需求是：当工作区里存在团队时，按 `Ctrl+A` 打开 MPD 的合并面板（宿主自己的子代理行 + 依赖图）。这个键归宿主
所有：`dashboard` 是宿主的内建动作（默认 `ctrl+a`），`Chat.js` 在任何插件绑定之前就把它消费掉，而三种贡献
类型（`workspace.provider`、`tui.settings-section`、`tui.scene`）都无法把内容放进宿主自己的
`SubagentDashboard`——它是 Chat 内的早退组件，props 固定。没有任何接缝能拿到这个键。

因此本包承载唯一能拿到它的接触面，并在此**明写**而不是藏起来：

- `hostRootCandidates(env, home)`——**已安装**宿主的候选根，最具体者优先：`MPD_DSH_TUI_HOST_ROOT`
  （QA/测试覆盖开关）、模块自身目录、正在运行的 `dsh-tui` bin（`process.argv[1]`）、每个
  `<DSH_HOME>/profiles/*/node_modules/@deepseek-harness-tui/dsh-tui`、`~/.dsh/profiles/*/…` 与
  `~/.dsh-tui/profiles/*/…`。只有 `<root>/lib/types/ui.js` 存在的候选才算数。
- `probeHostInput(candidates)`——以**文件 URL**动态 import 该模块，且只在其导出 `useStdin` 函数时接受；
  这里不能用**包说明符**导入，因为宿主的 `exports` 映射没有 `./lib/*` 子路径。
- 适配器上的 `hostInput()`——缓存下来的 `{ useStdin }`，或 `undefined` 外加**一行**诊断。`ui.js` 存在但
  不带 `useStdin` 的宿主上报为版本**偏移（skew）**，绝不当作“不存在”。

**为什么文件 URL 是关键**：Node 按解析后的 URL 缓存 ES 模块，所以这样 import
`<hostRoot>/lib/types/ui.js` 拿回的是宿主自己用的**同一个模块实例**，它的 `useStdin` 读到的是**同一个**
React context 对象（`StdinContext`）。若拿到的是第二份副本，`useContext` 会解析到 context 的**默认值**
——一个永远收不到按键的 emitter，于是接管会**静默失效**。适配器不把这件事交给运气：`readHostStdinValue()`
会对一次 `useStdin()` 的返回值做判定，并**拒绝** context 默认值（它要求存在真实 provider 自己的
`internal_querier` 标记），因此拿到拒绝的消费方**什么都不挂**并只输出**一行**日志，而不是把监听器挂在一条
死总线上。真机 PTY 用例 `skills/dsh-qa/scripts/tui-deps-ctrla.ts` 再从正面证明：它从工作区日志里读回适配器
自己写的 `host contact bound: <root>` 一行，并要求那个根目录**正是该用例启动的那份 profile 副本**。

接触面周围的纪律：不补丁、不 vendor、不写入任何 DSH-TUI 文件；宿主缺失、import 失败或模块偏移都降级为
`hostInput() === undefined`，接管**直接缺席**（`alt+a` 仍能打开面板）；接触面只存在于**本包**，因此 A2.2
闸门的范围不变；消费方契约刻意收窄——挂载中的组件调用 `useStdin()` 并
`prependListener("input", …)`，这正是让顺序确定的原因（宿主从前向后遍历监听器列表，插件因此在宿主自己的
处理器消费按键**之前**看到它）。

**该接触面遵守的两条实测宿主约束**（dsh-tui 0.12.0，均在真机 PTY 上确认）：

- **状态类注册携带的 identity 必须是"正在调用它的激活"，而不是消费方的 ctx。** 宿主的
  `assertCallerContext` 会拒绝 identity 属于另一 fiber 的 `tuiStatus.registerView`/`set`，而宿主看到的
  调用者正是绑定在适配器注入 scope 上的服务影子。因此每个状态注册都传该绑定的 `scope`；传消费方的 ctx 会
  被宿主**静默拒绝**（富视图从不挂载，`mpd:` 状态行也从不渲染）。
- **只有场景渲染会携带活的输入 kit。** `rememberHostKit()` 保存场景组件通过 `props.ui` 收到的那份 kit，
  而 `hostInput()` 优先使用这份记忆中的钩子、而不是自行 import 到的那份——因为后者是另一份模块实例，在本
  宿主上 `useStdin()` 什么也不返回。`capabilities().hostInput` 会写明最终是哪一路就绪的，QA 可据此区分。
  由此带来的实际后果是一次 bootstrap：基于本接触面的接管在"本次会话渲染过任一 MPD 场景"之后就绪，在那之前
  保持惰性（宿主原有行为，不做任何声明）。

**自 0.13.0 起按版本设闸（2026-10-06）。** 该接触面只服务于**一代**宿主——没有面板接缝的 dsh-tui，那时宿主
自带的 `dashboard` 动作是触达合并视图的唯一途径。在**提供** `tuiPanels` 的宿主上，`panelSeamBound()` 为真，
接触面**保持惰性**（`Ctrl+A` 保留宿主 dashboard 的原义），合并视图改由消费方自己的 `alt+a` / `/mpd panel`
路由进入侧栏面板。消费方除了在 apply 时，**每次按键**都会重测这道闸，因此晚落地的延迟绑定不会在 0.13.0 宿主
上把接触面留在启用状态。真机 PTY 用例 `skills/dsh-qa/scripts/tui-deps-ctrla.ts` 对两条路径都做了断言。

## 诊断文件 sink

活跃的 DSH-TUI 会话**占有**终端：写一次 fd 1 或 fd 2 就会毁掉渲染帧。因此适配器把自己的启动行写入**文件**
——`<workspace>/.mpd/logs/mpd-tui.log`——并提供 `createFileSink({root, name?, capBytes?})`：宿主 logger
缺席时，TUI 插件自己的日志就落在这个 sink 上。该 sink 追加写入、以保留文件尾部的方式执行大小上限、每次写入
都重新解析根（一个宿主服务多个会话），并且绝不抛错。`debug` 仍由 `DSH_TUI_DEBUG` 控制。

## 为什么存在

`packages/mpd-dsh-adapter-plugin` 是 DSH 平面的唯一接触面，而 DSH-TUI 平面原本没有：`packages/mpd-tui-plugin/src/**`
内联写着 `tui*` 服务 id、`commands` 注册表与 `settings` provider，一次 dsh-tui 发布就可能让改动散落十三个
文件。本包就是那个缺失的接触面，形状与 DSH 适配器完全一致：类型化接缝接口、调用时采样的能力探测、warn-once
降级、`resolveTuiAdapter` / `createLazyTuiAdapter`，以及单行提供者。

## 用法

```ts
// 挂载实例（常规情形）或行内私有实例（单元测试、独立行）。
const tui = resolveTuiAdapter(ctx)

// 注册：句柄如实报告实际发生了什么。
const handle = tui.registerScene({ id: "mpd-tui-board", title: "MPD board", component }, ctx)
handle.outcome()            // { id: "tuiScenes", state: "requested", detail: "mpd-tui-board requested …" }
handle.openScene("mpd-tui-board")

// 读取组合状态。
tui.capabilities().seams.scenes   // 延迟注入绑定成功时为 true
tui.seamOutcomes()                // 每个接缝键一条，按表内顺序
```

若某行还必须扛住“提供者尚未 ACTIVE”的瞬时 miss，请用 `createLazyTuiAdapter(ctx, { label })`：它在每次
成员读取时重新解析 `mpdTui`，退化到行内私有适配器时只警告**一次**。

## 配置

`apply(ctx, config)` 提供服务并写启动行：

| 键 | 含义 |
|---|---|
| `quiet` | `true` 静默适配器自身的启动行（提供者行与 `TUI_SEAMS=…` 清单） |
| `logRoot` | 诊断根——字符串或解析函数；默认 `DSH_WORKSPACE_ROOT`，否则进程 cwd |

行刻意声明 `export const inject: string[] = []`：所有接缝都在 `apply` 内用延迟注入绑定，因此该行可挂载于
任意组合顺序，也可挂载于这些服务都不存在的 web/headless 组合。
