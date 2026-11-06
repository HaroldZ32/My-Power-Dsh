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

**2026-11-06T02-09-20Z 针对已安装宿主 `@deepseek-harness-tui/dsh-tui` 0.18.0 实测：两份清单
都回答 `validatePlugin: ok` 与 `negotiate: compatible`。**

| 清单 | SHA-256（截断） | `validatePlugin` | 协商 |
|---|---|---|---|
| `dsh-plugin.json`（bundle 根） | `b807ad68…` | `ok` | `compatible` |
| `packages/mpd-tui-plugin/dsh-plugin.json` | `2354afb9…` | `ok` | `compatible` |

两个结果来自同一次运行，走的是已安装宿主自己的链路
`loadSpecData -> createContractIndex -> validatePlugin(index, manifest) -> negotiate(index, manifest,
legacyHostDescriptor, [])`，由我们的探针包装，并由本仓库自己的工具交叉印证：

```sh
bun skills/dsh-qa/scripts/tui-admission.ts --static-only
node evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/probe-negotiation.mjs
```

两者退出码均为 0。2026-11-06 这次是下面那次权限改动之后的复测；2026-11-03 那次才是改动所针对的
测量。

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
| B. 声明完整性 | **PARTIAL** | 已满足：`requires.contracts` 只有一条可选契约 `tui.dsh/v1alpha1#DecisionEvents` 并写有回退；`permissions: []`；`subscriptions: []`；`contributes.commands: []`；两份清单都没有出现 `provides` 或 `requires.services`。 | **未满足：** `contributes.commands: []`，而 `/mpd` 与 `/mpd-model` 确实通过 harness 的 `commands` 服务注册，于是宿主的 effect ledger 把它们记为 `undeclared`。这一点已写在 [`tui.zh-CN.md` §6.4](./tui.zh-CN.md) 中；声明与行为仍然不一致。 |
| C. TUI 兼容性 | **PASS** | 两份清单在 0.18.0 上协商通过（见上方 `result.json`）；没有声明 `Backend` 贡献，因此 `TUI-BACKEND-001` 不适用；没有声明 remote attach，因此不欠远程 profile 测试。 | 本组内无缺口。`compatible` 是协商结果，不是实机挂载结果（§3）。 |
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
| R7 | 插件配置与文件内容按不可信输入处理，尤其是进入渲染路径的字符串：宽度按 terminal cell 计，绝不依赖 `string.length`。 | **PASS** | `cellWidth` 位于 `packages/mpd-tui-plugin/src/sanitize.ts`，是渲染路径使用的宽度原语；规则落地时记录在案的两处 `.length` 别名仍留在树里，今天无害——本波次只是记录，没有重新推导，也不构成加第三处的许可。 |

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
