# DSH-TUI 版本

[English](./tui.md) | **中文**

本页说明 my-power-dsh 的 **DSH-TUI 版本**：它提供什么、如何安装、逐包兼容性测量的结果，以及它
**明确不声明**什么。目标宿主为 `@deepseek-harness-tui/dsh-tui` **0.17.0** 及其内置的准入
（admission）配置文件——它是第一个在声明的 peer 范围里接受 DeepSeek Harness `0.2.1-rc.3` 的
dsh-tui 版本。§11.10 是本波次的修订：其中记录了这次移动、没有变化的接缝清单以及被触及的各个载体。
**此前的钉定版本是 0.16.1，那段表述作为历史保持可读**：0.16.1 是第一个在声明的 peer 范围里包含
harness `0.2.1-rc.2` 的 dsh-tui 版本（其 36 个 `@deepseek-ai/dsh-*` peer 全部列出该版本），§11.8 是
那一波次的修订。**此前的钉定版本是 0.14.0，那段表述作为历史保持可读**：0.14.0 是新增 **Claude 后端 peer**
（`@anthropic-ai/claude-agent-sdk` 0.3.287）与 `ws` 运行时依赖、第**八**个内置侧栏面板（`btw`），
并把 `PanelBar` 改成**轮播**（只画当前标签页的标题加 `○`/`●` 圆点，不再绘制插件声明的图标）的那个
版本；§11.6 是那一波次的修订，其中列出了那次移动触及的各个载体。
**此前的钉定版本是 0.13.0，那段表述作为历史保持可读**：0.13.0 是**新增侧栏面板接缝**的那个版本——
宿主 row 为 `dsh-tui-panels`，
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
`0.13.0`）。**这两类载体在 0.14.0 与 0.16.1 波次中又移动过——当前生效的取值由 §11.8 那一节给出，而不是本节。**
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
| TUI 界面包 | `packages/mpd-tui-plugin/` | TUI 原生界面：**三个侧栏页面**（`src/panel.ts`——标题 `MPD`，主入口，且自 0.14.0 波次起它本身就是富形态 DAG 页，§3.3/§3.4——、`src/panel-workmate.ts`，以及 2026-10-23 看门狗波次新增的 `src/panel-watchdog.ts`）、状态行、`/settings` 区块、全屏场景、`/mpd` 命令树、快捷键、受中介的对话框、**宿主未投影**的转写渲染器注册（明确不声明第 10 条），以及"就绪但未激活"的决策事件接缝。 |
| 准入清单 | `dsh-plugin.json`（仓库根目录） | 整个 bundle 的**唯一**一份 Community v0.15 清单——这是刻意的偏离（见 §7）。 |
| 环境描述符 | `dsh-distribution.json`（仓库根目录） | 面向 dsh-distribution 元协议（Draft）的 `DistributionDescriptor`。 |
| TUI 组合 | `cordis.patch.yml` + `presets/mpd.patch.yml` | 新增 `mpd-tui` 行，并以追加方式注册 **mpd** 预设；部署默认值仍归宿主（`standard`），因此在选定 `mpd` 之前，TUI 会话使用 `standard`（§2）。 |
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
本 bundle 是**第三个** patch 层；两文件 bundle patch 层声明 **36** 行（`cordis.patch.yml` 35 行、
`presets/mpd.patch.yml` 1 行，即 `bun run verify:rows` 打印的行数）；真实启动日志中应用期崩溃特征计数为
**0**（`unsupported JSON schema`、`JsonSchemaError`、`plugin tree failed to load`、
`failed to apply loader entry`、`Error:`）；没有重复的 loader entry id。**证据级别：**
`Observed`（一次被记录的真实 dsh-TUI 启动，加上宿主自身的 `--dump-config`）。仅有
`--dump-config` 只能证明组合，不能证明加载——崩溃特征计数来自真实启动。

TUI 会话解析的是**宿主**的默认预设，而不是 `mpd`：承载部署 `default` 的那一行由宿主层声明
（Web 平面是 `@deepseek-ai/dsh-web-app` 的 `agent-preset-registry`，TUI 平面是
`@deepseek-harness-tui/dsh-tui` 的 `dsh-tui-agent-preset-registry`），而本 bundle 对两者都不发 id 定向——
`node scripts/verify-no-host-override.ts` 会在任何 id 落在宿主层声明集合内的 id 定向上让构建失败，而当初
携带 `config.default: mpd` 的两处 id 定向已按 2026-10-02 的"严格零覆盖"决定移除（被移除的块记录在
`cordis.patch.yml` 里）。因此 `mpd` 是**可用但需主动选择**的：在 TUI 里 `/preset mpd`（宿主的
`presetPrefs.js` 会把它持久化到 `~/.dsh-tui/agent-preset.json`）、在宿主的 `dsh-tui` 行上显式写
`preset: mpd`（或 `DSH_TUI_PRESET=mpd`）、Web 设置里的 `selectedDefault`，或者一键助手
`node scripts/set-default-preset.ts --yes`（默认试运行）。每条通道及其取舍都记录在
[`preset-default.zh-CN.md`](preset-default.zh-CN.md) 中。

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
| — | `tuiSettingsSections`（mpd.jsonc 可调项的 `/settings` 区块） | 已渲染——同上；该区块写明与 `<workspace>/.mpd/mpd.jsonc` 的**打通**、模型路由即时生效（挂载时捕获的旋钮仍需重启）与"绝不丢失"条款（§6.2），通道以 `allPatterns` 断言这段披露文本 |
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

共享 schema 声明的同一组可调项 —— 原有 13 个、三十三个 `agentRoutes` 叶子（每个名册 agent 一行：
提供商 / 模型 / 推理强度，渲染为联动的选择器），另加 TUI 界面自身的一个开关 —— 也能在 Web 界面里编辑。
**按 AGENT** 的路由才是模型配置的单位，**不存在持久化的槽位**：四个分组只是 `/mpd-model` 的批量编辑
分组，因此两扇门都按四个分组标题显示**每个 agent 一行**（分组仅用于显示），分组写入经一个点名受影响
agent 及其当前路由的确认面板后覆盖每个成员自己的条目，`/mpd-model` 依次询问 分组 → 范围（整组，或单个
agent）→ 提供商 → 模型 → 推理强度，写入 `agentRoutes.<Agent>.<leaf>`，并为单个 agent 提供清除分支。
遗留的 `teamModels` 块只迁移一次，之后被忽略、永不改写。

**设置 → MPD** 是设置对话框中独立的一栏 —— 它不再位于「插件」标签页内。该栏按宿主自有栏目（section）的注册方式注册（`ctx.slots.inject("settings.section", …)` →
`ctx.slots.register({ name: "settings.section", id: "mpd", order: 20, label: () => t("nav"), locale, inject }, Section)`，
形状取自 `dsh-client-ui-settings-models/lib/client.js:2936` 的实测）：设置外壳收集该列表槽位、按 `order`
排序并渲染当前激活项，因此 `order: 20` 让 MPD 排在 `general`（0）、`models`（10）、`plugins`（15）之后，
且不移动任何既有栏目。该栏原样渲染卡片，不声明任何嵌套 `children`；没有被注册的命名空间什么也不渲染——这
正是此前可调项不可见的原因。写入走 harness 自己的 config-form（`ctx.configForms.get("mpd-config")`，
即 `mpd-config` entry 文档），而不是 `settingsScope` 绑定；不可写的表单会带原因渲染为只读，并且绝不尝试写入。卡片的字段、
标签与中文描述由它自己的测试与 TUI 区块的描述符逐一比对，因此两扇门不会各自漂移。

**证据级别——已见证：** **已构建且已服务**的客户端字节中的注册契约
（`packages/mpd-bundle-plugin/client.js`；通道会重新哈希它所判定的那份产物，本次移动前后的大小与 sha256
都记录在证据中）、**离线钩子测试台（offline hook harness）**在注册被**调用**时记录下的该栏描述符——id、
order、label、locale、无 `children`、其字段与 TUI 描述符的一致性、以及模块行为——渲染、以正确的路径/值/
revision 驱动 scope 写入、拒绝非法草稿、带原因渲染为只读——以及经由宿主自身带认证的 settings API 完成的
**端到端写入路径**（`web-settings-bridge.ts` W1–W13）。

**证据级别——本环境未见证：** **真实浏览器渲染**（宿主在真实页面中分发该 key）与**点击驱动的保存**。
本环境没有浏览器可执行文件；通道以 `cardClaim.W3.witnessed === false` 记录这一点及原因，本页重复该结论，
绝不暗示相反。要自己看到它：启动 `dsh web`，打开界面，进入 **设置 → MPD**，应看到带 schema 各项（每个
agent 的路由叶子提供由目录驱动的选择）的
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

`packages/mpd-tui-plugin/` 通过 `ctx.tuiPanels` 接缝注册**三个**右侧栏页面——`src/panel.ts`（slug
`team`、标题 `MPD`、单格图标 `❖`、`order` 10）承载那份**富形态的合并视图**（宿主自己整理的子代理快照行
在**上方**，**本会话**自己团队的 MPD 依赖 DAG 在下方（见 §3.4），两者同处 DAG 页自己的外框、表头 + 进度、图例、按键页脚
与点击钉住的详情体之内）；`src/panel-workmate.ts`（slug `workmate`、标题 `MPD workmate`、图标 `⬢`、
`order` 12，见 §3.4）；以及 2026-10-23 看门狗波次新增的 `src/panel-watchdog.ts`（slug `watchdog`、
标题 `MPD watchdog`、图标 `⚠`、`order` 13、`minColumns` 28）。看门狗页渲染团队看门狗的持久状态：**每支团队**
的**暂停状态与阶段**、`mpd-tui` 读者的未读数，以及近期事件（种类、相对时间、团队 / 任务 / 尝试、原因与 `ms`、
挂起结果与确认状态）；`a` 确认到当前显示的最新事件（只推进 `mpd-tui` 水位，一次按键一次）、`r` 刷新、
`↑↓` / `jk`（外加 `PgUp`/`PgDn`/`Home`/`End`）滚动。它的数据源是经本包自己的前门访问的 `mpdWatchdog`
服务——**绝不**直接读 `.mpd/team/watchdog/*.jsonl` 文件——因此服务缺失时渲染显式的
`watchdog: 不可用` 状态，没有事件时渲染显式空状态，任何渲染路径都不抛错。`/mpd watchdog` 经
`openPanel(handle.id())` 打开它；该页**没有全屏回退**（没有任何场景绘制事件列表），所以面板接缝缺失时只用
一行**报告缺失**，而不是路由到另一个界面。该页还会从 apply 侧的关注面获得**自己的**徽标（暂停 = `warning`、
未读事件 = `info`），该关注面除了每个团队 feed 事件外，还以 5 秒轮询重取——暂停由看门狗自己的定时器造成，
不触碰任何团队记录，只靠 feed 永远不会通告它。**本节过去描述的那个页面——`src/panel-dag.ts` 那个独立的 `dag` 页——已被 0.14.0
波次退役并合并进 MPD 面板**（用户条款「DAG页作为MPD面板」，§11.6 有记录）：两个描述符、两个 slug、两个排
序位最终只留下**一个**，而存活槽位渲染的正是 DAG 页的渲染体。**用户能触达的入口没有一个变成死路**：
`/mpd dag` 改瞄到 MPD 面板——DAG 页**就是**这个面板——而 `/mpd panel`、`/mpd subagents`、`alt+a` 本来就
都走同一个槽位（旧的 `Ctrl+A` 宿主输入接触面在提供该接缝的宿主上**保持惰性**；在它确实就绪的老宿主上，
它打开的就是合并的 subagents 场景，与以往一致）。三个页面 `apiVersion` 都是 1，都**不带 `compact`**——宿主会校验
并保存描述符的 `compact` 槽位，但**不挂载**它的渲染槽，声明它就等于声明一个无法渲染的界面——并且都请求
**`minColumns` 28**，即宿主自己的底线。最终面板
id 是**从宿主自身的 `list()` 回读中发现的**，绝不自行拼接：`<pluginId>:<slug>`，合并前真机实测为
`act1:team`、`act1:dag`、`act1:workmate`（该 plain loader 行不携带任何 Component 身份，前缀由宿主加上）。
记录下来的集合就是**实际注册成功**的那些 id，因此现在带的是当前三个——`team`、`workmate` 与 `watchdog`——而不含已退役的 `dag` 页。

**可达性规则——宿主自己的两个开关，而本 bundle 无法代设。** 注册了页面并不等于页面可见。在已安装宿主上，
启用列表位于宿主**自己**的行配置里（`dsh-tui.sidePanel.panels` —— 0.13.0 上是 `todo,jobs,agents`，
0.14.0 目标宿主上是 `todo,jobs,agents,info,trajectory,workspace,btw,companion`，见 §11.6；一个格式
合法但尚无面板认领的 id 会留在列表里，等插件稍后注册），而侧栏本身默认是**关闭**的（`sidePanel.open`
默认 `false`）。两者都归宿主所有，而 bundle 的补丁行绝不能 id 指向宿主拥有的行，所以补救只能写成给用户
的步骤，既写进文档，也由命令自己打印：

1. 在 `/settings` → 侧栏 → *启用的面板* 里加入该页的最终 id（id 可从宿主的 `/panel ` 补全列表得知，或直接
   读 `/mpd panel` / `/mpd dag` / `/mpd workmate` / `/mpd watchdog` 打印的那一行）；
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
  改变任何一个 token 的顺序，并且**只剪除唯一一类 token**——本 bundle **上一次启动**留下的自有面板 id。
  **自修复轮 R1（CodeRabbit PR #35）起，这一类由「来源」（PROVENANCE）判定，绝不再看 slug**：一个 token 只有
  在**完整 id** 落在记录所证明的、本 bundle 早前启动注册过的有界历史里，且它不是当前存活的 id（守卫这边即
  `list()` 回读的结果）时才可剪除。宿主每次启动都会
  重编 `<pluginId>` 前半段，这些死 id 于是不断堆积在列表里，而宿主的 `SidePanelColumn` 仍会为每一个画出标签页
  与圆点、其后却没有任何面板（也就是上报的错位现象 D1）；剪除正是用来清掉它们的。**除此之外绝不删除任何
   东西**：宿主内置面板与任何本 bundle 从未听说过的 id 都按字节原样保留。旧 slug 规则的两个限制都随它一起
   消失：仅仅**撞上**我们某个 slug 的外部面板（宿主完全可能在我们的
   `act7:team` 之外产出 `act9:team`）不在我们的记录历史里，因此永远不会被剪除；而页面**改名或下线**后留下的
   token 就在那份历史里，它的孤儿标签页会像任何死 id 一样被清掉。只剩一条边界，且明码标出：一个**外部的死**
   id 留在列表里不归我们清理，所以它会留下。写入之后还会经宿主自己的
  读取器**回读**，并与守卫本打算写入的列表比对；若某个存储并未真正接受这次写入，状态就结算为 `refused` 并同时
  点名两份列表，而不会报出一个侧栏并不具备的成功。若列表里出现**任何一个**我们的 id，那就说明配置已经就本 bundle 表态
  了 —— 在 `/settings` 里启用过、由下面的脚本写入过、或者用户故意只删掉了部分 —— 此时守卫**主动退让**，因此
  它绝不会把用户本想丢掉的页面放回去。**退让不再保护死 token（R1.3）**：当这样一份列表同时还带着一个在记录
  历史里、当前又不存活的 id 时，守卫会**先剪掉那个 id、且不追加任何东西**，然后才退让 —— 被尊重的是用户的
  **选择**，而一个没有任何面板能应答的 token 从来不属于任何选择。**0.14.0 波次把有界的 tick 阶梯换成了宿主自己的订阅**
  （`subscribeSidePanelPanels`，即实时设置存储的变更订阅）：宿主一重新应用配置，守卫当场修复被抹掉的列表，
  而不是在约 25 秒后输掉这场竞跑；tick 阶梯只作为"宿主没有该订阅"时的降级路径保留。订阅随注入作用域一起
  释放（热重载不会留下监听），在没有该模块的宿主上永不抛错，退让规则不变：**我们自己的写入包含我们的 id，
  这正是循环的终点**。这是该适配器的**第二处**宿主
  内部接触，与 `Ctrl+A` 的 `useStdin` 触点并列（AGENTS.md §6 给这类接触计数，因此两处都在该文件里点名）；
  它发现的 id 记录在 `<workspace>/.mpd/logs/mpd-tui-panels.json`——**schema 3**，新增有界 `history` 字段
  （最近 32 个历史注册 id，最新的在最后），来源判定的剪除正是读它；无法被证明的记录不贡献任何历史，因此被污染的
  文件无法放宽可删除的范围。**残留风险明码标出**：若用户故意把我们
  **全部**移除，剩下的列表与全新配置无法区分，因此每个启动周期仍会把整组加回一次；要区分这两种情况必须读到
  配置里写的那个值本身，也就是第三处宿主内部接触 —— 那是 §6 的计数决策，本轮刻意不做；
* **绝不丢内置页，也绝不覆盖既有列表** —— 行的 `sidePanel.panels` 是**替换**宿主默认值、不是追加，因此
  `scripts/mpd-tui-panels.ts` 对**缺失**的叶以宿主自己当前的 `DEFAULT_SIDE_PANEL_IDS` 作种子（从已安装模块读取；
  读不到时**拒绝**运行而不是猜"没有内置页"），对**已存在**的叶**逐字节保留** —— 包括一个内置页都不含的列表，
  因为"内置页全缺"与"用户故意删光"是同样的字节。要补回缺失的内置页因此是**显式动作**：
  `--restore-builtins` 只补缺失项、打印补了什么，列表健康时是 no-op；
* **持久、一条命令** —— `node scripts/mpd-tui-panels.ts --apply` 把 `dsh-tui.sidePanel.panels` 写进
  profile 的
  patch 文件，而它就是设置用户层（`dsh-config-editor` 的 `documentPath` 返回
  `profileContext.patchPath`；`dsh-app-boot` 把它拼成 `<profileDir>/cordis.patch.yml`）——并且自
  2026-10-16 的修订起，也写进 `~/.dsh-tui/settings.json` 的 `values.sidePanel.panels`：那是
  dsh-tui 0.15.0 **先**读的层（生效清单 `values.sidePanel?.panels ?? config.sidePanel?.panels`，
  设置文档**遮蔽** patch；`--tui-settings <path>` 可指向夹具，文档缺失时本轮只写 patch 层）。
  **同一条**计算出的清单——一次共享合并、以**生效**值作种子——落进两层，全部护栏不变；设置文档以
  JSON 写回（2 空格缩进、行尾换行），保留其余每个键，包括一次性导入的 `imported` 标记。这两个读法都取自
  已安装的源码，脚本在无法证明该路径时拒绝写入；默认试运行，`--apply` 才写，每层各留 `.bak-<stamp>`，只补缺失
  的 id，**并施加同一条陈旧 id 剪除规则**（同一条规则，在 `scripts/mpd-tui-panels.ts` 里重述一次，因为独立
  运行的 Node 入口无法 import 一个已打包产物的源码；自修复轮 R1 起那条规则就是**来源**规则：脚本只在记录的
  `history` 证明本 bundle 注册过、且本次运行未启用它时才剪除该 token，因此外部的 `act9:team` 绝不会被删）。
  只有剪除、没有新增的那一次运行同样算一次运行，而不是
  空操作。`--apply` 在原子改名之后还会**逐层回读文档**，把该叶子与它打算写入的 CSV 比对——设置层的写入
  失败绝不能藏在一次落盘的 patch 写入后面：不一致即以退出码 1 拒绝并点名备份文件，因此没有真正落盘的写入
  绝不会被宣告为成功。它只写**用户**的 profile patch 与设置文档，不碰本仓库里的任何东西，因此不属于任何闸门扫描——需要重新钉定
  内置技能语料的是那个改动了 `skills/**` 的波次：它的 `treeSha` 必须与**恰好一次**重新钉定落在同一个
  提交里（AGENTS.md §9）；本命令两样都不涉及。

**记录是否可信，取决于它的来源信息（provenance）——而这是一处实测缺陷，不是担心。**
`.mpd/logs/mpd-tui-panels.json` 在 2026-10-08 被覆写成 `act0:team,act0:dag,act0:workmate`，而这些 id
是已安装宿主**无法**拼出的：它的 `pluginIdFor` 兜底计数器**先自增**，所以第一个裸激活是 `act1`，`act0`
在真机启动里不可能出现。是一次**单元测试**运行（它的面板接缝替身把注册标成 `act0`）驱动了真实记录器，
而补救脚本正是读这个文件来提议写入用户设置层——于是一次测试运行就能让补救命令写出任何启动都无法提供的
面板 id。0.14.0 波次修好了**写入**侧：记录现在带 `provenance {hostRoot, hostVersion, readBack,
activation}`，记录器**拒绝**生成任何无法追溯到已安装宿主包与宿主回读的记录（实测：完整跑一遍
`bun test ./packages/mpd-tui-plugin ./packages/mpd-tui-adapter-plugin` 之后，该文件的 sha256 不变）。**修复轮 R1（CodeRabbit PR #35）让这份来源证明同时成为剪除的依据，并把记录升到 schema 3**：除 `panelIds` 之外新增 `history` —— 本 bundle 早前启动所证明注册过的有界 id 列表（最近 32 个，最新的在最后），两个写入方都按它判定归属；这份历史的折叠同样在读取侧设防，被污染的文件贡献**零**历史，两侧都把「空白」当作「缺失」。
**同一份证明在**读取**侧也被守住，因此被污染的记录再也到不了用户的 profile patch：**
`scripts/mpd-tui-panels.ts` 会**拒绝**（试运行与 `--apply` 一视同仁，退出码 1）任何不带 `provenance`、
`provenance.hostRoot` 为空、`provenance.hostVersion` 为空、缺 `provenance.readBack`，或 `provenance.activation === "act0"` 的记录，
并点名失败的字段、同时提示 `--ids <a,b,c>`；被拒绝的记录同样不贡献任何历史 id，因此无法放宽剪除范围。实测（针对被污染的 version-1 记录）：打印
``REFUSED: … it carries no `provenance` block (a version-1 record, whose ids cannot be traced to a boot)``
并退出 1；该次运行不改变记录 sha256；`--ids act1:team,act1:workmate` 被接受（逃生口仍然可用）；脚本自带的
`--self-test` 全绿——每种拒绝形状各一条臂，外加"格式良好的记录被接受"。试运行仍会打印它读到的 id、其文件以及剪除将要使用的历史 id
及其文件，所以用户在 `--apply` 真的写入之前就能看到会被写什么。**磁盘上的文件仍然是那份被污染的 version-1
记录，直到宿主的真机启动把它重写**——这正是补救命令今天会拒绝它的原因，也正是 `--ids` 被记录为逃生口的原因。

**未设**时的实测：标签栏读作 `‹ 待办 › ▸ ◆`，宿主活的启用列表是 `toggle, focus, zoom, todo, jobs,
agents`。**设好**时的实测（120 列，这是本波次替换掉的**三页**集合）：标签栏出现 `‹ MPD ›`、
`‹ MPD DAG ›` 与 `‹ MPD workmate ›`，页面正文渲染出来（`evidence/tui/dag-port/verification/pty/frozen/`）。
**合并之后标签栏只有两个 MPD 标签页**——`‹ MPD ›` 与 `‹ MPD workmate ›`——上面两条路由依旧各自解析到存活
界面（本波次自己的记录见 §11.6）。**2026-10-23 看门狗波次之后，第三个 MPD 标签页**
（`‹ MPD watchdog ›`）可在宿主的启用列表写下它发现的 id 后加入；上面那两个宿主开关对它同样适用。面板列只在宿主分栏处存在——同一份抓取在 80 列
与 48 列上报 `split=false`，因此那里无论列表怎么写都不可能有页面可见。

`alt+a`、**`/mpd panel`** 与 **`/mpd subagents`** 在接缝已绑定时把 MPD 面板经 `tuiPanels.open()` 打开，
**`/mpd dag`** 改瞄到**同一个**面板（它渲染的就是 DAG 页），**`/mpd workmate`** 打开它自己的页面，**`/mpd watchdog`** 打开看门狗页——它是唯一没有全屏界面兜底的页面，
因此没有面板接缝的宿主得到的是**一行缺失报告**，而不是一个假装是它的别的界面。
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
  （`evidence/tui/session-scope-and-push/2026-10-08T08-22-12Z/pty-latency/`）——这是 0.14.0 时期的
  记录。**在那次测量时**兜底的 tick 是 **1000 ms**（`DAG_PANEL_REFRESH_MS`）——六次采样落在 9 ms 的
  带宽内、约 80 ms，这不是 tick 采样。事件源监听团队目录，因此本会话的 agent 或**另一个进程**所做的
  改动都能被看到；实时节拍只在 §3.5 说一次——所有 MPD 界面统一为 **2000 ms** 的 tick，作为没有事件源
  时的兜底。没有 `mpdTeams` 行、没有 `subscribe`、或它抛错，损失的只是 push，绝不会损失页面。

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
- **任何 rank 距离上的"阻塞者 → 依赖者"边都会画出来。** 长边走一条**通道**（lane）——中间各 rank 上没有任何
  盒子占用的一列，图内每一列都被占满时就追加到图形右侧——在阻塞者下方的连接带做一次横向折线、在依赖者上方
  的连接带再做一次，于是整条线从阻塞者底边的 `┬` 连续接到依赖者唯一的 `▼`。扇入仍然只有一个箭头，因为所有
  汇聚的父节点都写同一个格子。
- **空的 rank 桶不占任何行。** 带空洞的服务端 rank 阶梯（0、2、4——当宿主的 `depth` 是计划序号时就是如此）
  在**绘制层**被压紧，于是相隔一个 rank 的两个框只隔一条连接带，也没有任何边需要跨越一个没有盒子的 rank。
  计划自己的桶保留这些空洞：`rankPlan`/`bucketRanks` 与 WEB 平面共用，所以压紧只发生在绘制里。
- **点击经图形自己的命中矩形解析，且**包含列**。** 同一 rank 的两个框共享同一条行段，所以只看行的查找
  永远命中该 rank **最左**的那个框——这是实测结论，也是"用户点了某个任务、高亮却落在隔壁"的原因。指针
  自己的列（加上当前平移偏移）决定命中哪个框；点在没有框上的点击会**清除**钉住。
- **高亮不依赖颜色也能看见。** 钉住期间，被钉任务与它上游依赖链上的每个任务都**加粗**，其余则以弱化
  色调**并且**带上宿主的 `dimColor` 标志——因为深色主题下 `inactive` 与 `subtle` 太接近，纯靠颜色的"置灰"
  肉眼看不见。
  **连接线永远不调暗。** 框与标签可以弱化，但链外的连线保留图形可见的连色调（`edge`，即 `promptBorder`
  主题键），而不是 `inactive` + `dimColor`：上面那两种灰看起来是一样的，这正是钉住任务时用户的线"第二次
  消失"的原因。链内的边仍然是更亮的 `chain` 色调。
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

### 3.5 刷新节奏、重绘恢复与鼠标输入

**每个 MPD TUI 界面都按固定的 2 秒节拍刷新。** 合并后的侧边栏面板（`DAG_PANEL_REFRESH_MS`）、
workmate 页（`WORKMATE_PANEL_REFRESH_MS`）、board/team 场景与 subagents 场景用的是同一个节拍；
侧边栏面板曾经是唯一按 1 秒刷新的界面。TUI 读取的是**本地同步**投影（`readDashboardWorkflow`）——
`mpd-tui-plugin` 不发 HTTP、也不用 `EventSource`——所以这个节拍是**重绘自愈**（丢失的单元格、慢终端、
宿主只画了一半的帧），而不是取数重试。损坏的画面会在两秒内自己修好，面板也不会一直停留在被打开那一刻。

**只要放得下两列节点，侧边栏就画 DAG；要放得下的是「窗口」，不是整幅图。** 当面板能显示该图的两列
节点（`2 * nodeWidth + NODE_GAP`，即 `boxesFitWidth` 判定），或整幅图本来就放得下时，就选择盒图；比面板
**更宽或更高**的图靠页面自己的横向平移与纵向滚动够到，页脚会报出位置（`col n/m`，以及它上面的行位置）。
只有连两列节点都放不下的面板才回退——看板任务多于 `LIST_ROWS` 时退回密集列表，否则退回 rail——整屏 team
场景遵循同一条规则。被它取代的"整幅图都放得下"规则（提交 `95c836b9`）是拿图去换适配：一块 20 任务的看板曾
渲染成 `view rail`，一条依赖线都没有；一个偏短的窗口也让 5 任务看板的线消失。会跨越窗口边缘的框要么整只
画出、要么不画，纵向滚动条的那一格从内容宽度里预留，页面标题只画**一次**（标题行，它同时承载 `⤢` 控件）。

**画面不对时：**

- **`Ctrl+L` 强制宿主重绘。** dsh-tui 会清屏并重画；SSH 重连之后、宿主没感知到的尺寸变化之后、
  或终端丢了一帧之后，用它。
- **`r` 恢复整屏图。** 整屏 team 场景把纵向窗口夹到最后一行，所以 `End` 和长时间的滚轮都会停在底部，
  不会把图滑走；`r` 重读记录并把窗口退回顶部，`Home`/`g` 不重读而直接回顶。
- **`DSH_TUI_DISABLE_MOUSE=1` 只关闭应用内的点击与选区处理。** 在钉住的宿主 dsh-tui 0.16.1 上，
  `lib/types/utils/fullscreen.js#isMouseClicksDisabled` 喂给 `App.js#handleMouseEvent`，后者在点击分支
  之前就**返回**、滚轮滚动照旧保留，而 `AlternateScreen.js` 无条件开启鼠标上报——所以设了这个开关，
  鼠标上报与滚轮滚动**明确仍然生效**；它不是「滚轮被 shell 吃掉」的解药（那种情况要动终端 / tmux /
  全屏那一层的开关，见下面的 tmux 条目）。键盘手势——焦点游走、滚动键、`Esc` 取消钉住、`⤢` 打开
  场景——照旧可用。
- **tmux：** 用 `set -g aggressive-resize on` 让窗格尺寸保持真实，并用
  `set -g default-terminal 'tmux-256color'` 给宿主一个 UTF-8 的 terminfo。tmux 之外，`TERM` 必须是
  支持 UTF-8 的终端（如 `xterm-256color`），locale 必须是 UTF-8（`LANG=…UTF-8`），否则中日韩字符宽度
  会算错；字体必须带这套绘图用的制表符集合（`╭ ╮ ╰ ╯ ─ │ ▼ ◐`）以及面板自己的字形（`⤢ ❖ ⬢`），
  否则终端会用后备方框替代。
- **侧边栏的滚轮被夹在面板内。** 滚轮既绑在面板的内容上，也绑在面板的**外框**上，并由外框阻止事件继续
  传播：在标题行、边框或页脚上滚动，滚的是面板，绝不会滚到面板背后的聊天区。

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

### 6.2 `/settings` 区块**已**打通——entry 保存由宿主持久化、**不写工作区文件**；旧命名空间回写已具名且在此休眠

该区块声明的就是真实的 mpd.jsonc 可调项（`hashline.maxDiffChars`、`commentChecker.autoCheck`、
`ulw.maxRounds`、`memory.vcs`、`team.stateDir`、`boulder.dir` 以及
`agentRoutes.<Agent>.{provider,model,reasoningEffort}` 叶子 —— 每个名册 agent 一行三片叶子），它们是**本行 config 的入口文档**
（entry `mpd-config`）里的键，经 harness **自带的**表单编辑（entry 由 `packages/mpd-config-plugin` 拥有；
本包只是纯消费者，只在没有配置插件参与组合时才注册一个带守卫的兜底）。
**存在两条持久化路径，只有那条休眠的会写你的文件：**

- **entry-config 保存——本 harness 上两扇前门都走这条。** Web 卡片与本分区保存的是
  `configForms.get("mpd-config")`；entry 文档是**宿主自己的**存储，因此持久化是宿主的事。保存下来的
  override 就是最顶层配置层（L4，`readEntryConfig`），而 `onSettingsDocumentUpdated(ENTRY_CONFIG_ID)`
  会在进程内重新加载它——**无需重启**——并且这条路径**不执行任何 `<workspace>/.mpd/mpd.jsonc` 写入**，
  这是刻意的：该文档还承载着表单物化出的默认值，把它们投影进你的文件会污染它。
- **旧 `mpd` 命名空间回写——在此休眠。** `packages/mpd-config-plugin` 仍实现它（锁 + compare-and-swap +
  同目录临时文件 + 原子改名，保留注释/键顺序/尾随逗号，并带两个具名跳过情形）。在本 bundle 所固定的
  harness 上，`settingsRegister` 会被拒绝（"the namespace-registry model is RETIRED in this harness"），
  桥接只记录一次，其文件回写与 override 清理保持**休眠**。下文的全部内容——base 表、写回条目与工作区
  目标条目——记录的都是**那条**路径；它不是对 entry 保存的承诺。

一次保存如今会发生什么（entry 路径）：

**`base` 是一条规则，不是一次查表——而且它是「旧命名空间」的 base。** 提供该命名空间的包自行推导 base
（`baseForNamespace()`，经适配器注册），规则按活动根的数量分档：

| 活动会话根 | 命名空间 base |
|---|---|
| **恰好一个** | 该工作区的 `<workspace>/.mpd/mpd.jsonc`——常规路径 |
| **零个** | **挂载时**（无 exec）的根——`DSH_WORKSPACE_ROOT` 或进程 cwd——它是任何会话存在之前唯一存在的根；那里的文件缺失即得到**空 base**，实际上等同于 schema 默认值。由于 `mpd-config` 所在行通常先于任何活动会话生效，这就是**常规启动路径** |
| **多于一个** | **不虚构任何文件 base**：`base: undefined`，原因 `ambiguous-multi-root`，逐一点名全部候选并写入 `states()`。在恰好一个工作区活动之前，该命名空间显示 schema 默认值；此状态下的保存会被**拒绝**（见下），因此这种歧义不可能落到磁盘 |

**base 在整个进程生命周期内固定**——宿主对一次活动注册**不提供任何注销（disposal）句柄**，它自己的
settings 安装器同样保持 base 固定。固定 base **并不**表示每个已保存的旋钮都要等重启，而"无需重启"这句
也**不能一概而论**：配置服务本身是实时的（每次设置保存、以及监听到项目文件被编辑时都会重新解析），每个
旋钮的答案取决于**它的消费者在哪里读取**。由消费者每次使用时从实时服务读取 —— **实时生效、无需重启**：
`agentRoutes.*`、`modelchain.*`、`team.stateDir`、`team.gate`、`team.sensitivity`、
`captain.investigation`、`delegation.gate`；`watchdog.*` 同样是实时的，但来自**该行自己**读取
`<workspace>/.mpd/mpd.jsonc`（它不读 `mpd-config` entry，因此**表单保存到不了它**——用户指南 §9.1）；
`tui.dashboardKey` 在 `mpd-tui` **行配置**于挂载时允许
Ctrl+A 接管的前提下**双向**实时（保存的 `false` 之后再来 `true`，都会在下一次按键读取时生效），只有在
**行配置**禁用了接管（`dashboardKey: false`）时才是**单向**：该组合在 `apply()` 时根本不会注册接触点，
保存的 `true` 无法凭空创建它，需要以允许接管的行配置重启一次。在行自己的
`apply()` 里被捕获 —— **需要重启**、捕获值保持到下一次 `dsh` 启动：`hashline.*`、`commentChecker.*`、
`ulw.*`、`memory.*`、`boulder.dir`、`goal.*` 与 `extensions.*`。本 bundle 自己的提示常量把两半都写了
出来 —— `BRIDGE_DISCLOSURE`（实时条款，点名模型路由）与 `BRIDGE_RESTART_LIMIT`（边界），而**逐旋钮的
权威表是 [`user-guide.zh-CN.md`](user-guide.zh-CN.md) §9.1**。插件真正使用的是**已解析的值
（resolved value）**加上配置层的**逐次调用文件读取**：L1/L2 文件层在每次解析时都会被重新读取，因此即便
base 被冻结，**按工作区读取仍然解析各自会话自己的文件**。本页没有任何句子承诺 **base** 会被实时刷新——
只承诺**值**会被实时解析。

- **读入优先级** —— L0 schema 默认值 < L1 `$DSH_HOME/mpd.jsonc` < L2 `<workspace>/.mpd/mpd.jsonc` <
  **L3 settings 用户区段**（运行期以其为准）；此后若**文件**被再次编辑，重叠的 settings 叶子会被
  **取消设置**，于是文件里的新值重新生效，两个方向都不会静默丢失。
- **写回（旧命名空间路径——本 harness 上已休眠）** —— 由 `packages/mpd-config-plugin` 拥有（绝不由本
  TUI 包执行，后者保持已验证的零写入性质）。
  触发点是宿主的 `settings/document-updated(ns, revision)` 事件，并过滤为 `source === 'update'`
  （原始区段事件，因此深比较门不会把变更丢掉）；写入对象是事件时刻实机会话工作区的
  `<workspace>/.mpd/mpd.jsonc`，写入过程持锁、对原始字节做 compare-and-swap、写同目录临时文件、再原子改名。
  **注释、键顺序与尾随逗号都保留**：一次实际启动把 JSONC 文件里的 `hashline.maxDiffChars` 从 20000 改为
  31415，注释、键顺序与尾随逗号均未改变。entry-config 保存（见上）不会触发其中任何一步。
- **工作区目标（旧命名空间路径——此处已休眠）** —— 该路径不携带身份，因此目标集合是**事件时刻的实机会话
  工作区**：恰好一个 ⇒ 写入该文件；**零个 ⇒ `no-live-session`**；**多于一个 ⇒ `ambiguous-multi-root`**，
  并逐一列出候选。两种跳过情形下**都不改动任何文件**，而且这次编辑**没有丢失**：它已存入宿主全局 settings
  文档，配置层会立刻对所有工作区生效——只有**文件写入**在等"恰好一个实机会话"。TUI 状态行与 Web 卡片都
  写明了这一条，指的都是这条旧路径。
- **生效时机** —— 模型配置的消费者通过实时 `mpdConfig` 服务按次解析（`mpd_modelchain_resolve`
  每次调用；agent 路由在 spawn 时），而该服务在每次设置保存时、以及监听到项目文件被编辑时
  都会重新解析，因此保存的编辑**在下一次解析或 spawn 时即生效，无需重启**（`mpd_config_reload`
  可强制重读）。这里有**两个不同的 `applies` 答案，不能混为一谈**：`BridgeReport.applies`
  （`packages/mpd-config-plugin/src/bridge.ts`）的类型是 `"live"`，它逐次保存地记录**已解析的值**进入了
  **运行中的进程**；而**命名空间级**的答案在每一个承载它的表面上都是 `"restart"`——服务自己的
  `states().applies`（D-18，`packages/mpd-config-plugin/src/index.ts`）、`mpd-config` 的
  `dsh.settingsRegister(…)`、以及本包的 `registerSettingsNamespace(…)` 都回答/传入 `restart`——因为该
  命名空间整体并非全实时：`BRIDGE_RESTART_LIMIT` 点名的旋钮是在各自行内的 `apply()` 里被捕获的。因此
  报告里的 `live` **并不**覆盖每个消费者的行为，逐旋钮的权威表是用户指南 §9.1。TUI 区块提示承载
  **全部三段**（`SECTION_NOTICE` = `BRIDGE_DISCLOSURE` + `BRIDGE_RESTART_LIMIT` + `BRIDGE_NOT_LOST`）。
- **退化目标会大声报错** —— 文件缺失（创建并带头部注释）、只读（`denied` + 路径 + errno，settings 编辑
  仍然成功）、并发（重试 ×3 后 `conflict`，人的文件保持原样）、无法解析（`unparsable`，绝不"修复"）。

**有一个 mpd.jsonc 可调项会被读取，但**尚未**渲染进 `/settings`：`tui.wheelInvert`。** 它是布尔值，默认
`false`（＝今天的行为），用来翻转本 bundle 所画的每一个面板与场景的滚轮纵向符号。宿主是从终端自己的
wheelup/wheeldown 位推导出滚轮事件的 `deltaY` 的，因此滚轮上报的方向是终端／多路复用器／操作系统的属性，
在某些安装上会反过来；在这个可调项之前，每一条滚轮路径都各自按固定符号套用原始 delta，既没有统一的矫正点，
也没有面向用户的开关。该值与上面每一个可调项一样，经**同一个 `mpdConfig` 服务、同一套层级栈**读取：在
`<workspace>/.mpd/mpd.jsonc` 里写 `{ "tui": { "wheelInvert": true } }`，或把 `mpd-tui` 行自己的
`wheelInvert` 设为 `true`，后者是该开关的**下限**（已保存的叶子只要是布尔值就优先；垃圾值永远无法把它打开）。
插件是**每次滚轮手势**读取该叶子，而不是在挂载时采样，因此经 `/settings` 的保存**和**对**文件**的编辑都会
在运行中的进程内到达它——配置服务在设置保存时、以及监听到项目文件被编辑时都会重新解析，且 L1/L2 层在每次
解析时都会重读（见上文）——而挂载时采样会在任何"延迟的 `mpdConfig` 绑定晚于本行 apply"的启动上读到
`undefined`。**诚实边界：** 与 `tui.dashboardKey` 不同，该叶子尚未被
`packages/mpd-config-plugin/src/settings-schema.ts` 的 `SETTINGS_KNOBS` / `SettingsSchema` 收录，因此它在
`/settings` 表单里**没有对应的行**；文件层之所以可用，是因为 `mpd-config` 的 `loadConfig` 返回的是**原始**
合并层级、不会剥掉未声明的键。把该叶子声明进那份共享 schema，就是补上这一行的后续工作——它落地时上面的读取
路径不需要任何改动。

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
| **workspace**（`<workspace>/.mpd/**`） | `mpd.jsonc`（每一层都会读取的**配置文件**；entry 保存**不**写它——§6.2）、`memory.json`、team/plan/boulder 状态 | 两扇门运行在**同一工作区**——由构造保证 |
| **HOME**（`~/.mpd/workmate`） | 用户的跨项目 workmate 库 | 同一 `HOME`，即同一用户的多个 profile 之间；两个用户之间相互独立 |
| **bundle**（`<bundle>/…`） | `mpd` preset/roster 与技能语料（按引用提供，不复制） | 两扇门**就是同一次安装**，与 home 无关 |

**必须知道的边界：** 只有一个 DSH home 时，settings 文档是共享的，因此一次设置编辑对两扇前门同时可见。
而**不同的 DSH home 会有两份 settings 文档**——`settings.yaml` 是 DSH-HOME 作用域的——所以在一扇门里做的
编辑，对另一扇门而言**作为 settings 取值（VALUE）是不可见的**，而且它也不会经由工作区文件收敛：在本
harness 上，entry-config 保存**不会执行任何 `<workspace>/.mpd/mpd.jsonc` 写入**（§6.2），因此没有任何机制
自动同步两扇门。工作区的 `mpd.jsonc` 只在有东西写它时才会变——手工编辑，或者在仍提供旧命名空间的宿主上由
那条休眠的回写路径写入。一句话概括：*同一个 DSH home ⇒ settings 取值共享；不同 home ⇒ settings 取值不同，
且没有任何保存会替你写工作区文件。* 这是两扇门有可能对同一个继承值给出不同显示的唯一情形。

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
| `mpd-bundle` | 组合层（bundle patch 本身） | usable | 组合配置含 `mpd-tui`；真实启动 0 崩溃特征。本行曾记录的 `agent-preset-registry` id-target 已于 2026-10-02 按"严格零覆盖"决定移除 —— 以 §2 为准 |
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
| 安装 / 三层结构 / 36 行 / 0 崩溃特征 / mpd 预设**可用**（非默认） | Observed | 三层结构与 0 崩溃特征两半仍以 t5 `evidence/tui/composition/20260915T053445Z/` 的实测为准，并由 t8（`evidence/tui/live/20260915T063140Z/lanes/tui-mount/`）与 t9（`…/conformance/20260915T064521Z/09-mount-boot.log`、`10-mount-boot-clean-root.log`）重跑；行数与预设默认值两条已被 §2 取代 —— 36 行（`cordis.patch.yml` 35 + `presets/mpd.patch.yml` 1），且部署默认仍归宿主 |
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
| §3 的 settings 行 | "另有限制见 §6.2" | 打通后的行为，模型路由即时生效（挂载时捕获的旋钮仍需重启），另附两种具名跳过情形（§6.2）、重复键规则（§6.5）与 Web 卡片证据级别（§3.1） |

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
成立（**列表一旦出现我们的任何一个 id，就说明配置已经就本 bundle 表态，守卫永久停止**，因此用户故意删掉的
页面绝不会被放回；而我们自己的写入包含我们的 id，所以循环也就此结束）——修复轮 R1 在此基础上补了一条：同一次列表里
若还留着一个可证明已死的历史 id，守卫会先做一次**只剪不增**的写入把它清掉，然后才退让。

**记录的 id 集合现在带来源信息（provenance），因为一次测试运行污染过它（实测）。**
`.mpd/logs/mpd-tui-panels.json` 在 2026-10-08 被覆写成 `act0:team,act0:dag,act0:workmate`——这些 id
已安装宿主无法拼出，因为它的 `pluginIdFor` 兜底计数器先自增、第一个裸激活是 `act1`——而元凶是一次**单元
测试**运行，它的面板接缝替身把注册标成 `act0`。记录现在是 schema 版本 3（版本 2 加入 `provenance`，版本 3 加入有界的 `history`），并带
`provenance {hostRoot, hostVersion, readBack, activation}`；记录器**拒绝**写入任何无法追溯到已安装宿主包与
宿主回读的记录，`act0` 这一形状被点名拒绝。实测：完整跑一遍
`bun test ./packages/mpd-tui-plugin ./packages/mpd-tui-adapter-plugin` 之后，该记录的 sha256 不变。
**同一份证明在**读取**侧也被守住**，因此被污染的记录再也到不了用户的 profile patch：
`scripts/mpd-tui-panels.ts` 会**拒绝**（试运行与 `--apply` 一视同仁，退出码 1）不带 `provenance`、
`hostRoot`/`hostVersion` 为空、缺 `readBack` 或 `activation === "act0"` 的记录，点名失败的字段并指向
`--ids <a,b,c>`——实测（针对被污染的 version-1 记录）：``REFUSED: … it carries no `provenance` block …``、
退出 1、记录 sha256 不变、`--ids act1:team,act1:workmate` 被接受、脚本 `--self-test` 全绿（每种拒绝形状
一条臂，外加格式良好的记录被接受）。它同时也是**剪除**所依据的那道闸：被拒绝的记录不贡献任何历史 id（修复轮 R1）。

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

### 11.7 DSH-TUI 0.15.0 适配波次之后的修订（2026-10-15）

上表各行为其测量的版本与宿主保持原样。本波次把对标宿主再往前移一个版本（0.15.0，2026-10-13 发布），
而**插件可见接缝连续第二次原样通过**——这次适配是一次载体搬移，加上三条用户指定的功能条款（守卫重规约、
决策事件授权流、0 任务 DAG 缺陷）。以下各条取代 §11.6：

| 被取代的陈述 | 原为 | 现为（2026-10-15 实测） |
|---|---|---|
| 本页对标宿主（§ 前言） | `@deepseek-harness-tui/dsh-tui` **0.14.0** | **0.15.0**（npm `latest`；本波次冻结的测量基准是 `evidence/tui/dsh-tui-015/host-diff/FACTS.md`，两份 tarball 就在其旁解开）。宿主内部新增、无需本 bundle 反应：新的**可选** harness peer（`@deepseek-ai/dsh-plugin-manager`、`dsh-app-boot`/`dsh-cmdline`/`dsh-http-proxy`/`dsh-launch-environment` 改为可选定版）与 `zod@^4.4.3` 运行时依赖。`MPD_E2E_DSH_VERSION` **不动**——harness peer 范围未变（每个 `dsh-*` peer 仍止于 `0.2.0-rc.2`） |
| §3 接缝清单 | 十五个 `tui*` 接缝，0.13.0→0.14.0 逐字节相同 | **仍是十五个，只增不改**：`panels.d.ts` 新增 `applyConfiguredSidePanelPanels()` 与 `applySidePanelPanelsFromSettings()`（即 C2 所依据的宿主侧 CSV 合并助手），`plugin-host.d.ts` 新增 `probeBackendAdmission()`；其余接缝 `.d.ts` 逐字节相同，没有第十六个接缝，而裸 grep 撞到的 `tuiChannel` 是**内核通道协议 id**，不是接缝（没有 `Service` 注册它、无可注入——已写入 `agent-references/seam-adapters.md`）。**那一波没有改动适配器代码——而这一行测量的是宿主的文件，不是我们自己的 `Tui*Like` 声明与其是否一致（2026-10-17 重新推导：六处不一致；修订见下）。** |
| §3.3 —— 启用清单默认值 | `todo,jobs,agents,info,trajectory,workspace,btw,companion`（八个内置，0.14.0） | **0.15.0 上不变**——同一个 `DEFAULT_SIDE_PANEL_IDS`、同样八个内置图标（`≡ ▸ ◆ ⓘ ∿ ⌗ ? ♥`），不变量臂保持绿色。其下的**规则**变了：见下方守卫一行 |
| §11.6 —— `PanelBar` 不再绘制图标 | 0.14.0 上 `grep -c icon …/PanelBar.js` = 0；非活动标签是 `○`/`●` 圆点 | **0.15.0 重新绘制图标**：非活动标签画 `tab.icon ?? <标题首字符> ?? '?'` 外加未读数（重新实测的 `PanelBar.js` 中的 `tabLabel()`）。本 bundle 声明的单格图标（`❖` MPD、`⬢` workmate）重新被画出来；bundle 侧无任何改动——每个描述符仍按宿主校验器的要求声明恰好一格的图标 |
| §3.4 —— `⤢` 边界 | `dsh-adapter/panels.js` 冻结的插件描述符无 `capabilities` → 宿主自己的 `⤢` 不可达 | **在 0.15.0 上重新实测，仍成立**：`grep -c capabilities …/dsh-adapter/panels.js` = 0，`SidePanelColumn` 的 `canExpand` 仍读 `definition.capabilities?.fullscreen === true`。MPD 自己的 `⤢` 控件仍是唯一的全屏入口 |
| §3.3 / §7 —— 版本钉住载体 | 每个点名该版本的载体都是 `0.14.0` | **本波次载体为 `0.15.0`**：`docker/**`（两处 `MPD_E2E_TUI_VERSION` 默认值、`docker/ui/docker-compose.yml`、`docker/entrypoint.sh` 的 `TUI_VERSION`、`docker/ui/entrypoint.sh` 的两处 `MPD_UI_TUI_VERSION` 默认值、`docker/tui-lane.sh`）、`dsh-distribution.json` 的 `host-tui` 引用（`pkg:npm/@deepseek-harness-tui/dsh-tui@0.15.0`）、`skills/dsh-qa/scripts/**` 下的七个 QA 载体、`scripts/mpd-tui-panels.ts` 的头部叙述与两份 `docker/README*`。不搬项维持原样：`MPD_E2E_DSH_VERSION` 保持 `0.2.0-rc.2`；`dsh-plugin.json` 的 `compat.hosts` 保持 `@deepseek-harness-tui/dsh-tui@0.10.1`（准入**测量**，不是对标版本）；注册表的 `0.15` 版本串保持（生态规范号，本仓库已知误报） |
| §11.6 —— 启用清单守卫 | 每个宿主上都"订阅优先"：`subscribeSidePanelPanels` 修复配置镜像的清空，阶梯是降级路径，退位规则不变 | **重规约（C2，用户指定）：在会自愈的宿主——一切 `>= 0.15.0`——上，守卫加入宿主的原生自愈并退位；在更旧宿主上 0.14 行为逐字节保留。**2026-10-16 的修订（`fix/sidebar-015-keeper-migration`）开出**唯一**的写入例外——陈旧默认值迁移：在退位之前评估、由腰带在每个订阅事件上复查；见下方守卫两段 |

**2026-10-17 修订——宿主文件的逐字节相同，不等于我们自己声明的成员形状一致。** 上面那句"适配器接缝面零改动"
比较的是宿主自己的 `.d.ts` 模块在版本之间的变化；它从未把
`packages/mpd-tui-adapter-plugin/src/index.ts` 里的 `Tui*Like` 接口与这些模块对齐。以已安装的 0.15.0
声明树重新推导后，有 **六处**不一致，本波次已改正。这六处都不承载任何行为声明——bundle 里没有任何代码调用它们的成员；
它们只是被绑定、探测并报告：

| 接缝 | 原声明 | 0.15.0 声明（重新推导） |
|---|---|---|
| `tuiToast` | `push(message, {level})` → `Disposer \| undefined` | `show(text: string \| number \| boolean, {color?, timeoutMs?})` → `boolean` |
| `tuiThemes` | `register(name: string, theme)` 加 `current?()` | `register(descriptor: TuiThemeDescriptor, identity?)` → disposer；**没有**插件侧读取（`getSnapshot`/`resolve` 是宿主专用） |
| `tuiPluginStorage` | 扁平的 `get(key)` / `set(key, value)` | `open(pluginCtx)` → 异步 `{ get({key}), set({key,value}), delete({key}) }` |
| `tuiMessageObserver` | `subscribe(listener)` | `subscribe(pluginCtx, listener, { scope })`——`scope` 是**必填** |
| `tuiEffectLedger` | `entries?()` | `record(entry, identity?)` → void（插件侧没有任何读取该日志的成员） |
| `tuiWorkspaces` | `list?()` → `string[]` | `list(currentCwd, signal?)` → `Promise<TuiWorkspaceTarget[]>`，外加 `register(provider)` |

同一波次还有三处修正。**`closeScene(id)`** 原先以 `close(id) === true` 判定，而 0.15.0 的 `close()`
不接收 id 且返回 void——于是它在**每一个** 0.15.0 宿主上都答 `false`。现在它只在宿主自己的 `active` 读取
指明的正是请求的 id 时才发出那次 void `close()`（盲调 `close()` 会关掉当前活动的那个场景，却仍为一个从未打开过的
id 报告成功），并且接缝声明了 `close(): void` 与 `active` 读取。**`tuiPrompt`** 被标记为 phantom 接缝
（`PHANTOM_SEAM_KEYS`）：把 0.15.0 及之前每个 dsh-tui 的 `lib/**` 全 grep 一遍也找不到这个服务，因此
`seamOutcomes()` 现在报告 `phantom seam: no measured dsh-tui build declares this service`，而不是把它当成
组合缺口。另外，`plugin-host.d.ts` 的 `probeBackendAdmission()` 已在 `TuiPluginHostLike` 上声明，作为**刻意不消费**
的成员，让 Backend 贡献族可见，同时不凭空发明调用方。

本修订**不**声明的内容：本波次没有做真机启动（这是源码基线修正——不运行宿主），六处形状只与已安装的 `.d.ts`
**声明**比对，接缝集合本身未变（十五个，没有第十六个）。

**宿主现在会自愈侧栏启用 CSV，守卫向它退位（C2）。** 在 0.15.0 树上实测：`TuiPanelRuntime.register()` 经
`enablePanelIdInStore` 喂入 `registeredPanelIds`；启动/镜像的应用 `applyConfiguredSidePanelPanels(config.sidePanel?.panels)`
会把已注册的 id **并回**清单，除非被显式移除；`/settings` 的实时编辑走 `applySidePanelPanelsFromSettings`，
它把移除记录为**会话级**（`removedPanelIds`）；剩下的唯一 CSV 写入者就是那条 settings 应用路径。MPD 的回答：
启用清单守卫经适配器已被证明的 `readHostPackageVersion` 探测宿主版本（该值由探针作为 `hostVersion` 盖章在**同一个**
守卫据以决策的探针答案上——不新增宿主接触点），读到 `>= 0.15.0` 就**在任何写入路径之前退位：不装订阅、不走阶梯、
除了下一段开出的唯一例外之外一个字节都不写**——既不与宿主自己的合并赛跑，也绝不把用户显式移除的面板加回来。适配器日志里有一行说明
（`standing down on host 0.15.0 — the host self-heals the sidebar enable CSV, so this keeper never writes it again (the stale-default migration aside)`），
另有一条只观察的"腰带"：经存储自己的订阅查看宿主合并是否真的保住了我们的 id，其唯一写入同样是那同一个例外。版本为空、不可解析或
`< 0.15.0` 时，0.14 守卫（订阅优先、有界阶梯、退位规则、仅修剪死 id 的一次写）**逐字节保留**——该门只会在
真正读出版本时让守卫退位。

**陈旧默认值迁移是 `>= 0.15.0` 退位的唯一写入例外（2026-10-16，`fix/sidebar-015-keeper-migration`）。**
上面的退位曾吞掉 T1 迁移：该门在 `decide`——合并的唯一调用方——之前就从 tick 返回，而宿主自己的自愈只把
**已注册的插件 id** 并回去，于是 0.13.0 时代用户层钉下的 `todo,jobs,agents`（`KNOWN_STALE_PANEL_DEFAULTS`
的唯一条目）让五个内置页离开侧栏，且在 0.15.0 上无人治愈。守卫因此在门返回**之前**评估同一条 T1 谓词：当
去掉我们的 id 之后的现有清单**恰好**是已知陈旧默认值、且探得的宿主默认值可读、且两者不同、且我们至少注册了
一个 id 时，它写入宿主当前默认值 ∪ 我们的 id（宿主顺序在前、我们的按注册顺序追加——与 T1 指定的同一次合并），
**然后**向宿主合并退位。`>= 0.15.0` 上的其它一切情形——故意的自定义列表、当前默认值、不可读的宿主默认值
（只有那一行降级日志）、什么都没注册——都不写任何字节，与 C2 的规定一致。腰带在**每个**订阅事件上复查同一条
谓词（`/settings` 保存或宿主的一次性导入跳变都可能在**会话中途**重新呈现该钉定值），命中即再次迁移；该迁移
自我终止——它自己的写入让余量等于宿主当前默认值，于是下一个事件随即退位。0.15.0 之前的行为逐字节不变，
适配器测试套新增了七条臂把这全部钉死。

**2026-10-20 修订 —— 在**拥有**启用清单的宿主（`>= 0.16.1`）上，适配器是**只读**的。** 0.16.1 的
`TuiPanelRuntime.register()` 在注册时即启用面板，`dispose()` 时移除，启动与设置应用都会把已注册 id 并回——
启用的清单状态已没有本包可写入的余地，任何写入都只是与宿主自己的合并赛跑（即上面两段所属的事故类）。
`hostOwnsPanelCsv` 引出一条独立的 `standDownOwnedByHost` 路径；两道门共享的版本比较抽成
`hostVersionAtLeast`，避免两个下限各自漂移。该路径上阶梯被取消、不装订阅也不装腰带、**连陈旧默认值迁移
都不跑**，并留一行说明（`standing down READ-ONLY on host 0.16.1 …`）。0.15.x 路径逐字节保留 S1 迁移——
`0.16.0` 的那条测试臂钉住这个边界——发现的 id 仍经同一个 `onChange` 钩子写进诊断记录，因为记录是诊断而非
对宿主的写入。`node scripts/mpd-tui-panels.ts --apply` 仍是用户在任何宿主上手工修复陈旧用户层的方式。

**面板徽标与那一次自动开页现在从 apply 侧发布，不再由页面发布（G2，2026-10-20）。** dsh-tui 只在插件面板
是所在栏的**当前激活页**时挂载它，所以页面侧的徽标只能装饰用户已经在看的那一页。
`packages/mpd-tui-plugin/src/panel-attention.ts` 现在持有宿主侧 `tuiPanels.badge(id, …)` 调用与一次性的
`tuiPanels.open(id)`：两者都经 `whenBound("panels")` 挂载（没有该接缝的组合什么都不注册），并由页面同样订阅
的 `mpdTeams` 推送驱动。自动开页每个进程至多一次，且是**边沿触发**：只有「上一次没有活跃团队、这一次有」才算出现，因此
启动时就已存在的团队、以及该团队之后的任何状态变化都不会触发开页；宿主对 `open()` 有每插件 5 秒一次的限速，因此被拒绝即锁定、绝不重试；由新增的 `panelAutoOpen`
行配置控制（默认 `true`）。触发信号是**工作区级**的——该推送不携带会话 id——所以来自其它会话的触发会让页面
画出自己的 `no team in this session` 标记，而不是画错看板。`/mpd status` 增加了对应的部署行
（`panels: team=… workmate=… · seam bound · keeper …`），因为宿主分配的 panel id 是用户与文档都无法自行
推导的那条事实。

**修复脚本现在同时修复两个用户层，第二层是新的。** dsh-tui 0.15.0 把自己的用户设置放在
`~/.dsh-tui/settings.json`，并按 `values.sidePanel?.panels ?? config.sidePanel?.panels` 解析生效清单——
该设置层**遮蔽** profile patch，而它的一次性导入跳变（`imported.from` 标记阻止再次导入）曾把同一条陈旧
列表钉进遮蔽层（2026-10-16 在本机实测；当时两层均由人工修复，各留 `.bak-sidebar-20261016` 备份）。
`node scripts/mpd-tui-panels.ts --apply` 因此现在把**同一条**计算出的清单写进 `values.sidePanel.panels`
**和** profile patch 的叶子——一条共享的合并代码路径、以**生效**值（设置键在场则用它，否则用 patch 叶子）
作种子，全部护栏不变：既有立场逐字节保留、`--restore-builtins` 仍是唯一的显式内置页恢复、只剪除记录证明
已死的本方 act id。设置文档以 JSON 写回（2 空格缩进 + 行尾换行），保留其余每一个键——包括一次性导入的
`imported` 标记；`--tui-settings <path>` 供测试/QA 指向夹具；文档缺失时本轮只写 patch 层，与该层出现之前
逐字节相同。试运行与 `--apply` 的输出都**分别**报告两层，每层各留 `.bak-<stamp>` 备份并各自回读，脚本的
`--self-test` 带上了新的设置层测试臂。

**决策事件授权流，面向用户（C3'）。** 本页自 §6.1 起记载的"就绪但未激活"决策接缝，现在可以通过宿主自己的
文档化授权流**激活**，`dsh-plugin.json` 里那四条 `session.*.intercept` 声明（`tui/input`、`tui/rewind-prompt`、
`tui/session-switch`、`tui/compact`）正是它授权的对象。**如何授权**：在宿主自己的 `<DATA_DIR>/extension-grants.json`
（位于 `~/.dsh-tui` 下）写一条以 `com.mpd-dsh.mpd-tui` 为键的行，按作用域点名这四条权限——与宿主 `/plugins`
面板自己打印的提示完全一致——{"grants":{"com.mpd-dsh.mpd-tui":[{"name":"session.input.intercept","scope":"tui/input"},…]}}。
**激活了什么**：准入从 `waiting_authorization` 翻为 `compatible`，组件身份绑定（效果台账归属 `com.mpd-dsh.mpd-tui`
而不是 `undeclared`），四条决策订阅生效——输入、回退提示、会话切换与压缩拦截，即 §6.1 描述的那些面。**安全姿态**：
该文件**默认拒绝**——旧式裸字符串规则永不授权，损坏的文件按**空表**读（损坏 ≠ 不存在）；宿主每次操作都重读并轮询
（准入每 200 ms 重试一次、约 20 s 窗口，因此开机时或窗口内出现的授权无需重启即生效；已结算的拒绝需要重新加载）；
撤销该行则拦截再次停用。没有授权时一切照旧：`dsh-plugin.json` DecisionEvents 依赖里写好的回退仍然成立，本 bundle
照常可用。

**有零任务的活动团队按"团队"渲染，而不是"没有团队"（C6，用户上报的缺陷）。** `dagPageOf` 过去在看板为空时
丢掉已解析团队的身份，于是一个六人在线团队只画出一行暗色的"本工作区没有团队"。现在只要记录的 `team` 头解析了，
投影就保留页面（`tasks: []` 合法；诚实的无团队投影仍走各空态），MPD 面板的 0 任务渲染画出表头事实（团队、阶段、
`tasks 0/0`、成员数）、一行按场景自身规范排布的花名册，以及点名"哪个调用能填上看板"的提示——本会话自己的团队与
带标记的工作区回退一视同仁。

**团队派发现在会说明拒绝原因（C7，一句面向用户的话）。** 团队面的派发过程在纯决策里拒绝跨团队配对与
"只读成员接写任务"配对，而拒绝语句在派发报告里**用户可见**（`refused a CROSS-TEAM pairing: task … belongs to …
while member … belongs to …`；被守卫跳过的属主报告为 `was passed over by a dispatch guard (…)`）——被跳过的任务
永远带着原因，而不是悄悄回退。

**谢绝的采纳候选（两轮趋同的研究评估后由用户谢绝——记录在此，免得后续波次重新争论）。** 0.15.0 的每个新能力
都是宿主内部或仅诊断用途：`probeBackendAdmission()`——可在绑定的 `tuiPluginHost` 上调用，但它诊断的是本 bundle
并未发布、且上游未接通安装链的 Backend 贡献族（谢绝）；`backend-v1alpha1` Backend 族——延后的非目标；
`plugin-completions`、`plugin-declaration`、`plugin-manager`、`entry-slot`、`session-seed`、
`session-list-metadata`、`tui-settings`、`fresh-agent`——宿主内部子系统，不是插件可见接缝。准入注册表变更的
`registry-0.15.json` 与新的 `backend-v1alpha1` 契约使 `tui-admission` 通道的本波次重跑成为关键载荷。

**本波次证据，以及每个读数的分量。** 上面的宿主读数来自本波次冻结的测量基准
（`evidence/tui/dsh-tui-015/host-diff/FACTS.md`，两份 npm tarball 在其旁解开为 `a/` 0.14.0 与 `b/` 0.15.0——
接缝"只增不改"的 diff、合并/移除机制、`PanelBar` 图标复测与不变的默认值都读自这两棵树，而非凭记忆）。本节所在
代码版本上的单元带读数为：`bun test packages/mpd-tui-adapter-plugin` = **74 通过 / 0 失败**（五条新 C2 臂：版本
判定表、零写入臂与只观察腰带、/settings 移除保持臂、显式 0.14 修复臂、无版本走旧径臂），以及
`bun test packages/mpd-tui-plugin` = **482 通过 / 0 失败**（三条新 C6 臂；"宿主重应用配置 CSV"臂的版本感知拆分）。
安装好的 0.15.0 宿主上的沙箱通道、真机 PTY 臂与 Docker 双模通道是本波次在 `evidence/tui/**` 下的验证记录——
本节只引用它写作时所依据的 host-diff 与单元读数，不预支通道数字；**SKIP 不是通过**。

**边界（边界是主张的一部分）。**（a）守卫退位依赖宿主自愈确实存在——一个自称 `>= 0.15.0` 却丢失合并助手的宿主
会让 MPD 面板不在启用清单里，而只观察腰带的那一行就是该症状的可见线索。陈旧默认值例外自带一条已言明的边界：
在默认值与宿主当前默认不同的宿主上，**故意**把清单配置成恰好那条已知陈旧列表的用户，与陈旧钉定无法区分，
会被迁移一次——与 T1 既有的边界相同，现在经 tick 与腰带延伸到 0.15.0。（b）授权流的活跃度数字（每次操作重读、
200 ms ×100 重试）是宿主的实测行为，不是本 bundle 的承诺；撤销语义同样属于宿主。（c）`PanelBar` 图标回归是
**宿主**在 0.15.0 上的实测事实：将来某个宿主再次停画图标，也不会与本页任何 MPD 主张矛盾——每个描述符仍声明一个。
（d）C6 的真机 PTY 目验是一次**点名的人工观察**（船长自己的会话即复现源）；回归重量由单元臂承担。

### 11.8 DSH-TUI 0.16.1 适配波次之后的修订（2026-10-18）

0.16.1 是第一个声明 peer 接受 harness `0.2.1-rc.2` 的 dsh-tui 版本：36 个 `@deepseek-ai/dsh-*` peer
全部带该段（例如 `dsh-agent: … || 0.2.0-rc.2 || 0.2.1-rc.2`、
`dsh-app-boot: 0.2.0-rc.2 || 0.2.1-rc.2`），而 0.15.0 的同一族只列到 `0.2.0-rc.2`——这正是
`dsh plugin --profile dsh-tui add dsh-tui@0.15.0` 在 0.2.1 profile 上被拒的原因。对标宿主移向
**0.16.1**；以下各条在与 §11.7 冲突处取代它：

| 被取代的陈述 | 原为 | 现为（2026-10-18 实测） |
|---|---|---|
| 本页对标宿主（§ 前言） | **0.14.0** | **0.16.1** |
| §3 接缝清单 | 十五个 `tui*` 接缝，0.13.0→0.15.0 不变 | **仍是十五个，且 0.16.1 没有破坏适配器的任何东西**：同样六个 `Tui*Like` 形状、`close(): void` + `active.id`、`tuiPanels`、`tuiPrompt` 仍是 phantom、`lib/types/ui.js` 仍导出 `useStdin`；唯一新增是 `EFFECT_LEDGER_NAME` 常量，适配器与 bundle 都不声明、不消费。适配器代码无需改动 |
| §3.3 / §7 —— 版本钉住载体与 `MPD_E2E_DSH_VERSION` | 载体为 `0.15.0`；`MPD_E2E_DSH_VERSION` 保持 `0.2.0-rc.2` | **载体为 `0.16.1`，harness 为 `0.2.1-rc.2`**：两条 Docker 车道（`MPD_E2E_TUI_VERSION`、`MPD_E2E_DSH_VERSION`）、`dsh-distribution.json` 的 `host-tui` 引用（`…@0.16.1`）与 `dsh-plugin.json` 的 `compat.hosts`（`…@0.16.1`，从陈旧的 `0.10.1` 移来）。`MPD_E2E_DSH_VERSION` 现默认 `0.2.1-rc.2`，因为宿主的 peer 带接受它 |

TUI 车道使用配置好的 `TUI_VERSION`（默认 `0.16.1`）与 `MPD_E2E_DSH_VERSION`（默认 `0.2.1-rc.2`）
钉住值，记录 `tui.hostInstall`、`tui.pluginAddHost`、`tui.pluginAddBundle` 与 `tui.compose`；若所选
宿主的 peer 范围排除该 harness，宿主的 `dsh plugin --profile dsh-tui add <host>` 会被拒绝，
`tui.pluginAddHost` 为 `false`，车道以红色结束——它**不**检查 peer 范围，也**不**记录
`tui.hostPeerBound` 行。

### 11.9 看门狗面板波次之后的修订（2026-10-23）

本波次给团队看门狗一个一等 TUI 界面，并收尾模型设置的清理：

| 主题 | 之前 | 之后 |
|---|---|---|
| §3.3 面板清单 | 两个侧栏页面（`team`、`workmate`） | **三个** —— `team`（`order` 10）、`workmate`（`order` 12）与 **`watchdog`**（`MPD watchdog`、图标 `⚠`、`order` 13、`minColumns` 28）。由 `src/panel-watchdog.ts` 经本行自己的 `tuiPanels` 接缝注册；它自己的行配置开关是 `watchdog`（默认开启） |
| 看门狗可见性 | 一条状态行提示、每次附加时的一次确认对话框，以及 board/team/subagents 场景里的一行 `HELD` | **面板**（每团队暂停状态与阶段、`mpd-tui` 未读数、事件列表含种类 / 相对时间 / 团队·任务·尝试 / 原因与 `ms` / 挂起结果 / 确认状态；`a`/`r`/滚动键）、**自己的标签页徽标**（暂停 = `warning`、未读 = `info`，5 秒轮询重取）与 **`/mpd watchdog`** |
| `/mpd-model` | 槽位 → **范围** → 提供商 → 模型 → 推理强度，含成员覆盖与清除分支（`agentRoutes`） | 槽位 → 提供商 → 模型 → 推理强度；未配置的槽位从配置服务的类型化 `slotResolutionOf` 读作 `<unconfigured>`，老组合读作 `<unavailable>`；**没有**成员分支，也**不写** `agentRoutes` |
| DAG 渲染器决策 | 隐含（“就是字符网格”） | 记录在 [`tui-dag-renderer.md`](./tui-dag-renderer.zh-CN.md)（英文版 [`/tui-dag-renderer.md`](./tui-dag-renderer.md)）：notcurses **不可行**，宿主的 `ui.Image` 路径是有界、不可交互、且必须带单元格回退的位图，参考实现 `dsh-blender-plugin` 不含任何图形代码——因此本波次 DAG 仍是字符网格，自研渲染器推迟 |

**诚实的边界。** 本波次的证据是本包自己的测试套件（含新增的 `test/panel-watchdog.test.ts` 各项）与仓库门禁；
**没有对看门狗页做实时 PTY 抓取**——契约的最低一档（一个真正挂载、注册了面板与命令的启动）由插件契约项证明，
页面内容则由宿主 kit 替身证明。决策记录里的 `ui.Image` 清单读取自已安装宿主自身的类型声明（0.16.1），
而不是来自一次真实渲染。

### 11.10 DSH-TUI 0.17.0 适配波次之后的修订（2026-10-25）

本波次把钉定的一对宿主移到与之共同认证的版本上，不改任何插件源码：

| 主题 | 之前 | 之后 |
|---|---|---|
| 本页对标宿主（§ 前言） | **0.16.1** | **0.17.0** —— 第一个在声明的 peer 范围里接受 harness `0.2.1-rc.3` 的 dsh-tui 版本：其 39 个 `@deepseek-ai/dsh-*` peer 中有 36 个追加了 `0.2.1-rc.3` 这一段，而 0.16.1 的 peer 列表里没有这一段（读取自已发布的 0.17.0 tarball） |
| §3 接缝清单 | 十五个 `tui*` 接缝，0.13.0→0.16.1 不变 | **仍是十五个，且 0.17.0 没有破坏适配器的任何东西**：`lib/types/dsh-adapter/` 下的十五个接缝声明逐字节相同，`dsh-adapter/plugin-host.d.ts` 与 `adapter/standard/negotiate.d.ts` 逐字节相同，`tui-profile/registry/registry-0.15.json` 及随包发布的全部契约文件也逐字节相同——因此准入 profile 仍是 **v0.15**，`manifestVersion`/`$schema` **不移动**。0.17.0 真正的改动要么是增量的、要么不在本路径上：面板 kit 组件 `Markdown`/`CodeBlock`（`panels.d.ts`）、两个宿主 panel-CSV 辅助函数合并进 `tuiDisplayPrefs.applySidePanelPanels`、一个 Windows 通知通道，以及一棵新的 `cli/` 目录树 |
| §3.3 / §7 —— 版本钉住载体与 `MPD_E2E_DSH_VERSION` | 载体为 `0.16.1`，harness 为 `0.2.1-rc.2` | **载体为 `0.17.0`，harness 为 `0.2.1-rc.3`**：两条 Docker 车道（`MPD_E2E_TUI_VERSION`、`MPD_E2E_DSH_VERSION`）、UI 那套 stack（`MPD_UI_TUI_VERSION`、`MPD_UI_DSH_VERSION`）、`dsh-distribution.json` 的 `host-tui` 引用（`…@0.17.0`）、`dsh-plugin.json` 的 `compat.hosts`（`…@0.17.0`），以及 `skills/dsh-qa/scripts/tui-mount.ts` 的宿主规格和每一处 `npm i -g @deepseek-harness-tui/dsh-tui@…` 的 PREREQ 补救串。harness 的 pin 本身记在 `package.json` 的三个 `@deepseek-ai/dsh-experimental-*` 依赖里（`0.2.1-rc.3`） |
| 适配器的版本闸门 | `PANEL_CSV_HOST_OWNED_SINCE = "0.16.1"`、`PANEL_CSV_SELF_HEAL_SINCE = "0.15.0"`，以及 `hostVersion` 夹具 `0.14.0/0.15.0/0.16.0/0.17.0` | **不变** —— 它们编码的是宿主**何时**改变行为，而不是当前宿主是哪个；盲目全量替换版本号会把它们改坏 |
| “在 dsh-tui >= 0.16.1 上……”这类范围表述（§6.2 与使用者指南） | 一个闸门阈值 | **不变** —— 这是范围，不是目标版本 |

**诚实的边界。** 本波次的两条 Docker 真机车道都在最终树上跑过（裸 `ubuntu:24.04`），其提交的结果就是本页的
PTY 证据。`evidence/docker/client-install/2026-10-25T16-02-51Z/result.json` —— `ok: true`，122 条断言、
77 通过、0 失败、45 条 null（4 条 `oneclick.*` 因模式未跑；需要凭据的 `live.*` 各行与 `boot.llmTurn`；
9 条 `ui.*` 行因浏览器车道需显式开启；以及需要密钥的 `qa.mcpCall`）—— 其 22 条 `tui.*` 断言全部为真：
`tui.boot` 在真实 PTY 上到达聊天界面、`tui.hostInstall` 报 `version=0.17.0`、`tui.sessionPreset` 报
`agentPreset=mpd`，另有 `boot.presetMount` 与 `harness.version = 0.2.1-rc.3`。
`…/2026-10-25T16-13-29Z/result.json` —— `ok: true`，117 通过、0 失败、5 条 null（4 条 `oneclick.*` 与
未被询问的 `ui.teamBoard`）—— 记录到 `live.web`、`live.tui`、`live.headless` 三路的 `mpdToolCalled` 与
`assistantReplied` 均为真，`boot.llmTurn` 为真，`ui.*` 各行为真。仍有一条边界成立：**针对已发布包的
一键车道本波次没有跑**，因此它的行保持 null —— 这些 stamp 度量的是检出安装，绝不是打包产物。
