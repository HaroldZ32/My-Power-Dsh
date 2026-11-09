# DSH-Go 原生插件标准

[English](./dsh-go-standard.md) | **中文**

本页说明本 bundle 所实现的 **DSH-Go 原生插件标准**、它的证明方式，以及这份证明的边界。标准钉在
`ccch1mneyyy/dsh-Go` 的提交 `f36bf91b0736e81ef40c2a7040b2ec337ca1ab40`（2026-11-09）。执行点是
`node scripts/verify-dshgo-standard.ts`，它是常设门禁（[`AGENTS.md`](../AGENTS.md) §4）。

## 1. 标准的构成，以及本仓库钉住的规范数据

上游的权威是三样东西：数字表 `runtime/bridge/dsh-go-bridge/lib/native/limits.js`、bridge 的
`manifest.js` 结构规则，以及五个 JSON Schema 加上应用侧 `view-check.js` 的视图预算。本仓库把这些字节
当作**规范数据**保存，绝不 vendor 上游的可执行代码：

| 资产 | 它是什么 |
|---|---|
| [`specs/dsh-go/limits.ts`](../specs/dsh-go/limits.ts) | 对 `limits.js` 的规范数据转写：数字、封闭取值集合与模式，每条声明都注明对应的上游符号。文件里不做任何计算。 |
| [`specs/dsh-go/schemas/`](../specs/dsh-go/schemas) | 五个上游 JSON Schema 的逐字节副本（`manifest`、`contributions`、`view`、`stream`、`invoke`）。 |
| [`specs/dsh-go/SOURCE.json`](../specs/dsh-go/SOURCE.json) | 钉住的仓库、提交，以及每个抓取文件的 `sha256`。 |
| `VENDOR_LOCK.json` | 把整个 `specs/dsh-go/` 目录当作独立资产做指纹，因此转写或 schema 一旦漂移，`node scripts/verify-vendor.ts` 就会变红。 |

**可执行 SDK 是刻意缺席的。** `@dsh-go/plugin-kit` 在 npm 上是 `private: true`，因此不能成为依赖；
而本仓库的 de-vendor 政策禁止 vendor 上游可执行代码。数字、封闭取值集合与模式和旁边的 JSON Schema
属于同一类东西，所以采用转写加钉住，而不是引用。这是政策线，不是疏漏：门禁会把已发布引擎自己的运行时
常量与这张表交叉核对，于是我们的代码与已发布标准之间的分歧是一次门禁失败，而不是静默漂移。

## 2. 清单：七个插槽及其上限

`dshGo` 块位于根 `package.json`。只有 `v` 与 `contributes` 是必需的；`capabilities` 可选。
`engines.dsh` 位于 `package.json`，**不在** `dshGo` 里面。序列化后的块必须保持在 16 KiB 以内，每个贡献
id 必须在**跨插槽**范围内唯一，并匹配 `^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$`。

| 插槽 | 单插件上限 | 本 bundle 的声明 |
|---|---|---|
| `composer.actions` | 2 | `mpd-dispatch`、`mpd-board`（2） |
| `message.actions` | 2 | `mpd-save-memory`、`mpd-copy-reply`（2） |
| `composer.strip` | 1 | `mpd-status`（1） |
| `panels` | 4 | `mpd`、`mpd-team`（2） |
| `composer.tools` | 2 | 无 |
| `session.actions` | 2 | 无 |
| `turn.note` | 1 | 无 |

还有两条规则约束贡献能说什么。**`wants` 配对：** `draft` 或 `clipboard` 只允许出现在
`composer.actions` 与 `composer.tools` 上，`message` 只允许出现在 `message.actions` 上。本 bundle 声明
`wants: ["message"]`，并把两个动作放在 `message.actions` 上，正是标准允许的配对。**静态 `effect` 类型**
只限 invoke schema 列出的六种（`insert`、`command`、`open`、`link`、`copy`、`toast`），每项最多四个；
`mpd-board` 用的是静态 `{ type: "open", page: "panel:mpd-team" }` 效果，因此根本不需要处理器。

## 3. 显示文本：按语言分别计量

每条显示字符串都**按语言**以码点计量：英文值与中文值是两次独立测量，从不合并。上限与本 bundle 的实测
最大值如下：

| 字段 | 上限 | 本 bundle（en） | 本 bundle（zh） |
|---|---|---|---|
| `pluginTitle` | 24 | 3（`MPD`） | 3（`MPD`） |
| `panelTitle` | 16 | 13（`MPD Workbench`） | 7（`MPD 工作台`） |
| `panelTitle`（第二个面板） | 16 | 14（`MPD Team Board`） | 8（`MPD 团队看板`） |
| `stripText` | 24 | 1（`—`） | 1（`—`） |
| `composerAction` | 10 | 8（`Dispatch`）/ 5（`Board`） | 2（`派活`）/ 2（`看板`） |
| `messageAction` | 12 | 11（`Save memory`）/ 10（`Copy reply`） | 4（`存为记忆`）/ 4（`复制正文`） |
| `composerTool` | 8 | 无 | 无 |
| `sessionAction` | 12 | 无 | 无 |
| `turnNote` | 16 | 无 | 无 |
| `toast` | 40 | 运行时文案 | 运行时文案 |

超出上限的值是 NOTE 而不是失败：bridge 会截断超长标签并告警，本门禁沿用同一严重级别。重复 id 或结构
违规是 ERROR，会失败。

## 4. 视图预算，以及 v1 与 v2 的关系

| 视图 | 字节 | 节点数 | 深度 |
|---|---|---|---|
| 工具卡片 | 8192 | 40 | 6 |
| 面板 | 32768 | 120 | 8 |
| composer strip | 2048 | 8 | 3 |

**视图 v1 永远会被服务；v2 是可选的，并且会被降级。** 每个面板都在 `dsh-go/views/` 下指名一份手写的
静态兜底，这些文件就是视图 v1：没有 `$` 绑定，没有 v2 独占组件。面板运行时构建的树是 v2，适配器里的
`adaptView` 会为旧版应用重写它们：标签页变成带标题的分节堆叠，grid 变成列表，badge 变成文本，
`divider`/`spacer` 消失，所有 `style`/`accent` 被剥离，而 metric 的标签与数值都保留下来。两种形态由同
一个构建器产出，所以兜底不会与它所派生的树发生漂移。工具卡片按构造就是 v1：没有绑定、没有按钮，凡是
超出预算或带有 v2 独占组件的，一律降级为 `{}`，由应用自己渲染通用的工具行。

## 5. 宿主半边：绑定 `dshGo` 桥

标准要求插件用 `ctx.inject(['dshGo'], …)` 绑定桥。可选注入的拼法 `'dshGo?'` 不是 cordis 语法，而把
`dshGo` 放进顶层 `inject` 数组，会让一个没有桥的宿主根本无法启动该行。绑定之后，插件注册的东西必须与
清单声明完全一致：每个非静态条目一个 `on(id)`，每个面板一个 `panel(id)`，且不为清单未声明的 id 注册。

**本 bundle 如何满足这条规则——以及唯一一处刻意的偏离。** 本仓库把所有 harness 服务接触面集中到
`mpd-dsh-adapter-plugin`（[`AGENTS.md`](../AGENTS.md) §6），因此插件行从不直接指名 harness 服务。于是
延迟注入落在**适配器**里，而不是 bundle 插件里：适配器只注册**一个** `ctx.inject(["dshGo"], …)`，所有
dshGo 读取都走一个作用域访问器，在注入接缝缺席时退回惰性根探测。bundle 各行继续调用适配器的
`dshGoPresent()` 与 `onServiceBound(["dshGo"])`。规则的意图被满足了——插件唯一的接触面以被认可的方式
绑定了桥，而且只绑一次——同时架构规则（唯一接触文件）得以保留。各行自己的
`export const inject: string[] = []` 保持为空，任何地方都没有出现 `'dshGo?'`。

**没有桥的宿主不付出任何代价。** 什么也不注册，只打一行 `dshGo=absent`，并且零定时器、零轮询：该行
订阅 service-bound 接缝，而不是轮询等待。这就是本平面上的向后兼容声明，且有单元测试覆盖，其中一条
会统计 `setInterval` 的调用次数。

## 6. 门禁：五条车道，一个退出契约

`node scripts/verify-dshgo-standard.ts` 是一致性门禁。它的车道，以及每条能证明与不能证明什么：

| 车道 | 它证明什么 | 边界 |
|---|---|---|
| MANIFEST | `dshGo` 块及其周边的包字段：`v`、`contributes` 对象、16 KiB 上限、id 跨插槽唯一且符合模式、各插槽上限、按语言分别计量的文本上限、`wants` 配对、静态 `effect` 类型、面板枚举、strip 的 `panel` 指向已声明面板、`engines.dsh`，以及安装路径解析到的 `dsh.bundle.patch` 文件 | 静态 |
| VIEW | 每个面板声明的静态视图：位于包内、可解析、在面板预算内、是视图 v1、只用 v1 组件、无 `$` 绑定、无外链图片、通过设计 lint | 静态 |
| COMPAT | 向后兼容：已声明的静态视图保持传统 v1 树；kit 仍带有 `adaptView` + `V1_COMPONENTS`；把每个 v2 独占名称降级后不留下任何 v2 独占节点；适配器的 v1/v2 目录完整划分 schema 声明的组件名 | 静态 |
| HOST | 宿主半边以被认可的方式绑定桥，并注册的东西与清单声明完全一致（无 `'dshGo?'`、顶层 `inject` 数组里没有该条目、适配器的探测或 `ctx.inject(['dshGo'], …)` 存在、每个面板一个 `dshGoPanel(id)`、每个非静态 id 一个处理器、没有未声明的 id） | 源码文本走查——**不是一次启动** |
| CROSS-CHECK | 当 `MPD_DSHGO_KIT` 指向一个 DSH-Go 检出时，运行它自己的 `check.mjs --json` 并比较两边的结论 | 受宿主约束；没有检出即 NOT-PASSED |

退出码是聚合器遵守的契约：**0** 所有车道合法，**1** 一条或多条违规，**2** 无法运行（`package.json` 读不
了、未知参数、自检臂行为异常），**3** 官方交叉核对无法运行时的 NOT-PASSED。五条车道并不是唯一的失败
来源：八个声明点上出现 PIN 分歧时，即使每条车道仍然通过，门禁也会以 **1** 退出；而这个 PIN 检查**不是**
第六条车道——它打印自己的 `PIN:` 行。`--self-test` 跑 **46 条臂**——一条干净对照加 45 条负向对照，每个
规则族一条——在这棵树上退出 0。

门禁是**常设**成员：它是 `bun run verify:gates` 的第十一个成员；`gates.yml` 以稀疏的 `sdk/plugin-kit`
检出上游钉住提交，并在跑聚合前导出 `MPD_DSHGO_KIT`；`publish.yml` 在 `npm pack` / `npm stage publish`
**之前**运行它，因此不合规的清单无法进入发布暂存。它的前身 `scripts/verify-dshgo-views.ts` 已**退役**：
文件仍在磁盘上，但任何 npm 脚本、聚合器或工作流都不再调用它。

## 7. 官方交叉核对，以及它已知的一处假阴性

`MPD_DSHGO_KIT` 指向一个 DSH-Go 检出。**没有它时该车道报 NOT-PASSED（退出 3）：没有跑过的交叉核对
永远不算绿。** `--require-dshgo-kit` 把缺席写成记录中的显式要求；无论如何退出码都是 3，这是刻意的，
因此没有检出时聚合器就是红的。

有一处官方假阴性被显式隔离。上游 `check.mjs` 要求 `dsh.bundle.patch` 是**字符串**，而 DSH bundle 可以
声明**数组**式的多个 patch 层——本仓库正是如此。当该项是官方报告中唯一的阻塞项、且本门禁自己的
MANIFEST 车道解析了每一个声明的 patch 路径时，比较会排除它，并打印 `crosscheck-normalized` 作为 NOTE；
官方原始退出码仍会原样引用在报告里。其他任何官方错误、非 `ok` 的清单状态和致命视图，仍然会拦下插件。

## 8. 本页不能证明什么

- **本仓库没有 Flutter 应用**，也没有在真机上渲染过任何东西：原生半边是针对已发布标准、钉住的规范数据
  和服务替身证明的。
- **HOST 车道是静态源码分析**，不是挂载启动；通过小写变量传入、从未写成可解析键的 id 对它不可见。
- 工具卡片与降级臂断言的是 kit 在**合成树**上的行为，而不是真实工具结果上的行为。
- **官方检查器没有 vendor**；没有检出时 CROSS-CHECK 车道是 NOT-PASSED，这是已声明的边界，不是通过。
- 被跳过的 Docker 车道不是通过。

## 9. 细节在哪里

规范数据在 [`specs/dsh-go/`](../specs/dsh-go)；门禁在
[`scripts/verify-dshgo-standard.ts`](../scripts/verify-dshgo-standard.ts)，它的 QA 用例在
[`skills/dsh-qa/scripts/dshgo-standard.ts`](../skills/dsh-qa/scripts/dshgo-standard.ts)。清单在
[`package.json`](../package.json)（`dshGo`），静态视图在 [`dsh-go/views/`](../dsh-go/views)，视图工具包在
`packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts`，面板与界面在
`packages/mpd-bundle-plugin/src/dshgo-*.ts`。面向用户的界面描述见
[`drive-surface.zh-CN.md`](drive-surface.zh-CN.md) §4，三平面兼容矩阵见
[`compatibility.zh-CN.md`](compatibility.zh-CN.md)。
