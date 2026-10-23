# mpd-ulw-plugin
**中文** | [English](./README.md)

Plan C / C2 — 在 DSH subagent seam 上的固定策略 ultrawork 引擎（v2，取代 B3 loop；`mpd_ulw` 仍以轻量兼容别名形式存在）。

## 命令

- `/ulw <objective>` 与 `/ultrawork <objective>`（行为完全一致）——为该目标注入 ULW 激活指令并启动运行；空输入返回用法。
- 无命令界面（headless）：纯文本 `/ulw …` / `/ultrawork …` 消息会在插件的 `agent/pre-step` 边界被识别，并收到同一条指令。

## 自主策略（由激活指令携带）

被激活的 ULW 运行不向用户提出任何问题：

1. **先甄别（Triage first）**——目标不清晰、或属于「先调查再执行」的任务，先跑一轮普通 MPD 调查，再进入 gate、团队或循环。
2. **同一复杂度 gate**——运行评估与 session-start gate 相同的判定式：显式 `team:` / `!team` 标记，或任一命中信号（A 显式标记、B 交付类动词、C 枚举步骤、D 已存在的 `.mpd/plans` 计划文件）。绝不另立第二套判定。
3. **需要时才建团队**——gate 触发（或工作确实复杂）时，由本次运行**自己**建团，**默认**走已暂存计划这条路径：用 `agent_teams_plan` 为每个 roster 成员 `add_member`，再为每个 DAG 节点 `create_task`（带上它的依赖答案），最后 `approve`——由 captain 自行设计并直接运行，无需用户确认。这是**唯一**的入口：本 bundle 的团队平面就是 mpd **记录**，官方 Agent Teams 工具在**工具边界**被**拒绝**（`spawn_teammate`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`），而 `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` 仍保留用于智能体间通信。0.1.7 上同样不存在 `agent_teams_create` / `agent_teams_*` 工具；团队状态就是 mpd **记录**。
4. **循环至完成**——绝不中途停下询问；持续迭代直到每条成功标准都干净。
5. **就地修复（Fix on sight）**——运行中发现的缺陷在当轮立即修复；绝不上报后等待，也绝不请求用户批准。
6. **有证据才收尾**——只有当 verification gate 与 quality-gate ledger 双双通过后才报告完成。

**ULW 的正常流程——通过 `agent_teams_plan` 扩展已暂存的计划——正是「受守卫」的那条。** 用 `agent_teams_plan` 组队：每个 roster 成员一次 `add_member`，再为每个 DAG 节点 `create_task`，最后 `approve`。守卫在**工具**里，而不是建议：`create_task` **要求**给出依赖答案（`blocked_by: [...]`、显式的空根，或 `independent: true`），而 `approve` **拒绝**两个声明的写作用域重叠、且彼此之间没有依赖路径的任务（会点名这一对并给出两种补救）。

**在工具边界上不存在绕过路径：团队之门在那里关上。** mpd **记录**（`<workspace>/.mpd/team/teams/<teamId>.json`，以 `mpdTeams` 提供）就是本 bundle 的团队平面，`agent_teams_plan` 是唯一的进入方式；team-door guard 在每个会话上**拒绝** `spawn_teammate`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`，而 `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` 仍保留用于智能体间通信。**这条边界只说一次：**直接调用团队**服务**的插件行（官方执行器回退路径）不是工具调用，**不**受这道门约束。因此没有任何由**工具**创作的任务能在缺少依赖答案的情况下进入看板：`create_task` **要求**给出依赖答案，`approve` 会拒绝没有依赖路径的写作用域重叠。

## 策略——形态来自上游，措辞是我们的

这套纪律的**形态**来自上游：它依据**已记录的**上游 ultrawork 纪律（base 8c57e46）重新表达。此处发布的**措辞**是本包自己的——**没有找到、也没有复制任何上游提示词、策略或错误文本**；下列条款只在本 bundle 中成立（`mpd` 工具箱、本 harness 上的五个 `agent_teams_*` 工具、`.mpd/ulw`、`mpdConfig` 键）。

**未能比对的残留（如实陈述，不予粉饰）：** 有四条无法与任何上游文本比对——`PIN → RED → GREEN → SURFACE → CLEAN` 阶梯、连续 2 个无果 discovery wave 即停止的规则、subagent barrier，以及 evidence-never-suppressed。它们在措辞上属于我们；至于其**意图**是否源自上游，尚无证据，本说明不作此主张。

- Discovery waves：每轮一个全新 child；在为有界波次内并发执行独立工作；连续 2 个无果的 discovery wave 后停止。
- Per-criterion loop：PIN → RED → GREEN → SURFACE → CLEAN，直到所有 criterion 干净。
- Plan gate：Prometheus planner 写入 `.mpd/plans/<slug>.md` + checklist；当 heavy/sensitive 时由 Momus 做 plan review（最多 2 次 review 复审）。
- Verification gate：当存在 plan 且（tier=heavy OR strictReview OR plan review failed）时，由只读的 Momus reviewer 处理（最多 2 次 re-review）。
- Final quality gate：gate reviewer 为每条 lane 盖章 ledger（`.mpd/ulw/<id>/ledger.jsonl`：code quality、hands-on QA、goal verification）；任一 FAIL 都会阻止完成。
- Subagent barrier 与 evidence-never-suppressed 规则属于本包的固定 directive——它们正是四条没有上游文本可比对的条款中的两条。
- 可选 hyperplan wave：5 个对抗性 category reviewers（unspecified-low/high、deep、ultrabrain、artistry）→ insight bundle → planner。

## 工具

- `mpd_ultrawork({objective, tier?, plan?, hyperplan?, strictReview?, maxRounds?})`
- `mpd_ulw({objective, maxRounds?})` — 别名（light tier，无 plan）。

## 状态

`.mpd/ulw/<id>/{state.json, ledger.jsonl}`；plans 落在 `.mpd/plans/`。

## 构建 / 测试

在仓库根目录、使用带路径参数的命令（规范形式）。在包目录内构建会写入不同的 bundler 路径注释，`node scripts/verify-dist-fresh.ts` 会将其判为 stale：

```sh
bun build packages/mpd-ulw-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ulw-plugin/dist/index.js
```

测试：`bun test packages/mpd-ulw-plugin`。
Live QA：`node skills/dsh-qa/scripts/ultrawork-smoke.ts`。
