# 上游对齐台账 —— my-power-dsh 专家体系与钉定基线的对齐
[English](./upstream-parity-ledger.md) | **中文**

> 波次：`omo-parity-align`。状态：**已验证 —— 取值已冻结、实现已落地、门禁全绿（§8）。**
> 本文件是本次功能对齐波次的持久人类面向台账，对齐对象为上游
> `/root/dshProj/oh-my-openagent` @ `v5.0.0-beta.62`（HEAD `d1557a4b4`）。本仓库基线仍钉在
> 上游 `8c57e46` / `v5.0.0-beta.20`（`VENDOR_LOCK.json`）；本次只做**功能**参考，绝不重新 pin。
>
> 历史记录类文档豁免双语要求（AGENTS.md `L18–L23`）。此前的 `docs/omo-parity-gap.md`
> 即属此类：**单语且本波次不改动**。它没有被取代 —— 它是本台账的输入之一。

> **基线状态 —— 0.1.7-rc.2。** 本台账冻结的是 `omo-parity-align` 波次，其对象是内置的
> `agent-teams` 插件，而它现已**从组合中退役**（没有任何 loader 行挂载它）。它的配置键
> （`sessionTeamPolicy.mode`、`sessionTeamPolicy.autoRoute`）、它的团队
> 工具与它的 staged 团队流程都不再存在于随包会话中。迁移中**存活下来**、也是读者应当带走的东西，是**门禁
> 语义**：同一个冻结谓词 `trigger = explicit flag OR (matchedSignals >= 1)` 仍在会话第一个
> pre-step 求值，其通知仍带标记 `[AgentTeams] Session-start team rule`。门现在是**默认机械执行**
> （实现已迁入 `mpd-roles-plugin`，架在官方插件的接缝上）：一旦触发，它会 **stage** 一个可批准的
> plan shell —— 0 成员、0 任务，经本 bundle **自己**的 `agent_teams_plan` 工具 —— 并注入**一条**
> 通知，点名该调用返回的 plan id；此时**没有 spawn 任何东西**，该 shell 在 captain 用
> `add_member` / `create_task` 扩展并用 `agent_teams_plan {action:"approve"}` 批准之前保持**惰性**。
> `mpd.jsonc` 的 `team.gate` 选择 `mechanical`（默认）| `advisory` | `off`；在 `advisory` 下（或该工具
> 未挂载时），那**一条**通知改为建议式并声明 `NO team was staged`。见 `docs/plan-0.1.7-adaptation.md` 与
> AGENTS.md §1。下文其余内容是该波次的冻结记录，按历史来读 —— 包括 `D_AUTOROUTE_ADVISORY` 决策与
> `D_planArtifact` 信号行，二者均已于 2026-10-07 被取代（见信号表下方的日期注记）。

冻结取值的唯一真源：`evidence/omo-align/requirements/frozen-contract.json`（由队长维护）。
研究输入：`evidence/omo-align/research/team-vs-mass-ulw/gap.json`（t2）与
`evidence/omo-align/research/session-policy/output.log`（t3）。需求门：
`evidence/omo-align/requirements/verdict.json`（t1）、`verdict-r2.json`（t10）、
`verdict-r3.json`（t11）、`verdict-r4.json`（t12）。

## 1. 用户诉求

| # | 目标（用户原话） | 冻结决策 |
|---|---|---|
| G1 | 功能上对齐钉定的上游基线（beta.62） | `D_UPSTREAM_REF` —— 仅作参考，不重新 pin |
| G2 | agent-teams 不再作为默认存在，复杂任务时自动调用 | `D_FIRST` + `complexityGate` |
| G3 | 功能对齐 mass-ulw | 保留任务板模型，补 4 项语义（M1–M4） |
| G4 | 只对齐功能（不照搬结构/命名） | 手动入口名冻结；上限沿用本地取值 |
| G5 | 手动调用的指令名保持不变 | `manualEntryNames` |
| G6 | 技能语料：先调研 + 设门禁，再问用户 | t4 + t8 + 条件任务 t9 |
| G7 | 持久双语差距台账 | `D_LEDGER`（即本文件） |
| G8 | 仓库流程：feature 分支 + 证据同提交 + 全量门禁 + `--no-ff` | `isolation` + `requiredQaCases` |

## 2. 冻结决策

| Id | 决策 | 依据 / 证据 |
|---|---|---|
| `D_FIRST` | 每个符合条件的会话启动时**不建队、不注入通知**，除非复杂度信号命中。 | 对齐上游默认而非本地口味：上游 `team_mode.enabled` 默认为 `false`（t3 `[U2][U3]`）。 |
| `D_AUTOROUTE_SPLIT` | 机械门与旧的注入模式**解耦**：`sessionTeamPolicy.mode` 默认 `off`（枚举值全部保留）；新机械门是独立键 `sessionTeamPolicy.autoRoute`（默认启用）。 | 上游**没有**复杂度启发式（t3 全文 0 处 heuristic/threshold），其激活靠显式关键词。解耦可在新增门的同时不悄悄改变 `off`/`instruct` 的既有语义。 |
| `D_AUTOROUTE_ADVISORY` | 自动路由命中后**不建任何团队**：门只注入**一条**咨询通知（标记仍为 `[AgentTeams] Session-start team rule`），点名命中的信号、明确说明**没有团队被 staged**，并要求 captain 只在工作确实需要团队时才用官方 `spawn_teammate` + `team_task_create` 建队（本波次当时是该插件自己的建队工具，带 `approval="required", profile="mpd"`，现已不存在），否则继续单独执行并说明。显式 `team:`/`!team` 标记同样只是**咨询**，不会为它预建任何东西。 | 用户第 4 条（2026-09-17）：仅仅在判断复杂度，不应让用户先付出「已 staged 团队 + 一次审批」的代价。咨询措辞刻意不排斥自动批准，因为 ULW 运行会自行建队（冻结契约 §4.3）。 |
| `D_SKILLS_WRITER` | 本波次 `skills/**` 的**唯一**写者是 `t5`，且仅限 `skills/dsh-qa/SKILL.md` 与 `skills/dsh-qa/scripts/session-start-team.ts`。`t9` 本波次不写入。 | AGENTS.md `§9`：每波单写者；`skills/**` 变更会使语料 `treeSha` 失效，re-pin 必须与之同提交。基线：`afe718251965a933b6a15b40bbe6ebf2e5222996fecb48b05fc8e770e390fcad`，328 个文件。 |
| `D_LEDGER` | 台账 = `docs/upstream-parity-ledger.md` + `docs/upstream-parity-ledger.zh-CN.md`，同提交，标题下直接放语言切换链接。`docs/omo-parity-gap.md` 与既往报告不动。 | 用户裁决 6；AGENTS.md `§3` 双语规则及历史记录豁免。 |
| `D_UPSTREAM_REF` | 上游参考为 beta.62（`d1557a4b4`）；仓库基线仍为 beta.20。 | 用户裁决 1；AGENTS.md `§9`（不追上游）。 |

## 3. 复杂度门（构造即可证伪）

`trigger = anyExplicitFlag OR (matchedSignals >= 1)`

信号编号：**A** 硬，**B/C/D** 软。**C 只算一个信号**，且仅当其三个子信号中至少两个成立时才命中，
因此 `C1`/`C2`/`C3` 从不作为独立顶层信号。

| Id | 类型 | 判定 |
|---|---|---|
| `A_explicitFlag` | 硬 | 去掉首尾空白后的用户文本以 `team:` 开头，或包含 `!team`（大小写不敏感）；命中的前缀被消费、不计入目标文本 |
| `B_deliverableVerbs` | 软 | `align\|migrate\|refactor\|audit\|overhaul\|port\|rewrite\|consolidate\|对齐\|重构\|迁移\|审计\|移植\|梳理\|全量` 去重后 ≥ 4 个 |
| `C_enumeratedSteps` | 软 | **三取二**即命中：`C1` 编号/项目符号行（`^\s*(\d+[.)]\|[-*])\s`）≥ 3 行；`C2` 去重动作动词 ≥ 3 个；`C3` 动作子句（动词带宾语，编号与否皆可）≥ 3 个 |
| `D_planArtifact` | 软 | 首个 pre-step 时，会话工作区存在 `.mpd/plans/*.md` |

> **已于 2026-10-07 被取代 —— 信号 `D`，以及随之而来的"仅咨询"决策。** 上表 `D_planArtifact` 行是本
> 波次的冻结记录，**原样保留**作为历史；实际发布的谓词不再探测 plan 文件。**`D` 是该工作区存在正在进行
> 的 boulder 工作** —— `.mpd/boulder.json` 中的 `status: "active"` —— 因为按文件探测在本工作区的**每个**
> 会话都会触发：一个 plan 文件会比产生它的工作活得更久。仅有 plan **文件**不再构成信号。
> 同一天也取代了 `D_AUTOROUTE_ADVISORY`（见上）：触发不再只是建议 —— 默认模式会通过
> `agent_teams_plan` **stage** 一个可批准且惰性的 plan shell，由 captain 批准；而那**一条**建议式通知
> 及其 `NO team was staged` 文案，作为 `team.gate: "advisory"` 的降级路径保留下来。权威来源：AGENTS.md §1、
> `presets/mpd.patch.yml` 与 `packages/mpd-roles-plugin/README.md`。

**动词表已和谐化（行为变更，R3）。** `C2` 与 `C3` 现共用**同一**动词集：英文 14 个 —— `add, align,
audit, build, change, check, consolidate, implement, migrate, overhaul, port, refactor, rewrite,
verify`；中文 12 个 —— `设计, 实现, 验证, 改造, 补充, 对齐, 重构, 迁移, 审计, 移植, 梳理, 全量`。两者只差
**角色**：`C2` 统计文本中任意位置出现的动词，`C3` 统计以动词**开头**的子句。R3 之前 `C2` 缺 `audit`、
`C3` 缺 `consolidate|overhaul|port`，中英两表还差 7 条 —— 这些不对称已全部消除，不再有某个动词只属于
`C2` 或只属于 `C3`。

**为何阈值是 1（Option A）与已接受的代价。** 「两个计数信号」的门槛已被**取代**
（`complexityGate.logicRevisionNote`）：冻结的 complex 提示 #1 与 #3 完全不携带 B/D/标记，C 是它们
唯一的信号，`>= 2` 会让门对不上它自己冻结的预期。因此一个满足的 C 自身即可触发。**已接受并已登记的
代价：** 形如「Check the test, build the package, verify the output.」的多子句请求会满足 C（C2+C3）
从而**确实**进入建队路径；仅凭 C 上的任何规则都无法把它与冻结的 complex #1 区分开。详见 §7 `O1`
与 §8 的误触发实测。

*冻结波次记录。已于 2026-10-07 被取代 —— 默认模式现在会通过 `agent_teams_plan` **stage** 一个可批准的
plan shell，由 captain 批准；见信号表下方的日期注记。*

命中后门现在只**咨询**（`D_AUTOROUTE_ADVISORY`）：不建任何团队，只注入一条咨询通知
（标记 `[AgentTeams] Session-start team rule`），点名命中的信号并明确说明**没有团队被
staged**；captain 只在工作确实需要团队时自行用官方
`spawn_teammate` + `team_task_create` 建队，否则继续单独执行并说明。
显式 `team:` / `!team` 请求同样只是**咨询** —— 智能体被告知去建队，不会为它预建任何东西。
（本波次当时的调用是该插件自己的建队工具，带 `profile: mpd, approval: required`、名称
`MPD Default`、并由用户在 Web 计划上批准；那个工具与那套 staged 计划流程属于已退役的插件，
在随包会话中都不存在。）

**三向测试（冻结契约中的 `testPrompts` + 本波次 QA 用例）。** 每个 `simple` 提示必须使
`.mpd/team` 为空且日志中无启动通知；每个命中**软信号**的 `complex` 提示必须使 `.mpd/team`
为空，同时携带恰好一条咨询通知；显式 `team:` 提示仍必须恰好产生一个 staged 团队与一条通知。
任一侧未观察到即 `FAIL`，且**无法失败的门不被接受**。每一侧都必须跑在同一稳定修订 hash 上，
且在沙箱工作区中（`sandboxWorkspace` + `assertSessionsSandboxed`）。

**真实普通提示上的触发率实测（t37 测、t40 复核）。** 从本仓库自己的会话日志抽取 20 条真实普通提示
（全部含中文；其中 5 条为 session-start —— 门真正评估的唯一分层 —— 另 15 条为后续追问），用门自身
导出的判定式逐条回放：**0 条触发**（session-start 0/5、follow-up 0/15），因此「每 N 条一次无谓审批」
在该样本中**不存在有限 N**。误触发占比的 95% 上界为整体 **13.9%**（n=20）、仅 session-start 分层
**45.1%**（n=5，Clopper–Pearson 单侧界；「三倍法则」口径分别为 15.0% 与 60.0%）。同一样本中可观察到的
代价恰好相反：最丰富的一条 session-start 提示只命中 1 个去重 B 动词（`对齐`，阈值 4）与 1 个去重 C2
动词（阈值 3），因此零信号。原始数据：`evidence/omo-parity-rate/`（`raw/prompts.jsonl`、
`raw/probe-output.json`，并在 `evidence/omo-align/ledger-fix/` 中重跑）。

## 4. mass-ulw 对齐（保留任务板模型）

下列 Id 取冻结契约（`massUlwSemantics.items`）；其 `policy` 措辞为准，本台账仅作索引。

| Id | 语义 | 冻结断言（原文） |
|---|---|---|
| `S1` | 节点级重试 | “a terminal failed task can be retried without discarding the tasks that already completed” |
| `S2` | 定义修订不重跑已完成工作 | “amending a task definition re-runs ONLY the changed task and its TRANSITIVE DEPENDENTS. A completed node whose own definition is unchanged AND none of whose transitive dependencies were changed/added/xor-moved keeps its cached result — that is the 'completed nodes are not re-run' guarantee. A completed DEPENDENT of an amended task IS re-run, because its input changed” |
| `S3` | 跨重启 resume | “a run interrupted by process exit resumes from persisted state instead of restarting finished tasks” |
| `S4` | 运行中纠偏 | “a running member can be steered back into its scope with a bounded notice, without restarting the attempt” |

> **`O5` 已闭合（已和解，而非悬置）。** 早期措辞「及其依赖方」看起来与用户裁决「已完成节点不重跑」
> 冲突，本台账此前也把它写成未决冲突。冻结契约的 `S2.resolves` 已给出结论：不重跑保证的作用域被限定为
> **传递输入未发生变化**的节点，因此自身定义与其传递依赖都未变的已完成节点保留缓存结果，而被修订任务
> 的**已完成依赖方**因其输入已变**确实**会重跑。两种措辞不再冲突；上表 `S2` 行逐字引用冻结断言。
>
> 有一项限制如实记录而非略过（`S2.evidenceProvenance`）：冻结所引用的上游协议文档在本仓库中**并不
> 存在**，因此本地读者只能核对上面这段无矛盾的措辞，无法核实那条上游引文。

## 5. 手动入口名（该波次冻结 —— 见基线横幅）

当时禁止重命名下列名称；**允许新增**。下面的团队条目描述的是已退役的插件，作为该波次的记录保留。

- 斜杠指令：`/agent-teams`、`/agent-teams-mpd`（来自 `AGENT_TEAMS_COMMAND = 'agent-teams'`
  与 `profileCommandName('mpd')`，`lib/command.ts:3,24-34,95-111`）—— **随插件退役；随包会话中
  不存在 `/agent-teams` 命令**
- 工具：团队工具全套 —— **随插件退役；团队工作跑在官方的 `spawn_teammate` / `team_*`
  工具上**
- 键：`profiles.mpd`（随插件退役）；preset id `mpd`（**仍然随包提供**，现在由
  `presets/mpd.patch.yml` 的 `preset-mpd` 行声明）

## 6. 文本落点（会话启动团队规则的落点）

**这些落点属于已退役的实现**（它们点名的是那个插件的文件与它的 `sessionTeamPolicy` 块）。门禁
本身在迁移中存活并迁入 `mpd-roles-plugin`；当前落点在 `docs/plan-0.1.7-adaptation.md` 与
AGENTS.md §1 中列出。

| Id | 文件 | 区域 |
|---|---|---|
| `L1` | `cordis.patch.yml` | agent-teams row `sessionTeamPolicy` 块及其注释（已退役 —— 不存在该行） |
| `L2` | `packages/mpd-agent-teams-plugin/lib/session-start.ts` | `policyQualifies` 谓词 + `advisoryNotice` / `provisionedNotice` / `instructNotice` 文本（保留代码，未挂载） |
| `L3` | `presets/mpd/agent.cordis.yml` | `SESSION STARTUP RULE` 段与 sizing doctrine 的位置（已退役路径；预设现在位于 `presets/mpd.patch.yml`） |
| `L4` | `packages/mpd-bundle/README.md` | 整个 `Session-start team gate (binding)` 节 |
| `L5` | `packages/mpd-bundle/README.zh-CN.md` | 整个 `会话启动团队门（强制）` 节（与 `L4` 同提交） |
| `L6` | `scripts/install-profile.ts` | row 配置与其 `--self-test` 断言（现同时钉住 `mode === "off"` 与 `autoRoute === true`） |
| `L7` | `skills/dsh-qa/SKILL.md` | `session-start-team` 用例行 |
| `L8` | `skills/dsh-qa/scripts/session-start-team.ts` | `assessTeamState` 反转为双向断言 |
| `L9` | `AGENTS.md` | 启动规则段与描述旧行为的 delta 表行 |

冻结契约的 `changeLocations.items` 为准，共列 **10** 项：上表之外还有
`packages/mpd-agent-teams-plugin/lib/index.ts`（config schema 与解析后的默认值）与
`packages/mpd-agent-teams-plugin/self-fix-tests/**`（仅当 lib 行为体在已注册的 `mpd-delta`
区域内改动时）。bundle 的 EN/ZH 两个 README 在该列表中计为两项。

**不新建 `AGENT.md`**：启动条款落在 `AGENTS.md` 及上述落点。

## 7. 未决 / 待办项

此处的「未决」指**等待用户裁决或后续波次**，而非「未验证」。本波次承诺关闭的实现入口均已在 §8 实测
关闭；下表逐条给出终态。

| Id | 事项 | 状态 |
|---|---|---|
| `O1` | 复杂度门标定 | 当前为冻结默认值而非实测最优。实测已执行（t37 测、t40 复核）：20 条真实普通提示中门**0 次**触发，即已接受的误触发路径在样本中未发生；同一样本里可观察到的代价方向相反（一条确实复杂的 session-start 提示零信号）。用户仍可调整一次；判定用的数字见 §3 与 §8 |
| `O2` | 技能语料（mass-ulw / dag-library / hyperplan）是否移植 | 仅在 t8 门禁报告后决定（用户要求）—— 仍在等用户裁决；本波次不移植任何语料 |
| `O3` | t4 的 `D10-recovery` 覆盖 | **已闭合 / 已记录 `uncertain`。** t2 实测 `retry`×8、`revision`×2，但 `resume`×1、运行中纠偏×0；覆盖偏薄连同其理由（仅观测到一次 `resume`、未观测到运行中纠偏）记录于此，不再静默省略 |
| `O4` | `session-start.js` 的残留冲突 | **已闭合。** 在 `D_FIRST` 下 shipped 判定式没有无条件注入通知的路径：`trigger = anyExplicitFlag OR (matchedSignals >= 1)`，且 `mode: "off"` 意味着既不自动建队也不无条件注入通知。双向用例实测 3/3 普通提示静默（见 §8） |
| `O5` | `S2` 冻结措辞与用户裁决的冲突 | **已闭合 / 已和解。** 不重跑保证被限定为传递输入未变化的节点，因此被修订任务的已完成依赖方因其输入已变**会**重跑 —— 见 §4。冻结所依据的上游引文在本仓库中不存在，该限制已如实记录而非略过 |
| `O6` | 台账 Id 标注 | 冻结契约把复杂度信号标为 `A/B/C/D`、mass-ulw 语义标为 `S1–S4`；此前需求轮次把后者标为 `M1–M4`。本台账以契约为准；契约取值未变 |

## 8. 验证状态

下列门禁均在**本工作树内真实执行**（不是从计划照抄），原始输出保存在
`evidence/omo-align/ledger-fix/gates/<gate>.log`，并在 `evidence/omo-align/ledger-fix/result.json`
中以 sha256 钉住。

锚定：本次执行开始时 `HEAD = 3096455`，执行期间工作树推进到 `HEAD = e89fa2a`
（队长并发落盘了本波次的提交），因此下列**内容** hash 才是精确锚点。该窗口内本波次的冻结取值与门
代码逐字节未变：

| 锚点 | sha256 |
|---|---|
| `evidence/omo-align/requirements/frozen-contract.json` | `09949c8095d7ccd533329b114a2ef22bad1ce81bd24338240e68cfd0fd66be41` |
| `packages/mpd-agent-teams-plugin/lib/session-start.ts` | `8cfaef47e9959ef7def01003640f768ff4befa50e9c202ff692a0629ca0a2aa6` |
| `packages/mpd-agent-teams-plugin/lib/state.ts` | `751a4c1eaf1714d37a45baa8c0a83895ee8e2a487f28574d02fd445cd1b8b825` |
| `evidence/omo-parity-rate/raw/prompts.jsonl` | `123dca67e738f85e08a0043c6a33a686d1e91e31e9dbe0568437437414e5f9b5` |
| （历史）`packages/mpd-agent-teams-plugin/lib/{session-start,state}.ts` | 上面两行 pin 是**历史锚点**，不是当前值：TypeScript 转换波次把这两个文件由 `.js` 改名为 `.ts`，并为 adopted body 加了首行 `@ts-nocheck`，因此今天的字节**有意**不同。当前值：`session-start.ts` `f6f73d0b4248141bf5c2e8305b0b26a935460fbfd2dc909d552ba39dad82d920`，`state.ts` `f8c0cb5d8945cd73f92f47fdff977ba58ac0ddc6f36142a7c3e4a5b74878fe4d`（`evidence/ts-cordis-conformance/`）。 |

| 门禁 | 命令 | 状态 |
|---|---|---|
| typecheck | `bun run typecheck` | 已验证（退出码 0） |
| 插件测试 | `bun test packages/mpd-agent-teams-plugin` | 在该锚点已验证（161 通过 / 0 失败，42 个文件）。**当前树（v0.9.1）：** 220 通过 / 0 失败、60 个文件 —— 插件新增了 dispatch-stall 回归与 region 钉定测试套件（`evidence/agent-teams/dispatch-stall/`），并在 v0.9.1 加入了 pool-capability 守卫（`self-fix-tests/pool-capability-guard.test.ts`；region 46 → 48） |
| QA 自检 | `bun run test:qa` | 已验证（退出码 0，全部自检通过） |
| 运行时启动 | `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` | 已验证（PASS：一条命令安装、home 无副本、卸载无残留） |
| 双向门控用例 | `bun skills/dsh-qa/scripts/session-start-team.ts` | 在该咨询前锚点已验证（PASS：simple 3/3 静默、complex 3/3 恰好一个 staged 团队 + 一条通知、反向控制 disarmed = true）。**对当前代码树已被 `D_AUTOROUTE_ADVISORY` 取代：** complex 一侧须断言 0 个 staged 团队 + 一条咨询通知，显式标记一侧须断言恰好一个 staged 团队；该重跑属于本波次 QA 用例（`L7`/`L8`） |
| preset/patch 行 | `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | 已验证（30 条 harness 行合规、行对齐 31/31） |
| 安装器 | `node scripts/install-profile.ts --self-test` | 已验证（退出码 0） |
| vendor | `node scripts/verify-vendor.ts` | 在该锚点已验证（PASS；该波语料的 re-pin 已落盘）。**当前树已被 v0.9.0 取代：** 扩展波新增了 `skills/dsh-qa/SKILL.md` 行与三个 `extension-*.mjs` QA 案例，故 skills 资产重钉为 `fileCount: 301` / `treeSha: 0dd4a6ee68e0a11499f2b502873016d066cface6b59036147bca066433b4b576`，闸门再次 PASS —— 见 `VENDOR_LOCK.json` 与 `evidence/release/v0.9.0-integration/` |
| 触发率实测 | `node evidence/omo-parity-rate/raw/probe.ts --json` | 已验证（20 条真实普通提示、0 条触发；锚点与逐条判定可复算 —— 见 §3） |

本台账与其记录的变更**在同一提交内更新**；无证据的通过不算通过（AGENTS.md `§2.3`、`§4`）。
