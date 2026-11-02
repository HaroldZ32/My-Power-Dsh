# mpd-autoproject-plugin
**中文** | [English](./README.md)

Plan C / C2 — 在 DSH subagent seam 上的固定策略 autoproject 引擎（v2，取代已退役的 loop 引擎）。该纪律只有一条命令与一个工具：`/autoproject` 与 `mpd_autoproject`。

## 命令

- `/autoproject <objective>` —— 为该目标注入 autoproject 激活指令并启动运行；空输入返回用法。
- 无命令界面（headless）：纯文本 `/autoproject …` 消息会在插件的 `agent/pre-step` 边界被识别，并收到同一条指令。

## 自主策略（由激活指令携带）

被激活的 autoproject 运行自主执行，**只在三个明确的决策点停下来等人工**：(a) 超限升级触发且 `autoproject.escalate.mode` 为 `ask`；(b) 缺少凭证、密钥或外部能力；(c) 下一次写入会离开已声明的 scope。除此之外不会停下——四条「一概不问」的条款已被**删除**，指令用一句收尾句明确写出这三个点。

1. **先甄别（Triage first）**——目标不清晰、或属于「先调查再执行」的任务，先跑一轮普通 MPD 调查，再进入 gate、团队或循环。
2. **同一复杂度 gate——在注入指令之前由插件机械求值。** 运行读取**同一条**冻结判定式（`evaluateComplexityGate`），用**同一个** `team.sensitivity` 阈值行（`resolveSensitivity`；缺省或未知值读作 `easy`，即默认行），输入也与 session-start gate 相同：信号 **A** 显式 `team:` / `!team` 标记；**B** 去重的交付类动词；**C** **三路**子信号，各自对照该行自己的阈值计分 —— 枚举行（编号 / 项目符号 / 表格行）、去重的动作动词、以及**以动作动词开头**的子句 —— 其中至少 `cSubSignals` 路成立；**D** 存在**正在进行**的 boulder 工作（`readBoulderGate` 的 `active`——`.mpd/plans` 的**文件**不构成信号）；**E** **同时**满足该行的汉字数阈值**与**去重的动作动词数阈值（与 C2 读的是同一个计数）；**F** 大工作区规模（`readWorkspaceScale`，仅在 `easy` 行求值）。在 `easy` 行上：C1/C2/C3 各需 ≥ 2 且三路中至少 2 路成立，E 需 ≥ 24 个汉字**且** ≥ 2 个不同动作动词 —— 每一行的具体数值都在 `SENSITIVITY_THRESHOLDS` 里。绝不另立第二套判定。`team.gate: off` 在判定式运行**之前**就返回；命中后处于 `mechanical` 才会 stage plan shell，而 `advisory` 只报告判定结果、不 stage 任何东西。
3. **需要时才建团队**——gate 触发（或工作确实复杂）时，由本次运行**自己**建团，**默认**走已暂存计划这条路径：用 `agent_teams_plan` 为每个 roster 成员 `add_member`，再为每个 DAG 节点 `create_task`（带上它的依赖答案），最后 `approve`。批准自己暂存的计划属于这次运行本身，不是第二次用户确认。这是**唯一**的入口：本 bundle 的团队平面就是 mpd **记录**，官方 Agent Teams 工具在**工具边界**被**拒绝**（`spawn_teammate`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`），而 `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` 仍保留用于智能体间通信。0.1.7 上同样不存在那批已退役的内置（vendored）工具（`agent_teams_create`、`agent_teams_add_member`、`agent_teams_create_task`、`agent_teams_approve`、`agent_teams_status`、`agent_teams_send_message`、`agent_teams_shutdown*`、`agent_teams_delete`）——现存的五个工具是 `agent_teams_plan`、`agent_teams_task`、`agent_teams_dispatch`、`agent_teams_mail` 与 `agent_teams_control`；团队状态就是 mpd **记录**。
4. **循环至完成**——持续迭代直到每条成功标准都干净。运行中发现的缺陷在当轮就地修复，绝不上报后等待——**但**若修复会写到已声明 scope 之外，那是决策点 (c)，运行就此停下。
5. **有证据才收尾**——只有当 verification 的 PASS 通过 `mpd_verify_*` 平面被**记录**（只有测试不算证明），且最终 quality-gate ledger 通过后，才报告完成。

## 引擎一览

| 组成 | 运行实际做什么 |
|---|---|
| 子智能体 | 每轮是**一次** `mpd_role_spawn` 咨询，经 roster 与 `agentRoutes` 路由——heavy 用 Deep Worker、有计划的 light 用 Senior Engineer、其余用 Junior Engineer。没有平行引擎，也没有私有的 spawn 通道。 |
| 验证 | 只走 `mpd_verify_*` 平面：要报告 `complete` 必须有**被记录**的 PASS；`strictReview` 仅为兼容而接受，关卡无论如何都会跑。 |
| 台账 | `.mpd/boulder.json`，由六个 `mpd_boulder_*` 工具维护——名称与参数不变，现已由本包注册（boulder 包合并至此）。台账是 TUI 与复杂度 gate 读取的进行中事实。 |
| 状态 | `.mpd/autoproject/<runId>/{state.json,ledger.jsonl,escalation.json}`。 |
| Tier | `tier: "light"`（不写计划文件）或 `"heavy"`；`plan: true` 强制在 light 下也写计划文件。 |
| Scope | `scope`（工作区相对路径数组）是调用者**声明**的写作用域。给出时驱动升级的 scope 信号、verify 循环的授权范围和 cellwork 交接；缺省时引擎回退到子智能体提供的路径，`escalation.json` 记录用的是哪一种（`scopeSource: declared | evidence`）。下一次写入越界就是决策点 (c)。 |
| 超限升级 | **唯一**一个独立决定，由**引擎**在轮次边界作出：判定式 `S2 ∨ S3 ∨ count(S1,S4,S6,S7) ≥ 2`，其中 S1 成功标准数 > `criteriaMax`(12)、S2 `status == max-rounds`、S3 无果 wave ≥ 2、S4 台账字节 > `ledgerBytesMax`、S6 不同 scope 树 > `scopePathsMax`(20)、S7 同一标准 verify FAIL ≥ `verifyFailsMax`(2)。**S5 已退役**（R-W1B2 裁决，2026-11-02）：`autoproject.escalate.tasksMax` 仍可解析，但已无信号读取它。`autoproject.escalate.mode`（`off`/`ask`/`auto`）只决定**接下来**做什么；产物是 `.mpd/autoproject/<runId>/escalation.json` `{version,at,mode,signals[],objective,planFile,criteria,evidence,scope,roundsUsed,mandate}`；`state.status = "escalated"` 会让已锚定的 goal 保持 ARMED。交接：有 `cellwork_open` 时用它，否则返回 `/cellwork <objective>` 指令。 |

**autoproject 的正常流程——通过 `agent_teams_plan` 扩展已暂存的计划——正是「受守卫」的那条。** 用 `agent_teams_plan` 组队：每个 roster 成员一次 `add_member`，再为每个 DAG 节点 `create_task`，最后 `approve`。守卫在**工具**里，而不是建议：`create_task` **要求**给出依赖答案（`blocked_by: [...]`、显式的空根，或 `independent: true`），而 `approve` **拒绝**两个声明的写作用域重叠、且彼此之间没有依赖路径的任务（会点名这一对并给出两种补救）。

**在工具边界上不存在绕过路径：团队之门在那里关上。** mpd **记录**（`<workspace>/.mpd/team/teams/<teamId>.json`，以 `mpdTeams` 提供）就是本 bundle 的团队平面，`agent_teams_plan` 是唯一的进入方式；team-door guard 在每个会话上**拒绝** `spawn_teammate`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`，而 `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` 仍保留用于智能体间通信。**这条边界只说一次：**直接调用团队**服务**的插件行（官方执行器回退路径）不是工具调用，**不**受这道门约束。因此没有任何由**工具**创作的任务能在缺少依赖答案的情况下进入看板：`create_task` **要求**给出依赖答案，`approve` 会拒绝没有依赖路径的写作用域重叠。

## 策略——形态来自上游，措辞是我们的

这套纪律的**形态**来自上游：它依据**已记录的**上游 autoproject 纪律（base 8c57e46）重新表达。此处发布的**措辞**是本包自己的——**没有找到、也没有复制任何上游提示词、策略或错误文本**；下列条款只在本 bundle 中成立（`mpd` 工具箱、本 harness 上的五个 `agent_teams_*` 工具、`.mpd/autoproject`、`mpdConfig` 键）。

**未能比对的残留（如实陈述，不予粉饰）：** 有四条无法与任何上游文本比对——`PIN → RED → GREEN → SURFACE → CLEAN` 阶梯、连续 2 个无果 discovery wave 即停止的规则、subagent barrier，以及 evidence-never-suppressed。它们在措辞上属于我们；至于其**意图**是否源自上游，尚无证据，本说明不作此主张。

- Discovery waves：每轮一个全新 child；在为有界波次内并发执行独立工作；连续 2 个无果的 discovery wave 后停止。
- Per-criterion loop：PIN → RED → GREEN → SURFACE → CLEAN，直到所有 criterion 干净。
- Plan gate：Prometheus planner 写入 `.mpd/plans/<slug>.md` + checklist；当 heavy/sensitive 时由 Momus 做 plan review（最多 2 次 review 复审）。
- Verification gate：当存在 plan 且（tier=heavy OR strictReview OR plan review failed）时，由只读的 Momus reviewer 处理（最多 2 次 re-review）。
- Final quality gate：gate reviewer 为每条 lane 盖章 ledger（`.mpd/autoproject/<id>/ledger.jsonl`：code quality、hands-on QA、goal verification）；任一 FAIL 都会阻止完成。
- Subagent barrier 与 evidence-never-suppressed 规则属于本包的固定 directive——它们正是四条没有上游文本可比对的条款中的两条。
- 可选 hyperplan wave：5 个对抗性 category reviewers（unspecified-low/high、deep、ultrabrain、artistry）→ insight bundle → planner。

## 工具

- `mpd_autoproject({objective, tier?, plan?, hyperplan?, strictReview?, maxRounds?, scope?})` —— **一个**工具；`tier` 决定形态（`light` / `heavy`），`plan: true` 强制写计划文件，`maxRounds` 取值 1..8（默认 6）。没有别名，也没有第二个入口。
- `/autoproject <objective>` —— 唯一命令；它把激活指令作为你自己的下一条用户消息提交。

## 状态

`.mpd/autoproject/<runId>/{state.json, ledger.jsonl, escalation.json}`；plans 落在 `.mpd/plans/`；boulder 台账仍是 `.mpd/boulder.json`。

## 构建 / 测试

在仓库根目录、使用带路径参数的命令（规范形式）。在包目录内构建会写入不同的 bundler 路径注释，`node scripts/verify-dist-fresh.ts` 会将其判为 stale：

```sh
bun build packages/mpd-autoproject-plugin/src/index.ts --target node --format esm --outfile packages/mpd-autoproject-plugin/dist/index.js
```

测试：`bun test packages/mpd-autoproject-plugin`。
Live QA：`node skills/dsh-qa/scripts/autoproject-smoke.ts`。

## dsh-Go 工具卡片

`mpd_boulder_status` 还会通过 `output.presentationMeta` 发布原生 **dsh-Go 工具卡片**：一棵 v1 视图树
（`stack` 标题 → `row` 指标 → `keyValue` → `table`），不带数据绑定、不带按钮，并在发布前按应用的
8 KiB / 40 节点 / 深度 6 工具卡片预算测量。构建失败的卡片返回 `{}`，应用于是回退到通用工具行。
文本 `render` 与输出 schema 均未改动。
