diff --git a/packages/mpd-team-core-plugin/README.md b/packages/mpd-team-core-plugin/README.md
index 15c1a4d3..a64a6a82 100644
--- a/packages/mpd-team-core-plugin/README.md
+++ b/packages/mpd-team-core-plugin/README.md
@@ -18,19 +18,29 @@ service is the **fallback** for a composition that runs the official executor, r
 
 | Tool | `action` values | What it does |
 |---|---|---|
-| `agent_teams_plan` | `create`, `add_member`, `create_task`, `edit`, `approve`, `delete`, `status` | stage a team as a PLAN; `approve` EXECUTES it through the TEAM EXECUTOR — the native backend over `ctx.subagents.startContinuable` is the DEFAULT and the official `dsh.team*` calls are the FALLBACK, so the official plugin need not be mounted — resolves `blocked_by`/`owner` against the mpd record, and REFUSES a plan with 0 members and 0 tasks; `delete` archives; `status` shows the record beside the official readout when that backend is active |
-| `agent_teams_task` | `claim`, `contract`, `release` | claim the task on the mpd record AND freeze its contract with a monotonic `attempt`; read it back; `release` frees the pairing and reopens the row to `pending` |
+| `agent_teams_plan` | `create`, `add_member`, `create_task`, `edit`, `approve`, `delete`, `status` | stage a team as a PLAN; `approve` EXECUTES it through the TEAM EXECUTOR — the native backend over `ctx.subagents.startContinuable` is the DEFAULT and the official `dsh.team*` calls are the FALLBACK, so the official plugin need not be mounted — resolves `blocked_by`/`owner` against the mpd record, persists a declared `kind` from `task.kind` or its top-level alias (an unknown word is refused), and REFUSES a plan with 0 members and 0 tasks; `delete` archives; `status` shows the record beside the official readout when that backend is active |
+| `agent_teams_task` | `claim`, `contract`, `release`, `complete`, `fail`, `depend` | claim the task on the mpd record AND freeze its contract with a monotonic `attempt`; read it back; `release` frees the pairing and reopens the row to `pending`; `complete`/`fail` are the terminal verbs (owner-only, optional `note`/`expected_revision`, a `FAIL` releases its dependents); `depend` APPENDS `blocked_by` edges to an EXISTING row — idempotent (a re-added reference is a reported no-op), refused for a terminal row, for an unknown `task_id`, and for a caller who is neither the row's owner nor the team's Lead — and reports a reference that names no task: kept verbatim in `blockedBy`, named in the answer, and persisted on the row as `unresolvedBlockers` |
 | `agent_teams_dispatch` | `run`, `release` | pair ready tasks with idle members, tell each member its task, and RECORD the pairing in the TEAM-SCOPED ledger; `release` frees it and reopens the row |
 | `agent_teams_mail` | `send`, `unread`, `read`, `summary` | the team mailbox: durable, with a read state the official one cannot provide |
 | `agent_teams_control` | `halt`, `resume` | a hold that stops new dispatch and nothing else |
 
 `/agent-teams <what the team is for>` stages a plan from the current goal.
 
+**The DAG is visible.** `agent_teams_plan {action:"status"}` keeps its one-line summary
+(`plan <id> · members N · tasks N · hold …`) and prints one line per member (`id`, `name`, `status`) and
+one line per task (`id`, `owner`, `status`, `kind`, `blockedBy` — or `-` — and `subject`), so a flat
+board and a wired one no longer look alike. `edit`'s read form prints the staged tasks with `subject`,
+`owner` and `blockedBy`, and `id=-` on every row: approval is what mints the `T1…` ids. Because
+`create_task` mints a row and approval writes `blockedBy` once, `agent_teams_task {action:"depend"}` is
+the append-only verb that lets a lane added mid-run enter an existing DAG instead of becoming another
+unconnected row.
+
 **Why actions, not tools.** Every tool's name, description and parameter schema sits in the model's
 context on EVERY turn. The hand-written surface had grown to 14 tools costing 7,643 characters
 (~1,900 tokens) before a word of the actual task; the actions are steps of one workflow, so they are
-`action` values now — 5 tools, 4,717 characters (~1,180 tokens). `test/tool-surface.test.ts` pins both
-the budget and the action sets, so a new tool has to justify itself against that number.
+`action` values now — 5 tools, **4,971 characters of a 5,000 budget** (~1,240 tokens), measured
+2026-10-23. `test/tool-surface.test.ts` pins both the budget and the action sets, so a new tool has to
+justify itself against that number.
 
 `/agent-teams <what the team is for>` stages a plan from the current goal.
 
diff --git a/packages/mpd-team-core-plugin/README.zh-CN.md b/packages/mpd-team-core-plugin/README.zh-CN.md
index 0b4c269d..eba8c8cc 100644
--- a/packages/mpd-team-core-plugin/README.zh-CN.md
+++ b/packages/mpd-team-core-plugin/README.zh-CN.md
@@ -15,17 +15,25 @@
 
 | 工具 | `action` 取值 | 作用 |
 |---|---|---|
-| `agent_teams_plan` | `create`、`add_member`、`create_task`、`edit`、`approve`、`delete`、`status` | 把团队暂存成**计划**；`approve` 通过**团队执行器**执行它（原生后端 `ctx.subagents.startContinuable` 是**默认**，官方 `dsh.team*` 调用是**回退**），并按 mpd 记录解析 `blocked_by`/`owner`；0 成员且 0 任务的计划会被**拒绝**；`delete` 归档；`status` 在该后端生效时把记录与官方读数并排给出 |
-| `agent_teams_task` | `claim`、`contract`、`release` | 在 mpd 记录上认领任务**并**冻结契约（单调 `attempt`）；读回契约；`release` 释放配对并把任务行退回 `pending` |
+| `agent_teams_plan` | `create`、`add_member`、`create_task`、`edit`、`approve`、`delete`、`status` | 把团队暂存成**计划**；`approve` 通过**团队执行器**执行它（原生后端 `ctx.subagents.startContinuable` 是**默认**，官方 `dsh.team*` 调用是**回退**），并按 mpd 记录解析 `blocked_by`/`owner`，持久化声明的 `kind`（取自 `task.kind` 或其顶层别名，未知词会被**拒绝**）；0 成员且 0 任务的计划会被**拒绝**；`delete` 归档；`status` 在该后端生效时把记录与官方读数并排给出 |
+| `agent_teams_task` | `claim`、`contract`、`release`、`complete`、`fail`、`depend` | 在 mpd 记录上认领任务**并**冻结契约（单调 `attempt`）；读回契约；`release` 释放配对并把任务行退回 `pending`；`complete`/`fail` 是终结动词（仅所有者或队长可用，可带 `note`/`expected_revision`，`FAIL` 会释放其依赖方）；`depend` 只向**既有**行**追加** `blocked_by` 依赖边——重复添加是幂等空操作（会如实报告），已终结的行、未知的 `task_id`、以及既非该行所有者又非队长的调用者都会被**拒绝**——并报告点名不到任何任务的引用：按原文保留在 `blockedBy`、在结果里点名、并持久化为该行的 `unresolvedBlockers` |
 | `agent_teams_dispatch` | `run`、`release` | 把就绪任务与空闲成员配对、通知成员、并在**按团队分键的台账**里记录配对；`release` 释放配对并重开任务行 |
 | `agent_teams_mail` | `send`、`unread`、`read`、`summary` | 团队信箱：durable，且带官方**给不了**的已读状态 |
 | `agent_teams_control` | `halt`、`resume` | 只停派工、别的什么都不做的暂停 |
 
 `/agent-teams <这支团队是干什么的>` 按当前目标暂存计划。
 
+**依赖图是可见的。** `agent_teams_plan {action:"status"}` 保留原来的一行摘要
+（`plan <id> · members N · tasks N · hold …`），并**每个成员一行**（`id`、`name`、`status`）、
+**每个任务一行**（`id`、`owner`、`status`、`kind`、`blockedBy`——没有则 `-`——以及 `subject`），
+于是扁平看板与接好线的看板不再长得一样。`edit` 的读取形式会打印暂存任务及其 `subject`、`owner`、
+`blockedBy`，且每行都是 `id=-`：`T1…` 这样的 id 是批准时才铸造的。因为 `create_task` 只能新造一行、
+批准只写一次 `blockedBy`，`agent_teams_task {action:"depend"}` 就是那条**只追加**的动词，让中途新增的
+任务接入既有 DAG，而不是又变成一条孤立的行。
+
 **为什么用 action 而不是更多工具。** 每个工具的名字、描述和参数 schema **每一轮**都在模型上下文里。手写的界面一度长到
 **14 个工具、7,643 字符（约 1,900 token）**——还一个字都没提任务；而这些动作本就是**同一条工作流的步骤**，所以现在是
-`action` 取值：**5 个工具、4,717 字符（约 1,180 token）**。`test/tool-surface.test.ts` 同时钉住预算和 action 集合，
+`action` 取值：**5 个工具、4,971 字符 / 5,000 预算（约 1,240 token，2026-10-23 实测）**。`test/tool-surface.test.ts` 同时钉住预算和 action 集合，
 所以将来新增工具必须对这个数字交代。
 
 `/agent-teams <这支团队是干什么的>` 会按当前目标暂存一份计划。
