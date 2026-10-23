diff --git a/packages/mpd-bundle-plugin/README.md b/packages/mpd-bundle-plugin/README.md
index 138cdf1b..9f509ae0 100644
--- a/packages/mpd-bundle-plugin/README.md
+++ b/packages/mpd-bundle-plugin/README.md
@@ -76,7 +76,12 @@ existing `team-page.ts` pattern, never a declared inject — and when a probe is
 is bound, or `directoryFor` throws, the card falls back to the DECLARED option lists and the
 section still renders. Nothing about a slot is settable only by typing. The see-before-you-edit block shows each slot's STATE and renders
 `<unconfigured>` (naming the leaves it still needs) when the workspace configured none — there is no
-default floor to invent a route — and the deleted per-member `agentRoutes` rows are gone from the
+default floor to invent a route — while an INVALID slot (a leaf present but malformed, e.g. a
+non-string, or a slot that is not an object) renders its OWN sentence in both languages instead of
+`<unconfigured>`: `EffectiveRoute.problem` names the offending leaf (`teamModels.slotN.leaf is not a
+string`, or `teamModels.slotN is not an object`), and the `missing` check TRIMS every leaf, so a
+whitespace-only leaf counts as MISSING rather than as configured — a malformed slot must never read as
+absent. The deleted per-member `agentRoutes` rows are gone from the
 card entirely (a leftover block in an old file is IGNORED, never rendered and never rewritten). A browser module cannot
 import the TS declaration, so the card mirrors it and a test pins the declared metadata (path,
 label, zh, kind, declared options, human sentences) element-wise. Each slot row LEADS with its
diff --git a/packages/mpd-bundle-plugin/README.zh-CN.md b/packages/mpd-bundle-plugin/README.zh-CN.md
index a96c3dd3..6e93dcce 100644
--- a/packages/mpd-bundle-plugin/README.zh-CN.md
+++ b/packages/mpd-bundle-plugin/README.zh-CN.md
@@ -15,7 +15,11 @@
 **TUI 对应面。** 本客户端注册的设置卡片，与 TUI 版本渲染的 `/settings` 区块是**同一个** `mpd` settings 命名空间的两半（`packages/mpd-tui-plugin/src/settings.ts`）：两个前门的标签、提示与中文描述互为镜像，并有测试断言两份列表保持一致；两者也陈述同一句桥接披露——保存会写入 `<workspace>/.mpd/mpd.jsonc`（针对当时处于 live 的会话工作区），mpd 插件在重启后按其生效。浏览器只通过公开的 settings 接缝抵达该桥；回写本身属于 `packages/mpd-config-plugin`。改动任一半后请重建合并客户端（`node scripts/build-mpd-client.ts`）。
 
 **Web 卡片的团队模型选择器。** 卡片镜像 `packages/mpd-config-plugin` 中**唯一**的 26 行 knob 声明（原有 13 个 knob、十二个 `teamModels` 槽位叶子，再加 TUI 界面自身的一个 knob），并把每个槽位渲染为**联动的、只可选择**的选择器：模型控件的选项是目录中的 provider/model 组合（provider 作为分组显示），推理强度控件的选项是**所选模型自身**的 effort，并在模型变化时重新推导。目录通过**受保护的探针** `ctx.get("sessions")` + `ctx.get("modelDirectories")` 获取 —— 沿用 `team-page.ts` 的既有模式，绝不新增必需注入 —— 当探针缺失、没有绑定会话，或 `directoryFor` 抛错时，卡片回退到**声明**的选项列表，区块照常渲染。槽位的任何一项都不能只靠输入来设置。「当前生效」块会显示每个槽位的**状态**：工作区未配置时渲染 `<unconfigured>`（并列出仍缺的叶子）——
-不再有任何默认层去凭空造一条路由；已删除的逐成员 `agentRoutes` 行也从卡片上彻底消失（旧文件里残留的块
+不再有任何默认层去凭空造一条路由——而**无效（invalid）**槽位（叶子存在但格式不对，例如不是字符串，
+或槽位本身不是对象）会以**它自己的**中英文句子渲染，绝不冒充 `<unconfigured>`：`EffectiveRoute.problem`
+点出有问题的那个叶子（`teamModels.slotN.leaf is not a string`，或 `teamModels.slotN is not an object`），
+`missing` 判定会先 **trim** 每个叶子，因此只有空白的叶子算**缺失**而不是"已配置"——格式错误的槽位绝不能
+读成未配置。已删除的逐成员 `agentRoutes` 行也从卡片上彻底消失（旧文件里残留的块
 会被忽略：既不渲染，也永不改写）。浏览器模块无法 import TS 声明，因此卡片镜像它，并由测试逐项固定声明元数据（path、label、zh、kind、声明选项、人类语句）。每个槽位行**以所属分组和自身的人类语句开头**：标签写明分组（`槽位 2 提供商（分析型成员）`），每个槽位的三行之上有一行分组标题与一句影响说明，人类语句以正常字号/不透明度渲染，强制披露行更暗地跟在下方。两个前门都写出点号形式的 `mpd.jsonc` key，并在该人类语句**之后**携带披露与"不会丢失"条款：TUI 构造 `<人类语句> mpd.jsonc <key> — <披露> <不会丢失>`，卡片镜像同一份声明、同一顺序。
 
 ## 配置
diff --git a/packages/mpd-team-core-plugin/README.md b/packages/mpd-team-core-plugin/README.md
index a64a6a82..45e43c36 100644
--- a/packages/mpd-team-core-plugin/README.md
+++ b/packages/mpd-team-core-plugin/README.md
@@ -19,7 +19,7 @@ service is the **fallback** for a composition that runs the official executor, r
 | Tool | `action` values | What it does |
 |---|---|---|
 | `agent_teams_plan` | `create`, `add_member`, `create_task`, `edit`, `approve`, `delete`, `status` | stage a team as a PLAN; `approve` EXECUTES it through the TEAM EXECUTOR — the native backend over `ctx.subagents.startContinuable` is the DEFAULT and the official `dsh.team*` calls are the FALLBACK, so the official plugin need not be mounted — resolves `blocked_by`/`owner` against the mpd record, persists a declared `kind` from `task.kind` or its top-level alias (an unknown word is refused), and REFUSES a plan with 0 members and 0 tasks; `delete` archives; `status` shows the record beside the official readout when that backend is active |
-| `agent_teams_task` | `claim`, `contract`, `release`, `complete`, `fail`, `depend` | claim the task on the mpd record AND freeze its contract with a monotonic `attempt`; read it back; `release` frees the pairing and reopens the row to `pending`; `complete`/`fail` are the terminal verbs (owner-only, optional `note`/`expected_revision`, a `FAIL` releases its dependents); `depend` APPENDS `blocked_by` edges to an EXISTING row — idempotent (a re-added reference is a reported no-op), refused for a terminal row, for an unknown `task_id`, and for a caller who is neither the row's owner nor the team's Lead — and reports a reference that names no task: kept verbatim in `blockedBy`, named in the answer, and persisted on the row as `unresolvedBlockers` |
+| `agent_teams_task` | `claim`, `contract`, `release`, `complete`, `fail`, `depend` | claim the task on the mpd record AND freeze its contract with a monotonic `attempt`; read it back; `release` frees the pairing and reopens the row to `pending`; `complete`/`fail` are the terminal verbs (owner-only, optional `note`/`expected_revision`, a `FAIL` releases its dependents); `depend` APPENDS `blocked_by` edges to an EXISTING row — idempotent (a re-added reference is a reported no-op), refused for a terminal row, for an unknown `task_id`, for a caller who is neither the row's owner nor the team's Lead, and for a SELF-EDGE or ANY CYCLE (2-node or transitive); every refusal returns BEFORE any write, so `blockedBy` and `revision` are unchanged — a cyclic edge could never satisfy the readiness rule, and `depend` appends only, so the row would be permanently not-ready — and it reports a reference that names no task: kept verbatim in `blockedBy`, named in the answer, and persisted on the row as `unresolvedBlockers` |
 | `agent_teams_dispatch` | `run`, `release` | pair ready tasks with idle members, tell each member its task, and RECORD the pairing in the TEAM-SCOPED ledger; `release` frees it and reopens the row |
 | `agent_teams_mail` | `send`, `unread`, `read`, `summary` | the team mailbox: durable, with a read state the official one cannot provide |
 | `agent_teams_control` | `halt`, `resume` | a hold that stops new dispatch and nothing else |
diff --git a/packages/mpd-team-core-plugin/README.zh-CN.md b/packages/mpd-team-core-plugin/README.zh-CN.md
index eba8c8cc..da0fbadb 100644
--- a/packages/mpd-team-core-plugin/README.zh-CN.md
+++ b/packages/mpd-team-core-plugin/README.zh-CN.md
@@ -16,7 +16,7 @@
 | 工具 | `action` 取值 | 作用 |
 |---|---|---|
 | `agent_teams_plan` | `create`、`add_member`、`create_task`、`edit`、`approve`、`delete`、`status` | 把团队暂存成**计划**；`approve` 通过**团队执行器**执行它（原生后端 `ctx.subagents.startContinuable` 是**默认**，官方 `dsh.team*` 调用是**回退**），并按 mpd 记录解析 `blocked_by`/`owner`，持久化声明的 `kind`（取自 `task.kind` 或其顶层别名，未知词会被**拒绝**）；0 成员且 0 任务的计划会被**拒绝**；`delete` 归档；`status` 在该后端生效时把记录与官方读数并排给出 |
-| `agent_teams_task` | `claim`、`contract`、`release`、`complete`、`fail`、`depend` | 在 mpd 记录上认领任务**并**冻结契约（单调 `attempt`）；读回契约；`release` 释放配对并把任务行退回 `pending`；`complete`/`fail` 是终结动词（仅所有者或队长可用，可带 `note`/`expected_revision`，`FAIL` 会释放其依赖方）；`depend` 只向**既有**行**追加** `blocked_by` 依赖边——重复添加是幂等空操作（会如实报告），已终结的行、未知的 `task_id`、以及既非该行所有者又非队长的调用者都会被**拒绝**——并报告点名不到任何任务的引用：按原文保留在 `blockedBy`、在结果里点名、并持久化为该行的 `unresolvedBlockers` |
+| `agent_teams_task` | `claim`、`contract`、`release`、`complete`、`fail`、`depend` | 在 mpd 记录上认领任务**并**冻结契约（单调 `attempt`）；读回契约；`release` 释放配对并把任务行退回 `pending`；`complete`/`fail` 是终结动词（仅所有者或队长可用，可带 `note`/`expected_revision`，`FAIL` 会释放其依赖方）；`depend` 只向**既有**行**追加** `blocked_by` 依赖边——重复添加是幂等空操作（会如实报告），已终结的行、未知的 `task_id`、既非该行所有者又非队长的调用者、以及**自环**或**任何环**（双节点或传递环）都会被**拒绝**；所有拒绝都在**任何写入之前**返回，`blockedBy` 与 `revision` 保持原样——成环的边永远无法满足就绪规则，而 `depend` 只会追加、永不删边，任务行会因此永久 not-ready——并报告点名不到任何任务的引用：按原文保留在 `blockedBy`、在结果里点名、并持久化为该行的 `unresolvedBlockers` |
 | `agent_teams_dispatch` | `run`、`release` | 把就绪任务与空闲成员配对、通知成员、并在**按团队分键的台账**里记录配对；`release` 释放配对并重开任务行 |
 | `agent_teams_mail` | `send`、`unread`、`read`、`summary` | 团队信箱：durable，且带官方**给不了**的已读状态 |
 | `agent_teams_control` | `halt`、`resume` | 只停派工、别的什么都不做的暂停 |
