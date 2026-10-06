# DSH-TUI 版本

[English](./tui.md) | **中文**

本页说明 my-power-dsh 的 **DSH-TUI 版本**：它提供什么、如何安装、逐包兼容性测量的结果，以及它
**明确不声明**什么。目标宿主为 `@deepseek-harness-tui/dsh-tui` **0.12.0** 及其内置的准入
（admission）配置文件。0.12.0 是 peer 范围覆盖本 bundle 所钉 harness 整段区间的 dsh-tui 版本 ——
其列表一路列到 `0.1.7-rc.2`、`0.2.0-rc.1` 与 `0.2.0-rc.2`，而 `0.11.2` 只到 `0.2.0-rc.1`（0.10.1 与
0.10.2 只到 `0.1.5-rc.1`），因此只有它能与本 bundle 所针对的 harness 一起启动；下文的兼容性
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
| TUI 界面包 | `packages/mpd-tui-plugin/` | TUI 原生界面：状态行、`/settings` 区块、全屏面板场景、`/mpd` 命令树、快捷键、受中介的对话框、**宿主未投影**的转写渲染器注册（明确不声明第 10 条），以及"就绪但未激活"的决策事件接缝。 |
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
| Agent Teams 面板（会话头部） | `tuiScenes` 全屏面板 + `tuiStatus` 状态行 | 已在实机通道中渲染——`evidence/tui/live/20260915T063140Z/result.json`（t8；7 个界面中 6 个） |
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

TUI 命令树暴露 `/mpd team` 与 `/mpd plan`
（`packages/mpd-tui-plugin/src/command-trees.ts` 就是动作清单：`board`、`team`、`plan`、
`workmates`、`status`），以及带 key 的状态行与看板场景。

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
那是**按键改指**，不是决策事件订阅，且只在工作区的团队投影含有一个至少带一项任务的团队时生效。）清单将该
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

| 偏离项 | 取值 | 为什么是刻意的 |
|---|---|---|
| 包名 | `@mpd-dsh/mpd-tui` | 保持本 bundle 的命名空间；生态使用自己的命名。 |
| 许可证 | SUL-1.0（`LICENSE.md`） | 本版本未改动；任何产物都不得声明许可证变更。 |
| 清单 | **唯一**一份 bundle 级 `dsh-plugin.json`，而非 25 份逐包清单 | 本 bundle 作为一个整体安装；清单的 host facet 指向唯一的 TUI 插件模块。 |
| 宿主输入总线 | 接缝之外**唯一**被计数的接触面：适配器解析**已安装**宿主的根目录，按**文件 URL** 动态 import `<hostRoot>/lib/types/ui.js`，取得宿主自己的 `useStdin` | `Ctrl+A` 是宿主的内建动作，任何贡献类型都够不到它，否则就只能放弃这条需求。接触面只存在于 `mpd-tui-adapter-plugin`，不补丁任何宿主文件，且依赖**按 URL 的模块同一性**。在 0.12.0 上实测：这份 import 得到的是**另一份**模块实例，其 `useStdin()` 什么也不返回，因此适配器还会保存**场景渲染**收到的那份活 kit 并优先使用它——这正是接管会在"本次会话渲染过任一 MPD 面板或场景"之后就绪、在那之前保持惰性的原因。适配器内部还遵守另外两条宿主规则：状态类注册的 identity 必须是**正在调用它的激活**（注入 scope），并且不写入任何 DSH-TUI 文件。真机 PTY 用例 `tui-deps-ctrla` 就是它的反证器。 |

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
| `mpd-mcp-lsp` | LSP MCP 服务器（stdio 启动器） | usable | 8 个 `mcp__lsp__*` 工具 |
| `mpd-mcp-codegraph` | codegraph MCP 服务器（stdio 启动器） | usable | 服务器在进程内运行；**在该沙箱**中 0 个工具，因为 CodeGraph 策略排除含 `.mpd` 的项目路径（沙箱现象，不是 TUI 限制） |
| `mpd-mcp-gitbash` | git-bash MCP 服务器（上游仅 Windows） | inert | 任何 profile 下该行组合为 `disabled: true` |
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
   收窄到宿主的拒绝名单捕获顺序，而不是"任何渲染行都无法产生"；处置结论不变。
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
