# DSH-TUI 准入一致性

[English](./tui-admission.md) | **中文**

本页记录本 bundle 在 dsh-TUI 生态的插件准入规则书下的位置：测量针对哪个宿主、由哪个工具产出、
七组准入检查清单与七条质量与安全红线各自的实际结论，以及这些结论都**不能**证明什么。这是一份
自我评估——没有任何生态机构评审过它，本 bundle 也没有发布任何一致性声明（conformance claim）。

## 1. 本页是什么，规则书在哪里

规则书是《终端交互生态插件准入与开发指南》。它位于上游的
`tui-profile/docs/plugin-admission-and-development.md`，commit
`a2600c37720366bc0ca1187e848f718071f7a433`，99,723 字节。

**npm 载荷不包含它。** 已安装宿主的 `package.json#files` 在 `tui-profile/` 下只收录四项——`feed`、
`registry`、`protocols` 与 `schemas`——因此从已安装包内部引用规则书自身路径是死链：在
`@deepseek-harness-tui/dsh-tui` 0.18.0 上，
`<host>/tui-profile/docs/plugin-admission-and-development.md` 并不存在。请改为阅读本仓库提交的
副本；本页关于规则的每一句都读自它。

| 产物 | 路径 | 内容 |
|---|---|---|
| 规则书（仓内副本） | [`evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/admission-guide.md`](../evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/admission-guide.md) | 1,629 行、99,723 字节：本页引用的规则书正文，取自固定的上游 commit。 |
| 准入测量 | [`evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/result.json`](../evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/result.json) | 2026-11-06 用宿主自带的准入库对两份随包清单给出的判定，含两次工具运行及其退出码。 |
| 测量工具 | [`skills/dsh-qa/scripts/tui-admission.ts`](../skills/dsh-qa/scripts/tui-admission.ts) | 本仓库自己的准入用例：`bun skills/dsh-qa/scripts/tui-admission.ts --static-only`。 |
| 宿主库探针 | [`evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/probe-negotiation.mjs`](../evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/probe-negotiation.mjs) | 直接调用已安装宿主的准入链路跑两份清单，使判定不只依赖我们自己的包装。 |
| 硬门 | [`scripts/verify-tui-admission.ts`](../scripts/verify-tui-admission.ts) | 接线后的需求门（§7）：来自 §4/§5 的静态臂，加宿主对两份清单自己的协商；跳过永远不是通过。 |

2026-11-03 的协商前后对照也保留着，因为它是 §3 权限故事的证据：
[`negotiation-before.json`](../evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/negotiation-before.json)
对照
[`negotiation-final-root.json`](../evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/negotiation-final-root.json)
与
[`negotiation-final-package.json`](../evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/negotiation-final-package.json)。

## 2. 三个层，以及它们的结论为什么不能互相顶替

生态有三层，维护者不同、判据不同、结论也不同。规则书用一张表列出它们；下表沿用该表，并写清每层
能得出什么、不能得出什么：

| 层 | 谁维护 | 判据 | 能得出什么 | 不能得出什么 |
|---|---|---|---|---|
| 仓内 profile 准入 | dsh-TUI 仓库（`tui-profile/`，随代码修订） | 协议、形状、坐标、digest、conformance（规则书与 `conformance/`） | 五种状态之一：`compatible`、`compatible_degraded`、`waiting_authorization`、`rejected`、`unknown` | 安全性、质量、"官方认证" |
| 首方 feed | dsh-TUI 仓库随包发布（`tui-profile/feed/first-party.json`） | 精确的 `name@version`、只收 scoped 包、一个版本钉死一份产物 | 安装时**免一次信任确认**的那份名单 | 准入结论；不在名单里不等于不能用 |
| 生态收录 | 生态组织（`dsh-tui-ecosystem`） | `plugins.json` 加 `plugins-pr.yml` 的校验（§6） | [dshtui.com/plugins](https://dshtui.com/plugins) 上的一个目录条目 | 准入、验证、背书 |

层次之间不可传递。`compatible` 只说明清单与协议坐标对得上，不说明插件安全或优秀；首方 feed 的
条目只说明某个精确版本在安装时免一次确认，它不是准入结论，而且只收 scoped 包；目录条目只说明
仓库公开、作者本人提交、README 回链了 dsh-TUI，它既不查清单也不查 npm。规则书自己的总结是：
**收录 ≠ 准入 ≠ 背书**——收录不是准入，准入也不是背书。

## 3. 准入结果

准入词汇恰好五档，一次运行给出其中之一：

| 状态 | 对本 bundle 的含义 |
|---|---|
| `compatible` | 所有必需契约都能解析，没有任何可选契约降级。 |
| `compatible_degraded` | 准入通过，但某个已声明的可选契约沿写明的回退降级。 |
| `waiting_authorization` | 某个已声明的权限未被宿主的默认拒绝注册表授予，因此没有绑定组件身份。 |
| `rejected` | 清单或某个协议坐标未通过解析、校验或协商。 |
| `unknown` | 链路无法判定——例如遇到它读不懂的宿主描述符。 |

规则书把五档说明为 dsh-std 的 validation、composition、negotiation 与 authorization 报告在产品策略上的
投影；上表的一行释义是本页的读法，而本 bundle 实际观察到的只有 `compatible` 与
`waiting_authorization` 两档。

**2026-11-07T05-59-31Z 针对已安装宿主 `@deepseek-harness-tui/dsh-tui` 0.19.0 实测：`validateHost: ok`，
两份清单都回答 `validatePlugin: ok` 并协商为 `compatible`。** 同一条链在 0.18.0 上也回答
`compatible`，而且两个结论依托的是同一条链：准入指南、契约与权限注册表、以及十一个准入决策源文件在两个
tag 上**逐字节相同**（指南 blob 为 `6b9dfd3…`，99,723 B；`permissions-0.1.json` 为 `f36cb6e…`），因此
0.19.0 这次移动不需要任何准入返工。

**本次发布把波段移到 `0.20.0`，而且本波自己的门禁运行已经对它完成协商。** `0.20.0` 相对 `0.19.0` 是
纯增量（波次契约 §3 F1：同样的 52 个行、同样的 15 个 `tui*` 服务、完全一致的 `lib/types/ui.js` 且仍导出
`useStdin`），两个清单的 `compat.hosts` 与 `specs/tui-hosts.json` 现在都以同一份有序集合携带 `0.18.0`、
`0.19.0`、`0.20.0`，`dsh-distribution.json` 的 `host-tui` 引用为 `0.20.0`。

**实测（钉定宿主上的 `verify:gates`）：** `tui-admission` 退出 0，
`REPORT: PASS — 49 arms passed, 1 allowed deviation(s), 5 bound(s)`，且宿主自己的链把**两个**清单都协商为
`compatible`（`arm H.chain:bundle PASS`、`arm H.chain:package PASS`）。记录见
`evidence/verify-022rc2/2026-11-14T03-02-10Z/logs/verify-gates.log`。

**边界不变。** 该臂只是静态准入加上宿主自己的协商——门禁自己会打印
`BOUND: … NOT a live TTY mount, and NOT a Verified claim (no artifact digest exists)`。**本页不声称对
`0.20.0` 做过真机 TTY 抓取**；面板级车道归 `evidence/` 下的运行，没有车道演练过的结论不在本页声称。

| 清单 | SHA-256（截断） | `validatePlugin` | 协商 |
|---|---|---|---|
| `dsh-plugin.json`（bundle 根） | `bcbe05af…` | `ok` | `compatible` |
| `packages/mpd-tui-plugin/dsh-plugin.json` | `aeed4c00…` | `ok` | `compatible` |

两个结果来自同一次运行，走的是已安装宿主自己的链路
`loadSpecData -> createContractIndex -> validatePlugin(index, manifest) -> negotiate(index, manifest,
legacyHostDescriptor, [])`，由我们的探针包装。本仓库自己的工具只交叉印证**根清单**——它只解析并测量
`dsh-plugin.json` 一份，走宿主固定的 `parseManifest`；探针确实覆盖两份清单，但送入的是 `JSON.parse`
得到的对象，而不是宿主 `parseManifest` 的输出，因此这些运行**没有**确立包清单能被宿主清单解析器接受，
确立的只是它的 `validatePlugin` 与 `negotiate` 结果：

```sh
bun skills/dsh-qa/scripts/tui-admission.ts --static-only
node evidence/upstream/0.2.2/2026-11-07T05-45Z/probe-negotiation-0.19.0.mjs
```

两者退出码均为 0——第一条产出 `tui-admission-019.log`，第二条产出 `probe-negotiation-0.19.0.json`，
都在该目录下。第二条命令与机器相关：探针把作者的宿主根（`HOST`，`.qa-tmp/tui-019` 下的 0.19.0 临时
安装）与仓库根（`REPO`）写死在文件里，运行前需替换这两个常量；第一条命令是仓库相对路径，无需替换。
2026-11-06 那次跑的是 0.18.0，是下面那次权限改动之后的复测；2026-11-03 那次才是改动所针对的测量。

**`waiting_authorization` 是怎么变成 `compatible` 的。** 2026-11-03 的运行回答
`waiting_authorization`，原因码 `PERMISSION_NOT_GRANTED`，涉及四个已声明权限，全部是
`session.*.intercept` 拦截点：

- `session.input.intercept@tui/input`
- `session.rewind.intercept@tui/rewind-prompt`
- `session.switch.intercept@tui/session-switch`
- `session.compact.intercept@tui/compact`

Community v0.15 的权限对象没有 `optional` 标志，而宿主注册表默认拒绝，所以一个请求了未使用权限的
清单永远过不了准入。这四条被移除——两份清单都写成 `permissions: []`——同一条链路随即回答
`compatible`。`tui.dsh/v1alpha1#DecisionEvents` 契约仍然保留，作为**可选**要求并写明回退；没有丢失
任何拦截行为，因为那四个点上的处理器本来就不表达意见。前后对照产物见 §1 末尾。

**这个判定自带的边界。** 它是静态准入判定：证明的是解析、校验与协商，不是真实 TTY 挂载，也不是
effect ledger 的归属记账。宿主在产出它时会打印自己的警告——
`legacy compatibility descriptor: contracts declared from the mounted legacy service topology without
live probe evidence`——探针结果与本仓库工具都记录该警告，而不是隐藏它。

## 4. A–G 检查清单

规则书的清单共七组，机器与人工联合检查。只有组内每一行都满足，该组才是 `PASS`；只要有一行未满足，
本页就保持 `PARTIAL`，即使那一行卡住的是声明而不是准入。

| 组 | 判定 | 证据 | 仍存在的缺口 |
|---|---|---|---|
| A. 包与身份 | **PARTIAL** | 已满足：`$schema` 是绝对 URI（`https://dsh.community/schemas/dsh-plugin-0.15.json`），`manifestVersion` 为 `0.15`，`id` 稳定且唯一（`com.mpd-dsh.mpd-tui`），`facets.host` 指明入口且 `apiVersion: v1alpha1`，未出现 `client` 或 `worker` facet，源仓库与 MIT 许可可定位（`dsh-plugin.json`、`LICENSE.md`）。 | **未满足：任何地方都没有记录产物 SHA-256 digest。** 两份清单、`dsh-distribution.json`、`VENDOR_LOCK.json`、`scripts/pack-mpd.ts` 都没有；存在的是散文——`docs/tui.md` 内引用的若干哈希，其中多处以 `…` 截断——不是准入库能读取的 digest。规则书把 digest 限定在 Verified 声明里，因此这**卡住的是声明，不是准入**。 |
| B. 声明完整性 | **PARTIAL** | 已满足：`requires.contracts` 只有一条可选契约 `tui.dsh/v1alpha1#DecisionEvents` 并写有回退；`permissions: []`；`subscriptions: []`；`contributes.commands: []`；两份清单都没有出现 `provides` 或 `requires.services`。 | **未满足：** `contributes.commands: []`，而 `/mpd` 与 `/mpd-model` 确实通过 harness 的 `commands` 服务注册，于是宿主的 effect ledger 把它们记为 `undeclared`——这是**更早的一次观察**，准入变成 `compatible` 之后并未复测；该实机边界记录在 [`tui.zh-CN.md` §6.4](./tui.zh-CN.md) 中。声明与行为仍然不一致。 |
| C. TUI 兼容性 | **PASS** | 两份清单在 0.18.0 与 0.19.0 上都协商通过（见上方 `result.json` 与 0.19.0 探针日志）；没有声明 `Backend` 贡献，因此 `TUI-BACKEND-001` 不适用；没有声明 remote attach，因此不欠远程 profile 测试。 | 本组内无缺口。`compatible` 是协商结果，不是实机挂载结果（§3）。 |
| D. 运行时行为 | **PARTIAL** | `apply` 是同步的——没有 `await`，也没有捕获 `ctx.root`；重复 activation 行为确定；清理归属由 `packages/mpd-tui-plugin/test/plugin.test.ts` 覆盖，该用例记录每个 disposer 并统计释放次数。 | **未满足：** `effectOn`（`packages/mpd-tui-adapter-plugin/src/index.ts`）把归属调用包在 `try` 加空 `catch` 里，于是无法拥有 effect 的 scope 会静默失败，而不是留下可诊断、可重试的状态；另外没有记录 activation 或 runtime generation id，已注册资源无法追溯到拥有它的 activation 实例。 |
| E. 清理与恢复 | **PARTIAL** | 文档这一半由 [`tui.zh-CN.md` §2.1](./tui.zh-CN.md) 补上：三种移除等级、一次移除实际撤销什么、以及按资源类别说明保留什么。 | **尚未自动化。** 固定的那套一致性矩阵（`evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/requirements-v0.15.json`）没有 `TUI-OBS-002` 行，`skills/dsh-qa/scripts/tui-spec-conformance.ts` 也没有对应的求值分支——未知 id 报 `blocked`。今天没有任何通道为 §2.1 背书。 |
| F. 信任与声明 | **PARTIAL** | `trusted-in-process` 披露用的是宿主自己的 `/plugin` 界面，不是我们的一句话；依赖闭包可复现（提交了 `bun.lock`，且已发布的依赖闭包不含安装脚本）。 | **未满足：** 本 bundle 有意不做任何一致性声明，因此 `TUI-CLAIM-001` 从未被行使；没有 provenance 或 attestation，而绑定声明所需的产物 digest 并不存在（§4 A 组）。 |
| G. 市场展示 | —（非作者职责） | 这是目录自己的展示规则：兼容性判定、验证等级与限制分开显示，未授权措辞会被拒绝。 | 不适用于本仓库。收录意味着什么、不意味着什么，见 §6。 |

## 5. 质量与安全红线

规则书的红线小节是五条；本波次把它们拆成七条可测规则，让每条都能带自己的判定。

| 编号 | 规则 | 判定 | 证据 |
|---|---|---|---|
| R1 | 不向宿主的 surface 事件流追加；模型可见面只走既有服务（工具、prompt 段、preset）。 | **PASS** | TUI 各界面通过宿主自己的服务接缝绑定（`ctx.get(id, false)` 再 `service.register(...)`），不向宿主事件流追加；两份清单都声明 `subscriptions: []`。 |
| R2 | 不注入凭证。 | **PASS** | 两份清单都不请求权限（`permissions: []`），两个 TUI 包内不含任何凭证引用（`apiKey`、`api_key`、`credential`）——接缝适配器只绑定宿主服务，凭证处理留在 harness 里。 |
| R3 | TUI 活动期间 stdout 保持安静：不打印 `console.log` 诊断；调试输出走 stderr 的 `DSH_TUI_DEBUG` 或 `DSH_TUI_RENDER_LOG`。 | **PASS** | 由 `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` 强制；其只减不增的清单（`SWEEP_INVENTORY`）已为空——原先冻结的十一个文件全部清理、条目逐条删除，若重新加回条目，门会变红。 |
| R4 | 长会话保持有界：per-session 状态在 `session/disposed` 时清理，而不是无限累积。 | **PASS** | 没有任何按会话累积的东西：workspace 根、团队视图与 home 目录都在每次调用时解析，从不缓存在模块级（`packages/mpd-tui-plugin/src/index.ts` 的 `apply`），唯一的进程级闩锁是一个布尔值。不存在随会话数量增长的 per-session 注册表。 |
| R5 | 用户数据只放在既有的 `~/.dsh-tui` 位置下。 | **FAIL** | 在它之外写了三个 home 根：`~/.mpd/workmate`（`packages/mpd-workmate-plugin`）、`~/.mpd/memory`（`packages/mpd-memory-plugin`）与 `~/.mpd/codegraph`（收养的 CodeGraph 服务器，第三方组件）；而本 bundle 自己在 `~/.dsh-tui` 下什么都不写。记录为偏差，不予修复：§5.1。 |
| R6 | 外部 JSON 一律校验；损坏时回退而不是崩溃。 | **PASS** | 每次外部读取都走"先校验、失败则回退"的路径；诚实的边界是：校验是结构性的（形状与类型），不是 schema 校验。 |
| R7 | 插件配置与文件内容按不可信输入处理，尤其是进入渲染路径的字符串：宽度按 terminal cell 计，绝不依赖 `string.length`。 | **PASS\*** | `*` 声明的边界：`cellWidth` 按码点计，每个码点算一格，其 `WIDE` 表只覆盖 BMP 内的东亚宽字符与全角区间，因此落在这些区间之外的 emoji（🚀，U+1F680）与组合附加符号各算**一格**——这类字符串的排版会被少算，本条规则只在它覆盖的区间内成立，并非无条件通过。`cellWidth` 位于 `packages/mpd-tui-plugin/src/sanitize.ts`，是渲染路径使用的宽度原语；规则落地时记录在案的两处 `.length` 别名仍留在树里，今天无害——本波次只是记录，没有重新推导，也不构成加第三处的许可。 |

### 5.1 R5：`~/.dsh-tui` 之外的用户数据——一项记录在案的偏差

R5 失败，本波次不修复它。2026-11-06 的用户决定把它记录为已知偏差，并写明理由：

- **本 bundle 是多端的。** 一次安装同时提供 Web GUI 界面、DSH-TUI 界面与 dsh-Go 原生界面。它的状态根
  服务这三个端，不是 TUI 专属状态。
- **它早于 TUI 生态。** 自 0.1 起 `~/.mpd` 就是本 bundle 自己的命名空间，workmate 库与 memory 存储
  这些用户数据本来就住在那里。
- **挪走会破坏既有工作。** 把 `~/.mpd/workmate` 与 `~/.mpd/memory` 移到 `~/.dsh-tui` 下，会让所有
  既有的 workmate 库与 memory 存储失联——而这条规则管的是位置，不是行为。

这是偏差，不是被无视的缺陷：规则确实未满足，本页明说，任何地方都不声称符合 `~/.dsh-tui`。如果这条
规则将来变成硬门，需要三件事一起变：三个插件的数据根改由同一个可配置根解析、默认指向 `~/.dsh-tui`；
提供迁移路径，把既有的 `~/.mpd/workmate` 与 `~/.mpd/memory` 搬到新根；收养的 CodeGraph 服务器——第三方
组件，不是我们的代码——的索引根要跟随该覆盖值，而不是写死 `~/.mpd/codegraph`。在这三件都落地之前，
收录或 `compatible` 判定都不能被读成 `~/.dsh-tui` 一致性。

## 6. 本 bundle 不声明什么，以及目录条目如何取得

把明确的"不声明"写下来，读者就不必自己推断：

- **没有 Verified 声明。** 两份清单、`dsh-distribution.json`、`VENDOR_LOCK.json` 与
  `scripts/pack-mpd.ts` 里都没有打包插件产物的 digest。规则书把 digest 限定在 Verified 声明上，因此
  没有发布任何 claim 产物，也不得暗示有。
- **没有 `Backend` 贡献。** 未声明 `tui.dsh/v1alpha1#Backend` 契约，因此 `TUI-BACKEND-001` 不适用，
  也没有 backend picker 条目。
- **没有 remote attach。** 未声明远程 Presentation 或挂载模式，因此不欠远程 profile 测试，也没有跑过。
- **没有 `~/.dsh-tui` 用户数据。** R5 失败（§5.1）。本 bundle 写的是 `~/.mpd/workmate`、
  `~/.mpd/memory` 与 `~/.mpd/codegraph`。
- **没有包形一致性。** 两处偏差是记录而非修复：根 `engines.node` 是 `>=22.18`，而规则书写
  `^22.19 || >=24`；并且没有 `peerDependencies["@deepseek-ai/cordis"]`，该偏差记录在
  `packages/mpd-tui-plugin/dsh-plugin.json` 的 `x-mpd-tui-package` 下并写明理由（这是一个私有的
  工作区内包，从不单独安装，且按名字引第二个 `cordis` 是被禁止的）。
- **没有 TUI-OBS-002 自动化。** 固定的那套一致性矩阵
  （`evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/requirements-v0.15.json`）没有 `TUI-OBS-002`
  行，`skills/dsh-qa/scripts/tui-spec-conformance.ts` 也没有对应求值分支，未知 id 报 `blocked`。
  [`tui.zh-CN.md` §2.1](./tui.zh-CN.md) 是这条要求的人工答案；通道不为它背书。
- **没有生态评审。** 没有任何生态机构读过本页。`compatible` 是针对已安装宿主准入库的一次测量，
  仅此而已。

**目录条目如何取得。** 收录层属于生态自己的仓库（`dsh-tui-ecosystem/dsh-tui-ecosystem`）：在其
`plugins.json` 里一个插件一个对象，通过 pull request 提交。本仓库把条目暂存在
`docs/market/dsh-tui-ecosystem-entry.json`，以便提交前在树内评审字段；权威副本在目录仓储里。
pull request 会跑的五个检查（规则书 2026-10 口径）：

1. `plugins.json` 是合法 JSON，且 `plugins` 是数组。
2. 每条都带七个必填字段——`name`、`displayName`、`description`、`author`、`repo`、`kind`、
   `addedAt`——且 `kind` 只能是 `plugin`、`template`、`core`。
3. `repo` 形如 `https://github.com/owner/repo`，插件名与仓库地址都不重复（大小写不敏感）。
4. **新增**条目：仓库真实存在且公开，pull request 作者是该仓库的 owner 或 collaborator。
5. **新增**条目：仓库 README 里有指向 dsh-TUI 的链接（`https://dshtui.com` 或主仓地址）。

这五条里有两个坑：校验器会先把 README 转小写再匹配，所以大小写随意，但链接必须是真链接而不是一句
提及；README 读的是仓库的**默认分支**——本仓库是 `master`——而不是准备条目所在的分支。

五条**不查**什么，与查什么同样重要：npm 上有没有发布、包名是裸名还是 scoped、有没有
`dsh-plugin.json`、manifest 能不能解析、有没有 provenance 或 attestation、声明了哪些能力与权限。
正因如此，规则书写下 收录 ≠ 准入 ≠ 背书：一个条目只说明仓库公开、作者本人提交、README 回链了本
产品——它不为本页的检查清单背书，也不代表 dsh-TUI 或生态组织对本 bundle 的功能、质量或安全作任何
担保。

## 7. 门禁：硬需求，而不是一份报告

`node scripts/verify-tui-admission.ts` 把本页中机器可判定的部分变成失败。它有独立的脚本行
（`bun run verify:tui-admission`），并且是聚合静态门（`bun run verify:gates`）的成员：树一旦偏离本页，
门就会变红，不需要谁再读一遍本页。

**它硬性判失败的内容。** 静态臂只读本仓库自己的字节，判定 §4 与 §5 中机器能判定的条目：`$schema` 是
绝对 URI，且其版本标记与 `manifestVersion` 0.15 一致；id 稳定，两份清单一致，且两份清单的 licence、
facet `apiVersion`、permissions 与契约坐标也必须一致；`facets.host` 同时给出 entry 与 `apiVersion`，
且 entry 能从清单自身目录解析；不出现 `client`/`worker` facet；licence 文件与源码仓库可定位；每个
optional 契约都带书面 fallback，且不出现 `provides`/`requires.services`；`permissions`、
`subscriptions`、`contributes.commands` 均声明为数组，且不声明任何在 TUI 源码里从未使用的权限；TUI
平面不出现凭证引用、不出现 `console.log`；`subscriptions` 保持为空——R1 的 PASS 正建立在此；宽度原语
是 `cellWidth`；§5.1 记录的三个 `.mpd` 用户数据根仍在写入。每条臂都在输出里报出自己的规则 id，因此
红色记录会直接指出本页哪一段变了。

**它不判定的部分会被打印，绝不会被省略。** 机器无法判定的分组（D 的运行时残留、E 的清理自动化、
F 的信任声明、G 的展示规则）以 `BOUND` 报告。其中两项还会被复核，因此不会静默过期：本页点名的
`effectOn` 吞掉异常必须仍然存在，固定的那套一致性矩阵必须仍然没有 `TUI-OBS-002` 行——任一变化，
门就失败，本页必须同步修改。

**宿主臂跑宿主自己的链路。** 装了宿主时，两份清单的字节都先过宿主自己的 `parseManifest`（绝不用
`JSON.parse` 顶替），再过宿主的 `loadSpecData` 及其 registry 自检、`createContractIndex`、
`validatePlugin`、`projectManifest`，最后用宿主自己的 `buildLegacyHostDescriptor`（由
`HOST_SUPPORTED_CONTRACTS` 构建）跑 `negotiate`。两份清单都必须回答 `compatible`。

**跳过永远不是通过（D5）。** 宿主发现顺序是 `MPD_DSH_TUI_HOST`、`DSH_TUI_ROOT`、
`<DSH_HOME>/profiles/*/node_modules/@deepseek-harness-tui/dsh-tui`、`~/.dsh` 下的同一路径，以及 PATH
上的 `dsh-tui` 启动器。一个都解析不到时，门会打印它试过的每个候选与补救命令，并以 **3** 退出——
NOT PASSED，绝不渲染成绿色的跳过。`--static-only` 出于同样理由退出 3。

**自检不需要宿主。** `node scripts/verify-tui-admission.ts --self-test` 不需要宿主：它在随包树上跑静态
臂，然后用同一条 spawn 路径跑两次——一次喂故意损坏的 fixture（必须以非零退出且规则变红），一次喂随包
清单（必须以零退出）。这一对就是负向对照，并且对照记录会打印在报告里。

**R5 是一项具名允许。** 门把 §5.1 打印为 `ALLOWED-DEVIATION` 并写明理由，绝不打成 PASS，同时复核记录：
某个根不再被写入、出现 `~/.dsh-tui` 下的写入，或某份文档丢掉这项偏差，门都会失败。R5 仍然是对规则
的未满足；门让它成为一项不会静默腐烂的未满足。

**写入扫描有一条明说的限制。** `~/.dsh-tui` 那一臂是**按行**扫描的：只有当一次会写盘的调用与一个
`~/.dsh-tui` 路径出现在**同一行**时它才会失败，所以跨行拼出来的写（例如路径在一句里构造、传给另一句的
`writeFile`）可以绕过它。它是针对明显违规形态的绊线，而不是「不存在这种写」的证明；R5 的允许偏离靠的是
**已记录的根目录**这一事实，不是靠这一臂。

**诚实的边界。** 这是静态准入检查加宿主自己的协商。它不是实机 TTY 挂载，不跑宿主的 `/plugin check`
（那是 §1 里的 QA 用例），也不记录任何产物 digest，因此它打印的任何内容都不是 "Verified" 声明（§6）。
它协商所用的描述符是宿主的 legacy 兼容描述符，不是实机探针证据。
