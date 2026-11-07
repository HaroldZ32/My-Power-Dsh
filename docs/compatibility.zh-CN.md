# 兼容性

[English](./compatibility.md) | **中文**

本页是 `0.18.0` 版本的**三平面兼容矩阵**：每个上游平面保证什么、在旧宿主上什么会降级、以及在旧宿主上
什么**不可用**。每一行都能追溯到一次门禁运行、一次在隔离 `DSH_HOME` 里的挂载启动，或旁边点名的上游包
源码——绝不能追溯到真机，因为本仓库里没有 Flutter 宿主，也没有手机。

## 1. 怎么读这一页

三个平面各自独立移动，bundle 也按各自的规则分别适配：

| 平面 | 最低支持 | 当前目标 | 该声明在哪里被断言 |
|---|---|---|---|
| DSH 核心（`@deepseek-ai/dsh`） | `0.2.1-rc.5` | `0.2.2-rc.1` | `package.json` 的 `engines.dsh`、隔离挂载启动、`preset-conformance` |
| DSH-TUI（`@deepseek-harness-tui/dsh-tui`） | `0.18.0` | `0.19.0` | `dsh-plugin.json` 的 `compat.hosts`、`verify:tui-admission`、宿主自己的协商 |
| DSH-Go（`dsh-Go`，协议 v1） | 视图 v1，永远 | 在应用能接受的范围内用视图 v2 | `dshGo` 清单、`verify:dshgo` |

三个词各只有一个含义。**保证**意味着本仓库里有检查真正演练过它。**降级**意味着在缺少该能力的宿主上，
有写明的兜底接手。**不可用**意味着该能力在那台宿主上就是不存在，本页不会假装它存在。

`engines.dsh` 刻意同时覆盖两个波段：`"dsh": ">=0.2.1-rc.5 <0.3.0-0"`。把发布锁死在新波段，会在安装阶段
就拒绝旧宿主，而这正是本波的向后兼容规则所禁止的。

## 2. DSH 核心：`0.2.1-rc.5` 与 `0.2.2-rc.1`

| | `0.2.1-rc.5` | `0.2.2-rc.1` |
|---|---|---|
| 安装 | 保证——`dsh plugin --profile w add <repo root>`，退出 0 | 保证——同一条命令，退出 0 |
| 挂载与启动 | 保证——`bundle-lifecycle` PASS，所有启动检查为真，无 home 副本，卸载干净 | 保证——`bundle-lifecycle` PASS，同样的检查 |
| `mpd` preset 创建 | 保证 | 保证——对已发布的 `standard` preset 行对齐 27/27，两条负向对照都按预期变红 |
| 模型路由（`agentOptions`） | 有效 | 有效——见下文 |
| 经适配器的工具调用 | 有效 | 在下面的批量 API 修复**之后**有效 |
| `list_agents` | **不可用**——已声明的能力减值 | 可用——根插件自己注册它 |

**上游改了什么。** `0.2.2-rc.1` 把 cordis 移到 `~4.1.0`、loader/include 移到 `~1.1.0`、timer 移到
`~1.2.0`、schemastery 移到 `~3.19.0`、cosmokit 移到 `~1.9.0`，并给 CLI 增加了
`engines.node >= 24.9.0`。它发布说明里那四条头条破坏性变更（没有 `agent/request` 监听器、没有
`tools.resolve`、没有 `executable` 工具属性、没有 Session Projection 注册）都不触碰本树：一次盘点确认
这些一个都没用到。

**有一处破坏性变更不在那份清单里，是一次挂载发现的。** `ToolsService.execute` 从单个
`ToolExecutionInput` 改成了批量形状——`ToolBatchInput { calls: [{ type: 'tool-call', id, name,
arguments: <raw JSON string> }], … }`，返回 `ToolBatchResult`。我们的盘点（搜的是 `tools.resolve` 与
`executable`）漏掉了它；`bundle-lifecycle` 挂载以
`ADAPTER_TOOL_CALL=fail:Tool batch execution failed` 抓到了它。适配器被修成发送批量形状（现在两台宿主
都通过同一次挂载），而这个发现留在记录里：发布说明不是一份完整的破坏性变更清单。

**模型路由通过 `agentOptions` 仍然有效——但只在本次波次真正演练过的那一个点上。** 在 `0.2.2-rc.1` 上，
一次 CONSULT spawn 的请求 `agentOptions` 仍然选择模型，证据是子会话自己的请求头：子会话跑的是
`agentRoutes."Junior Engineer"` 配置的模型，而父会话跑的是另一个。这是**一个**点，不是四个。
`TeamExecutor.spawn`、`resolveRunRoute` 与 roster provider 的 `applyRoute` 共用同一个接缝，但本次波次
没有单独演练其中任何一个：它们仍是**已声明的边界**，不是已证明的结果。证据是一次真实运行，而不是读代码。

**旧宿主上已声明的能力减值：`list_agents`。** `0.2.2-rc.1` 从
`@deepseek-ai/dsh-tool-subagent-control` 移除了 `./list-agents` 子路径导出（根插件现在自己注册
`list_agents`，已发布的 `standard` preset 也删掉了那一行）。模块路径已无法解析的行不可能保留，因此
`presets/mpd.patch.yml` **删除**了它的 `tool-subagent-list-agents` 行。实测后果：在 `0.2.2-rc.1` 上
`mpd` preset 现在与 `standard` 一致（行对齐 27/27，负向对照 4/4 变红）；在 `0.2.1-rc.5` 上同一个比较会
报告*“the mpd preset does not mount active row(s) the installed standard preset mounts:
tool-subagent-list-agents”*。

**旧宿主上的用户仍然拥有一个可用的 bundle，只是少了一项能力。** 它仍然能安装、挂载、运行——
`bundle-lifecycle` 在 `0.2.1-rc.5` 上退出 0，所有启动检查为真，没有残留——但 `list_agents` 在那台
harness 上不再由本 bundle 的 preset 提供。这就是本次发布的已声明能力减值，而不是“没有影响”。

**为什么条件行不是解法。** loader 在尊重 `disabled` **之前**就解析行的模块路径，因此保留该行会让
`0.2.2-rc.1` 上的启动失败；在这一点上，不存在一个能横跨两台宿主的单一 preset。删掉它是艰难的选择，不是
偷懒。同一波还从已发布的 preset 镜像了另一处行守卫：`tool-plugin-manager` 的 `disabled` 改为
`!ctx.get('profileContext')`——在 `0.2.2-rc.1` 上它是激活的，而在 `0.2.1-rc.5` 上因为那台 harness 没有
`profileContext` 服务，表达式求值为 disabled，旧宿主保持原来的行为。

## 3. dsh-TUI：`0.18.0` 与 `0.19.0` 都被接纳

`dsh-plugin.json` 与 `packages/mpd-tui-plugin/dsh-plugin.json` 都声明
`compat.hosts: ["@deepseek-harness-tui/dsh-tui@0.18.0", "@deepseek-harness-tui/dsh-tui@0.19.0"]`，而
`dsh-distribution.json` 的 `host-tui` 引用写的是 `0.19.0`。`verify:tui-admission` 断言这份已发布的
波段，而不再只是相信字段。本 bundle **声明**支持的宿主集合是**写死的数据**，不是被发现的事实：
`specs/tui-hosts.json` 点名这两台宿主，门禁的 COMPAT 车道有五条臂——四条在每次静态运行中都无需宿主即可
跑，另有一条只有在能发现宿主时才跑：

- `COMPAT.band:<label>`——每份清单的 `compat.hosts` 都是非空的 `@scope/name@x.y.z` 坐标数组（每份清单一条臂）。
- `COMPAT.band-parity`——两份清单声明**相同**的波段，因此这一对不会各自漂移。
- `COMPAT.distribution-ref`——`dsh-distribution.json` 的 `host-tui` 引用位于该波段**之内**。
- `COMPAT.declared-hosts`——`specs/tui-hosts.json` 里点名的**每一台**宿主都位于每份清单的波段**之内**。
  这条臂读的是写死的数据，从不查询被发现的宿主；因此从任一清单删掉一台已声明的宿主，即便 CI 只安装了
  另一台宿主，门禁也会变红：这份缺失藏不到“这台机器恰好装了哪台宿主”后面。
- `COMPAT.host-version`——**被发现**宿主的精确版本位于波段之内。发现不到宿主时，这条臂报告
  `BOUND — NOT CHECKED — <reason>`，而不是悄悄通过；`--static-only` 按构造总是这样报告，并且它自身
  退出 3，因为静态运行绝不是准入裁决。

“已声明集合”这条臂与“被发现宿主”这条臂回答的是两个不同的问题，谁也替代不了谁：前者证明**声明**覆盖
两台宿主，后者证明**这台机器**上的宿主是声明所接纳的。两者都不是对**两台**宿主的一次实时准入。本次发布的
门禁运行发现的宿主是 `0.18.0`，所以 `COMPAT.host-version` 针对 `0.18.0` 通过，整次运行报告
**PASS——49 条臂通过，1 条允许偏差，5 条边界**。`0.19.0` 的结果是下面那份更早的实测：

- 宿主自己的准入链针对 **`0.19.0`** 跑过：`validateHost: ok`，两份清单都协商为 `compatible`（那次更早的
  运行报告 43 条臂，在本波加入五条 COMPAT 臂之前）。
- `0.18.0` 的结果作为更早的实测继续成立：两份清单都答 `validatePlugin: ok` 与 `negotiate: compatible`。

**准入指南与准入链在两个 tag 上是逐字节相同的**，所以第二个结果不是抽样巧合：指南的 blob 在两个 tag 上
都是 `6b9dfd3…`（99,723 B），`permissions-0.1.json` 注册表都是 `f36cb6e…`，十一个准入决策源文件全部
未变。`0.19.0` 自身只改了 DSH peer 范围（增加了 `0.2.2-rc.1`，同时保留 `0.2.1-rc.5`）、`/update`
编排、一条 subagent 通道通知，以及一次第一方 feed 重钉。没有准入返工要做，我们也没有编造任何返工。

在旧 TUI 宿主上会降级什么：**本 bundle 声明的东西里没有**。七个运行时绑定界面与可选的
`DecisionEvents` 契约行为完全相同；该契约本来就声明为可选并带写明兜底，且没有请求任何拦截权限。

## 4. DSH-Go：视图 v1 永远在，视图 v2 按需选用

原生界面是唯一一个“旧”指的是旧**应用**而非旧 harness 的平面：

- **保证：** 每个面板都在 `dsh-go/views/` 下指名一份手写静态视图，而它们都是视图 **v1**——任何协议 1
  应用都能画的形状。
- **降级：** 面板运行时构建的树是 v2，适配器的 `adaptView` 会为无法接受 v2 的应用重写它们（标签页变成
  带标题的分节堆叠，grid 变成列表，badge 变成文本，`divider`/`spacer` 消失，`style`/`accent` 被剥离，
  metric 的标签与数值保留）。
- **不可用：** 在只支持 v1 的应用上使用 v2 独占的视觉语言——这是刻意的，而且同一棵树是**降级后**提供，
  而不是被扣下。
- **完全没有桥：** 什么也不注册，只打一行 `dshGo=absent`，零定时器、零轮询。

细节、七个插槽、按语言的上限与门禁见 [`dsh-go-standard.zh-CN.md`](dsh-go-standard.zh-CN.md)。

## 5. 展示元数据：图标、`meta` 包装与 `meta.detail`

`0.2.2-rc.1` 改变了 WEB 插件管理器界面：会话列表会渲染插件图标，插件管理页获得了富文本详情和更好的
布局/导航行为，并且——引用发布说明原文——*“Stop reading separate package.json files for subpath plugins;
display text and icons must use the corresponding subpath exports.”*

**图标契约没有变。** 图标是 `package.json` 的顶层字段 `DshPackageManifest.icon?: string`：*“SVG, PNG,
JPEG, or WebP file relative to this manifest's directory, at most 256 KiB and contained there after realpath
resolution.”* 这段措辞在 `0.2.1-rc.5` 与 `0.2.2-rc.1` 上完全相同，它是可选的，并在整个波段内保持稳定。
本仓库本来就声明了 `"icon": "./icon.svg"`，通过 `files` 发布该文件，并导出 `"./package.json"`、
`"./icon.svg"`、`"./locale/*.json"`——所以它早已合规，无需改动。

**本波修掉了一个真实且既有的缺口，这是一个好发现，而不是升级引入的缺陷。** 我们的 `locale/*.json`
是**扁平**的（`{title, description}`），而宿主读的是 `{"meta": {title, description}}`。两个文件现在都
带 `meta` 包装。有了包装，宿主还接受 `meta.detail`——一个指向 markdown 文档的路径，会被渲染成插件的
富文本详情页。本 bundle 把 `locale/en.json` 指向 [`plugin-details.md`](plugin-details.md)，把 `locale/zh.json` 指向
[`plugin-details.zh-CN.md`](plugin-details.zh-CN.md)；这两个文件在同一波中创建，打包产物必须包含它们
（它们随 `files` 里的 `docs/**` 一起发布）。

本波并没有在插件管理器里真正渲染并验证过这些：它是由清单字段和发布文本陈述的，locale 形状则按宿主的
读取器核对。诚实的边界是：这个**页面**就是宿主渲染的 markdown 文件，它的内容就是
[`plugin-details.zh-CN.md`](plugin-details.zh-CN.md) 里面向用户的摘要。

## 6. 已声明的边界

- **没有真机，没有 Flutter 宿主。** DSH-Go 半边是针对已发布标准、钉住的规范数据和服务替身证明的；像素
  由读者自己核对。
- **是挂载，不是每一条路径。** `bundle-lifecycle` 在两台 harness 上证明了安装、组合、启动、工具调用、
  preset 与卸载；Docker 真机车道是**最后**一步，没有 rootless 守护进程时可以跳过——而跳过永远不是通过。
- **`0.2.1-rc.5` 是在挂载层面证明的**，并带有上面那一项已声明的能力减值。我们不声称 `0.2.2-rc.1` 的
  每一种行为在它上面都存在。
- **官方 DSH-Go 检查器没有 vendor**；没有 `MPD_DSHGO_KIT` 时该车道是 NOT-PASSED（退出 3），这是已声明
  的边界，不是绿。
- **未完成的 CodeRabbit 评审或被跳过的门禁永远不是通过**——发布清扫会记录真正跑过的东西。

## 7. 细节在哪里

发布叙事见 [`../CHANGELOG.md`](../CHANGELOG.md) 的 `## 0.18.0`。本页所依托的两份上游适配来源，是
`evidence/upstream/0.2.2/2026-11-07T05-45Z/` 下的实测证据包（挂载、路由、行对齐、`0.19.0` 协商探针与
批量 API 发现）以及旁边的门禁记录。DSH-Go 标准见
[`dsh-go-standard.zh-CN.md`](dsh-go-standard.zh-CN.md)；TUI 车道见 [`tui.zh-CN.md`](tui.zh-CN.md) 与
[`tui-admission.zh-CN.md`](tui-admission.zh-CN.md)；约束性规则见 [`../AGENTS.md`](../AGENTS.md) §2 与 §4。
