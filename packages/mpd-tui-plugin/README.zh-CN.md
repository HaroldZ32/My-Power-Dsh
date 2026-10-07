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
| 命令树 | `ctx.tuiCommandTrees` | `/mpd board`、`/mpd team`、`/mpd plan`、`/mpd status`、`/mpd panel`、`/mpd dag`、`/mpd workmate`、`/mpd workmates` 补全，以及 `/mpd-model` 根；两个根与每个子项都在 `descriptions` 中同时提供中英双语，由宿主按其当前 `/lang` 解析 |
| 模型菜单（R3） | `ctx.tuiDialogs` + 共享的目录/设置接缝 | **`/mpd-model`** —— 一个真正的选择式菜单，依次选择 槽位 → 提供商 → 模型 → 推理强度，并把所选路由写入 `/settings` 区块所编辑的 `mpd-config` 条目。选项来自该区块**自己**的投影（`teamModelOptionLists`）与同一份实时模型目录，因此菜单与设置行不可能互相矛盾；输出结果携带与区块完全相同的披露语句。任一档取消即不写入任何内容 |
| 快捷键 | `ctx.tuiShortcuts` | `alt+m` 打开面板 · `alt+a` 子代理 + 团队面板 · `alt+t` 团队工作流 · `alt+w` workmate 选择器 · `alt+r` 立即刷新状态行 |
| 侧栏页面（dsh-tui 0.13.0） | `ctx.tuiPanels`（经适配器） | **三个**页面 —— `team`（`MPD`、`order` 10、合并视图）、`dag`（`MPD DAG`、`◈`、`order` 11）与 `workmate`（`MPD workmate`、`◆`、`order` 12）；三者的 `minColumns` 都是 28，且都不声明 `compact`。接缝已绑定时，`alt+a` / `/mpd panel` 经 `tuiPanels.open()` 路由到合并视图；`/mpd dag` 与 `/mpd workmate` 路由到各自的页面。**任何**拒绝都会回退到该页自己的全屏场景（`team`/`dag` 用 `mpd-tui-subagents`，`workmate` 用看板场景）—— 绝不静默无操作 —— 每条命令都会打印一行双语状态，点名它到达的界面与最终 id。页面能否出现在屏幕上由宿主自己的两个开关决定，见下方"如何到达"一段 |
| 合并面板 | `ctx.tuiScenes` | `mpd-tui-subagents`——宿主自己的子代理行（含其 运行中/已完成/失败 计数）、团队正文，以及每条**已绘制**依赖边都以方向箭头 `▼` 收尾、下方带图例的任务 DAG：它是**回退**界面 —— 宿主没有面板接缝、或拒绝了打开请求时，`alt+a` 与 `/mpd panel` 落到这里；在 0.13.0 之前的宿主上，工作区存在团队时也可用 **`Ctrl+A`** 打开（见下方接管说明）。`enter` 打开选中子代理的详情，`i` 中断选中的活跃运行，鼠标点击选中行 |
| `Ctrl+A` 接管 | 一个 `ctx.tuiStatus` 视图 + 适配器的宿主输入接触面 | 当团队投影含有一个至少带一项任务的团队时，`Ctrl+A` 打开合并面板而非宿主自带的 dashboard；没有团队时——或宿主输入总线无法被适配器触达时——该键行为与今天完全一致（`tui.dashboardKey`，默认 `true`；见"明确不声明"第 7–9 条） |
| 对话框 | `ctx.tuiDialogs` | 托管式 workmate 选择器（`select`） |
| 决策事件 | `tuiPluginHost.subscribeDecision` | 已尝试注册、预期被拒绝、**未激活**（见下） |

支撑面（不属于上述七个接缝）：harness 命令注册表上的 `/mpd` 命令、`mpd` 设置
命名空间注册、以及 log-only 的 `mpd-tui/board-opened` 会话记录。

### 三个侧栏页面（dsh-tui 0.13.0）：合并视图、DAG 与 workmate 书架

本包通过宿主的 `tuiPanels` 接缝贡献**三个**页面，每个页面都有自己在模块作用域**冻结**的描述符
（`*_DESCRIPTOR_FROZEN`），且都在宿主自己的 `MAX_PANELS_PER_PLUGIN = 4` 配额之内：

| 模块 | slug（宿主会用本次激活的插件 id 加前缀） | 标题 | 图标 | `order` | `minColumns` |
|---|---|---|---|---|---|
| `src/panel.ts` | `team` | `MPD` | — | 10 | 28 |
| `src/panel-dag.ts` | `dag` | `MPD DAG` | `◈` | 11 | 28 |
| `src/panel-workmate.ts` | `workmate` | `MPD workmate` | `◆` | 12 | 28 |

三个页面的 `apiVersion` 都是 1（0.13.0 只接受这个值），且都**不声明 `compact`**：0.13.0 会校验并保存
那个行槽位，却**不挂载**它的渲染槽位，声明它就等于主张一个宿主永远不会绘制的界面。

**三页都向宿主请求 `minColumns` 28 —— 那正是宿主自己的底线 —— 而这个数字就是"面板看不见"这一缺陷的
修复。** 宿主的 `components/sidePanel/PanelHost.js` 会计算
`tooNarrow = def.minColumns !== undefined && width < def.minColumns`，为真时用一条 `panel-too-narrow`
提示**顶替**页面正文；而 `components/sidePanel/dimensions.js` 在分栏阈值处把面板列固定为它自己的
`PANEL_MIN_COLUMNS = 28`。旧的描述符向宿主请求 32，于是出现了一整段终端宽度：侧栏能打开、标签页也在，
用户看到的却是一条拒绝提示而不是团队图。宿主的描述符校验器对 32 照收不误，注册阶段不会变红 —— 只有按
宽度分段的测试才抓得到这类问题。28 列下的可读性是**页面自己**的职责（DAG 页按实际拿到的宽度在
`boxes`／`rail`／`list` 之间选择），绝不是要求宿主把列加宽。

注册在每一个宿主版本上都是安全的：apply 时的 `registerPanel(...)` 被适配器的延迟绑定器**入队**，在
没有 `tuiPanels` 服务的宿主上结算为 `absent`，且绝不抛错。最终 id 不在这里拼装 —— 它是从宿主自己的
`list()` 回读中**发现**的，因此在真机 0.13.0 宿主上调试行写作 `sidebar panel id: act1:team`（实测），
其它地方则是 `(not discovered)`。

**用户究竟怎么走到某一页 —— 在断定"面板不见了"之前请先读这一段。** 最终 id 是**动态**的
（`<activationId>:<slug>`；实测为 `act1:team`、`act1:dag`、`act1:workmate`，该组合里那个 plain loader
行不携带任何 Component 身份），所以任何地方都不写死它：请从宿主的 `/panel ` 补全列表得知，或直接读
`/mpd panel`、`/mpd dag`、`/mpd workmate` 打印的那一行（各自都会点名它实际走到的 id）。注册一个页面**本身
并不会**让它出现在屏幕上 —— 决定这件事的是**宿主自己行配置里的两个开关**，而本包无法代设（补丁行绝不能
id 指向宿主拥有的行）：

1. **该页必须在启用列表里** —— `/settings` → 侧栏 → *启用的面板*（`dsh-tui.sidePanel.panels`，默认
   `todo,jobs,agents`）：把该页的最终 id 加进去。宿主会保留一个格式合法但**尚无面板认领**的 id，因此在
   插件注册之前先写入 `act1:dag` 也没问题；默认列表正是新装配置只显示宿主自有标签页的原因。
2. **侧栏必须打开** —— 按 `Ctrl+B`（宿主的三态切换），或打开 *启动时展开侧栏*
   （`dsh-tui.sidePanel.open`，默认 `false`）。

**为什么开关 1 以前会自己失效，以及现在守住它的两条路径。** 宿主自己的注册通路**确实**会把注册成功的 id
追加进列表（`lib/types/dsh-adapter/panels.js` 的 `enablePanelIdInStore`），所以刚启动时列表读作
`todo,jobs,agents,act1:team,…` —— 然后在**实测约 +5.4 秒**时，`dsh-tui` 行会重新应用它的**配置**
（`applySidePanelPanels(config.sidePanel?.panels)`，经一次 `Fiber._reload` 抵达），追加进去的 id 就没了。
正是这次「瞬时追加」让全新配置只显示宿主自带三个标签页。现在有两条**互相独立**的路径守住这个列表：

* **自动、有界** —— TUI 适配器（`packages/mpd-tui-adapter-plugin`）带一个沉降守卫：它只重新断言**宿主
  自己的 `list()` 回读产出的那些 id**，而且只在启用列表里**一个我们的 id 都没有**时才动作；它把整组 id
  **一次性追加在用户列表之后**，从不删除任何一个 token，也从不改变顺序。如果列表里出现了**任何一个**我们的
  id，那就说明**配置已经就本 bundle 表态了** —— 你在 `/settings` 里启用了我们、或跑了下面的脚本、或故意
  只删掉了其中几个而留下其余的 —— 此时守卫**主动退让**，因此它绝不会把你本想移除的页面又放回去。它在启动后
  的前 ~25 秒内走完六个 tick 然后**永久停止**。它发现的 id 会记录到
  `<workspace>/.mpd/logs/mpd-tui-panels.json`，因为没有任何源码常量能知道它们。这是该适配器的**第二处**
  宿主内部接触（第一处是 `Ctrl+A` 的 `useStdin` 触点；AGENTS.md §6 明确给这类接触计数，因此两处都在该文件里
  点名）。
  **明码标出的残留风险**：如果一个用户故意把我们**全部**移除，剩下的列表与全新配置**无法区分**，因此守卫
  每个启动周期仍会把整组加回一次。要区分这两种情况就必须读到**配置里写的那个值** —— 也就是第三处宿主内部
  接触，而这属于 AGENTS.md §6 的计数决策，本轮**刻意不做**。让某个 bundle 页面永久消失是用户层的事，而那
  正是脚本所写的东西；写进去之后守卫就不再动它。
* **持久、一条命令** —— `node scripts/mpd-tui-panels.ts` 把 `dsh-tui.sidePanel.panels` 写进 **profile
  自己的 patch 文件**，而它就是宿主的设置用户层：`dsh-config-editor` 的 `documentPath` 返回
  `profileContext.patchPath`，`dsh-app-boot` 把它拼成 `<profileDir>/cordis.patch.yml`。脚本会读取**这两个
  已安装源码**，在无法证明该路径时**拒绝写入**。它默认是**试运行**，会打印将要改动的那个叶子节点，支持
  `--apply`，会留一份 `.bak`，并且只补列表里缺的 id。当设置层来得太晚、超出有界守卫的视野时，或者你希望
  这个选择跨重启保留时，就用它。

两个开关就位后，`/panel <id>` 切到该页（`/panel toggle`、`focus`、`zoom` 是另外几种形式），`Alt+Z`
缩放当前面板。**未设**时的实测：标签栏读作 `│ ‹ 待办 › ▸ ◆`，宿主活的启用列表是
`toggle, focus, zoom, todo, jobs, agents`。**设好**时的实测（120 列）：标签栏出现
`‹ MPD ›`、`‹ MPD DAG ›` 与 `‹ MPD workmate ›`，页面正文渲染出来。面板列只在宿主分栏处存在 ——
同一份抓取在 80 列与 48 列上报 `split=false`，即根本没有面板列：那是宿主自己的阈值，不是 MPD 的设置项。

出于同样的原因，`/mpd panel` 的句子刻意保守：*"宿主已接受 {id}；若没有出现面板，请在 /settings → 侧栏
里把 {id} 加入面板列表，并按 Ctrl+B 展开（或开启"启动时展开侧栏"）"*。宿主的 `tuiPanels.open()` 只在请求
**被送达**时返回 `true`，而它自己的 `useSidePanel` 会**丢弃** id 不在启用列表中的请求 —— 因此旧措辞是
一次假绿灯。MPD 也无法观测渲染：宿主的事件集合是
`registered|unregistered|badge|error|disabled`（`opened`/`focused` 是宿主明确的 TODO），所以诚实只能写在
句子里，而不是写进分支。

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

**两个独立页面走同一条路由。** `/mpd dag` 与 `/mpd workmate` 调用 `openPage(...)`，与合并视图共用同一套
仲裁，并各自带自己的**兜底**场景（`dag` → 全屏合并子代理场景，`workmate` → 看板场景）；两者都打印
`slug · <同一句路由结果>`，因此那一行既点名宿主接纳的是**哪一页**，也点名它实际走到的最终 id。裸 `/mpd`
的动作选择器同样多了这两个动作，而每个子命令行都携带双语描述，交给宿主按自己的 `/lang` 解析。

**`Ctrl+A` 按版本设闸。** 在提供面板接缝的宿主上，旧的宿主输入接触面被直接跳过 —— 无论配置层说什么，
`takeoverArmed(seamBound, savedKnob, floor)` 都返回 `false`，聚合行会点名原因，`Ctrl+A` 保留宿主
dashboard 的原义。在没有该接缝的宿主上，接触面与以往完全一样地就绪，且在那里已保存的 `tui.dashboardKey`
高于行配置的底线。这道闸**每次按键**都会重读，而不只在 apply 时 —— 因为适配器是经延迟注入绑定该接缝的；
因此 `tui.dashboardKey` **只在旧宿主上有意义**，在 0.13.0 宿主上这个键不归 MPD 花。

行配置新增的 `panel` 开关（默认 `true`）同时关掉贡献与路由：不再尝试注册（聚合行上报适配器自己的
`skipped("panels", …)` 结果并点名该配置），`alt+a` 与 `/mpd panel` 保持面板出现之前的全屏路径，而
`Ctrl+A` 是否就绪只由接缝决定。

**如实写出的边界。**（1）可见性主张是关于**那两个开关**的主张，而且有实测：当 `sidePanel.panels` 带着页面
id、侧栏也打开时，120 列的冻结版本抓取里标签栏读作 `≡ ▸ ◆ ‹ MPD › ◈ ◆`、`≡ ▸ ◆ M ‹ MPD DAG › ◆` 与
`≡ ▸ ◆ M ◈ ‹ MPD workmate ›`，`mpdTab=true`；未设时标签栏只有宿主自己的三个标签页（`‹ 待办 › ▸ ◆`）。
同一份抓取在 80 列与 48 列上报 `split=false` —— 宿主根本不画面板列，因此在那里无论列表怎么写都不可能
有页面可见。（2）MPD **无法**观测渲染：宿主的事件集合里没有 `opened`/`focused`（那是宿主明确的 TODO），
所以插件知道的只是"id 已被拼装 + 请求已被接受"，绝不是"已经画出来了"；先前那次逐字节相同的抓取正是 R13
的动因，也是这句话只点名补救步骤、不主张成功的原因。（3）0.12.0 一侧**没有 PTY 证据**：干净的 0.12.0
沙箱需要 `dsh plugin add @deepseek-harness-tui/dsh-tui@0.12.0`，本机被只读的 pnpm store 锁拒绝（现有的
`.mpd/recon/tui-012` 夹具是混版组合，其 loader 在出现聊天界面前就卡在只属 0.13.0 的那一行上），因此旧
宿主的就绪路径依赖单元断言 —— 判据是 `src/panel.ts` 中的 `takeoverArmed`，由 `test/panel.test.ts`
覆盖，另有 `test/dashboard-key.test.ts` 的 `Ctrl+A` 决策臂 —— 而**不是**某次 pane 抓取。

证据：`evidence/tui/lanes/2026-10-06T10-27-42.389Z/`（挂载用例 PASS）、
`evidence/tui/lanes/2026-10-06T10-27-53.571Z/`（8 个界面中 7 个渲染，面板行绿、负对照红）、
`evidence/tui/lanes/2026-10-06T10-28-57.807Z/`（宿主的 `Ctrl+A` **保持惰性**，而 `/mpd panel` 证明了
侧栏注册 + 被接受的打开）、`evidence/tui/lane-repair/013-20261006T102742Z/TUI-013-LANE-REPORT.md`，以及
—— 针对**本次**波次的三个页面 —— `evidence/tui/dag-port/verification/pty/frozen/`（冻结版本的真机 PTY
抓取：标签栏里的三个 MPD 标签页、pin/unpin 键位、以及带 `split=false` 分支的宽度矩阵）与
`evidence/tui/dag-port/seam-guard/20261006T135423Z/T6-WIRING.md`（接线与 R26 措辞）。

### DAG 页面：自适应纵排 rank、六种状态色调与图例

`src/panel-dag.ts` 把依赖 DAG 做成**独立**页面（冻结条款 R1），带上合并面板负担不起的外框：带边框的
框架、点名团队与其进度的表头、图形本体、图例，以及一行只列本页真正处理的按键的页脚。

- **纵排、且自适应，任何地方都没有固定尺寸。** rank 是**纵向**轴（自上而下），图形直接**复用**
  `graph.ts` 而不是另写一套：`layoutBoxes`（每个任务一个带框盒子）、`layoutRail`（缩进森林）、
  `layoutList`（按 rank 分组、带进度条的表格 —— 在这一页出现之前它没有任何调用方）。`dagPanelLayout`
  按面板**实测**到的宽度选择画法：`boxes` 宁可**拒绝**也不画一个被挤扁的盒子，rail 在森林仍放得下时接管，
  `list` 是窄而拥挤时的密集兜底。这里没有任何常量决定谁有多宽；本波次用户的决定就是
  「纵向，但不要固定尺寸」。
- **rank 由依赖图**推导**，绝不听信服务端给的 `depth`（R17）。** 绘制自己把每个 rank 算成"其下**能解析**
  的阻塞者构成的最长链"；服务端的 `depth` 至多只是一个提示。这修掉了一个已实测的、静默的谎言：线上看板
  的阻塞引用写成了计划序号（`["2"]`），而任务 id 是 `T1..T10`，于是 store 丢掉了每一个无法解析的引用、
  每个任务都变成根、每个 depth 都变成 0 —— 图形只画**一列**、**一条边都不画**，而且什么都不说。本页会
  报出究竟是哪个来源画的：`view boxes · 12 tasks · ranks derived` 对比 `· ranks served`。
- **解析不了的阻塞引用是可见事实（R18）。** `GraphView.unresolved` 会以警告色调打印成
  `unresolved blockers: <ids>` —— 静默丢数据正是上面那个缺陷的成因，绝不能在下一层重演。
- **六态色调是一张表，而不是散落的字面量（R5）。** `dag-theme.ts` 持有 `DAG_STATE_TONES`（图例顺序下的
  六个状态）、`DAG_TONE_THEME`（completed→`success`、running→`activity`、failed→`error`、
  blocked→`warning`、cancelled→`inactive`、open→`subtle`）、`DAG_TONE_GLYPH`（`✓ ◐ ✗ ○ ⊘ ○`）、
  `DAG_KIND_ABBREV`（`REQ WRK REV FIX INT`）与 `DAG_CHROME`（边框样式，以及图例必须点名的
  `▼ ▸ ▶ ◆` 标记）。WEB 视图的十六进制色值只作为**出处**记录（`DAG_TONE_WEB_HEX`），没有任何地方渲染它们。
- **图例消解了 WEB 视图从来不必消解的歧义（R6）。** `blocked` 与 `open` 按设计共用字形 `○`，因此图例
  会把共用者一起印出（`○ open=blocked · ○ blocked=open`），并且**换行**而不是缩写状态名 —— 放不下的条目
  直接**丢弃**，绝不截断。箭头与焦点那几句取自 `graph.ts` 自己的 `legendLines`，所以图例点名的字符与图形
  实际绘制的完全一致。
- **点击钉住 + 键盘（R11）；悬停**刻意不做**。** 一次点击经图形自己的命中矩形解析并钉住该任务；钉住的详情
  体画在图形下方，按固定顺序印出十条事实，记录里没有的以 `—` 占位：`id`、`kind`、`visual`、`verdict`、
  `failedBy`、`owner`、`attempt`、`round`、`blockedBy`、`dependents`。按键：`↑↓/jk` 移动焦点，`Enter`
  钉住，`Esc` 取消钉住。**没有**悬停面 —— 终端没有指针移动，而用户在需求会上明确放弃了这一项。
- **滚动，以及一个**已知未修**的缺陷。** 正文在内容溢出时自带**常驻**比例滚动条，并支持滚轮与
  `PgUp`/`PgDn`/`Home`/`End`。常驻的理由来自宿主自己的规则：自动隐藏的滚动条会改变内容宽度，出现的一瞬
  就会让每一行重新折行。缺陷是：无界的 `PgDn` 连按可以把窗口推到零行，因为偏移量跨渲染累积。它已被定位、
  设界并记录 —— 滚动是能用的，但**不是**完美无瑕的。
- **徽标、空状态、环。** 有失败任务时徽标为 `error`，有任务在等未完成的阻塞者时为 `warning`，看板在跑时
  为 `info`，无事可报时**清空**徽标（过期徽标比没有更糟）。没有团队时页面点名填满它的调用：
  `no team in this workspace — `agent_teams_plan` stages one`。依赖**环**以失败色调报出
  （`dependency cycle: <ids>`），而不是被静默画少一条边。

**OPT-1 是用户决定，不是实现细节。** **失败**的依赖**不**阻塞它的下游：下游保持 `open` 且可派发，失败被
报在状态**旁边**（`failedBy`，在钉住详情体里渲染为 `failedBy <ids>`），绝不折进 `blocked`
（`graph.ts` 头部、`team-store.ts` 与 `team-state.ts` 承载同一条规则；绘制只画交给它的 `visual`，从不
重新推导）。

冻结版本上 120 列的实测：本页自己的那一行读作 `view rail · 12 tasks · ranks derived`，图例的状态键把共用
字形消解为 `○ open=blocked · ○ blocked=open`。

### workmate 页面：把库做成只读书架

`src/panel-workmate.ts`（冻结条款 R12）把持久 workmate 库（`$HOME/.mpd/workmate/<key>/`）渲染成**独立**
页面，而不是合并面板里的一节，因为这个库是**按用户**的书架，而不是按工作区的团队。它在构造上就是**只读**
的：既不创建、也不修改、也不归档任何实例 —— 改动面始终是 `mpd_workmate_*`，因为一个按键就能归档库条目的
页面是陷阱而不是功能。每一次文件系统读取都是被包住的：库不存在（第一次 `mpd_workmate_init` 之前的正常
状态）、目录不可读、`meta.json` 被手改、或某实例没有 note，代价都只是某一行或某个字段，绝不是整页。每个
条目印出 `name · key`、它的 BASE 模板、使用次数、描述与 note，并按最近更新优先排序 —— 与
`mpd_workmate_list` 提供的顺序相同，因此面板与工具不可能给出不同说法。键盘行为与 DAG 页一致，空状态点名
填满它的调用：`no workmates yet — `mpd_workmate_init` creates one`。它的刷新节拍是 2000 ms，而 DAG 页是
1000 ms，因为库是在工具调用时变化、而不是在按键时。

### 依赖图：箭头、图例与 `Ctrl+A` 接管

`src/graph.ts` 用三种画法绘制看板，并选择终端放得下的最宽的一种：`boxes`（分层 DAG，纵轴是最长
依赖路径，因此一条链自上而下阅读）、`rail`（窄终端的缩进森林）、`list`（看板过密时的按 rank 分组表格）。
每一条**已绘制**的依赖边都以方向箭头收尾——`boxes` 里是 `▼`，`rail` 里是 `▸`——指向**依赖方**；多个阻塞者
汇聚时仍然只显示**一个**箭头：合并入口是写成**文本**而不是交叉字符的，因为没有任何方向位能表达"……并且这条
依赖指向这个盒子内部"。两个调用方（团队场景与合并面板）都在图下方渲染 `legendLines(width)`；它同时说明两种
箭头标记、五个状态字形（直接取自绘制所用的同一张表）以及焦点标记，并在终端过窄时**丢弃**一整句而不是把句子
截断。

**绘制引擎**推导**它要画的东西，并说出赢的是哪个来源（本波次）。** rank 由看板实际能解析的依赖图算出 ——
即"其下能解析的阻塞者构成的最长链"，只有在什么都解析不出来时才把服务端的 `depth` 当提示；`GraphView`
携带 `ranksDerived`（究竟是哪个来源画的）与 `unresolved`（看板上没有对应任务的阻塞引用），让页面能把两者
都报出来而不是藏起来。另有两个已实测缺陷修在**绘制内部**：宽字形（CJK）占两个单元格，因此它后面那一格现在
渲染为空而不是空格 —— 过去任何一个宽字符之后，带框的行都会丢掉右侧边框；而窄宽度底线现在是诚实的：
`layoutBoxes` 在盒子宽度不足 `MIN_NODE_WIDTH`（16）时返回 `undefined` 而不是画一个挤扁的盒子，DAG 页还会
在标签区至少达到 `MIN_BOX_LABEL_CELLS`（32）时才选择带框画法，因此窄面板会降级为 rail 或 list，而不是把
盒子裁掉。

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
16. **侧栏页面只有在宿主自己那两个开关都就位时才会出现，而 MPD 永远无法观测渲染。** 冻结版本上的实测：
    当 `sidePanel.panels` 带着页面 id、侧栏也打开时，120 列真机 PTY 抓取的标签栏读作
    `≡ ▸ ◆ ‹ MPD › ◈ ◆`、`≡ ▸ ◆ M ‹ MPD DAG › ◆` 与 `≡ ▸ ◆ M ◈ ‹ MPD workmate ›`（`mpdTab=true`）；
    未设时标签栏只有宿主自己的三个标签页，而 80/48 列下宿主上报 `split=false`，即根本没有面板列。页面 id 是
    **动态**的（`<activationId>:<slug>`；实测 `act1:team`、`act1:dag`、`act1:workmate`），而补丁行不得
    id 指向宿主的行去代设这两个开关，所以补救只能写成给用户的具名步骤（见"如何到达"一段）。插件自己知道的
    只有"id 已被拼装 + `open()` 请求已被接受" —— 绝不是"已经画出来了"：宿主的事件集合里没有
    `opened`/`focused`（那是宿主明确的 TODO）。
17. **旧宿主的 `Ctrl+A` 就绪路径没有 PTY 证据。** 干净的 0.12.0 沙箱需要 `dsh plugin add @deepseek-harness-tui/dsh-tui@0.12.0`，本机被只读的 pnpm store 锁拒绝；现有的 `.mpd/recon/tui-012` 夹具是混版组合，其 loader 在出现任何聊天界面前就卡在只属 0.13.0 的 `dsh-tui-panels` 那一行上。因此该路径依赖单元断言 —— 判据是 `src/panel.ts` 中的 `takeoverArmed`（`test/panel.test.ts`，16 通过）加上 `test/dashboard-key.test.ts` 的 `Ctrl+A` 决策臂（11 通过）—— 对真实 0.12.0 pane 不做任何主张。
18. **只属于浏览器的行为刻意**不**移植。** 悬停、WEB 视图的**像素**几何（固定 `168px` 列、`42px` 节点）、
    CSS 省略号、`overflow:auto`、原生 tooltip、DOM 读取与 `fetch` 轮询在终端里都没有对应物，因此直接舍弃
    而不是假装实现。移植的是 WEB 视图的**语义**与视觉语言 —— 六个状态、各自的色系、rank 的方向 —— 而绝不是
    它的几何；这也是 TUI 里每一个尺寸都由实测面板算出的原因。WEB DAG 是那些语义的**参照**，除它自身可读性所
    必需的 rank 推导与连线走线修复之外，本波次没有修改它。
19. **DAG 页的滚动条能用，但**不**完美。** 无界连按 `PgDn` 可以把窗口推到零行，因为滚动偏移量跨渲染累积；
    `clampScroll` 界定了取值范围，但累积本身仍未修。它已被定位并记录 —— 冻结版本上 `bun test ./packages`
    的两个失败臂正是这两个偏移量累积臂（`evidence/tui/dag-port/freeze/FROZEN-REVISION.md`）。

## 构建与测试

```sh
bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm \
  --outfile packages/mpd-tui-plugin/dist/index.js
bun test packages/mpd-tui-plugin
bun run typecheck
```

`dist/index.js` 使用仓库既有工具链（bun，无联网步骤）构建，且自包含：运行时仅需
Node 内建模块。`Config` schema 来自本 bundle **自有**的 schemastery
（`packages/mpd-schemastery`，由 de-vendor 波次从已退役的 agent-teams 主体迁出）——本包不声明自己的
依赖。该副本是本包唯一一个指向**包目录**的相对说明符（经其自身 `package.json`
解析，其中同时给出 `exports.import` 与 `types`）；`src/` 中每一个相对**文件**导入
都带显式后缀（`.js`），而构建产物已把 vendor 副本内联，因此发布产物中不含任何
相对说明符。

## 许可证

不变：沿用仓库许可证（`LICENSE.md`，SUL-1.0）。本包不主张任何许可证变更。
