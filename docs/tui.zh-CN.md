# DSH-TUI 版本

[English](./tui.md) | **中文**

本页说明 my-power-dsh 的 **DSH-TUI 版本**：它提供什么、如何安装、逐包兼容性测量的结果，以及它
**明确不声明**什么。目标宿主为 `@deepseek-harness-tui/dsh-tui` **0.14.0** 及其内置的准入
（admission）配置文件——该版本新增 **Claude 后端 peer**（`@anthropic-ai/claude-agent-sdk`
0.3.287）与 `ws` 运行时依赖、第**八**个内置侧栏面板（`btw`），并把 `PanelBar` 改成**轮播**：只画
当前标签页的标题加 `○`/`●` 圆点，不再绘制插件声明的图标。§11.6 是本波次的修订，其中列出了本次
移动触及的各个载体。**此前的钉定版本是 0.13.0，那段表述作为历史保持可读**：0.13.0 是**新增侧栏
面板接缝**的那个版本——宿主 row 为 `dsh-tui-panels`，
导出为 `@deepseek-harness-tui/dsh-tui/panels`——它同时把宿主自己的 `dsh-ecosystem-spec/` 目录更名为
`tui-profile/`；本版本把这条新接缝采纳为**第十五条** `tui*` 接缝（§3、§3.3）。**此前的钉定版本是
0.12.0，那段表述作为历史保持可读**：0.12.0 是 peer 范围覆盖本 bundle 所钉 harness 整段区间的 dsh-tui
版本 —— 其列表一路列到 `0.1.7-rc.2`、`0.2.0-rc.1` 与 `0.2.0-rc.2`，而 `0.11.2` 只到 `0.2.0-rc.1`
（0.10.1 与 0.10.2 只到 `0.1.5-rc.1`），因此它是第一个能与本 bundle 所针对的 harness 一起启动的版本；
0.13.0 自身 `peerDependencies` 的末端同样是 `0.2.0-rc.2`（读自已安装的包）。**这次移动在同一个波次里
改动了每一个载体**：全局包与 `dsh-tui` profile、分发描述符的 `host-tui` 引用（0.13.0 还是钉住版本时，
`dsh-distribution.json` 里写的是 `pkg:npm/@deepseek-harness-tui/dsh-tui@0.13.0`），以及 QA 宿主规格
（`docker/tui-lane.sh`、`docker/entrypoint.sh`、`skills/dsh-qa/scripts/tui-mount.ts` 的
`TUI_HOST_SPEC` 与 `skills/dsh-qa/scripts/install-dependencies.ts` 的修复命令，当时的默认值均为
`0.13.0`）。**这两类载体在 0.14.0 波次中又移动了一次——当前生效的取值由 §11.6 那一节给出，而不是本节。**
下文的兼容性
测量是在 0.10.1 上做的，并已在 Docker 端到端测试（`docker/tui-lane.sh`）中重新验证 —— 那也是
唯一能端到端跑通 TUI profile 的地方。

> **请先读这一段。** 本仓库**没有**发布任何一致性声明（conformance claim）。该生态的声明产物
> （`schemas/conformance-claim.schema.json`，`claimVersion` 为 `"0.15"`，`specVersion` 为
> `"community-v0.15"`，`evidenceLevel` 取 Declared/Parsed/Negotiated/Tested/Observed/Attested）
> 是一个独立的、刻意未执行的步骤。下文的每一条结论都标注了真正支撑它的证据级别；本页写作时仍在
> 进行中的验证通道一律写为 **pending（待完成）**，不会写成"已验证"。

## 1. TUI 版本包含什么

| 产物 | 路径 | 说明 |
|---|---|---|
| TUI 界面包 | `packages/mpd-tui-plugin/` | TUI 原生界面：**两个侧栏页面**（`src/panel.ts`——标题 `MPD`，主入口，且自 0.14.0 波次起它本身就是富形态 DAG 页，§3.3/§3.4——与 `src/panel-workmate.ts`）、状态行、`/settings` 区块、全屏场景、`/mpd` 命令树、快捷键、受中介的对话框、**宿主未投影**的转写渲染器注册（明确不声明第 10 条），以及"就绪但未激活"的决策事件接缝。 |
| 准入清单 | `dsh-plugin.json`（仓库根目录） | 整个 bundle 的**唯一**一份 Community v0.15 清单——这是刻意的偏离（见 §7）。 |
| 环境描述符 | `dsh-distribution.json`（仓库根目录） | 面向 dsh-distribution 元协议（Draft）的 `DistributionDescriptor`。 |
| TUI 组合 | `cordis.patch.yml` | 新增 `mpd-tui` 行与 `dsh-tui` 花名册默认值，使 TUI 会话默认使用 **mpd** 预设。 |
| 本页 | `docs/tui.md`、`docs/tui.zh-CN.md` | 以上内容的人工说明。 |

Web 版本不受影响：同一个 bundle 仍可安装到 web profile。

## 2. 安装

```sh
dsh plugin --profile dsh-tui add /path/to/my-power-dsh
```

这一条命令就是全部安装内容（插件代码、清单、技能、MCP 行）。不存在逐包 `dsh plugin add`；
TUI 包刻意不带 `cordis.patch.yml`——第二次挂载会产生重复的 loader entry id，而 loader 会直接
拒绝。

安装后的组合实测（t5，`evidence/tui/composition/20260915T053445Z/`）：
`dsh.profile.bundles` = `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`，
本 bundle 是**第三个** patch 层；bundle patch 贡献 24 行；真实启动日志中应用期崩溃特征计数为
**0**（`unsupported JSON schema`、`JsonSchemaError`、`plugin tree failed to load`、
`failed to apply loader entry`、`Error:`）；没有重复的 loader entry id。**证据级别：**
`Observed`（一次被记录的真实 dsh-TUI 启动，加上宿主自身的 `--dump-config`）。仅有
`--dump-config` 只能证明组合，不能证明加载——崩溃特征计数来自真实启动。

TUI 会话默认使用 **mpd** 预设，由 id 定向的 `agent-preset-registry` 行（`default: mpd`）与
`presets/mpd.patch.yml` 中的 `preset-mpd` 行共同承载（依据是抓取到的会话
记录，而不是 patch 文本）。

任何实机通道的前提：stdout 不是 TTY 时 `dsh-tui` 拒绝启动
（`dsh-tui requires an interactive terminal (stdout must be a TTY)`），因此 QA 通道必须在 tmux
内驱动真实 TUI 并抓取 pane；也正因这一边界，TUI 通道**没有**纳入 `bun run test:qa` 的自检扫描。

## 3. TUI 界面与对应的 Web 界面

原先仅存在于 Web 的界面，在 TUI 中有**等价物**，不属于同等对齐：

| Web 界面 | TUI 等价物 | 证据级别 |
|---|---|---|
| Agent Teams 面板（会话头部） | **`tuiPanels` 侧栏面板**——主入口（§3.3）——并以 `tuiScenes` 全屏界面作为其**回退**（页面自己的 `⤢` 用富形态 `mpd-tui-team` 场景，路由回退用合并的 subagents 场景），外加 `tuiStatus` 状态行 | 0.13.0 上实测到注册 + 宿主**接受**的打开——`evidence/tui/lanes/2026-10-06T10-27-53.571Z/` 与 `…/2026-10-06T10-28-57.807Z/`，从宿主自身回读中发现的 id 为 `act1:team`；全屏场景已在 0.10.1 时期的实机通道 `evidence/tui/live/20260915T063140Z/result.json` 中渲染（t8；7 个界面中 6 个） |
| Workmate 库标签页 | `tuiCommandTrees`（`/mpd …`）+ `tuiDialogs` | 同上（同一实机通道证据） |
| — | `tuiStatus` 状态行；`tuiRenderers` 转写行**宿主未投影** | 状态行已渲染；渲染器行**未渲染**——见明确不声明第 10 条 |
| — | `tuiSettingsSections`（mpd.jsonc 可调项的 `/settings` 区块） | 已渲染——同上；该区块写明与 `<workspace>/.mpd/mpd.jsonc` 的**打通**、重启提示与"绝不丢失"条款（§6.2），通道以 `allPatterns` 断言这段披露文本 |
| — | `tuiShortcuts` | 已渲染——同上 |
| 团队工作流（成员表和成员阶段、共享任务板） | `mpd-tui-team` 场景 —— `/mpd team` | 场景由 TUI 命令树注册（`packages/mpd-tui-plugin/src/command-trees.ts`）；界面契约与每一行的证据层级见一致性台账 `docs/tui-parity.md`（打开方式见下文 §3.2） |
| — | `mpd-tui-plan` 场景 —— `/mpd plan` | 一个 TUI 场景；它当初围绕的"暂存计划批准"语义属于已退役的内置插件，现已不存在（§3.2） |

13 个接缝在范围内：本波次新建 8 个（settings 区块、场景、对话框、状态、快捷键、渲染器**注册**、
决策事件尝试、组合行）；已有 5 个由既有 bundle 承载（会话事件、技能打包、主题资源、系统提示区块、
profile 组合）；**1 个（`tuiPrompt`）宿主不提供，完全不声明**；**另 1 个（`tuiRenderers`）虽已注册，
但宿主不投影任何转写行，因此其转写行同样不声明**——与 `tuiPrompt` 采用同一种明确处理，记为明确不
声明第 10 条。

**自 0.13.0 起，接缝清单是十五条 `tui*` 接缝，其中新增的那条是 `tuiPanels`。**
适配器的单一事实表（`packages/mpd-tui-adapter-plugin/src/index.ts` 中的 `TUI_SEAMS`）如今承载
dsh-tui 自 0.12.0 起就暴露的十四条接缝，加上 0.13.0 新增的侧栏面板注册表——本波次把计数从 14 移到
15——每一条都按同一套纪律绑定、探测与降级：每条接缝一次延迟 `ctx.inject([id], …)`，以
`ctx.get(id, false)` 作探针，永不绑定的接缝报 `absent`，而不是让启动失败。上面那段"13 个接缝"是首个
波次范围的记录，保持原样。

**0.14.0 不改动这十五条中的任何一条。** 宿主 `lib/types/dsh-adapter/` 下面向插件的接缝模块 ——
`panels`、`scenes`、`status`、`renderers`、`settings-sections`、`shortcuts`、`dialogs`、
`command-trees`、`plugin-host`、`toast`、`themes`、`plugin-storage`、`message-observer`、
`effect-ledger`、`workspaces`，每个都有 `.js` 与 `.d.ts` —— 在 0.13.0 与 0.14.0 之间**逐字节相同**，
也不存在第十六条接缝；harness 的 `peerDependencies` 范围同样未变（末端仍是 `0.2.0-rc.2`），因此
`MPD_E2E_DSH_VERSION` 不动：**接缝层面不需要任何适配器代码改动**。0.14.0 究竟改了什么，见 §11.6。

### 3.1 Web 界面的设置界面（设置 → MPD）

同样的 25 个可调项 —— 原有 13 个加十二个 `teamModels` 槽位叶子，后者渲染为联动的模型 + 推理强度
选择器 —— 也能在 Web 界面里编辑：**设置 → MPD**，即设置对话框中独立的一栏——它不再位于"插件"
标签页内。该栏按宿主自有栏目（section）的注册方式注册（`ctx.slots.inject("settings.section", …)` →
`ctx.slots.register({ name: "settings.section", id: "mpd", order: 20, label: () => t("nav"), locale, inject }, Section)`，
形状取自 `dsh-client-ui-settings-models/lib/client.js:2936` 的实测）：设置外壳收集该列表槽位、按 `order`
排序并渲染当前激活项，因此 `order: 20` 让 MPD 排在 `general`（0）、`models`（10）、`plugins`（15）之后，
且不移动任何既有栏目。该栏原样渲染卡片，不声明任何嵌套 `children`；没有被注册的命名空间什么也不渲染——这
正是此前可调项不可见的原因。写入走公开的 `ctx.settingsScope.bind({ namespace: 'mpd' }).mutate(ops, revision)`
接缝（支持嵌套路径；复位用 `unset`），不可写的 scope 会带原因渲染为只读，并且绝不尝试写入。卡片的字段、
标签与中文描述由它自己的测试与 TUI 区块的描述符逐一比对，因此两扇门不会各自漂移。

**证据级别——已见证：** **已构建且已服务**的客户端字节中的注册契约
（`packages/mpd-bundle-plugin/client.js`；通道会重新哈希它所判定的那份产物，本次移动前后的大小与 sha256
都记录在证据中）、**离线钩子测试台（offline hook harness）**在注册被**调用**时记录下的该栏描述符——id、
order、label、locale、无 `children`、其字段与 TUI 描述符的一致性、以及模块行为——渲染、以正确的路径/值/
revision 驱动 scope 写入、拒绝非法草稿、带原因渲染为只读——以及经由宿主自身带认证的 settings API 完成的
**端到端写入路径**（`web-settings-bridge.ts` W1–W13）。

**证据级别——本环境未见证：** **真实浏览器渲染**（宿主在真实页面中分发该 key）与**点击驱动的保存**。
本环境没有浏览器可执行文件；通道以 `cardClaim.W3.witnessed === false` 记录这一点及原因，本页重复该结论，
绝不暗示相反。要自己看到它：启动 `dsh web`，打开界面，进入 **设置 → MPD**，应看到带 25 个可调项（十二个
团队模型槽位提供由目录驱动的选择）的
`mpd` 栏，编辑一项并保存——恰好一个活动会话时，工作区的 `<workspace>/.mpd/mpd.jsonc` 会在保留注释的
前提下改变；否则打通功能会大声拒绝（`no-live-session` / `ambiguous-multi-root`）并说明取值并未丢失。

### 3.2 团队工作流与计划界面（波次 `tui-team-surface`）

TUI 命令树暴露 `/mpd team`、`/mpd plan`，以及自 0.13.0 适配起新增的 `/mpd panel`
（`packages/mpd-tui-plugin/src/command-trees.ts` 就是动作清单：`board`、`team`、`plan`、
`subagents`、`panel`、`workmates`、`status`），以及带 key 的状态行与看板场景。

**批准闸门已经回到 mpd 的 plan 平面，本节如实写明。** 最初的实现调用的是已退役的内置
`agent-teams` 工具（`agent_teams_approve`、`agent_teams_delete`），并依赖持久的
`.mpd/team/team.json`；而本 bundle 现在挂载的官方 Agent Teams 插件**没有暂存计划，也没有批准步骤** ——
Lead 用 `spawn_teammate` 创建队友、用 `team_task_create` 开通道，共享任务板就是计划（见
`docs/user-guide.zh-CN.md` §6 与 `docs/plan-0.1.7-adaptation.md` §3）。但**暂存计划本身并未消失**：
它由**本 bundle 自己**拥有（`mpd-team-core` 的 `agent_teams_plan`，保存在 `<workspace>/.mpd/team/` 下），
且自 W6 起 TUI 计划场景重新承载了批准闸门。用 `/mpd plan` 打开，逐字输入面板提供的**确切**短语
（`approve plan-…`，与 Web 面板来自同一份投影），按 `Ctrl+X`；10 秒内按两次 `Ctrl+D` 丢弃该暂存计划，
`Ctrl+R` 重新读取，`esc` 返回。该动作是一次 `agent_teams_plan {action:"approve"|"delete"}` 调用，
因此批准会落地 mpd 记录、并通过 **native 执行器**唤醒其成员 —— 不需要官方服务。调用方以**身份**
随调用传递，从适配器**自身**的实时注册表解析（`liveAgent(sessionId)`，否则取 `session.id` 相符的实时条目，
只有场景完全没有 id 时才取**唯一**的实时 agent）；以上都点不出调用方时，面板**拒绝**且不调用任何东西：
`session "<id>" is not live in this process — no live agent to speak as, so nothing was called`。
**本页不声明：** 每个宿主、每个 session 都能解析成功 —— 真实 TUI 宿主上的这一跳尚未被本波次证伪。

这一块对 TUI 包仍然成立的事实：包内**不含任何写原语** —— 每一次团队变更都是它经适配器发起的工具调用，
而 `/mpd plan` 是唯一提供此类调用的界面，且背后有五重屏障（独立界面、逐字输入的确切短语、初始为空的回显、
仅用快捷键触发变更、带重新读取的单飞执行）。`/mpd team` 是团队场景的保底入口，`alt+t` 是通往它的尽力
而为快捷键。`tui-team-surface` 波次记录的限制（依赖残留限制与一个无法定位的契约行标签）仍在
`docs/tui-parity.zh-CN.md` §4–§5 中保持**未修复** —— 引用本页的状态之前请先读那一页。

**MPD 团队已不再依赖它：自团队平面拆分（W2）起，团队拥有自己的记录与基于 `ctx.subagents` 的 native
执行器，因此 TUI 会话可以在官方服务完全不挂载的情况下完成组队、派发与渲染 —— §10 第 11 条给出了说明这一点
的启动日志。**

**官方 Agent Teams 平面在 TUI 宿主下无法激活，因此本 bundle 不在那里挂载它（2026-09-29 实测：
harness 0.2.0-rc.1 + `dsh-tui` 0.11.2；见本页 §10 第 11 条）。**
`@deepseek-ai/dsh-experimental-agent-team` 通过 `ctx.root.sessionProjections.register(...)` 注册它的
会话投影，而 Cordis 会把服务调用绑定到**调用方**的上下文上，于是该 `register()` 在组合的**根**上下文
上运行、并在**根 fiber** 上创建副作用。dsh-tui 宿主恰恰拒绝插件激活这么做
（`root.effect is unavailable from a plugin activation`，
`lib/types/dsh-adapter/host-access.js`；其 `host-access.d.ts` 写明理由 —— 绑定在根上的副作用会在
请求它的插件卸载之后继续存活），因此 `TeamService` 的构造函数抛错、`agentTeams` 服务永不激活，
注入它的工具行在整个运行期间都报告 `pending (waiting for service: agentTeams)`。本 bundle 能设置的
任何东西都改变不了这一点：该插件的 `Config` 没有投影开关，这次调用是无条件的，而且在任何注册去重
逻辑之前就抛错 —— 没有任何配置值、挂载顺序或隔离开间能触及它。因此 bundle 补丁在任何挂载了 dsh-tui
宿主的组合里**禁用只为该服务而存在的两行** —— `mpd-agent-team` 与 `mpd-tool-agent-team` —— 并留下
一行说明原因；Web/无头平面不受影响（该守卫只读取已组合的条目，在不存在 dsh-tui 宿主行时返回 false，
所以那里的团队平面与原先完全一致）。

TUI 会话仍然拥有的东西：`/mpd team` 场景、`/mpd plan` 场景与状态行会依据它们能读到的团队状态渲染
—— 没有 Team 服务时**官方**读数为空、状态行显示 `team -`。mpd 的团队**工作流**行是刻意保留挂载的，因为它们
不是官方服务本身：`agent_teams_plan` / `agent_teams_task` / `agent_teams_mail` / `agent_teams_control`
中基于文件（`<workspace>/.mpd/team/`）的动作照常可用，而 `agent_teams_plan` 自身的 `approve` / `delete`
走的是 mpd 记录自己的 **native 执行器**（基于 `ctx.subagents`），并不依赖官方服务。仍由官方服务承担的部分
—— 它自己的实时读数、等待变更与队友消息 —— 会由适配器报出它无法解析的服务名而失败。今天的 TUI 会话无法
通过官方平面创建队友 —— 这是能力边界，不是配置失误。

### 3.3 侧栏面板接缝——主入口，以及它诚实的边界

`packages/mpd-tui-plugin/` 通过 `ctx.tuiPanels` 接缝注册**两个**右侧栏页面——`src/panel.ts`（slug
`team`、标题 `MPD`、单格图标 `❖`、`order` 10）承载那份**富形态的合并视图**（宿主自己整理的子代理快照行
在**上方**，**本会话**自己团队的 MPD 依赖 DAG 在下方（见 §3.4），两者同处 DAG 页自己的外框、表头 + 进度、图例、按键页脚
与点击钉住的详情体之内）；以及 `src/panel-workmate.ts`（slug `workmate`、标题 `MPD workmate`、图标 `⬢`、
`order` 12，见 §3.4）。**本节过去描述的第三个页面——`src/panel-dag.ts` 那个独立的 `dag` 页——已被 0.14.0
波次退役并合并进 MPD 面板**（用户条款「DAG页作为MPD面板」，§11.6 有记录）：两个描述符、两个 slug、两个排
序位最终只留下**一个**，而存活槽位渲染的正是 DAG 页的渲染体。**用户能触达的入口没有一个变成死路**：
`/mpd dag` 改瞄到 MPD 面板——DAG 页**就是**这个面板——而 `/mpd panel`、`/mpd subagents`、`alt+a` 本来就
都走同一个槽位（旧的 `Ctrl+A` 宿主输入接触面在提供该接缝的宿主上**保持惰性**；在它确实就绪的老宿主上，
它打开的就是合并的 subagents 场景，与以往一致）。存活的两个页面 `apiVersion` 都是 1，都**不带 `compact`**——宿主会校验
并保存描述符的 `compact` 槽位，但**不挂载**它的渲染槽，声明它就等于声明一个无法渲染的界面——并且都请求
**`minColumns` 28**，即宿主自己的底线。最终面板
id 是**从宿主自身的 `list()` 回读中发现的**，绝不自行拼接：`<pluginId>:<slug>`，合并前真机实测为
`act1:team`、`act1:dag`、`act1:workmate`（该 plain loader 行不携带任何 Component 身份，前缀由宿主加上）。
记录下来的集合就是**实际注册成功**的那些 id，因此现在只带存活的两个，不再有第三个。

**可达性规则——宿主自己的两个开关，而本 bundle 无法代设。** 注册了页面并不等于页面可见。在已安装宿主上，
启用列表位于宿主**自己**的行配置里（`dsh-tui.sidePanel.panels` —— 0.13.0 上是 `todo,jobs,agents`，
0.14.0 目标宿主上是 `todo,jobs,agents,info,trajectory,workspace,btw,companion`，见 §11.6；一个格式
合法但尚无面板认领的 id 会留在列表里，等插件稍后注册），而侧栏本身默认是**关闭**的（`sidePanel.open`
默认 `false`）。两者都归宿主所有，而 bundle 的补丁行绝不能 id 指向宿主拥有的行，所以补救只能写成给用户
的步骤，既写进文档，也由命令自己打印：

1. 在 `/settings` → 侧栏 → *启用的面板* 里加入该页的最终 id（id 可从宿主的 `/panel ` 补全列表得知，或直接
   读 `/mpd panel` / `/mpd dag` / `/mpd workmate` 打印的那一行）；
2. 打开侧栏——`Ctrl+B`——或开启 *启动时展开侧栏*。

**启用列表还必须挺过宿主自己的配置重应用；现在它挺得住，靠的是两条路径。** 宿主自己会追加注册成功的 id
（`enablePanelIdInStore`），但**实测约 +5.4 秒**时 `dsh-tui` 行会经一次 `Fiber._reload` 重新应用它的配置
（`applySidePanelPanels(config.sidePanel?.panels)`），所以那次追加是瞬时的，全新配置最终只剩下宿主自带的三个
标签页。（注意这次重置**实际**做了什么：它恢复的是**配置里写的那个列表**——只有在用户层未设置时才是
`todo,jobs,agents`；一个列出页面 id 的配置会在结算后仍然带着这些 id、并且不带宿主自带的三个。）现在有两条
互相独立的路径守住列表：

* **有界、在插件内，并且自 0.14.0 波次起改为跟随宿主自己的变更订阅** ——
  `packages/mpd-tui-adapter-plugin` 的沉降守卫只重新断言**宿主自己的 `list()` 回读
  产出的那些 id**，而且只在列表里**一个我们的 id 都没有**时才动作：它把整组一次性追加在用户列表之后，从不
  删除也从不改变任何一个 token 的顺序。若列表里出现**任何一个**我们的 id，那就说明配置已经就本 bundle 表态
  了 —— 在 `/settings` 里启用过、由下面的脚本写入过、或者用户故意只删掉了部分 —— 此时守卫**主动退让**，因此
  它绝不会把用户本想丢掉的页面放回去。**0.14.0 波次把有界的 tick 阶梯换成了宿主自己的订阅**
  （`subscribeSidePanelPanels`，即实时设置存储的变更订阅）：宿主一重新应用配置，守卫当场修复被抹掉的列表，
  而不是在约 25 秒后输掉这场竞跑；tick 阶梯只作为"宿主没有该订阅"时的降级路径保留。订阅随注入作用域一起
  释放（热重载不会留下监听），在没有该模块的宿主上永不抛错，退让规则不变：**我们自己的写入包含我们的 id，
  这正是循环的终点**。这是该适配器的**第二处**宿主
  内部接触，与 `Ctrl+A` 的 `useStdin` 触点并列（AGENTS.md §6 给这类接触计数，因此两处都在该文件里点名）；
  它发现的 id 记录在 `<workspace>/.mpd/logs/mpd-tui-panels.json`。**残留风险明码标出**：若用户故意把我们
  **全部**移除，剩下的列表与全新配置无法区分，因此每个启动周期仍会把整组加回一次；要区分这两种情况必须读到
  配置里写的那个值本身，也就是第三处宿主内部接触 —— 那是 §6 的计数决策，本轮刻意不做；
* **持久、一条命令** —— `node scripts/mpd-tui-panels.ts --apply` 把 `dsh-tui.sidePanel.panels` 写进
  profile 的
  patch 文件，而它就是设置用户层（`dsh-config-editor` 的 `documentPath` 返回
  `profileContext.patchPath`；`dsh-app-boot` 把它拼成 `<profileDir>/cordis.patch.yml`）。这两个读法都取自
  已安装的源码，脚本在无法证明该路径时拒绝写入；默认试运行，`--apply` 才写，会留 `.bak-<stamp>`，只补缺失
  的 id。它只写**用户**的 profile patch，不碰本仓库里的任何东西，因此不属于任何闸门扫描——需要重新钉定
  内置技能语料的是那个改动了 `skills/**` 的波次：它的 `treeSha` 必须与**恰好一次**重新钉定落在同一个
  提交里（AGENTS.md §9）；本命令两样都不涉及。

**记录是否可信，取决于它的来源信息（provenance）——而这是一处实测缺陷，不是担心。**
`.mpd/logs/mpd-tui-panels.json` 在 2026-10-08 被覆写成 `act0:team,act0:dag,act0:workmate`，而这些 id
是已安装宿主**无法**拼出的：它的 `pluginIdFor` 兜底计数器**先自增**，所以第一个裸激活是 `act1`，`act0`
在真机启动里不可能出现。是一次**单元测试**运行（它的面板接缝替身把注册标成 `act0`）驱动了真实记录器，
而补救脚本正是读这个文件来提议写入用户设置层——于是一次测试运行就能让补救命令写出任何启动都无法提供的
面板 id。0.14.0 波次修好了**写入**侧：记录现在带 `provenance {hostRoot, hostVersion, readBack,
activation}`，记录器**拒绝**生成任何无法追溯到已安装宿主包与宿主回读的记录（实测：完整跑一遍
`bun test ./packages/mpd-tui-plugin ./packages/mpd-tui-adapter-plugin` 之后，该文件的 sha256 不变）。
**同一份证明在**读取**侧也被守住，因此被污染的记录再也到不了用户的 profile patch：**
`scripts/mpd-tui-panels.ts` 会**拒绝**（试运行与 `--apply` 一视同仁，退出码 1）任何不带 `provenance`、
`provenance.hostVersion` 为空、缺 `provenance.readBack`，或 `provenance.activation === "act0"` 的记录，
并点名失败的字段、同时提示 `--ids <a,b,c>`。实测（针对被污染的 version-1 记录）：打印
``REFUSED: … it carries no `provenance` block (a version-1 record, whose ids cannot be traced to a boot)``
并退出 1；该次运行不改变记录 sha256；`--ids act1:team,act1:workmate` 被接受（逃生口仍然可用）；脚本自带的
`--self-test` 全绿——每种拒绝形状各一条臂，外加"格式良好的 version-2 记录被接受"。试运行仍会打印它读到的 id
及其文件，所以用户在 `--apply` 真的写入之前就能看到会被写什么。**磁盘上的文件仍然是那份被污染的 version-1
记录，直到宿主的真机启动把它重写**——这正是补救命令今天会拒绝它的原因，也正是 `--ids` 被记录为逃生口的原因。

**未设**时的实测：标签栏读作 `‹ 待办 › ▸ ◆`，宿主活的启用列表是 `toggle, focus, zoom, todo, jobs,
agents`。**设好**时的实测（120 列，这是本波次替换掉的**三页**集合）：标签栏出现 `‹ MPD ›`、
`‹ MPD DAG ›` 与 `‹ MPD workmate ›`，页面正文渲染出来（`evidence/tui/dag-port/verification/pty/frozen/`）。
**合并之后标签栏只有两个 MPD 标签页**——`‹ MPD ›` 与 `‹ MPD workmate ›`——上面两条路由依旧各自解析到存活
界面（本波次自己的记录见 §11.6）。面板列只在宿主分栏处存在——同一份抓取在 80 列
与 48 列上报 `split=false`，因此那里无论列表怎么写都不可能有页面可见。

`alt+a`、**`/mpd panel`** 与 **`/mpd subagents`** 在接缝已绑定时把 MPD 面板经 `tuiPanels.open()` 打开，
**`/mpd dag`** 改瞄到**同一个**面板（它渲染的就是 DAG 页），**`/mpd workmate`** 打开它自己的页面。
**任何**拒绝情形——每插件每 5000 ms 只允许一次打开、宿主
已不再持有的 id、或没有存活的 panel 消费者——都会回退到一个全屏界面，并且打印出的那一行会说明实际到达的
界面；这条路径上没有任何静默的空操作。回退目标按路由区分，刻意不是同一个场景：MPD 面板自己的 `⤢` 打开的是
**富形态的团队场景**（`mpd-tui-team`——外框、图例、聚焦任务的详情面板、按键提示），这样读者不会从一个富页面
掉进一个贫页面；而 MPD 面板的**路由**回退仍然是合并的 subagents 场景（`mpd-tui-subagents`），因为那条路由
问的是"哪个界面承载宿主自己的行"——两个问题各有各的答案，`registerPanelSurface` 也就把它们作为两个选项
接收。

**证据级别为 `Observed`：** 注册、从宿主回读中发现的 id、以及宿主**接受**的打开，均由真机 PTY
记录——`evidence/tui/dag-port/verification/pty/frozen/`（合并**前**那套集合的三个 MPD 标签页、120 列下的
标签栏，以及 80/48 列的
`split=false` 分支）与更早的 0.13.0 通道（`evidence/tui/lanes/2026-10-06T10-27-53.571Z/` 与
`…/2026-10-06T10-28-57.807Z/`），两者的负向对照都按要求为红。

**边界——MPD 无法观测**渲染**，并且如实说明这一点。** 宿主的 `tuiPanels.open()` 只在请求**被送达**时返回
`true`，而它自己的 `useSidePanel` 会**静默丢弃** id 不在启用列表中的请求；宿主的事件集合是
`registered|unregistered|badge|error|disabled`（`opened`/`focused` 是宿主明确的 TODO）。因此插件只打印它
确实知道的事——*"宿主已接受 {id}；若没有出现面板，请在 /settings → 侧栏里把 {id} 加入面板列表，并按
Ctrl+B 展开（或开启"启动时展开侧栏"）"*——而不是宣称"已打开"。页面**正文**由单元套件与钉住版本的真机 PTY
抓取断言，绝不靠插件自己的分支。

### 3.4 MPD 面板——富形态的 DAG 页——与 workmate 页

MPD 面板渲染的是**调用会话（本会话）自己**的团队依赖 DAG —— 绝不是工作区最新的那一个（见下方「本会话」
条目）—— 宿主自己整理的子代理行位于图形**上方**，两者同处一个合并前的旧合并页负担不起的富外框之内：
带边框的框架、点名团队与进度的表头、图形本体、显式图例、只列本页处理按键的页脚、状态徽标，以及钉住的
详情体。（在 0.14.0 波次之前，这是与一个更朴素的合并页并列的独立 `dag` 页；现在两者是**一个**页面，
见 §11.6。）

**这个面板的 `⤢` 打开的是富形态的团队场景，而不是贫形态的。** 页面自己的控件调用 `mpd-tui-team` 场景——它
画的是与页面同一套语法：外框、图例、聚焦任务的详情面板（钉住在整屏下的形态）与按键提示——这正是用户条款
「全屏出来的MPD也要有这种富外观」的具体落实。宿主自己的 `⤢` 对插件面板依旧不可达（§11.6 的重新测量边界），
所以这个控件是 MPD 自己的，并且就声明在页面上。

- **画的是「本会话」自己的团队——绝不拿工作区最新那个顶替。** 用户报告的缺陷（「我new了一个session，
  老session的DAG图还摆在那儿」）正是界面会挑**工作区**里最新的未结束团队；现已修复。凡是会绘制团队状态的
  界面（本页、团队场景、合并场景、计划场景）都读**自己**的会话 id——页面读 `host.snapshot().sessionId`
  （这个字段过去被读出来又丢弃），场景读 `props.channel.sessionId`——再经
  `mpdTeams.active(workspace, sessionId)` 解析；服务不暴露 `active` 时，退化为按记录自身的 `leadSessionId`
  匹配。读取方会报出它回答的是**三种状态**中的哪一种（`TeamWorkflow.source.scope`），渲染方就画那个状态、
  而不是猜：**`session`**——读到了会话 id **且**解析到本会话的团队，只画那个团队的 DAG，别的一概不画；
  **`none`**——读到了会话 id 但本会话**没有**团队，画标记 `no team in this session`，外加本工作区持有
  多少个团队，**绝不画别的会话的板**；**`workspace`**——**读不到**任何会话 id（旧宿主、按键时刻的读取），
  保留旧的「工作区主团队」规则，但标记 `workspace-level`，让读者知道这未必是自己的板。两个标记都是
  `src/team-state.ts` 里的常量（`NO_SESSION_TEAM_MARKER`、`WORKSPACE_SCOPE_MARKER`）。WEB 标签页**早已**
  按会话限定（`?sessionId=`），本会话没有团队时它会列出工作区的团队；唯一无法限定范围的界面是旧的
  `Ctrl+A` 状态视图——status view 既收不到 `host` 也收不到 `channel`——因此它按构造保留带标记的
  workspace-level 行为。
- **界面靠 PUSH 更新，定时器只作兜底保留。** 凡是会绘制团队状态的界面都订阅该工作区的团队事件源——
  `mpdTeams.subscribe(workspace, listener)`，同一底座也由 `mpd-team-core` 经 SSE 路由
  `/plugins/mpd-team/events` 提供——并在卸载时释放订阅。在真实的 dsh-tui 0.14.0 PTY 上实测：侧栏**打开且
  无人按键**时改写记录，六次试验都在 **76–85 ms** 内到达终端
  （`evidence/tui/session-scope-and-push/2026-10-08T08-22-12Z/pty-latency/`），而兜底的 tick 是
  **1000 ms**（`DAG_PANEL_REFRESH_MS`）——六次采样落在 9 ms 的带宽内、约 80 ms，这不是 tick 采样。
  事件源监听团队目录，因此本会话的 agent 或**另一个进程**所做的改动都能被看到；侧栏的 1000 ms tick 与
  场景的 2000 ms tick 原样保留，作为没有事件源时的兜底。没有 `mpdTeams` 行、没有 `subscribe`、或它抛错，
  损失的只是 push，绝不会损失页面。

- **纵排且自适应。** rank 是**纵向**轴（自上而下），每一个尺寸都由宿主实测出的面板算出——没有任何固定像素
  或单元格常量决定布局，这正是本波次用户的明确决定（纵向，但不要固定尺寸）。`boxes`、`rail`、`list` 是三种
  画法（按 rank 分组、带进度条的 `list` 在这一页之前没有任何调用方），页面按**实际拿到**的宽度自行选择，而
  不是要求宿主把列加宽。
- **rank 从依赖图**推导**，绝不听信服务端给的 `depth`。** 阻塞引用解析不到任何任务的看板，过去会塌缩成
  静默的一列、一条边都没有——那正是用户报告的缺陷——因此绘制自己算 rank，并报出究竟是哪个来源画的
  （`view … · ranks derived` 对比 `· ranks served`），同时列出没有对应任务的阻塞引用
  （`unresolved blockers: …`）。
- **六个状态，一张调色表。** `completed ✓ / running ◐ / failed ✗ / blocked ○ / cancelled ⊘ / open ○`
  集中映射到宿主主题键（`success`、`activity`、`error`、`warning`、`inactive`、`subtle`）；WEB 视图的
  十六进制色值只作为出处保留，而不是当作样式。
- **图例消解了 `blocked` 与 `open` 的歧义**——两者按设计共用字形 `○`，而 WEB 参照根本没有图例。点击任务会
  钉住一个含十条事实的详情体（`id`、`kind`、`visual`、`verdict`、`failedBy`、`owner`、`attempt`、`round`、
  `blockedBy`、`dependents`），`↑↓/jk`、`Enter`、`Esc` 分别负责移动、钉住与取消钉住。**悬停刻意不做**——
  终端没有指针移动，用户也放弃了它。
  **现在只有一张状态键，而且就是本图例自己的（用户条款「删除TUI DAG界面的多余图例（目前有两行）」）。**
  它由 `panel-core.ts` 的 `legendLinesFor` 从冻结的六态契约（`DAG_STATE_TONES` + `DAG_TONE_GLYPH`）组合
  而成，六个状态全都在其中，所以 `blocked` 与 `open` 靠各自条目携带的同形字（twin）区分；`graph.ts`
  自己不再携带任何状态键——它那份五态键（`LEGEND_STATES` / `LEGEND_SHORT` / `LEGEND_KEY`）已随多余的
  那一行**删除**：那份键漏掉了 `blocked`，而挂到契约这张键下面它只是同一份图例的第二次出现。
  **"图例越点越多"的缺陷（用户原话「越点越多直到撑爆屏幕」）根因是一个重复的 React key，已修复并钉住
  （§11.6）。** 图例的行原本以 `legend-${line.slice(0, 24)}` 作为 key，而图形自己的状态键行——即随多余
  那一行一并删除的那条——与图例紧随其后的第一行折行后都以 `✓ completed · ◐ running` 开头——于是两个
  子元素共用一个 key，React 在**每一次**重渲染时都会把冲突的那一行多渲染一次。在挂载实例上实测：**挂载后
  4 行图例，点击七次后 7 行**。现在 key 是位置，
  守住它的那条臂断言的是**点击 N 次后图例行数稳定**，而不只是"存在一个图例"。
- **节点只读 `<marker> <id>`**（`✓ T3`，聚焦中的任务读 `▶ T3`）。标题**不再进入图形**；它原样留在钉住的
  详情体里——一句中文就是一句中文，而不是被压成可打印 ASCII。把它移出图形也正是让"一列三个节点"能塞进
  40 格侧栏的原因。
- **框是紧凑的三行形态**（上边框、内容、下边框），圆角保留。一次绘制只用一种形态，因此同一列的两个框
  永远不会有不同高度。
- **点击经图形自己的命中矩形解析，且**包含列**。** 同一 rank 的两个框共享同一条行段，所以只看行的查找
  永远命中该 rank **最左**的那个框——这是实测结论，也是"用户点了某个任务、高亮却落在隔壁"的原因。指针
  自己的列（加上当前平移偏移）决定命中哪个框；点在没有框上的点击会**清除**钉住。
- **高亮不依赖颜色也能看见。** 钉住期间，被钉任务与它上游依赖链上的每个任务都**加粗**，其余则以弱化
  色调**并且**带上宿主的 `dimColor` 标志——因为深色主题下 `inactive` 与 `subtle` 太接近，纯靠颜色的"置灰"
  肉眼看不见。
- **再次点击已钉住的任务会打开该成员的**工作页面**：** MPD 的整屏 subagents 场景，并停在任务归属者
  （`assignee`）的详情视图上。归属者会与宿主策展的 subagent 行匹配；匹配不到时 MPD 通过宿主 toast
  说明原因，场景退到它的列表——绝不静默。
- **两条滚轴都可拖动。** 纵向 gutter 与横向 rail 都按**与点击完全相同**的绝对轨道算术响应鼠标拖动
  （不做"抓住滑块"的偏移）。点击、滚轮与键盘手势照旧；忽略拖动属性的宿主只是不能拖动而已。
- **每个 MPD 页面都画自己的外观：一枚独特的一格图标，加一个可点的 `⤢`。** 存活的两枚图标是 `❖`（MPD
  面板，它过去
  **不声明**图标、退回字母 `M`）与 `⬢`（workmate 页，它过去戴 `◆`——与宿主自己的 `agents`
  标签页逐字节相同，所以根本算不上独特的符号）；已退役 DAG 页的 `◈` 现在不被任何页面声明。每枚图标在本包
  的 `cellWidth` 与宿主的 `stringWidth` 下都
  恰好一格，因为图标不是一格的注册会被宿主**拒绝**。**即便 0.14.0 的轮播 `PanelBar` 已不再绘制它，`icon`
  仍被要求、也仍被声明**（§11.6）——去掉它会把一次静默的宿主变化变成一次被拒绝的注册。`⤢` 打开该页自己的
  整屏场景；它是 MPD 自己的控件，因为
  宿主**画不出**插件面板的那一个——§11.5 记录了实测原因、§11.6 在 0.14.0 上重新测量，而
  `evidence/tui/dag-highlight/` 里的真机终端抓取
  显示该字形确实落在页面标题行上。
- **OPT-1（用户决定，2026-09-13）：**失败**的依赖**不**阻塞它的下游。** 下游保持 `open` 且可派发，失败被报在
  状态**旁边**（`failedBy`），绝不折进 `blocked`。
- **workmate 页**把持久 workmate 库（`$HOME/.mpd/workmate/<key>/`）渲染成独立页面，因为该库是**按用户**的
  书架而不是按工作区的团队。它在构造上就是只读的（改动面仍在 `mpd_workmate_*`），任何文件系统故障都只损失
  一行或一个字段，按最近更新优先排序——与 `mpd_workmate_list` 提供的顺序一致——空状态则点名填满它的调用
  （`mpd_workmate_init`）。

**边界，按限制来写。** 未从 WEB 视图移植：悬停、它的像素几何（固定 `168px` 列、`42px` 节点）、CSS 省略号、
`overflow:auto`、原生 tooltip、DOM 读取与 `fetch` 轮询——它们在终端里都没有对应物，因此一律不做假实现。
WEB DAG 仍是语义参照，除它自身可读性所必需的 rank 推导与连线走线修复之外未被修改。

## 4. 准入与分发产物

### 4.1 `dsh-plugin.json`（宿主自身的准入路径）

唯一的 bundle 级清单：`manifestVersion` 为 `0.15`，id 为 `com.mpd-dsh.mpd-tui`，只有一个 host
facet，入口为 `packages/mpd-tui-plugin/dist/index.js`，**没有** `provides`、**没有**
`requires.services`，没有 client/worker facet；四个默认拒绝的决策事件权限；
`tui.dsh/v1alpha1#DecisionEvents` **仅**作为可选要求声明，并附有书面降级说明。在宿主自身的解析、
投影与协商路径上实测：准入状态为 `waiting_authorization`，原因为四个拦截权限的
`PERMISSION_NOT_GRANTED`——这是该协议五种准入状态之一，不是解析错误。在真实 TUI 内执行
`/plugins check <dsh-plugin.json 绝对路径>` 得到相同结果并打印出我们的 id。
**证据级别：** `Parsed` + `Negotiated`（宿主模块，加一次真实 `/plugins check`），并记录了对照
实验（去掉四个权限的清单协商为 `compatible`；损坏的清单报 JSON 解析错误）。

准入状态是五态投影：`compatible / compatible_degraded / waiting_authorization / rejected / unknown`。

本包中有一处注册刻意留在清单投影之外——`/mpd` 命令，它走的是宿主的 `commands` 服务（见 §6.4）。

### 4.2 `dsh-distribution.json`（dsh-distribution 元协议）

协议**不强制**文件名（`docs/getting-started.md:27`）；本仓库采用其建议的
`dsh-distribution.json`。它是 `distribution.dsh.dev/v1alpha1` 下的 `DistributionDescriptor`，
身份为 `urn:dsh:distribution:mpd:my-power-dsh`，版本取自 `package.json` 的真实版本；包含一个
`EnvironmentComposition`（8 个组件：两个 DSH 宿主 bundle、本 bundle、插件、MCP 服务器、技能语料、
Web 客户端、TUI 版本）和一个覆盖真实数据位置的 `ManagedLayout`（9 项资源）：

| 资源 | 位置（方案前缀） | 归属 / 可迁移性 / 敏感性 |
|---|---|---|
| `workspace-config` | `dsh-workspace:.mpd/mpd.jsonc` | exclusive / portable / private |
| `workspace-state` | `dsh-workspace:.mpd` | exclusive / conditional / private |
| `codegraph-cache` | `dsh-workspace:.codegraph` | exclusive / nonportable / private |
| `workmate-library` | `dsh-home:.mpd/workmate` | shared / conditional / private |
| `workspace-extensions`、`user-extensions`、`bundle-extensions` | `dsh-workspace:.mpd/extensions`、`dsh-home:.mpd/extensions`、`dsh-bundle:extensions` | 依次 exclusive-shared-exclusive / portable / private-private-public |
| `bundle-install` | `dsh-profile:node_modules/@mpd-dsh/mpd` | exclusive / nonportable / public |
| `credentials` | `dsh-external:host-managed-credential-store` | external / external / secret |

位置使用协议的 URI 形态（仅校验形状，协议不会解引用），原因有二：真实根目录跨多个 root——会话
工作区、用户 HOME、已安装的 profile；且协议的 `relative-path` 不接受以点开头的路径段（例如
`.mpd`）。方案前缀由本仓库定义：`dsh-workspace:`（会话工作区）、`dsh-home:`（用户 HOME）、
`dsh-bundle:`（已安装 bundle）、`dsh-profile:`（DSH profile 目录）、`dsh-external:`（由宿主管理、
本 bundle 不接管的存储）。描述符中不含任何私有机器路径，也不含任何密钥值。

该描述符的诚实边界：

- 该协议目前是 **Draft**（`registry/protocols.json`），其 README 也提醒：通过格式校验**不等于**
  数据安全认证。
- `EnvironmentLifecycle`、`EnvironmentPortability`、`EnvironmentDiscovery` 三项**刻意省略**：本
  bundle 没有实现版本化的生命周期操作，也没有 clone/export/migrate 能力，并且不发布安装实例身份。
  声明为空的这些字段在结构上合法，却等于什么都没说。
- 由该协议自带一致性 CLI 执行的校验现已交付：分发通道（`t9`）把协议仓库复制进沙箱、完成构建
  （`pnpm install --frozen-lockfile` 与 `pnpm build` 均退出 0），并运行该协议副本自带的
  `<protocol-repo>/packages/conformance/lib/cli.js dsh-distribution.json`（退出 0）——描述符由协议自带工具验证，
  而不是由重新实现验证（`evidence/tui/conformance/20260915T064521Z/03-distribution.log`）。通过该
  CLI 仍然只证明格式与内部一致性，绝不证明数据安全。按协议 schema 文件做的本仓库结构检查另记录在
  `evidence/tui/docs/20260915T060010Z/descriptor-check.json`。

## 5. 三个不同的版本字符串

它们**不可互换**，每个只对应一个产物：

| 字符串 | 它标识什么 | 记录位置 |
|---|---|---|
| `tui-admission/0.15` | 宿主实际执行的**配置文件**版本 | 宿主 `registry/registry-0.15.json` → `profileVersion` |
| `community-v0.15` | 声明所写的**规范**版本 | `schemas/conformance-claim.schema.json` → `specVersion` 常量（其 `claimVersion` 是另一个常量 `"0.15"`） |
| `dsh-tui-admission-v0.15` | **要求套件**版本 | `conformance/requirements-v0.15.json` → `profileVersion` |

本版本的规范目标是**宿主内置的 `tui-admission/0.15` 配置文件，修订 `d28c267`**——即已安装的
`@deepseek-harness-tui/dsh-tui` 包内自带的准入内容。它**不是**"当前生态标准"：生态当前的 main
分支根本没有 TUI 配置文件（`registry/profiles.json` 为空），因此本仓库发布的任何内容都不得被描述为
生态已认可。实测表明宿主自带内容与归档的 v0.15 内容逐字节一致（抽样 8 个文件 sha256 相同；真实
描述符的 DecisionEvents 摘要 `sha256:56440dde1b00…` 与两侧文件哈希一致），因此不存在需要追赶的更新
TUI 配置文件。

**状态词汇。** 生态使用的状态名为 Draft / Experimental / Candidate / Stable / Deprecated；本页的
对应关系是精确的：本版本是 bundle 对宿主内置配置文件的**实验性适配（experimental adaptation）**；
它对准的规范内容是**社区草案（community draft）**（`community-v0.15`，目前以宿主内置 TUI 准入策略
的形式承载）；TUI 界面接缝的**参考实现（reference implementation）**是宿主自身
（`@deepseek-harness-tui/dsh-tui`），不是本 bundle。本仓库没有任何内容是 Stable，也没有任何内容
获得生态认可。

## 6. 已知限制

### 6.1 决策事件接缝已就绪但未激活

profile 安装的插件无法注册 `tui.dsh/v1alpha1#DecisionEvents`：在宿主修订 `b246411` 上，公开的
`admit()` 直接抛出，`admitInternal` 由模块私有 token 把关，导出的生产访问器没有任何调用方——因此
身份从未被授予，注册在任何策略判断之前就被拒绝。插件因此只对其四个拦截点尝试受中介注册，把拒绝视为
预期结果，**只告警一次**，不注册任何内容，也从不使用测试专用 token 或伪造身份。**经该接缝不声明任何
决策事件式的输入、回退、会话切换或压缩拦截。**（自 2026-10-05 起确实有一个按键被接管，但走的是完全不同的
机制：宿主的**内建** `dashboard` 动作占有 `Ctrl+A`，因此 `packages/mpd-tui-adapter-plugin` 按文件 URL
取得宿主自己的 `useStdin`，再由一个零行状态视图在宿主输入总线上抢先处理该键——见 §7 的"宿主输入总线"一行。
那是**按键改指**，不是决策事件订阅，且只在工作区的团队投影含有一个至少带一项任务的团队时生效。
**自 0.13.0 起该接触面是版本门控的**：在提供侧栏面板接缝的宿主上它保持**惰性**——`Ctrl+A` 保留宿主
自己的 dashboard 语义，合并视图改经 `alt+a` / `/mpd panel` 打开（§3.3）——只有在**没有**该接缝的宿主上
才沿用 0.13.0 之前的就绪行为。）清单将该
接缝声明为带降级说明的可选要求；使其可用的上游修复记录在研究文档（`.mpd/recon/UPSTREAM-RESEARCH.md`）中。

相关：`trusted-in-process` 是**兼容性/审计标签，不是安全边界**。SHA-256 摘要只能证明字节一致，
**不能**证明发布者身份。

### 6.2 `/settings` 区块**已**与 `<workspace>/.mpd/mpd.jsonc` 打通——附带一次重启与两种具名跳过情形

该区块在宿主 settings 命名空间 `mpd` 下声明的就是真实的 mpd.jsonc 可调项（`hashline.maxDiffChars`、
`commentChecker.autoCheck`、`ulw.maxRounds`、`memory.vcs`、`team.stateDir`、`boulder.dir` 以及十二个
`teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}` 叶子），而该命名空间
由 `packages/mpd-config-plugin` **提供**（本包只是纯消费者，只在没有配置插件参与组合时才注册一个带守卫的
兜底）。如今一次保存会发生什么：

**`base` 是一条规则，不是一次查表。** 提供该命名空间的包自行推导 base（`baseForNamespace()`，
经适配器注册），规则按活动根的数量分档：

| 活动会话根 | 命名空间 base |
|---|---|
| **恰好一个** | 该工作区的 `<workspace>/.mpd/mpd.jsonc`——常规路径 |
| **零个** | **挂载时**（无 exec）的根——`DSH_WORKSPACE_ROOT` 或进程 cwd——它是任何会话存在之前唯一存在的根；那里的文件缺失即得到**空 base**，实际上等同于 schema 默认值。由于 `mpd-config` 所在行通常先于任何活动会话生效，这就是**常规启动路径** |
| **多于一个** | **不虚构任何文件 base**：`base: undefined`，原因 `ambiguous-multi-root`，逐一点名全部候选并写入 `states()`。在恰好一个工作区活动之前，该命名空间显示 schema 默认值；此状态下的保存会被**拒绝**（见下），因此这种歧义不可能落到磁盘 |

**base 在整个进程生命周期内固定**——宿主对一次活动注册**不提供任何注销（disposal）句柄**，它自己的
settings 安装器同样保持 base 固定。这正是界面上的句子写作"**重启后**对 mpd 插件生效"的原因：那是诚实的
后果，而不是含糊其辞。插件真正使用的是**已解析的值（resolved value）**加上配置层的**逐次调用文件读取**：
L1/L2 文件层在每次解析时都会被重新读取，因此即便 base 被冻结，**按工作区读取仍然解析各自会话自己的
文件**。本页没有任何句子承诺 base 会被实时刷新。

- **读入优先级** —— L0 schema 默认值 < L1 `$DSH_HOME/mpd.jsonc` < L2 `<workspace>/.mpd/mpd.jsonc` <
  **L3 settings 用户区段**（运行期以其为准）；此后若**文件**被再次编辑，重叠的 settings 叶子会被
  **取消设置**，于是文件里的新值重新生效，两个方向都不会静默丢失。
- **写回** —— 由 `packages/mpd-config-plugin` 拥有（绝不由本 TUI 包执行，后者保持已验证的零写入性质）。
  触发点是宿主的 `settings/document-updated(ns, revision)` 事件，并过滤为 `source === 'update'`
  （原始区段事件，因此深比较门不会把变更丢掉）；写入对象是事件时刻实机会话工作区的
  `<workspace>/.mpd/mpd.jsonc`，写入过程持锁、对原始字节做 compare-and-swap、写同目录临时文件、再原子改名。
  **注释、键顺序与尾随逗号都保留**：一次实际启动把 JSONC 文件里的 `hashline.maxDiffChars` 从 20000 改为
  31415，注释、键顺序与尾随逗号均未改变。
- **工作区目标** —— settings 路径不携带身份，因此目标集合是**事件时刻的实机会话工作区**：恰好一个 ⇒
  写入该文件；**零个 ⇒ `no-live-session`**；**多于一个 ⇒ `ambiguous-multi-root`**，并逐一列出候选。
  两种跳过情形下**都不改动任何文件**，而且这次编辑**没有丢失**：它已存入宿主全局 settings 文档，配置层
  会立刻对所有工作区生效——只有**文件写入**在等"恰好一个实机会话"。TUI 状态行与 Web 卡片都写明了这一条。
- **生效时机** —— mpd 的消费者在插件 `apply()` 时读取配置（`applies: 'restart'`），因此保存的编辑
  **在重启后对这些插件生效**；界面提示就是这么写的。
- **退化目标会大声报错** —— 文件缺失（创建并带头部注释）、只读（`denied` + 路径 + errno，settings 编辑
  仍然成功）、并发（重试 ×3 后 `conflict`，人的文件保持原样）、无法解析（`unparsable`，绝不"修复"）。

**证据级别：** `Observed` —— 沙箱内两次真实启动（ok: true），见
`evidence/mpd-bridge/implementation/20260915T080138Z/`；另有通道
`skills/dsh-qa/scripts/tui-settings-bridge.ts` 与复审 PASS
`evidence/mpd-bridge/review/REREVIEW-t49.md`。打通之前的版本
（`packages/mpd-tui-plugin/dist/index.js` sha256 `5dce2563fd0e3b20…`）携带的是旧的界面文本
（`mpd.jsonc <key> — not bridged: a save here does not rewrite .mpd/mpd.jsonc`）；该文本与"已命名的后续
任务"这一措辞在当前版本（`dist/index.js` sha256 `cf4b3813a344c9d5…`）**已不成立**。

### 6.3 包内技能只是资源

`packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` 随包发布，但**不**由本行注册：bundle 的语料由
`mpd-bootstrap` 从 `<bundle>/skills` 提供（18 个技能）。

### 6.4 `/mpd` 命令使用的是宿主未归属（unattributed）的 `commands` 服务

`packages/mpd-tui-plugin/src/commands.ts:53-60` 把 `/mpd` 注册到宿主的 `commands` 服务上——即宿主以
`commands.dsh/v1alpha1` 契约对外声明的那个面——而清单声明的是 `contributes.commands: []`。这两件事同时
为真：清单的 `x-mpd-tui-surfaces.whyNoContribution` 陈述的是更窄、也更精确的事实——本插件"没有通过
Command 能力注册任何 host Command"。由清单中介的 Command **贡献**面是另一条路径，它才需要贡献 id
（以及按宿主注册表 `registry/permissions-0.1.json`，`commands.invoke` 权限）。本包刻意把宿主的
`commands` 服务留在该投影之外、不声明任何贡献，因此 `contributes.commands: []` 是**真话，而不是遗漏**。

其后果是被测量并披露的，而不是被掩盖：宿主的效果台账把这次注册记为 `undeclared`，因为受中介
（`tuiPluginHost.registerCommand`）的路径需要一个已准入的组件身份，而准入按设计处于
`waiting_authorization`——这是 t10 的 F4 披露，见 `evidence/tui/review/t12/REVIEW.md:62` 与
`result.json:115`。`/mpd` 本身可用：实机通道渲染了该命令及其命令树，属于七个界面中已渲染的六个（第七个
由明确不声明第 10 条覆盖）。另一种读法——在清单里声明该命令——需要已授予的 `commands.invoke` 权限，以及
profile 安装的插件无法到达的准入路径（§6.1），因此不是本版本选择的读法。生态最终采用哪种读法，由交付报告
说明。

### 6.5 `mpd.jsonc` 中的重复键——已定规则

`JSON.parse` 是"后者胜出"，因此一个被声明多次的路径只有一个可观测值。打通功能按此编辑持久投影，规则以
队长的最终表格为准（`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`）：

| 操作 | 同一路径被声明多次时 | 依据 |
|---|---|---|
| **SET** | 编辑**最后一处**，成功返回，并警告时列出**每一处**所在行 | 最后一处才是 `JSON.parse` 唯一能观测到的值 |
| **UNSET**（直接调用或 `DELETE` 哨兵） | 一次由后向前的区段扫描，删除该路径的**每一处** | 取消设置后键必须**不存在**：留下较早的一处会让它在文件里继续生效，而 settings 层却报告已取消——这正是打通功能要消除的静默分歧 |
| **拒绝** | 仅限无法证明的区段、被重复的**中间**键（`ambiguous-intermediate`，两个方向）、无法解析的文档、或 `read-only` 目标 | 这些情形下目标区段无法被证明，因此不写任何内容，并给出具名原因 |

投影理由一句话：文件是 settings 层的**持久投影**，不是不可触碰的用户原件——这就是 UNSET 删除所有出现处、
而 SET 只改运行时真正读取的那一处的原因。

### 6.6 状态各自存放在哪里——作用域与跨 home 边界

打通功能横跨四个作用域；按机制把它们命名清楚，两扇前门的行为才是可预测的
（`evidence/mpd-bridge/dual-path/REPORT.md`，发现 D1）：

| 作用域 | 状态 | 共享条件 |
|---|---|---|
| **DSH-HOME**（`$DSH_HOME/settings.yaml` + 用户 `mpd.jsonc`） | 宿主的 settings 文档 | 两扇前门位于**同一个 DSH home** |
| **workspace**（`<workspace>/.mpd/**`） | `mpd.jsonc`（打通的持久投影）、`memory.json`、team/plan/boulder 状态 | 两扇门运行在**同一工作区**——由构造保证 |
| **HOME**（`~/.mpd/workmate`） | 用户的跨项目 workmate 库 | 同一 `HOME`，即同一用户的多个 profile 之间；两个用户之间相互独立 |
| **bundle**（`<bundle>/…`） | `mpd` preset/roster 与技能语料（按引用提供，不复制） | 两扇门**就是同一次安装**，与 home 无关 |

**必须知道的边界：** 只有一个 DSH home 时，settings 文档是共享的，因此一次设置编辑对两扇前门同时可见。
而**不同的 DSH home 会有两份 settings 文档**——`settings.yaml` 是 DSH-HOME 作用域的——所以在一扇门里做的
编辑，对另一扇门而言**作为 settings 取值（VALUE）是不可见的**。持久状态仍然会收敛：回写的目标是
**工作区**文件，两扇门写的是同一个 `<workspace>/.mpd/mpd.jsonc`。一句话概括：*同一个 DSH home ⇒ settings
取值共享；不同 home ⇒ settings 取值不同，但工作区的 `<workspace>/.mpd/mpd.jsonc` 仍然收敛。* 这是两扇门有可能对同一个
继承值给出不同显示的唯一情形。

## 7. 对生态惯例的刻意偏离

有一项曾经的偏离已**关闭**：DSH-TUI 生态对第三方插件的惯例之一就是 **MIT** 许可，而自去 omo 的 E 波许可证
替换之后，本 bundle 采用的正是同一份 MIT 许可（`LICENSE.md`，`Copyright (c) 2026 HaroldZ32`）——因此许可证
不再是偏离项，下方不再列出。仍然成立的偏离如下。

| 偏离项 | 取值 | 为什么是刻意的 |
|---|---|---|
| 包名 | `@mpd-dsh/mpd-tui` | 保持本 bundle 的命名空间；生态使用自己的命名。 |
| 清单 | **唯一**一份 bundle 级 `dsh-plugin.json`，而非 25 份逐包清单 | 本 bundle 作为一个整体安装；清单的 host facet 指向唯一的 TUI 插件模块。 |
| 宿主输入总线 | 接缝之外**唯一**被计数的接触面，且自 0.13.0 起是一个**版本门控**的接触面：适配器解析**已安装**宿主的根目录，按**文件 URL** 动态 import `<hostRoot>/lib/types/ui.js`，取得宿主自己的 `useStdin`。**门控覆盖的是「是否拦截」，不是那次加载**：探测在每种组合下都会进行（0.13.0 通道自己的适配器日志里就有 `host contact bound: … (lib/types/ui.js)` 这一行），被版本分流的只是 `Ctrl+A` 的处理方式 | `Ctrl+A` 是宿主的内建动作，任何贡献类型都够不到它，所以在 0.13.0 之前的宿主上，另一条路只能是放弃这条需求。**门控规则：** 在**提供**面板接缝的宿主（0.13.0+）上该接触面保持**惰性**——`Ctrl+A` 保留宿主自己的 dashboard 语义，合并视图改经 `alt+a` / `/mpd panel` 打开（§3.3），这一点由 0.13.0 真机 PTY 通道实测（`evidence/tui/lanes/2026-10-06T10-28-57.807Z/`：宿主自己的 dashboard 被打开，且 `/mpd panel` 证明了侧栏注册 + 被接受的打开）；在**没有**该接缝的宿主（0.12.0）上旧行为不变——当 `tui.dashboardKey` 打开且工作区团队投影含有至少一项任务时接触面就绪。因此 `tui.dashboardKey` 仍留在配置 schema 与 `/settings` 行里，但文档写明它**只在旧宿主**上有意义。逐次按键的规则只存在于一个函数里——`packages/mpd-tui-plugin/src/panel.ts` 的 `takeoverArmed`（**接缝优先**于任何配置层；只有没有接缝时才由已保存值、否则由行配置的下限决定），而适配器的 `panelSeamBound()` 是**每次按键**读取的，不只是应用期读一次。**历史（在 0.12.0 上实测，按记录原样保留）：** 那份 import 得到的是**另一份**模块实例，其 `useStdin()` 什么也不返回，因此适配器还会保存**场景渲染**收到的那份活 kit 并优先使用它——这正是接管会在"本次会话渲染过任一 MPD 面板或场景"之后就绪、在那之前保持惰性的原因。适配器内部还遵守另外两条宿主规则：状态类注册的 identity 必须是**正在调用它的激活**（注入 scope），并且不写入任何 DSH-TUI 文件。**边界：** 本波次没有取得 0.12.0 的 PTY 证据（§11.3），因此旧宿主的就绪路径靠单元测试而非 pane 抓取支撑。 |

## 8. 逐包兼容性台账

由组合任务（t5）在 `@deepseek-harness-tui/dsh-tui` 0.10.1 上、本 bundle 作为第三个 patch 层时
测量。事实来源：`evidence/tui/composition/20260915T053445Z/ledger.json`（生成于
2026-09-15T05:54:03.989Z，sha256
`a292c88b95c8cf1f0566fa8a13e3276e2447db44079834554bb7178686974bf3`）；同目录 `ledger.md` 为人工
摘要；逐包观察、caveat 与原始产物（`raw/tool-list.json`、`raw/tui-*.log`、
`raw/dsh-tui-dump-config.txt` 等）都在旁边。下表是该测量的逐条复述，不是本页重新推导的结果。

计数：**usable 22 · inert 2 · web-only 1 · 合计 25**。

**这张历史表在 0.1.7-rc.2 上有一处变化：** 下表 `mpd-agent-teams-plugin` 那一行记录的是
2026-09-15 的测量，当时内置的 `agent-teams` 主体**确实**被挂载。它现在已**从组合中退役**
（没有任何 loader 行挂载它；它的团队工具与侧边栏面板都不属于随包会话），本 bundle 改为挂载三个
**官方** Agent Teams 包（`mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team`）。请把
那一行读作历史，而不是当前能力。

| 包 | 角色 | 分类 | 实测见证 |
|---|---|---|---|
| `mpd-bundle` | 组合层（bundle patch 本身） | usable | 组合配置含 `mpd-tui` 与 `agent-preset-registry` id-target；真实启动 0 崩溃特征 |
| `mpd-dsh-adapter-plugin` | 与宿主接缝的唯一接触面 | usable | 应用期日志 `[mpd-dsh-adapter] mpdDsh provided` |
| `mpd-config-plugin` | mpd.jsonc 运行时配置层 | usable | 工具 `mpd_config_get`、`mpd_config_reload` |
| `mpd-tools-plugin` | 写入守卫 / 截断 / waterfall | usable | 组合行 `mpd-tools` 及其配置；不拥有工具名 |
| `mpd-modelchain-plugin` | 模型链解析 + 工作区记忆 | usable | 工具 `mpd_modelchain_resolve` |
| `mpd-ext-plugin` | 扩展注册表（技能/流程/角色/MCP） | usable | 工具 `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show` |
| `mpd-roles-plugin` | 专家花名册 | usable | 工具 `mpd_role_persona`、`mpd_role_spawn`、`mpd_roles_list` |
| `mpd-ulw-plugin` | ulw 循环纪律 | usable | 工具 `mpd_ultrawork`、`mpd_ulw` |
| `mpd-hashline-plugin` | 锚点编辑纪律 | usable | 4 个 `mpd_hashline_*` 工具 |
| `mpd-boulder-plugin` | 持久工作台账 | usable | 6 个 `mpd_boulder_*` 工具 |
| `mpd-comment-checker-plugin` | 注释/文档串检测（可选二进制） | usable | 工具 `mpd_comment_check` |
| `mpd-codegraph-plugin` | codegraph 项目初始化 + 二进制解析 | usable | 应用期 `[mpd-codegraph] init status=marker …` |
| `mpd-memory-plugin` | git/svn 支撑的记忆 + 反思 | usable | 7 个 `mpd_memory_*` 工具 |
| `mpd-workmate-plugin` | 持久演化型智能体库 | usable | 7 个 `mpd_workmate_*` 工具 |
| `mpd-team-compact-plugin` | 已结束团队的压缩 | usable | 工具 `mpd_team_compact_run`、`mpd_team_compact_status` |
| `mpd-bootstrap-plugin` | 提供 bundle 技能语料（不复制到 HOME） | usable | 应用期 `skill corpus served from <bundle>/skills` |
| `mpd-tui-plugin` | TUI 原生界面包（本版本） | usable | 组合行 `mpd-tui` → `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js` |
| `mpd-agent-teams-plugin` | 内置的 AgentTeams 插件（工具 + Web 面板）—— **已于 0.1.7-rc.2 从组合中退役；本行是 2026-09-15 的历史测量** | 当时 usable | 17 个团队工具 |
| `mpd-mcp-astgrep` | ast-grep MCP 服务器（stdio 启动器） | usable | 3 个 `mcp__ast_grep__*` 工具 |
| `mpd-mcp-lsp` | LSP MCP 服务器（为已声明的 `cclsp` 依赖提供的 stdio 启动器） | usable | 12 个 `mcp__lsp__*` 工具（cclsp 自己的名字） |
| `mpd-mcp-codegraph` | codegraph MCP 服务器（stdio 启动器） | usable | 服务器在进程内运行；**在该沙箱**中 0 个工具，因为 CodeGraph 策略排除含 `.mpd` 的项目路径（沙箱现象，不是 TUI 限制） |
| `mpd-mcp-gitbash` | 一个启动器同时服务 git 工具箱与裸 shell 运行器（均为已声明 npm 依赖） | inert | `mcp-git`（28 个 `mcp__git__git_*` 工具）与 `mcp-shell`（`mcp__shell__run_process`）两行在任何 profile 下都组合为 `disabled: true` |
| `mpd-mcp-shared` | MCP 启动器共用的二进制解析库 | usable | 支持库，自身无行/工具；由已启动的 MCP 子进程间接见证 |
| `mpd-bundle-plugin` | bundle web 兼容包（浏览器客户端 + 空操作 main） | **web-only** | 无 TUI 渲染面；TUI 等价物见 §3 |
| `mpd-qa-roles-probe` | 仅 QA 的探针包 | inert | bundle patch 中没有它的行（仅由 QA overlay 挂载） |

台账自身记录的 caveat：测量时 `packages/mpd-tui-plugin` 仍在由 t4 编写，台账记录的插件摘要即该修订
（`dist/index.js` sha256 `695f68c4858745cc…`）。该产物在本波次中又被重建两次，因此台账中的插件哈希
是**历史，绝不是交付产物**：本页绑定的是 §11 与
`evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md` 记录的交付修订，而台账的*组合*观察仍然
成立。七个接缝界面的*渲染*不属于该台账的主张：它属于实机通道，该通道渲染了七个中的六个（明确不
声明第 10 条）。本页没有对任何包重新分类（AC-12 是 t5 的测量，由 t8 复核）。

## 9. 要求级证据类型

准入的要求套件为每条要求固定了证据类型；规范一致性通道（`t9`）此后已用固定输入运行了该套件，并为
全部七行记录了逐条状态与对应产物，因此没有任何一行留空——但套件自身的运行器被阻断（vendored
`dsh-std` 子模块只提供源码，`pinned-cli`/`pinned-suite` 退出 1），逐条矩阵是用固定解析器在固定输入
上求得的。这是一条被记录的阻断，**不是**套件干净通过，也**不是**本 bundle 的一致性结论：
`evidence/tui/conformance/20260915T064521Z/04-spec-conformance.log`。

每条要求固定的证据类型：

| 要求 | 证据类型 |
|---|---|
| `BASE-STD-001`、`TUI-PKG-001`、`TUI-PKG-002`、`TUI-PRIVATE-001`、`TUI-HOST-001`、`TUI-OBS-001` | `automated` |
| `TUI-TRUST-001` | `review` |

有两条条款限制了以上内容能被拔高成什么：仅验证源码仓库、或仅运行参考实现测试，**不足以**产生产物
级声明（`TUI-DEP-001`）；`trusted-in-process` 是兼容性/审计标签，不是安全边界（`TUI-TRUST-001`）。
兼容性判定、验证级别与限制被刻意分节陈述。

## 10. 明确不声明（NOT-CLAIMED）

本节没有任何一项是可用的功能。

1. **决策事件接缝（decision-event seam）** —— 因宿主准入不可达而被阻断（§6.1）。就绪但未激活；**经该
   接缝**不声明任何拦截。（§7 里那次独立的 `Ctrl+A` 按键改指不属于该接缝，也不做任何决策事件声明。）
2. **身份门控服务** —— `storage.local`、`messages.observe` 与受中介的 `registerCommand` 路径需要
   同样的已核实组件身份；因此效果台账目前把我们的界面记为 `undeclared`。
3. **仅 Web 的界面** —— workmate 标签页
   （`dsh.client.platform = web`）在 TUI 中不渲染，官方 Agent Teams 面板同样是 Web 客户端界面。
   §3 的 TUI 等价物不是像素级或功能级对齐声明。
4. **引擎版本偏差** —— 宿主打印
   `⚠ dsh 引擎为 0.1.5-rc.2，比本界面验证过的 0.1.5-rc.1 新`，并继续运行。我们的验证针对已安装的
   `0.1.5-rc.2` 引擎，而不是界面验证时所用的修订。本页不把任何结论锚定在生态的当前状态上。
5. **接缝 2（`tuiPrompt`）** —— 宿主不提供；不声明。
6. **宿主内部门禁不是我们的一致性验证** —— 宿主自带的 `verify:plugin-*` 验证的是**宿主**的插件
   子系统；即使通过也不构成本 bundle 的一致性结论，且它可能被阻断（宿主检出没有
   `node_modules`/`lib/`）。
7. **非自动化的 TTY 边界** —— TUI 只在 stdout 为真实终端时启动，因此 TUI 通道在 tmux 下运行，且
   被排除在自动化的 `bun run test:qa` 扫描之外；自动化通道无法见证 TUI 界面。
8. **未发布一致性声明，也不构成数据安全认证** —— 描述符合法不等于安全保证，我们的通道也不是证书
   （`TUI-DEP-001`）。
9. **包内技能资源与刻意的偏离** —— 见 §6.3 与 §7。（`/settings` 打通曾列在此处；自打通波次起，它已是
   受声明、有证据的能力——`Observed`，两次真实启动——见 §6.2，并在 §11.1 记为被取代。）
10. **`tuiRenderers` 转写行未被宿主投影。** 插件为其纯日志事件 `mpd-tui/board-opened` 注册了渲染器，
   该事件在持久存储中确有记录，但**界面上没有出现任何转写行**，而其余六个受激活门控的界面都正常渲染：
   `evidence/tui/live/20260915T063140Z/result.json` 记录 `"tuiRenderers": false`（以及
   `"sceneReportedTranscriptRows": 0`），`T8-LIVE-VERIFY.md:19` 记录 "6/7 seams render …
   `tuiRenderers` MISSING"。归因在**宿主侧**，不是本插件的默认失败：同一次启动中，两个彼此独立的插件
   都能到达该服务并调用 `register()` 且不抛错，而已安装的运行时对 `tuiRenderers` 只捕获一次、没有任何
   本地兜底，却给 `tuiSettingsSections` 提供了兜底。诚实的限制是：宿主只读且**没有注册回读接口**，因此
   究竟是通道构造时捕获到的运行时为 `undefined`（H1），还是宿主根本不投影插件注册（H2）——**尚未
   证实**，两种解释都在宿主侧。`register()` 返回函数并不能证明任何事，因为被拒绝时返回的是同一个空操作
   disposer；正因如此，本包对该接缝只报 `requested`，从不报 `confirmed`。之后的一次单进程交叉运行复现
   了"全新事件类型会渲染、这个已知类型不会"（同目录 `CORRECTION-renderer-causation.md`），这把原因
   收窄到宿主的拒绝名单捕获顺序，而不是"任何渲染行都无法产生"；处置结论不变。**在 0.13.0 上重新
   测量（2026-10-06）：仍然 MISSING**——界面通道渲染了它八个界面中的另外七个，读出
   `tuiRenderers=MISSING`（`evidence/tui/lanes/2026-10-06T10-27-53.571Z/`），因此该缺口并未因
   0.13.0 适配而改变，仍是 `evidence/tui/EVIDENCE-INDEX.md` 中已声明的既有结构性缺口；通道在该必需
   界面上退出码为 1，而不是把它弱化以换取一个绿色退出码。
11. **TUI 会话现在可以创建队友了 —— 本条目过去写的是"不能"。** 官方 Agent Teams 服务在 dsh-tui 宿主下
    依然无法激活：宿主拒绝该插件自己发起的 `ctx.root.sessionProjections.register(...)` 所创建的根
    fiber 副作用，于是 `TeamService` 的构造函数在服务存在之前就抛错（机制与测量见 §3.2）。
    **变化在于 mpd 团队不再需要它。** 自团队平面拆分（W2）起，团队运行在自己的记录
    （`mpd-team-core-plugin`，以 `mpdTeams` 对外提供）与自己的执行器之上 —— 即 `mpd-dsh-adapter` 的
    `TeamExecutor`，默认走 **native** 后端，基于 `ctx.subagents.startContinuable`，完全不读官方插件的
    任何东西。启动日志就是这么写的：`[mpd-team-core] team executor: native (native: the default
    backend — it needs nothing from the official plugin)`。
    因此那两行官方插件仍然保持禁用，守卫也**保留** —— 但它的理由是被**重新界定**的，而不是惯性沿用：
    它不再说"这里团队平面会死掉"（自 W2 起已不成立），而是说"一行在此组合中无法挂载的插件会在每次启动时
    打印激活错误，而禁用它对 TUI 平面毫无损失"（成立，且可测量 —— 两种情况下团队都能工作）。原缺陷的
    证据在 `evidence/tui/team-plane-not-mountable/20260929T083309Z/`。
    `mpd-tui-team` 场景、计划场景与状态行照常渲染；自 W3 起，该场景绘制记录自身的**任务依赖图** ——
    按 rank 分层、带状态颜色、带焦点链路，终端过窄时回退为缩进轨道视图。

## 11. 本页的验证状态

**修订绑定。** 下表每一条都绑定到交付修订：`dsh-plugin.json` sha256
`84ed4a5d5aac3fb07949f0f62bb7e7afdfa1e96de2c19de02974381eeb1201c9`（身份三元组
`@mpd-dsh/mpd` / 版本 0.9.1 / id `com.mpd-dsh.mpd-tui`），以及它的入口
`packages/mpd-tui-plugin/dist/index.js` sha256
`5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f`（98883 字节）。该产物在本波次中
被重建两次，因此更早的摘要是**历史，不是当前产物**；逐步链记录在
`evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md`。引用更早的摘要绝不等于引用交付产物。

| 结论组 | 本页主张的级别 | 状态与证据 |
|---|---|---|
| 安装 / 三层结构 / 24 行 / 0 崩溃特征 / mpd 预设默认值 | Observed | 有证据——t5 `evidence/tui/composition/20260915T053445Z/`，并由 t8（`evidence/tui/live/20260915T063140Z/lanes/tui-mount/`）与 t9（`…/conformance/20260915T064521Z/09-mount-boot.log`、`10-mount-boot-clean-root.log`）重跑 |
| 清单被解析、投影、协商（`waiting_authorization`）、真实 `/plugins check` | Parsed + Negotiated | 有证据——t9 `…/conformance/20260915T064521Z/01-admission-static.log`（清单 `84ed4a5d…`、入口 `5dce2563…`）与 `02-admission-live.log` |
| 逐包台账 | Observed（逐包） | 有证据——`ledger.json`（t5）；其结构由 t8 复核 |
| 插件契约形态（无默认导出、清理、软探测） | Tested（单元） | 有证据——`evidence/tui/plugin/20260915T054343Z/`（t4）；547 个包测试通过（t9） |
| 七个受激活门控的界面在真实 TUI 中的表现 | Observed | **7 个中交付 6 个**——`evidence/tui/live/20260915T063140Z/result.json`（`"tuiRenderers": false` → 明确不声明第 10 条） |
| 准入 / 分发 / 规范一致性通道 | Parsed + Negotiated / Tested / Tested（含被记录的阻断） | 有证据——t9 `…/conformance/20260915T064521Z/01`–`04`（分发：协议自带 CLI 退出 0，`fullyValidated=true`；规范套件：因未构建的 vendored `dsh-std` 而 `pinned-cli`/`pinned-suite` 退出 1，逐条矩阵已记录） |
| Web profile 仍可启动（回归） | — | **未验证**——只存在组合层面的代理证据（R4：24 个 row id，退出 0；干净存储的 TUI 挂载启动退出 0）。尚未运行真实的 web profile 启动 |
| 从干净沙箱重跑实机通道 | Observed | 有证据——t8 `…/live/20260915T063140Z/`（自建 root，`inherited: []`，隔离违规 0） |
| R3 `bun run test:qa` | — | 在船长单次 `VENDOR_LOCK` 重新固定之前**按设计失败**（t9 残留：技能语料 307 文件 / `e510d8c5c6de` vs 固定值 301 / `0dd4a6ee68e0`） |

本 bundle 到已准入要求套件的映射已经存在，该通道也已在固定输入上执行、并为每一行记录了逐条状态；尚待
处理的是被记录的规范套件阻断、web profile 启动，以及船长的单次重新固定——本页不会把其中任何一项变成
"通过"。

### 11.1 打通波次之后的修订（t50，2026-09-15）

上表是 TUI 版本当时的记录，保持原样。settings 打通波次（t35–t50）移动了其中两个被点名的产物，并关闭了
其中一项残留，因此以下内容取代它们。下列每个数字都在写入本段的同一步用 `sha256sum` / `stat -c %s`
重新测量——既不推算，也不凭记忆：

| 被取代的表述 | 原为 | 现为（2026-09-15 实测，t50） |
|---|---|---|
| §11 版本绑定中的入口摘要 | `packages/mpd-tui-plugin/dist/index.js` sha256 `5dce2563…`，98883 字节 | sha256 `cf4b3813a344c9d5…`，**105305 字节**——打通波次改写了 `/settings` 的披露文案，因此该包被重建。`dsh-plugin.json` sha256 `84ed4a5d…` 未变（8088 字节）；该波次新增的两个产物是 `packages/mpd-config-plugin/dist/index.js` sha256 `15733c1e…`（99868 字节）与 `packages/mpd-bundle-plugin/client.js` sha256 `dd9c8893…`（282453 字节） |
| §11 的 R3 行 | `bun run test:qa`"按设计失败"，直到船长的单次 `VENDOR_LOCK` 重钉落地 | **通过**——单次重钉已落地（`VENDOR_LOCK.json` 的 `assets/skills`：307 个文件，treeSha `ba0c3922…`），套件报告全部自测通过，退出码 0 |
| 明确不声明第 9 条（其开头是 `/settings` 打通） | "`/settings` 打通、包内技能资源、刻意的偏离" | 打通**已是受声明、有证据的能力**（§6.2，`Observed`，两次真实启动）；第 9 条现覆盖包内技能资源与刻意的偏离（§6.3、§7） |
| §3 的 settings 行 | "另有限制见 §6.2" | 打通后的行为，附一次重启提示与两种具名跳过情形（§6.2）、重复键规则（§6.5）与 Web 卡片证据级别（§3.1） |

原有表述未被改写——它们在本标题下就地被取代。

### 11.2 团队界面波次之后的修订（t5，2026-09-16）

上表是它们当时测量的修订版的记录，保持原样。本波次新增两个团队界面，并重新测量它们触及的东西：

| 被取代的表述 | 原为 | 现为（2026-09-16 实测，t5） |
|---|---|---|
| §3 的界面清单 | 面板、`/settings` 区块与命令树就是 TUI 的全部界面 | 新增 `mpd-tui-team`（`/mpd team`）与 `mpd-tui-plan`（`/mpd plan`），以及面板上的两行 `team-plan` / `team-hold`（§3.2） |
| §11 版本绑定中的入口摘要 | `packages/mpd-tui-plugin/dist/index.js` sha256 `cf4b3813…`，105305 字节 | 已在 `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/REVISION.json` 中按摘要重新钉定——交付的入口文件加上本波次触及的每一个源文件 |
| §11 的 R3 行 | `bun run test:qa` 通过 | **再次通过**——captain 把 `VENDOR_LOCK.json` 的 `assets.skills`（319 个文件 / treeSha `303e1631…`）与语料库变更放进同一次提交完成重新固定，验证任务也重试转绿。重新固定的值与扫描都在 `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/`；`docs/tui-parity.md` §7 复述它们 |
| 一致性这个问题本身 | 界面集是按通道分别描述的 | 针对 Web 版的每一个界面逐行回答，见 `docs/tui-parity.md`（+ zh-CN）：状态、原因，以及每一行的证据层级 |

### 11.3 DSH-TUI 0.13.0 适配波次之后的修订（2026-10-06）

上表是它们当时测量的修订版与宿主的记录，保持原样。本波次把目标宿主推进一个版本，并采纳了该版本
新增的接缝，因此以下内容取代它们：

| 被取代的表述 | 原为 | 现为（2026-10-06 实测） |
|---|---|---|
| 本页的目标宿主（开头段落） | `@deepseek-harness-tui/dsh-tui` **0.12.0** 及其内置准入配置 | **0.13.0**——新增侧栏面板接缝（宿主 row `dsh-tui-panels`，导出 `./panels`）并把宿主的 `dsh-ecosystem-spec/` 更名为 `tui-profile/` 的那个版本。0.12.0 的那段话作为历史保留在上方；同一次移动还改了分发钉定（`dsh-distribution.json` 的 `host-tui` 引用）与 QA 宿主规格（`docker/tui-lane.sh`、`docker/entrypoint.sh`、`skills/dsh-qa/scripts/tui-mount.ts`、`skills/dsh-qa/scripts/install-dependencies.ts`） |
| §3 接缝清单 | 十四条 `tui*` 接缝，即 dsh-tui 自 0.12.0 起暴露的那一套 | **十五条**——新增的是 `TUI_SEAMS.panels`（`tuiPanels`），按与其他接缝相同的纪律绑定/探测/降级（§3） |
| §3 的 Agent Teams 面板行 | `tuiScenes` 全屏面板 + `tuiStatus` 状态行 | **`tuiPanels` 侧栏面板成为主入口**，全屏场景为其回退，`alt+a` 与新增的 `/mpd panel` 都如此（§3.3）；动作清单现为 `board`、`team`、`plan`、`subagents`、`panel`、`workmates`、`status` |
| §7 的"宿主输入总线"行 | `Ctrl+A` 宿主输入接触面自 2026-10-05 起、只要工作区团队有 ≥1 项任务就绪 | **版本门控**：在提供面板接缝的宿主（0.13.0+）上惰性；在没有该接缝的宿主（0.12.0）上不变；`tui.dashboardKey` 保留在 schema 与 `/settings` 中，只对旧宿主有意义 |
| §10 第 10 条（`tuiRenderers`） | 在 0.10.1 时期的实机通道上 MISSING（7 个界面中 6 个） | **在 0.13.0 上仍为 MISSING**——界面通道渲染了八个界面中的七个，并在这一个必需界面上退出 1（`evidence/tui/lanes/2026-10-06T10-27-53.571Z/`）；本波次未改变该缺口 |

**本波次的证据与边界——边界是主张的一部分，不是脚注。**

- **挂载通道 PASS** —— `evidence/tui/lanes/2026-10-06T10-27-42.389Z/`：0.13.0 宿主上的 `mpd` 预设
  会话，带 key 的状态行、计数器、零应用期崩溃特征，且 `isolationOffenders=0`。
- **界面通道** —— `evidence/tui/lanes/2026-10-06T10-27-53.571Z/`：八个界面中 7 个已渲染（状态行、
  `/mpd` 补全、`/mpd workmates` 命令、侧栏面板的注册 + 打开、看板场景、带披露文本的 `/settings`
  区块、受中介对话框），其负向对照按要求为红——并在必需的 `tuiRenderers` 界面上退出码为 **1**，那
  是上面的既有缺口，不是本波次的回归。
- **`Ctrl+A` 通道 PASS** —— `evidence/tui/lanes/2026-10-06T10-28-57.807Z/`：宿主自己的 `Ctrl+A`
  dashboard 被打开（旧接触面按版本门控要求保持**惰性**），且 `/mpd panel` 证明了侧栏注册 + 宿主
  **接受**的打开。完整通道报告（含原始命令行与两个负向对照）见
  `evidence/tui/lane-repair/013-20261006T102742Z/TUI-013-LANE-REPORT.md`。
- **边界 (a) —— 在本宿主上面板主体无法被抓取。** 宿主**接受**打开之后，320×50 的抓取与紧接其前
  的那次逐字节相同，因此本波次证明的是注册 + `open()` + 从宿主 `list()` 回读中发现的 id
  （`act1:team`）——**不是渲染**；§3.3 写明这一点，每次运行都以 `panelBodyBound` 记录。
- **边界 (b) —— `tuiRenderers` 仍为 MISSING**（既有结构性缺口，已在
  `evidence/tui/EVIDENCE-INDEX.md` 中声明，不是本波次造成的）。
- **边界 (c) —— 没有取得 0.12.0 的 PTY 证据。** 干净的 0.12.0 沙箱需要 `dsh plugin add`，而它在这里
  被只读的 pnpm store 锁阻断（现存的那个 fixture 是**混合版本**组合，从未到达聊天界面），因此旧宿主
  的就绪路径靠单元测试支撑：`packages/mpd-tui-plugin/test/panel.test.ts` 中的 `takeoverArmed`
  （本修订上 16 pass / 0 fail，含 "the SEAM WINS: a bound panel seam forbids interception whatever
  the config layers say"），以及 `packages/mpd-tui-plugin/test/plugin.test.ts` 中的旧宿主分支——
  后者在这里**根本无法加载**（`TypeError: require() async module … cosmokit/lib/index.ts is
  unsupported`，已退役的采纳插件 vendored `_deps` 中的既有模块解析错误），因此该分支**不**作为
  证据主张。

### 11.4 依赖 DAG 移植波次之后的修订（2026-10-06，同日晚些时候）

上表维持它们所测量修订与宿主的原样。本波次把 WEB 依赖视图移植到 TUI 侧栏，并定位了"面板看不见"的根因，
因此以下内容取代它们：

| 被取代的陈述 | 原为 | 现为（2026-10-06 实测） |
|---|---|---|
| §3.3 面板清单 | **一个**侧栏面板（`team`），`minColumns` **32** | **三个**页面——`team`（`order` 10）、`dag`（`MPD DAG`、图标 `◈`、`order` 11）与 `workmate`（`MPD workmate`、图标 `◆`、`order` 12）——**`minColumns` 全部为 28**。32 正是缺陷本身：只要面板列窄于描述符请求的宽度，宿主就会用一条 `panel-too-narrow` 提示**顶替**页面正文，而它自己的分栏阈值恰好把该列定在 28，于是出现了一整段终端宽度：侧栏能打开、标签页也画出来了，用户看到的却是拒绝提示而不是图形 |
| §3.3 入口 | `alt+a` 与 `/mpd panel` | 另加 **`/mpd dag`** 与 **`/mpd workmate`**，各自经同一套仲裁路由到自己的页面，并各自带**自己**的全屏兜底（`dag` 用 `mpd-tui-subagents`，`workmate` 用看板场景） |
| §3.3 / §10 第 16 条——"面板正文无法用 pane 抓取" | 一次被宿主**接受**的 `open()` 前后抓取逐字节相同，因此不主张渲染 | **根因**现已查明：该页从未进入宿主的启用列表——宿主自己的 `useSidePanel` 会**丢弃** id 未启用的请求，而 `tuiPanels.open()` 在请求**被送达**时就返回 `true`——并且侧栏默认关闭。当 `sidePanel.panels` 带着页面 id、侧栏也打开时，120 列抓取会显示三个 MPD 标签页与页面正文。主张仍然有界：MPD 依旧无法观测**渲染**（宿主事件集合里没有 `opened`/`focused`），因此命令的那句话只陈述它知道的事，并点名补救步骤而不是宣称成功 |
| §3 对 DAG 的描述（仅场景） | 场景内一个按深度缩进的任务列表 | DAG 有自己的页面（§3.4），且 rank 是从依赖图**推导**而不是听信服务端 `depth`——阻塞引用解析不到任何任务的看板，过去会画出一列且一条边都没有，而且什么都不说——无法解析的引用会被报出，并且只有**一张**调色表作为色调来源 |
| §1 界面清单 | 面板、场景与状态行是彼此独立的界面 | 整个 `mpd-tui` 界面层被统一到**一套**视觉系统（R14），每个界面都读冻结的色调/字形/图例表，而不是自带一份私有副本 |

**本波次的证据**（全部位于 `evidence/tui/dag-port/`）：`requirements.md` —— 冻结契约及其四次修订；
`verification/pty/frozen/` —— 冻结版本的真机 PTY 抓取（三个 MPD 标签页、pin/unpin 键位，以及带
`split=false` 分支的宽度矩阵）；`seam-guard/20261006T135423Z/` —— 接线、id 发现与 R26 措辞；
`panel-surface/20261006T140037Z/`、`dag-layout/`、`visual/`、`team-feature-test/`、`web-dag/`；以及
`freeze/FROZEN-REVISION.md` —— 抓取所依据的修订哈希。

**边界（边界是主张的一部分）。**（a）MPD 无法观测渲染（见上）：它知道的只是"id 已被拼装 + 请求已被接受"。
（b）页面 id 是**动态**的（`<activationId>:<slug>`），因此任何文档都不得把 `act1:dag` 写成常量——请从宿主
的 `/panel ` 补全列表或命令打印的那一行得知。（c）在 80 列与 48 列下宿主根本不劈栏（`split=false`），因此
那里任何侧栏页面都不可能可见。（d）DAG 页的滚动条有一个**已知未修**的缺陷——无界连按 `PgDn` 可以把窗口推
到零行，因为滚动偏移量跨渲染累积——因此它被记录，绝不宣称完美。（e）只属于浏览器的行为（悬停、像素几何、
CSS 省略号、`overflow:auto`、原生 tooltip、DOM 读取与 `fetch` 轮询）未移植，也不主张。

### 11.5 DAG 高亮波次之后的修订（2026-10-07）

上表维持它们所测量修订与宿主的原样。本波次修复了 DAG 页的点击、缩小了节点，并给三个侧栏页面各自配上
专属外观，因此以下内容**取代**它们——是取代而不是简单追加，因为同一页上两句互相矛盾的话比任何一句都糟：

| 被取代的陈述 | 原为 | 现为（2026-10-07 实测） |
|---|---|---|
| §3.4——"点击任务会钉住一个含十条事实的详情体" | 点哪个节点就钉哪个节点 | **点击是"只看行"的。** `panel-dag.ts` 用 `hits.find(c => index >= c.row && index <= c.rowEnd)` 解析指针——只看行——而 `GraphHit` 本来就带 `col`/`colEnd`、`graph.ts` 也早就导出了 `hitTest(view, row, col)`。同一 rank 的所有框共享**同一条**行段，因此点击永远钉住该 rank **最左**的框；Termaid 那次把框加宽后一个 rank 常有 2~3 个框，而最左那个经常被平移出屏幕，于是 `▶` 与蓝色链路落在用户根本没指过的任务上。修复前无头实测：点击**画着 `T3`** 的那一行，渲染出 `[accentShimmer] │ ▶ T2 …`，而 `T3` 仍是 `[inactive]`。现在点击经图形自己的命中矩形、用指针的列加上平移偏移解析；点在没有框上的点击会**清除**钉住 |
| §3.4——节点标签 | `<marker> <id> <KIND> <graph-safe subject>` | **`<marker> <id>`**——`✓ T3`、`▶ T3`。标题彻底不再进入图形，这正是消除用户报告的**乱码**那一类的方式（中文标题经 `graphSafeLabel` 压出来是 `#5`），也是让"一列三个节点"塞进 40 格侧栏的原因。标题与描述在钉住的详情体里**原样**保留 |
| §3.4——框的形态 | 带两行留白的五行框 | **紧凑的三行框**（上边框、内容、下边框），圆角保留，一次绘制只用一种形态 |
| §3.4——钉住后看起来如何 | 只有色调变化（颜色） | 被钉任务与其上游依赖链**加粗**，其余带上弱化色调**并且**带宿主的 `dimColor` 标志——因为深色主题下 `inactive`（`#8991A0`）对 `subtle`（`#A6ADBA`）几乎看不出差别。**实测边界，如实陈述而不是暗示**：在已安装的 0.13.0 上宿主把 `dimColor` 解析成 `theme.inactive`——正是 `DAG_TONE_THEME.dim` 本来就用的那个键——所以该标志是一条**语义**通道，在本宿主上不改变任何像素；可见的非颜色分隔是 focus 与 chain 上的**加粗**，而"置灰"本身是真实的 `subtle`→`inactive` 变化 |
| §3.4——DAG 页的滚轴 | 一条纵向 gutter 支持点击跳转；一条横向 rail 只支持滚轮/键盘 | **两条滚轴都响应鼠标拖动**，走**与点击完全相同**的绝对轨道算术（`onDragStart`/`onDragMove`/`onDragEnd` 配宿主自己的 `localRow`/`localCol`），与宿主自己的 `components/ScrollbarGutter.js` 一致。点击、滚轮与键盘照旧 |
| §3.3 / §11.4 图标格——`workmate` | 图标 `◆` U+25C6 | **`◆` 本来就是宿主自己的标签页图标之一**（`agents`），所以它根本不是"独特的符号"。实测集合为 `MPD` = `❖` U+2756、`MPD DAG` = `◈` U+25C8、`MPD workmate` = `⬢` U+2B22，每个在插件的 `sanitize.cellWidth` 与宿主的 `stringWidth` 下都是一个单元格（图标不是恰好一格的注册会被宿主**拒绝**） |
| §3.3 / §11.4——合并页的标签页 | 标题 `MPD`、**无图标**，于是宿主画出兜底字母 `M` | 合并页声明 `❖`，不再退回字母 |
| §3.3 / §10——MPD 页面上的全屏控件 | 无 | 每个 MPD 页面都画**自己可点的 `⤢`**，用来打开该页既有的整屏场景。它是 MPD 自己的控件而不是宿主的，**因为宿主根本画不出来**：dsh-tui 0.13.0 的描述符校验器把插件定义冻结成恰好 `{id, title, icon, order, minColumns, source, pluginId, mountPolicy, component, compact}`——**没有 `capabilities`**——而 `components/sidePanel/SidePanelColumn.js` 的 `canExpand` 读的是 `definition.capabilities?.fullscreen === true`，所以宿主的 `⤢` 对 MPD 永远不会出现，`Chat.js` 的 `openPanelFullscreen` 也只映射内置面板 id。声明 `capabilities` 只会画出一个点了没反应的按钮，本包不发布这种东西 |
| §3.4 结尾的边界句，以及 §11.4 边界（d） | "冻结版本上 `bun test ./packages` 的两个失败臂正是这两个偏移量累积臂"；DAG 滚动条无界 `PgDn` 被记作**已知未修** | **已过时并删除。** 偏移量现在由 ref 持有、是唯一的实时权威，每次读取都按**当前**渲染的尺寸夹紧，所以偏移量累积缺陷已修，套件是绿的（本波实测：`bun test packages` 退出码 0，TUI 包内 382 条通过）。滚动条剩下的边界就是 §3.4 仍在如实陈述的那条：MPD 无法观测渲染 |
| §3.4——DAG 页的十条事实详情体 | 只有钉住/取消钉住 | 另加：点击**已经钉住**的任务会打开该成员的**工作页面**——MPD 的整屏 `mpd-tui-subagents` 场景，停在任务归属者的详情视图上，归属者经宿主策展的 subagent 行匹配。匹配不到时由宿主 toast 说明，场景退到列表 |

**本波次的证据**（全部位于 `evidence/tui/dag-highlight/`）：`20261007T120342Z/` —— **修复前**的诊断，含可
直接运行的 `probe-click.ts`/`render.ts` 仪器，以及"点击画着 `T3` 的那一行却钉住 `T2`"的日志；修复后的
运行、验收仪器日志、真机 PTY 抓取与各道闸门日志落在同一 slug 下的第二个时间戳目录。

**边界（边界是主张的一部分）。**（a）指针坐标的**投递**链路——终端与宿主是否真的把可用的
`localRow`/`localCol` 交给插件侧栏面板内部的**行 `Box`**——属于**已声明、未证明**：无头臂证明的是
**解析**，真机 PTY 抓取证明的是**渲染**，本页主张的就只有这么多。（b）忽略拖动属性的宿主只是不能拖动；
不会丢失任何手势，因为点击、滚轮与键盘仍然绑定。（c）除此之外 DAG 绘制没有任何变化：rank 推导、
无法解析的阻塞引用与环的报告、箭头、图例与六态调色表都仍是 §11.4 的那些。（d）WEB 依赖视图**未**被本
波次改动。

### 11.6 DSH-TUI 0.14.0 适配波次之后的修订（2026-10-08）

上面的行是它们各自测量时的记录，保持原样。本波次把目标宿主再往前推了一个版本，而**面向插件的每一条
接缝都原封不动地穿过这次移动**，所以这次适配是一次宿主形态的重新测量，加上侧栏自己的页面集合与整屏
控件。以下内容取代它们：

| 被取代的表述 | 原为 | 现为（2026-10-08 实测） |
|---|---|---|
| 本页的目标宿主（§ 前言） | `@deepseek-harness-tui/dsh-tui` **0.13.0** 及其内置准入配置文件 | **0.14.0**（读自已安装的包：`version` 为 0.14.0）。该版本自身的增补：**Claude 后端 peer**——`@anthropic-ai/claude-agent-sdk`，恰好 `0.3.287`，是该版本唯一新增的 peer——**`ws` 运行时依赖**（`^8.21.3`，0.13.0 时并不存在）、第**八**个内置侧栏面板（`btw`），以及下面重写过的 `PanelBar`。`MPD_E2E_DSH_VERSION` **不动**，因为 harness 的 peer 范围未变 |
| §3 接缝清单 | 自 0.13.0 起的十五条 `tui*` 接缝 | **仍是十五条，且每一条与 0.13.0 逐字节相同**——宿主 `lib/types/dsh-adapter/` 下的十五个接缝模块及声明（`panels`、`scenes`、`status`、`renderers`、`settings-sections`、`shortcuts`、`dialogs`、`command-trees`、`plugin-host`、`toast`、`themes`、`plugin-storage`、`message-observer`、`effect-ledger`、`workspaces`，每个都有 `.js` + `.d.ts`）都没有变动，不存在第十六条接缝，`peerDependencies` 列表末端仍是 `0.2.0-rc.2`。**接缝层面不需要任何适配器代码改动** |
| §3.3——启用列表的默认值，以及钉住它的那条测试臂 | 宿主默认 CSV 为 `todo,jobs,agents`（三个内置面板） | **`todo,jobs,agents,info,trajectory,workspace,btw,companion`——八个内置面板，`btw` 是新增的那个**（`DEFAULT_SIDE_PANEL_IDS`，读自已安装宿主的 `lib/types/tuiDisplayPrefs.js`）。本 bundle 自己的测试现在断言的是**不变量**，而不再断言三 id 的字面量：宿主一长大，字面量就会变红，而这个文件的前提本来就是"宿主一变，它自己重新判定"。该条款点名的**三**条子断言全部在执行且为绿：默认值只列内置面板、不含我们的任何 id；其中每个 id 都通过宿主自己的 `SIDE_PANEL_ID_PATTERN`；规范化函数对它**幂等**——幂等这条的载体是 `packages/mpd-tui-plugin/test/panel-visibility.test.ts` 中的测试臂 *"the host REWRITES the CSV from configuration, which is how a registered panel disappears"*，其 `const once = prefs.normalizeSidePanelPanels(prefs.DEFAULT_SIDE_PANEL_IDS)` 之后紧跟 `expect(prefs.normalizeSidePanelPanels(once)).toBe(once)`。**该断言就在那条臂里运行并通过**——它属于上文 469 通过 / 0 失败 的那次套件读数，是直接读该文件确认的，而不是从臂的标题推断的 |
| §3.4 / §11.5——`⤢` 控件与宿主自己的那个 | 每个 MPD 页面画自己的 `⤢`，因为宿主画不出插件面板的 | **在 0.14.0 上重新测量，仍然成立，且作为边界而不是愿望陈述**：`dsh-adapter/panels.js` 仍把插件定义冻结为 `{id, title, icon, order, minColumns, source, pluginId, mountPolicy, component, compact}`，**没有 `capabilities`**，而 `components/sidePanel/SidePanelColumn.js` 的 `canExpand` 读的是 `activeEntry?.definition.capabilities?.fullscreen === true`——因此宿主自己的 `⤢` 对插件面板依旧不可达，`capabilities` 依旧不声明（不发布点了没反应的按钮）。MPD 自己的控件打开的是一个由 MPD 注册的整屏界面，外观与该页**同样丰富**（§3.4） |
| §3.4——图形下方的图例 | 一份每次绘制固定的图例行块 | **"图例累积"缺陷已修，且根因已实测**：图例行原本以 `legend-${line.slice(0, 24)}` 为 key，而图形自己的状态键行与图例紧随其后的第一行折行后都以 `✓ completed · ◐ running` 开头，于是两个 React 子元素共用**同一个** key，冲突的那一行在每次重渲染时都被多渲染一次（挂载实例实测：挂载后 4 行，点击七次后 7 行）。现在 key 是该行的位置，守住它的臂断言**点击 N 次后图例行数稳定** |
| §3.3 / §7——钉定载体 | 全局包、`dsh-tui` profile、分发引用与 QA 宿主规格都写着 `0.13.0` | **本波次载体改为 `0.14.0`**：`docker/**`（`docker-compose.yml` 的两个 `MPD_E2E_TUI_VERSION` 默认值、`docker/ui/docker-compose.yml` 的同名键、`docker/entrypoint.sh` 的 `TUI_VERSION`、`docker/ui/entrypoint.sh` 的两个 `MPD_UI_TUI_VERSION` 默认值、`docker/tui-lane.sh` 的 `TUI_VERSION` 及其 `PREF_WRITER` 探针字符串）、分发描述符的 `host-tui` 引用（`dsh-distribution.json` 现为 `pkg:npm/@deepseek-harness-tui/dsh-tui@0.14.0`），以及 `skills/dsh-qa/scripts/**` 下七个 QA 载体（`tui-mount.ts` 的 `TUI_HOST_SPEC` 与 PREREQ 行，`tui-panels.ts`、`tui-deps-ctrla.ts`、`tui-team-surface.ts`、`tui-admission.ts` 的 PREREQ/修复字符串，`lib/tui-lane.ts`，`install-dependencies.ts`），以及 `scripts/mpd-tui-panels.ts` 的头注释：它现在把
0.14.0 写成本 bundle 对准的版本，而它上方那段仍是当年的 0.13.0 测量。**两处刻意的"不动"：** `MPD_E2E_DSH_VERSION` 保持默认 `0.2.0-rc.2`，因为 harness 的 peer 范围没有变化（F2 的读数）；`dsh-plugin.json` 的 `compat.hosts` 保持 `@deepseek-harness-tui/dsh-tui@0.10.1`，因为该字段记录的是本 bundle 通过准入时所依据的 **0.10.1 准入测量**，而不是它所对准的 TUI 版本——改动它会篡改一项测量，而不是记录一个目标 |

**双面板侧栏（用户条款「把MPD与Workmate两个panel扔到侧边栏上去」）。** 本波次把三个 MPD 页面收敛为
**两个**——富形态的 `team`/`MPD`（`❖`、`order` 10）与 `workmate`/`MPD workmate`（`⬢`、`order` 12）——
两者 `minColumns` 均为 28、`apiVersion` 均为 1、都不声明 `compact`。独立 `dag` 页的**注册**已消失：
存活槽位渲染的就是 `src/panel-dag.ts` 的渲染体（宿主自己整理的子代理行在图形上方，同处 DAG 页自己的外框、
表头 + 进度、图例、按键页脚、徽标与钉住详情体之内），那份单独的合并渲染器被删除而不是与它并列保留，该模块的
`◈` 图标不再被任何页面声明。**每一个用户可见入口都仍然解析到存活界面**，这正是该条款自己的检验标准：
`/mpd dag` 改瞄到 MPD 面板被发现的 id（该路由的回退是富形态团队场景），`/mpd panel`、`/mpd subagents` 与
`alt+a` 本来就都走同一个槽位，`/mpd workmate` 保留它自己的页面，而适配器记录的 id 集合是**从实际注册中
发现的**——因此它只带存活的两个 id，绝不自行拼出三个。

**整屏对应界面（用户条款「全屏出来的MPD也要有这种富外观」）。** MPD 页面自己的 `⤢` 打开的是**富形态的团队
场景**（`mpd-tui-team`），而不是合并的 subagents 场景：团队场景画的是与页面同一套语法（外框、图例、聚焦任务
的详情面板——即钉住在整屏下的形态——以及按键提示），所以读者不会从一个富页面掉进一个贫页面。`/mpd panel` 与
`alt+a` 的**路由**回退仍然是合并的 subagents 场景（`mpd-tui-subagents`），因为那条路由问的是"哪个界面承载
宿主自己的行"——两个问题按设计各有各的答案，`registerPanelSurface` 也就把它们作为两个选项接收。

**启用列表现在跟随宿主自己的变更订阅。** 作为**主要**修复手段，有界的 tick 阶梯（六个 tick、约 25 秒后永久
停止）已被宿主自己的 `subscribeSidePanelPanels`（实时设置存储上的订阅）取代：宿主一重新应用配置，被抹掉的
列表就当场被修复，而不是在阶梯结束后彻底丢失——这才是用户那句「侧边栏挂掉了」的持久解法。tick 阶梯**只**作为
"宿主不提供该订阅"时的降级路径保留；订阅随注入作用域释放、在没有该模块的宿主上永不抛错，而**退让**规则
不变（**列表一旦出现我们的任何一个 id，就说明配置已经就本 bundle 表态，守卫永久停止**，因此用户故意删掉的
页面绝不会被放回；而我们自己的写入包含我们的 id，所以循环也就此结束）。

**记录的 id 集合现在带来源信息（provenance），因为一次测试运行污染过它（实测）。**
`.mpd/logs/mpd-tui-panels.json` 在 2026-10-08 被覆写成 `act0:team,act0:dag,act0:workmate`——这些 id
已安装宿主无法拼出，因为它的 `pluginIdFor` 兜底计数器先自增、第一个裸激活是 `act1`——而元凶是一次**单元
测试**运行，它的面板接缝替身把注册标成 `act0`。记录现在是 schema 版本 2，并带
`provenance {hostRoot, hostVersion, readBack, activation}`；记录器**拒绝**写入任何无法追溯到已安装宿主包与
宿主回读的记录，`act0` 这一形状被点名拒绝。实测：完整跑一遍
`bun test ./packages/mpd-tui-plugin ./packages/mpd-tui-adapter-plugin` 之后，该记录的 sha256 不变。
**同一份证明在**读取**侧也被守住**，因此被污染的记录再也到不了用户的 profile patch：
`scripts/mpd-tui-panels.ts` 会**拒绝**（试运行与 `--apply` 一视同仁，退出码 1）不带 `provenance`、
`hostVersion` 为空、缺 `readBack` 或 `activation === "act0"` 的记录，点名失败的字段并指向
`--ids <a,b,c>`——实测（针对被污染的 version-1 记录）：``REFUSED: … it carries no `provenance` block …``、
退出 1、记录 sha256 不变、`--ids act1:team,act1:workmate` 被接受、脚本 `--self-test` 全绿（每种拒绝形状
一条臂，外加格式良好的 version-2 记录被接受）。

**0.14.0 的 `PanelBar` 不再绘制插件的图标，这是**宿主**的事实，而不是本 bundle 的改动。**
`components/sidePanel/PanelBar.js` 现在是一个**轮播**：当前标签页的标题居中绘制（`ActiveTitle`——
加粗、`wrap: "truncate-end"`），其余每个标签页是一个 `○` 圆点——带徽标时是 `●`——按算出的间距
（pitch）摆放，溢出时开窗。在已安装源码上实测：`grep -c icon lib/types/components/sidePanel/PanelBar.js`
为 **0**。描述符的 `icon` 仍被宿主校验器**要求**，每个 MPD 页面也仍然声明它（图标不是恰好一个单元格
就会被拒绝）；只是它不再被绘制。因此本 bundle 图标臂从宿主自己的 `builtinPanels.js` 读到的碰撞集合
从七个变成**八个**——`≡ ▸ ◆ ⓘ ∿ ⌗ ? ♥`，新增的那个是 `btw` 的 `?`。

**本波次的证据，以及每一份读数各值多少。** 上面的宿主读数都取自已安装的那棵树
（`/root/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui`，`version` 为 0.14.0），并且
是与本修订同一步写下的——`DEFAULT_SIDE_PANEL_IDS`、`SIDE_PANEL_ID_PATTERN`、冻结描述符字面量、
`canExpand` 的源码、`PanelBar.js` 中不含 `icon` 的正文，以及 `builtinPanels.js` 的八个图标，全部是从
那些文件里读出来的，而不是凭记忆写的。接缝的逐字节相同是本波次对两棵已安装树的比对。图例缺陷由一条
**挂载实例**臂钉住：它导入宿主真正的 React/ink
（`packages/mpd-tui-plugin/test/panel-legend-mount.test.ts`）并走完点击序列——修复前的行数序列为
`[4,5,5,5,6,6,6,7,7]`，修复后在每一步都是 `4`——再加上实测的测试套件：`bun test ./packages/mpd-tui-plugin
./packages/mpd-tui-adapter-plugin` = **469 通过 / 0 失败**（冻结版本的读数：波次前 454 → 469，即被恢复的
44 条测试文件加上 15 条新臂）。
**全仓范围**上，本波次的验证记录 `rec-20261008T030715-f1a2ad` 读作 **1632 通过 / 3 跳过 / 2 失败**——两条
红是**已声明**的环境缺陷，对照合同波次前的 1615 / 3 / 4——本页引用该记录，而不是自行重算。记录完整性的
边界也用同一方式测量：上述套件
运行前后该文件的 sha256 **不变**。**补救命令的这两处读法并不矛盾——它们是同一条命令在它自身修复之前与之后
的行为，两者都刻意保留在这里。**在读取侧守卫落地之前（实测于 2026-10-08，即本波次更早的时刻），对
被污染的记录执行一次 `node scripts/mpd-tui-panels.ts` 试运行会**打印**它打算写入的 `act0:*` id——那是缺陷
的实证，也正是守卫存在的原因。而在该修复之后，**当前、实测**的行为是同一条命令打印
``REFUSED: … it carries no `provenance` block (a version-1 record, whose ids cannot be traced to a boot)
… or pass --ids <a,b,c>`` 并退出 1（见 §3.3 与上文来源信息一段）；修复前那一行是**历史**，不是对现在这版
脚本的描述。本波次的沙箱与真机 PTY 通道（mount、panels、surfaces、deps/`Ctrl+A`、
team surface、admission）记录在 `evidence/tui/lanes/**` 下；Docker 通道在
rootful 守护进程上给出的是 NOTICE 而不是通过——**SKIP 不是通过**，本页不会把它写成通过。

**边界（边界是主张的一部分）。**（a）MPD 依旧无法观测**渲染**：宿主的事件集合是
`registered|unregistered|badge|error|disabled`，而 `open()` 回答的是**送达**，因此插件只陈述它知道的
事，页面正文由单元臂与钉住的 PTY 抓取断言，绝不由插件自己的分支断言。（b）宿主自己的 `⤢` 对插件面板依旧
不可达，因此 `capabilities` 依旧不声明——不发布点了没反应的按钮，而且这是一条边界而不是 TODO。（c）记录的
来源信息在**两侧**都被强制执行（写入侧拒绝不可证明的记录，读取侧点名拒绝），而 `--ids` 是用户已知 id 时
记录在案的逃生口。（d）`PanelBar` 的这次
变化是**宿主**的事实：本页描述的是 0.14.0 的行为，将来若某个宿主重新绘制图标，也不会与本页任何 MPD 主张
相矛盾——每个描述符仍然声明图标。
