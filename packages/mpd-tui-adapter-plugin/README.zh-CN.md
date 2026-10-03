# mpd-tui-adapter-plugin

[English](./README.md) | **中文**

本 bundle 与 **DSH-TUI 平面**之间的**唯一接触面**。任何需要 `tui*` 服务、harness 命令注册表或
harness settings provider 的 mpd 插件都经由本适配器调用，因此 dsh-tui 发布版重命名或重塑某个接缝时，
改动只在**这一个包**内消化（一个文件、一次重建），而不是散落在十三个文件里。

行 id：`mpd-tui-adapter`。服务名：`mpdTui`（`ctx.get("mpdTui")`）。包名：`@mpd-dsh/tui-adapter`。

## 封装的接缝

接缝 id 表就是 `TUI_SEAMS`——全 bundle 中唯一出现 DSH-TUI 服务名的地方。消费方用**键**（`scenes`、
`status`、`pluginHost` …）寻址接缝，永远不直接写服务 id。

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
