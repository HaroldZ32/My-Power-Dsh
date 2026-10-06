# mpd-tui — `@mpd-dsh/mpd` 的 DSH-TUI 界面

[English](./README.md)

`packages/mpd-tui-plugin` 为 `@mpd-dsh/mpd` 插件包提供 TUI 原生界面。它是单个
Cordis 插件行（`mpd-tui`），其模块说明符由 bundle patch 持有：

```text
@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js
```

本包**故意不包含 `cordis.patch.yml`**：行由 bundle patch
（`cordis.patch.yml`）持有，二次挂载会重复 loader entry id
（loader 会直接拒绝重复项）。

## 提供的能力

| 接缝 | 宿主服务 | 用户得到什么 |
|---|---|---|
| 状态行 | `ctx.tuiStatus` | 提示框上方一个键控的 `mpd` 贡献：`mpd: team … · boulder … · plans … · workmates …` |
| 条目渲染器 | `ctx.tuiRenderers` | 本包的 log-only 会话事件（`agent-teams/*`、`mpd-tui/board-opened`）渲染为纯文本行，实时与回放同路径 |
| 设置区块 | `ctx.tuiSettingsSections` | 把 mpd.jsonc 的可调项 —— 原有 13 个加上十二个 `teamModels` 槽位叶子（共 25 个），其中槽位叶子渲染为**由模型目录驱动的选择项** —— 声明为 `/settings` 中可编辑的字段，**已与 `<workspace>/.mpd/mpd.jsonc` 打通**（保存会写入文件；插件行为需重启后生效）；每个字段的提示在界面上直接写明（见"明确不声明"第 2 条） |
| 全屏场景 | `ctx.tuiScenes` | 团队与任务账本、boulder 工作账本、计划、workmate 库；已路由团队在面板上多两行：`team-plan …`（仅 staged 时）与 `team-hold held (…)`（仅看门狗 hold 持续期间） |
| 团队工作流场景 | `ctx.tuiScenes` | `mpd-tui-team` —— 用 `/mpd team` 打开，或在面板中按 `a`：团队 id/名称/阶段、计划审阅状态、看门狗 hold、成员表（角色/模型/状态/进度/当前任务）以及任务 DAG（kind/状态/负责人/尝试/轮次/判定/依赖，按深度缩进，标 `failed-dep=`）与邮箱尾部 |
| 计划场景（批准流程，W6） | `ctx.tuiScenes` | `mpd-tui-plan` —— 用 `/mpd plan` 打开。它渲染实时任务板，并承载批准闸门：逐字输入该面板显示的**确切**短语（`approve plan-…`，由 Web 面板渲染的**同一份**投影提供），再按 `Ctrl+X`；10 秒内按两次 `Ctrl+D` 丢弃已 stage 的 plan，`Ctrl+R` 重新读取，`esc` 返回。该动作是一次 `agent_teams_plan {action:"approve"\|"delete"}` 调用，携带从适配器**自身注册表**解析出的**实时** agent —— 解析不出调用方时一律**响亮拒绝**，绝不伪造（见下） |
| 命令树 | `ctx.tuiCommandTrees` | `/mpd board`、`/mpd team`、`/mpd plan`、`/mpd status`、`/mpd workmates` 补全，以及 `/mpd-model` 根；两个根与每个子项都在 `descriptions` 中同时提供中英双语，由宿主按其当前 `/lang` 解析 |
| 模型菜单（R3） | `ctx.tuiDialogs` + 共享的目录/设置接缝 | **`/mpd-model`** —— 一个真正的选择式菜单，依次选择 槽位 → 提供商 → 模型 → 推理强度，并把所选路由写入 `/settings` 区块所编辑的 `mpd-config` 条目。选项来自该区块**自己**的投影（`teamModelOptionLists`）与同一份实时模型目录，因此菜单与设置行不可能互相矛盾；输出结果携带与区块完全相同的披露语句。任一档取消即不写入任何内容 |
| 快捷键 | `ctx.tuiShortcuts` | `alt+m` 打开面板 · `alt+a` 子代理 + 团队面板 · `alt+t` 团队工作流 · `alt+w` workmate 选择器 · `alt+r` 立即刷新状态行 |
| 侧栏面板（dsh-tui 0.13.0） | `ctx.tuiPanels`（经适配器） | **一个**面板 —— slug `team`、标题 `MPD`、`minColumns` 32、`order` 10、无图标、**无 `compact`** —— 其正文就是**同一份**合并视图：先是宿主那份精心裁剪的 `host.snapshot().subagents` 行，然后是 MPD 依赖 DAG。接缝已绑定时，`alt+a` 与新增的 `/mpd panel` 都经 `tuiPanels.open()` 路由；只要被拒就**回退**到全屏 `mpd-tui-subagents` 场景 —— 绝不静默无操作。`/mpd panel` 会打印一行双语状态，点名它实际到达的界面 |
| 合并面板 | `ctx.tuiScenes` | `mpd-tui-subagents`——宿主自己的子代理行（含其 运行中/已完成/失败 计数）、团队正文，以及每条**已绘制**依赖边都以方向箭头 `▼` 收尾、下方带图例的任务 DAG：它是**回退**界面 —— 宿主没有面板接缝、或拒绝了打开请求时，`alt+a` 与 `/mpd panel` 落到这里；在 0.13.0 之前的宿主上，工作区存在团队时也可用 **`Ctrl+A`** 打开（见下方接管说明）。`enter` 打开选中子代理的详情，`i` 中断选中的活跃运行，鼠标点击选中行 |
| `Ctrl+A` 接管 | 一个 `ctx.tuiStatus` 视图 + 适配器的宿主输入接触面 | 当团队投影含有一个至少带一项任务的团队时，`Ctrl+A` 打开合并面板而非宿主自带的 dashboard；没有团队时——或宿主输入总线无法被适配器触达时——该键行为与今天完全一致（`tui.dashboardKey`，默认 `true`；见"明确不声明"第 7–9 条） |
| 对话框 | `ctx.tuiDialogs` | 托管式 workmate 选择器（`select`） |
| 决策事件 | `tuiPluginHost.subscribeDecision` | 已尝试注册、预期被拒绝、**未激活**（见下） |

支撑面（不属于上述七个接缝）：harness 命令注册表上的 `/mpd` 命令、`mpd` 设置
命名空间注册、以及 log-only 的 `mpd-tui/board-opened` 会话记录。

### 侧栏面板（dsh-tui 0.13.0）：一个面板，一份合并视图

`src/panel.ts` 只贡献**一个**侧栏面板，并承载它的全部契约。描述符在模块作用域**冻结**
（`PANEL_DESCRIPTOR_FROZEN`）：`apiVersion` 为 1、slug `team`（宿主会用本次激活的插件 id 加前缀）、
标题 `MPD`、`minColumns` 32（高于宿主自身默认的 28 这一底线）、`order` 10、**无图标、无 `compact`**
—— 0.13.0 会校验并保存那个行槽位，却**不挂载**它的渲染槽位，声明它就等于主张一个宿主永远不会绘制的
界面。

注册在每一个宿主版本上都是安全的：apply 时的 `registerPanel(...)` 被适配器的延迟绑定器**入队**，在
没有 `tuiPanels` 服务的宿主上结算为 `absent`，且绝不抛错。最终 id 不在这里拼装 —— 它是从宿主自己的
`list()` 回读中**发现**的，因此在真机 0.13.0 宿主上调试行写作 `sidebar panel id: act1:team`（实测），
其它地方则是 `(not discovered)`。

面板**正文**就是全屏场景绘制的**同一份**合并视图，且只经**一个**读取器（`readWorkflow`，即各场景自身
`readDashboardWorkflow` 的无 agent 形态），因此两个界面不可能对同一个团队给出不同描述：先是宿主那份
精心裁剪的 `host.snapshot().subagents` 行，然后是 MPD 依赖 DAG，两者都复用 `subagent-scene.ts`
（`subagentSectionRows`、`teamGraphView`）与 `graph.ts`。它**只**通过 props 自带的 kit 渲染 ——
`props.React` 与 `props.ui` —— 因为宿主是在自己的 reconciler 里渲染这个面板的：在这里 import React
（或它的任何第二份副本）会挂载一棵外来树，所以本面板从不 import 它，也从不读自己的主题（单 React 规则）。

**入口，以及那一次路由打开。** `alt+a` 与新增的 `/mpd panel` 子命令都落在 `openMergedPanel()` 上，由它
**逐次调用**决定：接缝是异步绑定的，因此在绑定之前按下的键同样必须找到界面 —— `panelSeamBound()` 为真且
已发现 id 时走侧栏面板，否则走全屏 `mpd-tui-subagents` 场景。宿主的**拒绝**也不是静默无操作：
`opened() === false`（不是本次激活的面板、每 5000 ms 只允许一次的打开限流、或没有活的消费者）会以场景
兜底并记录原因。**入队**的请求（`opened() === undefined`）**不**被当作拒绝。`/mpd subagents` 保持它在
面板出现之前的布尔契约；`/mpd panel` 用当前语言打印路由结果（`panel.opened` / `panel.fallback` /
`panel.refused` / `panel.unavailable`），因此回退永远不会被读成"面板已打开"，而**已绑定**接缝却**拒绝**注册
的宿主会报成"被拒绝"，绝不会被读成"该宿主不提供面板接缝"。

**`Ctrl+A` 按版本设闸。** 在提供面板接缝的宿主上，旧的宿主输入接触面被直接跳过 —— 无论配置层说什么，
`takeoverArmed(seamBound, savedKnob, floor)` 都返回 `false`，聚合行会点名原因，`Ctrl+A` 保留宿主
dashboard 的原义。在没有该接缝的宿主上，接触面与以往完全一样地就绪，且在那里已保存的 `tui.dashboardKey`
高于行配置的底线。这道闸**每次按键**都会重读，而不只在 apply 时 —— 因为适配器是经延迟注入绑定该接缝的；
因此 `tui.dashboardKey` **只在旧宿主上有意义**，在 0.13.0 宿主上这个键不归 MPD 花。

行配置新增的 `panel` 开关（默认 `true`）同时关掉贡献与路由：不再尝试注册（聚合行上报适配器自己的
`skipped("panels", …)` 结果并点名该配置），`alt+a` 与 `/mpd panel` 保持面板出现之前的全屏路径，而
`Ctrl+A` 是否就绪只由接缝决定。

**如实写出的边界。**（1）在当前宿主上，面板**正文**无法用 tmux pane 抓取观测：一次**被宿主接受**的
`open()` 前后两次抓取**逐字节相同**，因此真机 PTY 用例证明的是注册、被发现的 id 与被接受的打开 ——
绝不是渲染，也不主张面板栏或正文绘制出来。（2）0.12.0 一侧**没有 PTY 证据**：干净的 0.12.0 沙箱需要
`dsh plugin add @deepseek-harness-tui/dsh-tui@0.12.0`，本机被只读的 pnpm store 锁拒绝（现有的
`.mpd/recon/tui-012` 夹具是混版组合，其 loader 在出现聊天界面前就卡在只属 0.13.0 的那一行上），因此旧
宿主的就绪路径依赖单元断言 —— 判据是 `src/panel.ts` 中的 `takeoverArmed`，由 `test/panel.test.ts`
覆盖，另有 `test/dashboard-key.test.ts` 的 `Ctrl+A` 决策臂 —— 而**不是**某次 pane 抓取。

证据：`evidence/tui/lanes/2026-10-06T10-27-42.389Z/`（挂载用例 PASS）、
`evidence/tui/lanes/2026-10-06T10-27-53.571Z/`（8 个界面中 7 个渲染，面板行绿、负对照红）、
`evidence/tui/lanes/2026-10-06T10-28-57.807Z/`（宿主的 `Ctrl+A` **保持惰性**，而 `/mpd panel` 证明了
侧栏注册 + 被接受的打开），以及
`evidence/tui/lane-repair/013-20261006T102742Z/TUI-013-LANE-REPORT.md`。

### 依赖图：箭头、图例与 `Ctrl+A` 接管

`src/graph.ts` 用三种画法绘制看板，并选择终端放得下的最宽的一种：`boxes`（分层 DAG，纵轴是最长
依赖路径，因此一条链自上而下阅读）、`rail`（窄终端的缩进森林）、`list`（看板过密时的按 rank 分组表格）。
每一条**已绘制**的依赖边都以方向箭头收尾——`boxes` 里是 `▼`，`rail` 里是 `▸`——指向**依赖方**；多个阻塞者
汇聚时仍然只显示**一个**箭头：合并入口是写成**文本**而不是交叉字符的，因为没有任何方向位能表达"……并且这条
依赖指向这个盒子内部"。两个调用方（团队场景与合并面板）都在图下方渲染 `legendLines(width)`；它同时说明两种
箭头标记、五个状态字形（直接取自绘制所用的同一张表）以及焦点标记，并在终端过窄时**丢弃**一整句而不是把句子
截断。

当工作区的团队投影含有一个至少带一项任务的团队时，`Ctrl+A` 打开合并面板——宿主自己的子代理行及计数、团队
正文、以及该 DAG。这个键归宿主的**内建** `dashboard` 动作所有，且没有任何贡献类型能触达它的组件，因此适配器
加载宿主自己的 `useStdin`（见 `packages/mpd-tui-adapter-plugin`），再由一个零行状态视图把一个监听器
prepend 到输入总线最前面，抢先消费该键。没有团队时该监听器什么都不碰；任何失败——宿主模块不可达、版本偏移、
`tui.dashboardKey` 关闭——都降级为今天的行为。`skills/dsh-qa/scripts/tui-deps-ctrla.ts` 在真机 PTY 上
证明了两条路径（外加设置界面那条对照）。**自 dsh-tui 0.13.0 起这条路径按版本设闸**：在提供侧栏面板接缝的
宿主上，该接触面被直接跳过，`Ctrl+A` 保留宿主 dashboard 的原义 —— 接管只在**没有**该接缝的宿主上就绪（见
上方侧栏面板一节）。

**一条宿主约束**（它直接影响你看到的现象）：宿主只在**场景渲染**时把活的输入上下文交给插件，因此接管会在你本次
会话打开任意一个 MPD 面板或场景之后自行就绪（`alt+a`、`alt+t`、`alt+m`、`/mpd board` 等）。在那之前——以及
在任何"插件自行 import 得到的是另一份模块实例"的宿主上——钩子什么都不挂，`Ctrl+A` 与没有本 bundle 时完全
一样地打开宿主 dashboard。本次会话打开过一次即可。

### 团队模型槽位字段：由模型目录驱动的选择项

十二个 `teamModels` 叶子（`slot{1,2,3,4}.{provider,model,reasoningEffort}`）声明为
`select` 字段。宿主渲染 `select` 的方式是**循环遍历一份已冻结的选项列表**（没有选择
对话框），因此它们的选项在**注册时**根据适配器上报的模型目录（`mpdDsh.llmCatalog()`，
即 `packages/mpd-dsh-adapter-plugin` 记录的增量接缝）计算：

- **provider** 选项 = 目录中的 provider id（标签 = provider 名）；
- **model** 选项 = 所有 provider 的 model id 的并集（标签 = 模型名）；
- **reasoning effort** 选项 = 所有模型的 effort id 的并集（标签 = effort 名）。

每个值都是 settings 文档实际存储的原始 id（因此 `deepseek-official` /
`deepseek-v4-flash` / `max` 仍是配置层读取的词汇表）。当目录不可用或**降级**时
（`{ providers: [], degraded: true }` —— 不带该接缝的适配器构建也是这个形状），
每个字段回退到共享 schema 中声明的 `TEAM_MODEL_FALLBACK_OPTIONS`：因此槽位字段
永远不会以空列表注册，也永远不需要手动输入。由于目录读取是异步的而宿主在注册时
冻结列表，区块注册会在读取目录期间推迟一个微任务链（宿主注册表自带的晚注册接缝）；
没有该接缝的读取方则同步注册声明列表。每次注册都会记录产生选项的分支：
`settings section mpd slot options: provider=live(N)|declared(N) model=… reasoningEffort=… catalog=live|degraded|unavailable`。

面板是 web 专有界面（agent-teams 侧边栏、workmate 标签页）的
TUI 原生等价物。它**只读**状态：

- 官方 Agent Teams 实时读数（`dsh.teamLiveTeams()`，经适配器；0.1.7 起旧的
  `.mpd/team/<teamId>/team.json` 已消失，且**单人会话**不再被当作团队展示）
- `<workspace>/.mpd/boulder.json`
- `<workspace>/.mpd/plans/*.md`
- `$HOME/.mpd/workmate/<key>/meta.json`（用户级 workmate 库）

所有路径每次调用都解析到**发起会话的工作区**（
`packages/mpd-dsh-adapter-plugin` 的 `workspaceRoot` / `workspaceRootsAll`），
绝不使用 dsh 进程的 cwd。

这里的只读规则不是一句政策声明，而是构建产物自身的属性：包内不含任何写原语 —— 每一次团队变更都是场景经适配器发起的**工具调用**。
0.1.7 退役了最初实现所调用的两个工具
（`agent_teams_approve`、`agent_teams_delete`），面板因此一度无工具可调；
自 W6 起它调用**本 bundle 自己**的 `agent_teams_plan`（`approve` / `delete`），
闸门重新可用。每一次失败都是**响亮的拒绝**，绝不伪造成功。

**调用方是解析出来的，绝不凭空捏造。** `agent_teams_plan` 需要调用方
（`exec.agent`），而 Harness 会拿它在自己的实时存储中**按身份**校验 ——
手工构造的 `{ session: { id } }` 已被实测在此处被拒。因此场景从适配器**自身注册表**
解析调用方：`liveAgent(sessionId)`，否则取 `session.id` 与之相符的实时条目，
只有在场景完全没有 id 时才取**唯一**的实时 agent。以上都点不出调用方时，
面板在**调用之前**就拒绝：
`session "<id>" is not live in this process — no live agent to speak as, so nothing was called`
（界面上没有 id 时为 `no live agent to speak as and no session id on this surface — nothing was called`）。
组合中没有 `agent_teams_plan` 工具时同样拒绝。**明确不声明：** 每一个宿主、每一个 session 都能解析成功 ——
本页承诺的是解析**顺序**与拒绝文案，而不是在本轮尚未实测的宿主上普遍成功。

**Web 版每一个界面与 TUI 对应物的关系**，在 `docs/tui-parity.md`
（+ `docs/tui-parity.zh-CN.md`）中逐行回答：每个界面的状态、原因与证据层级，
仍处于未修复状态的偏差如实记录而不做平滑。引用本文件中的一致性主张之前请先读那一页。

## 每个界面的语言（R4）

宿主通过**按字段声明的本地化映射**、并按自己的当前语言解析来本地化贡献项。只要存在这样的字段，本包就只使用它：

| 贡献项 | 本地化字段 | 内容 |
|---|---|---|
| 设置字段标签 | `TuiSettingsField.descriptions` | `{ zh }` —— 英文是 `label` 基准值（宿主自身的写法；`pick(text, descriptions)` 会在缺失时回落到基准值） |
| 设置字段提示 | `TuiSettingsField.hintDescriptions` | `{ zh }` —— 英文是 `hint` 基准值。仅十二个槽位叶子设置了它（它们的提示有可翻译的句子）；其余行只保留 `hint` |
| 设置区块 | `TuiSettingsSection.descriptions` | `{ zh, en }` —— 区块自身的披露语句，双语齐备 |
| 命令树（根与每个子项） | `TuiCommandTreeProvider.descriptions` | `{ zh, en }` —— 英文一半在构造上就是节点的 `description` 基准值 |

宿主**没有**提供本地化字段的部分 —— 场景 `title`、快捷键 `description`、状态项 `text`、对话框自身的标题与标签，以及本包自己渲染的每一个字面量 —— 由 `src/i18n.ts` 按**宿主自己的**优先级链原样解析（`lib/types/i18n.js`）：`DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → `LC_ALL` / `LC_MESSAGES` / `LANG`（`zh` 前缀为中文；**其他任何已声明的 locale 一律为英文**，因此 `C.UTF-8` ⇒ 英文；整条链都为空时才用 `zh`）→ `zh`。

**限制如实写出，不含糊带过（见"明确不声明"第 10–12 条）。** `~/.dsh-tui` 是**只读**的 —— MPD 不持有自己的语言偏好，`/lang` 始终是唯一开关，本包从不写入该目录。由 MPD 解析的字符串在**使用时**求值，因此在 `/lang` 切换后跟随下一条命令 / 下一次状态发布生效；它**不是**逐帧订阅，本包任何界面都不作此声明。场景 `title` 在**注册**时固定（宿主的描述符只带一个字符串），因此需要重启才会跟随。

## 静态资产

- `themes/mpd-tui.json` —— 一套深色 TUI 主题（部分配色的覆盖）。主题接缝本就是
  静态资产：把文件复制到 `~/.dsh-tui/themes/` 即可选用。本行**不**代为安装。
- `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` —— 仅为资产，见"明确不声明"第 4 条。

## 插件契约

- 纯 ESM，相对导入带 `.js` 后缀；
- `name` / `Config`（类型）/ `Config`（schemastery schema）/ `apply`，**无默认导出**；
- 每个配置键在 schema 与解析器中都带默认值；
- 清理由 `ctx.effect` 持有；
- 每个可选服务都用 `ctx.get(id, false)` 软探测并降级告警——服务缺席时 `apply`
  绝不抛错，因此该行在 web 组合中是惰性的，在 `dsh-tui` 组合中才真正生效。

harness 接缝（tools、skills、agent registry、subagents）不在此处直连：它们统一
走 `packages/mpd-dsh-adapter-plugin`。`tui*` 服务、`ctx.commands` 与
`ctx.settings` 是宿主服务，按宿主文档惯用法直接软探测。

### 配置键

| 键 | 默认 | 作用 |
|---|---|---|
| `statusLine` | `true` | 发布键控状态贡献 |
| `statusIntervalMs` | `3000` | 刷新间隔；`0` 表示仅手动（`alt+r`、`/mpd status`） |
| `renderers` | `true` | 注册条目渲染器 |
| `settingsSection` | `true` | 声明 `/settings` 区块（并注册 `mpd` 命名空间） |
| `scene` | `true` | 注册面板场景 |
| `commandTrees` | `true` | 注册 `/mpd` 补全树 |
| `commands` | `true` | 注册 `/mpd` 命令（面板的打开入口） |
| `shortcuts` | `true` | 注册快捷键 |
| `panel` | `true` | 贡献侧栏面板（dsh-tui 0.13.0）并把 `alt+a` / `/mpd panel` 路由到它。关闭 ⇒ 不再尝试注册（聚合行上报适配器自己的 `skipped("panels", …)` 结果并点名该配置），两个入口都保持面板出现之前的路径：全屏合并场景 |
| `dashboardKey` | `true` | 启用 `Ctrl+A` 接管：工作区存在团队时 `Ctrl+A` 打开合并面板；无团队（或本项关闭）时该键保持宿主原有含义。与本节其它旋钮不同，它**每次按键**都通过配置层重新读取，因此 `/settings` 保存后**无需重启**即生效。接管本身会在宿主把活的输入 kit 交给本会话之后就绪——即任意一次 MPD 场景/面板渲染之后（见"明确不声明"第 12 条）。**在提供侧栏面板接缝的宿主（dsh-tui 0.13.0+）上本旋钮是惰性的** —— 无论它说什么，接触面都保持解除武装，因此它只在旧宿主上有意义 |
| `dialogs` | `true` | 启用托管对话框门面 |
| `sessionEvents` | `true` | 追加 log-only 的 `mpd-tui/board-opened` 记录，且仅在事件类型已验证被可达的 `dsh-session` 副本认识之后 |
| `decisionEvents` | `true` | 尝试托管式决策事件注册（预期被拒绝） |
| `logPrefix` | `"mpd-tui"` | 诊断标签 |

### 诊断

`stdout` 保持安静（TUI 帧占用它）：诊断走 `ctx.logger`；只有在没有 logger 时才
写 `stderr`，且 `debug` 需 `DSH_TUI_DEBUG` 打开。每次启动汇总一行：

```text
[mpd-tui] mpd TUI surfaces: tuiStatus, tuiScenes, tuiDialogs, tuiRenderers, tuiSettingsSections, tuiCommandTrees, tuiShortcuts, commands · skipped: …
[mpd-tui] no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped
```

## 明确不声明（NOT CLAIMED）

1. **决策事件接缝（`tui.dsh/v1alpha1#DecisionEvents`）已就绪但未激活。** 对
   profile 安装的插件而言，admission 由 token 把关且不可达（宿主 `b246411` 修订
   的 `src/dsh-adapter/plugin-host.ts`：公开 `admit()` 抛错、`admitInternal` 需要
   未导出的 token、`getHostAdmission*` 无生产调用者），因此身份断言先于任何策略
   判定抛错。本插件据此对四个拦截点（`tui/input`、`tui/rewind-prompt`、
   `tui/session-switch`、`tui/compact`）尝试托管注册、把拒绝视为预期结果、**只
   告警一次**，并且不注册任何东西。它绝不调用 `admit`/`admitInternal`，绝不使用
   测试专用 token，绝不伪造身份。**不声明任何输入 / rewind / 会话切换 / 压缩
   拦截能力。**
2. **`/settings` 区块已与 `<workspace>/.mpd/mpd.jsonc` 打通，但行为变更需要重启。** 字段声明的
   是真实的 mpd.jsonc 可调项（`hashline.maxDiffChars`、`commentChecker.autoCheck`、
   `ulw.maxRounds`、`memory.vcs`、`team.stateDir`、`boulder.dir`），并在 harness
   设置命名空间 `mpd` 下编辑它们。该命名空间**由 `packages/mpd-config-plugin`
   提供**（设计 §10.1）：它以推导出的 `base` 注册，因此两个前门展示的都是文件中的真实
   取值，而不是 schema 默认值；本插件是**纯消费者**，仅在没有 config 插件的组合中作为
   **受保护的兜底**注册。`base` 遵循**数量规则**：一个活动根 ⇒ 该工作区的
   `<workspace>/.mpd/mpd.jsonc`；零个根 ⇒ 挂载时（无 exec）的根，那里文件缺失即得到空
   base（schema 默认值）——这是常规启动路径，因为本行通常先于任何活动会话；多于一个根 ⇒
   **不虚构任何文件 base**（`base: undefined`、`ambiguous-multi-root`，逐一点名全部候选
   并由 `states()` 暴露），因此在恰好一个工作区活动之前该命名空间显示 schema 默认值。
   `base` 在整个**进程生命周期内固定**（宿主对一次活动注册不提供注销句柄）——这正是下方
   句子写作"重启后生效"的诚实理由——而插件真正使用的是**已解析的值**与配置层的
   **逐次调用文件读取**。保存的编辑会回写到
   当前会话工作区的 `<workspace>/.mpd/mpd.jsonc`，并保留注释与键顺序，配置层立即对所有工作区
   生效。**本区块的每个开关对插件行为的影响都需要重启**，因为 mpd 消费方在
   `apply()` 时读取配置——界面上同样如此说明：每个字段提示都写出自己的 mpd.jsonc 键并携带 `a
   save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and
   takes effect for the mpd plugins after a restart (this knob is read at plugin
   mount)`，并附上「仅存于设置中的保存不会丢失」的说明。十二个团队模型槽位的提示**以该开关自身的
   人类语句开头**（写明该槽位路由哪个成员分组，例如 `槽位 2 提供商（分析型成员）`，以及配置它的
   影响），之后才写出键与上述披露。当目标不明确时回写会
   **明确拒绝且不写文件**（无活动会话 `no-live-session`；多个活动工作区
   `ambiguous-multi-root` 并列出全部候选；只读/不可解析/冲突的文件），而设置值仍然
   生效；状态行会显示对应的运行时提示。不声明：某个具体前门的渲染效果（Web 卡片的
   浏览器渲染由用户在自己的 GUI 中验证）。
3. **web 专有界面在 TUI 中没有渲染面。** agent-teams 侧边栏与 workmate 标签页
   （`dsh.client.platform = web`）在 TUI 中不渲染。面板、状态行与对话框是**等价物**，
   不是像素或功能对齐声明。web profile 未受影响。
4. **随包技能仅为资产。** `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` 随包分发，但技能语料由
   `mpd-bootstrap` 从 `<bundle>/skills` 提供；本包内这份副本并未由该行注册。
5. **引擎版本偏差。** 宿主会提示 dsh 引擎比其 UI 验证版本更新；验证针对已安装
   引擎进行，而非该修订。
6. **宿主内部门禁不等于本插件的合规结论。** 宿主自带的 `verify:plugin-*` 套件验证
   的是宿主的插件子系统；即便全绿也不构成对本插件的合规判定。
7. **`Ctrl+A` 接管是按键改指，不是并入宿主 dashboard。** 不补丁任何宿主文件，也不扩展宿主 dashboard 的
   渲染：你落到的是 `mpd-tui-subagents`，它自己渲染宿主的 `channel.subagents` 行。只要团队里还有至少一项
   任务，`Ctrl+A` 就完全不再打开宿主 dashboard——把 `tui.dashboardKey` 关掉即可恢复宿主行为。
8. **它盯的是按键本身，而不是宿主当前对 `dashboard` 的绑定。** 如果你在 `/settings` 里重映射了该动作，只要
   存在团队，`Ctrl+A` 仍会打开合并面板：钩子监视的是宿主的默认组合键。我们不会替你重映射，宿主自己的绑定表
   也未被改动。
9. **只在纯聊天界面生效。** 钩子寄居在一个状态视图组件上，而每一个独占式宿主界面（对话框、`/settings`、会话
   树、supervisor、插件场景、宿主 dashboard 自身）都会让它卸载——`tui-deps-ctrla` 用例的设置界面臂在真机
   pane 上证明了这一点，而不是从宿主的分支顺序推断。
10. **`boxes` 视图不绘制跨 rank 依赖边。** 阻塞者位于两层或更多层之上的任务不会为它画出连线（既有布局规则：
    只连接紧邻上一层）。`rail` 视图会把额外的阻塞者内联写出（`⇠ T4+T6`）。
11. **合并入口的箭头取的是依赖方的色调，而不是边的色调。** 一个单元格无法同时承载多个父节点的色调，因此一条
    被压暗的边可能以子节点自身颜色的箭头收尾。
12. **`Ctrl+A` 接管是在"场景渲染"时就绪的，而不是启动时。** 在 dsh-tui 0.12.0 上实测：活的输入上下文只能
    通过宿主交给**场景**的 kit（`props.ui`）拿到；插件自行按文件 URL 导入宿主 `ui.js` 得到的是另一份模块
    实例，它的 `useStdin()` 什么也不返回。因此钩子会保存它收到的第一份 kit：你在本次会话里打开过任意 MPD
    面板或场景（`alt+a`、`alt+t`、`alt+m`、`/mpd board`）之后接管即生效；在那之前 `Ctrl+A` 保持宿主原
    有行为。对于 kit 从不送达的宿主，本包不做任何声明。

13. **`/mpd-model` 写入的是取值，并不保证建队成功。** 菜单只提供实时模型目录列出的内容；某个提供商实际并不提供的路由，仍会让建队**明确失败**（并点名成员与槽位）—— 这个失败就是如实的结果，本命令不做预校验，也不做钳制：每一档提供的都是 id，绝不是显示名。
14. **`LocalCommand.descriptions` 在本宿主上不可达，因此 `/mpd-model` 不声明它。** `dsh-commands` 的 `normalizeDefinition` 会把每个定义重建为 `{definitionId?, name, description, input?, recordInput?, handler}` 并丢弃未知字段，所以 `descriptions` 映射永远到不了注册表。用户在斜杠菜单里看到的文案来自**命令树节点**，而它确实携带双语；命令自身的 `description` 保持英文基准值，供宿主的 `tOr('cmd-desc-<name>', description)` 回落读取。
15. **语言解析不是逐帧订阅，且 MPD 不写任何语言偏好。** 它按 `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → 操作系统 locale（`zh` 前缀 ⇒ 中文；其他任何**已声明**的 locale ⇒ 英文，因此 `C.UTF-8` ⇒ 英文；整条链都为空时才用 `zh`）→ `zh` 的顺序、在**使用时**求值。`~/.dsh-tui` **只读**：`/lang` 始终是唯一开关，`/lang` 切换会在该字符串下一次使用时对其生效 —— 场景 `title`（在注册时固定）则要等重启。语言由 `cordis.yml` 的 `lang` 固定时属于**已知缺口**：该键由宿主自己的 `plugin.apply` 读取，插件看不见。
16. **侧栏面板的正文在当前宿主上无法用 tmux pane 抓取观测。** 实测：`/mpd panel` 报告一次**被宿主接受**的打开之后，320×50 的抓取与紧邻其前的一次**逐字节相同**（均为 3413 个字符），而 `alt+a` 什么都没改变 —— 因此真机 PTY 用例证明的是注册、被发现的 id（`act1:team`）与被接受的打开，而**不是**渲染。0.13.0 上不存在可用 pane 抓取的 MPD 依赖视图，因此不主张面板栏或面板正文绘制出来；合并本身由 `test/subagent-scene.test.ts` 与 `test/graph.test.ts` 覆盖，绝不靠 pane。
17. **旧宿主的 `Ctrl+A` 就绪路径没有 PTY 证据。** 干净的 0.12.0 沙箱需要 `dsh plugin add @deepseek-harness-tui/dsh-tui@0.12.0`，本机被只读的 pnpm store 锁拒绝；现有的 `.mpd/recon/tui-012` 夹具是混版组合，其 loader 在出现任何聊天界面前就卡在只属 0.13.0 的 `dsh-tui-panels` 那一行上。因此该路径依赖单元断言 —— 判据是 `src/panel.ts` 中的 `takeoverArmed`（`test/panel.test.ts`，16 通过）加上 `test/dashboard-key.test.ts` 的 `Ctrl+A` 决策臂（11 通过）—— 对真实 0.12.0 pane 不做任何主张。

## 构建与测试

```sh
bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm \
  --outfile packages/mpd-tui-plugin/dist/index.js
bun test packages/mpd-tui-plugin
bun run typecheck
```

`dist/index.js` 使用仓库既有工具链（bun，无联网步骤）构建，且自包含：运行时仅需
Node 内建模块。`Config` schema 来自本包已 vendor 的 schemastery
（`packages/mpd-agent-teams-plugin/_deps/schemastery`）——本包不声明自己的依赖。
该 vendor 副本是本包唯一一个指向**包目录**的相对说明符（经其自身 `package.json`
解析，其中同时给出 `exports.import` 与 `types`）；`src/` 中每一个相对**文件**导入
都带显式后缀（`.js`），而构建产物已把 vendor 副本内联，因此发布产物中不含任何
相对说明符。

## 许可证

不变：沿用仓库许可证（`LICENSE.md`，SUL-1.0）。本包不主张任何许可证变更。
