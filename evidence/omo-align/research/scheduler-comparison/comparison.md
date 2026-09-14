# mass-ulw / workflow DAG 引擎 vs 本地 agent-teams 任务板调度器

任务：t14（Explorer，只读）。用户要求：「对比一下 mass-ulw 的调度器，和现在的有什么优劣，看看有没有优化的空间，调研完了再回来问我看看要不要改」。
本文件只做调研与候选清单，**不实施任何改动**。

- 上游对照实现：`/root/dshProj/oh-my-openagent`（v5.0.0-beta.62，commit `d1557a4b4`）
  - `packages/senpi-task/src/dag/**`（节点状态机、frontier 调度、fingerprint、journal/recovery、retry/amend/send、事件）
  - `docs/reference/mass-ulw-protocol.md`、`packages/omo-senpi/skills/mass-ulw/**`
- 本地对照实现：`packages/mpd-agent-teams-plugin/lib/{scheduler,state,quality-gates,members,tools,events}.js`
- 机器可读版本：`comparison.json`（每条发现带 `upstreamEvidence` / `localEvidence` / `verdict` / `optimizationCandidate` / `needsUserDecision`）
- 证据：本目录 `output.log`（原始命令与行号摘录）

> 结论速览：**核心调度语义其实等价**（都是「依赖门 + 谁空闲谁上」，都不是 wave barrier）；真正的差距在**失败恢复的完整性**（上游有 retry/send/amend + fingerprint 最小重跑，本地只有 reassign）、**可观测性**（上游 WAL 事件 + heartbeat + activity，本地只有磁盘快照）、**幂等**（上游 run key + fingerprint 复用，本地每次会话新建团队，实测残留 25 个）。其中**失败依赖永久钉死下游是本地真实缺陷，本波已实测发生**（t12 failed 钉死 t5，连带 t6/t7/t9）。

---

## 维度 1：触发与调度 —— 谁决定下一个跑什么

**上游做法**
- 自 2026-08-25 起是 **dependency-frontier admission**：一个节点在「它依赖的每个节点都已 completed **且** 有空闲 residency 槽位」的瞬间就被放行，**wave 只是信息分组，绝不是 barrier**
  （`packages/senpi-task/src/dag/scheduler.ts:502-504`；该语义被钉进 fingerprint：`dag/fingerprint.ts:18-31`）。
- 被 residency 拒绝的节点进**有序队列（最早被拒者优先）**，槽位释放先补给最老的等待者（`scheduler.ts:175-177`；admission pass 见 `:544`）。
- 谁启动 run、规模多大由 lead 显式决定：mass-ulw 只在用户点名或确有依赖时使用，且必须先读完 planning 参考再定义图（`packages/omo-senpi/skills/mass-ulw/SKILL.md:10,14`）。

**本地做法**
- `unsatisfiedDependencies` 依赖门：只有全部依赖 completed/cancelled 才可领（`lib/state.js:106-117`）。
- 事件驱动：**每个成员 idle 边 + 每次任务图变更**触发一次 `kickMember`（`lib/scheduler.js:491-495`、`:256-269`），选下一任务的规则是「先本成员已分配的 pending 任务，再未分配任务」（`scheduler.js:145-151`）。
- 每个成员一条串行队列 + parked attempt 记账（`scheduler.js:225-240`、`:296-328`）。

**上游优势**：显式 admission 队列带来公平性与可解释性（谁在排队、排第几）；run 级 pause/resume generation 可表达「整轮暂停」。
**本地优势**：派工是**目标性**的（assignee 优先），配合持久成员身份与 attempt 能力，重复 idle 边不会误撤有效工作；上游靠 latch/admission pass 达到同样效果。
**风险**：本地若成员永远不回到 idle（句柄被 dispose），只能依赖冷恢复的一次性重投（`scheduler.js:303-305`、`:396-411`），没有上游的 3 次重入预算（`dag/recovery.ts:33-35`）。

**顺序缺陷（已知 t2/D8，本维度最重要的一条）**
自动建队发生在规模判断**之前**：`session-start.js:229-269` 在会话第一步无条件 provision，而预设 persona 的「先估规模再选团队形态」写在后面（`presets/mpd/agent.cordis.yml:80-86` 然后 `:88-102`）。上游不存在这个问题——它根本不会在建 run 之前产生编排状态。
→ 判定：`upstream-better`（本地缺陷，见 OPT-2）。

---

## 维度 2：失败恢复

**上游做法**（三种动词作用于**单个节点**，已完成的节点永远保留缓存结果）
- `retry`：failed/cancelled 节点换新 attempt，**被 skip 的下游回到 wave loop**；completed 节点复用；对 completed 执行 retry 会被 `node_not_retryable` 拒绝（`SKILL.md:78`；`dag/node-retry.ts:31,63-108`）。
- `send`：运行中的子节点就地纠偏；仍驻留的已结束子节点**带上下文复活**；不能续的给 `node_not_continuable` 并把 `retry` 作为补救（`SKILL.md:79`；`dag/node-send.ts`）。
- `amend`：提交新定义到同一 run，**逐节点 fingerprint diff**——未变的 completed 节点保留结果，只有 changed/added 节点及其传递下游重跑（`SKILL.md:80`；`dag/manager.ts:440-512`）。
- 跨重启：run 被 journal，进程死亡时 pause 而非丢失，重启后复用已完成节点输出（`SKILL.md:82`；`dag/recovery.ts:1-60`）。
- 失败**不阻塞独立节点**（`failurePolicy:"continue-independent"`），失败节点的下游变 `skipped` 而不是卡死。

**本地做法**
- `agent_teams_reassign_task`：对一个 ready 的未完成**或 failed** 任务做 retry/reassign/captain 接管；completed 任务拒绝改派（`lib/tools.js:1199-1311`，`:1236`）；旧 attempt 先吊销再打断成员（`:1282-1285`）。
- attempt 能力：`beginTaskAttempt` 递增代数并发新 `attemptId`，`invalidateTaskAttempt` 清空能力并打 `handoffId`，迟到的更新被判 stale（`state.js:145-160,225-233`）。
- 冷恢复： parked attempts + 一次性重投（`scheduler.js:296-326,396-411`）。
- 终态不可变：completed/failed/cancelled 无出边（`state.js:122-129`；`tools.js:1557`）。

**上游优势**：恢复面广（中途纠偏、单节点重跑、最小重跑、跨重启续跑），且失败语义天然不卡图。
**本地优势**：能力令牌协议更强（谁在跑、哪一代、迟到更新一律拒绝），`reassign` **不会丢已完成上游结果**——completed 不可变，依赖输出每次派工时从 team.json 重新收集（`scheduler.js:36-84,372`）。
**风险（本维度关键结论）**
1. 「缺 fingerprint 会让已完成任务在修订后被重跑」——**本地不会**：completed 是终态且无任何路径可复活它（`tools.js:1236`、`state.js:122-129`）。真实代价是反面：**无法刻意作废并最小重跑**，批准后连依赖都不能改（`tools.js:106-111,769`；`update_task` 无 dependencies 参数，`:1425-1520`）。
2. **失败依赖永久钉死下游 = 本波实测缺陷**：`unsatisfiedDependencies` 只承认 completed/cancelled，failed 永远阻挡（`state.js:112-116`）；仅有「cancelled 依赖级联」的解法（`state.js:186-224`）；failed 是终态不可 cancel（`update_task` 走 `transitionError`，`tools.js:1586`）；edit_plan 仅限 staged。
   实测盘面（`.mpd/team/mpd-default-db53f0d4/team.json`）：

   | 任务 | 状态 | 依赖 |
   |---|---|---|
   | t12 | **failed**（attempt 3） | — |
   | t5 | pending | t12, t2, t3 |
   | t6 | pending | t12, t5 |
   | t7 | pending | t5, t6 |
   | t9 | pending | t5, t8 |

   一个失败钉死 4 个任务，产品内**没有任何逃逸路径**（除非 reassign 重试 t12 且它真能通过）。
   附注：`canDeclareDelivery` 本来就要求 failed 质量任务有 follow-up repair（`quality-gates.js:782-793`），但 repair 是新任务、**不会释放** failed 任务的依赖，所以连规定的补救流程也走不通。

→ 判定：恢复模型 `upstream-better`；依赖输出传递 `local-better`；失败钉死 = **本波应修缺陷**（OPT-1）。

---

## 维度 3：幂等与去重

**上游做法**
- `runKey + definitionFingerprint`：同 key 同定义 → `{reused:true}` 直接复用、不调度；同 key 不同定义 → `definition_conflict` 报错（`dag/manager.ts:336-355`）。
- key 记录路径 = `hash(parentSessionId, runKey)`，并用 key 锁防并发同 key 起两个 run（`dag/store.ts:237-280,314-319`）。
- 节点级复用跨 run 有 `dag.node.reused`（带 `sourceRunId`）事件（`mass-ulw-protocol.md:52-56`）。
- 保留期把已经消失的 run 记录视为 stale 而非冲突（`manager.ts` 注释与 `store.ts` retention）。

**本地做法**
- 团队 id = 名称 sanitize，重名时 `<base>-<sha256(captainSessionId)[0:8]>`（`session-start.js:96-110`）；任务是团队内序号 `t<N>`（`tools.js:1151-1176`）。
- 会话内幂等：一个 captain 同时只有一个团队（`findTeamByParticipant`），策略每会话只结算一次（`session-start.js:241-244`）。
- 成员侧幂等：attemptId 能力 + parked attempts；一个成员同时只有一个未完成任务。

**上游优势**：幂等锚在**工作定义**上，重复意图不会产生第二个 run，分歧意图同 key 会响亮失败；还有跨 run 的节点复用。
**本地优势**：更简单的 id 语义，且不依赖「定义指纹」这种需要引擎语义配合的机制。
**风险（实测）**：跨会话零去重——每个会话建一个新团队目录；本工作区已累积 **25 个 `mpd-default*`**：`(staged, 0 tasks, 未批准)` = **22 个纯残留**，`(staged, 8 tasks, 未批准)` = 1，`(running, 10, 已批准)` = 1（本会话），`(running, 32, 已批准)` = 1。策略刻意「结算后不再碰这个团队」（`session-start.js:241-244`），所以残留无人回收；而 `.mpd/team` 正是 workmate rename/delete 的 in-use 扫描面。

→ 判定：`upstream-better`；残留回收 `needsUserDecision`（OPT-2 / OPT-6）。

---

## 维度 4：可观测性

**上游做法**
- **17 个 journaled 边界事件**（`dag/types.ts:251-269`），带 WAL `seq`，先落盘后投递，可按 seq 重放（`mass-ulw-protocol.md:28-70,150-166`）。
- **4 条推送通道**：`omo.dag.event`（有序+持久）、`omo.dag.heartbeat`（15s，带 headSeq，只有非终态 run 才有）、`omo.dag.activity`（150ms 合并，带 currentTool/lastAssistantLine/turns/toolCalls）、`omo.dag.updated`（50ms 去抖快照）（`mass-ulw-protocol.md:88-140`）。
- 有 gap-free catch-up 与 overflow recovery 算法；`/dag` 详情视图 + TUI 状态组件（`SKILL.md:93-95`）。

**本地做法**
- Web 面板经鉴权路由读磁盘团队状态（`lib/web-routes.js:1-20`；`lib/snapshot.js:40,128,165`）。
- `agent_teams_status` 返回 phase/halted/escalated/loop_state/deliverable/coverage/delivery blockers/mailbox unread（含最新 200 字符）/每个任务状态（`tools.js:1787-1875`）。
- 成员状态由 `agent/status` 边推导为 idle|working（`scheduler.js:462-489`）。
- **实测**：`appendTeamEvent` 会把 harness 不认识的类型**直接丢弃**（仅 debug 日志）（`lib/events.js:33-38`）；而本机 harness 的 `KNOWN_SESSION_EVENT_TYPES`（生成文件）**没有任何 `agent-teams/*` 条目**（`…/dsh-session/lib/types/known-event-types.js:20-78`，文件头写明 out-of-repo 事件天然不在集合内）。插件的兜底是「磁盘状态才是活动面板的权威来源」，但原本设想的会话事件账本在这套 harness 上端到端不存在。

**上游优势**：能回答「**哪个节点现在卡住/跑偏**」——heartbeat 判活、activity 看最后一行与轮次、transition 账本看状态迁移与 last_error。
**本地优势**：面板直接读磁盘、无需 seq 追赶；`coverage` + `delivery blockers` 是上游没有的**交付就绪度视图**。
**风险**：本地没有 heartbeat、没有 seq、没有 per-member turn/tool 遥测、任务没有 last_error（只有 output）。成员「working 但空转」只能靠会话记录发现；一次派工悬挂只能靠「状态长时间不变」推断。

→ 判定：`upstream-better`（OPT-4）。

---

## 维度 5：依赖语义

**上游做法**：`dependsOn` 是**纯排序**；`dependencyData:"filesystem-only"` 被钉进调度器指纹——**上游不在 prompt 里传上游输出**，数据走文件系统；节点输出全量保存不截断，但规划纪律要求每个节点写一份有界文件报告（≤5k tokens）（`dag/fingerprint.ts:24-27`；`references/planning.md:30,105`）。
**本地做法**：依赖输出**按拓扑序内联进派工 prompt**，单项 2000 字符、合计 12000 字符封顶（`scheduler.js:18-20,36-84,101-121,190-191,372`）；另有独有机制——失败 review 可作为 `reasonTaskId` 把 output + 未解决 findings 注入修复方（`scheduler.js:71-98`）；任务契约（kind/objective/inScope/outOfScope/acceptance/verify）整段渲染进 prompt（`scheduler.js:152-203`）。

**上游优势**：不把输出塞进 prompt，避免膨胀与陈旧副本；「文件系统即接口」让超大产物天然可传。
**本地优势**：自动带上有界摘要做定向（省一次翻文件），并且 `canDeclareDelivery` 把「verdict=pass / failed 需 repair / 变更路径必须在 inScope」变成**机器可校验的交付门**（`quality-gates.js:769-812`），上游只有规划约定 + 目标判据。
**风险**：上游陷阱——节点若把报告写得太薄，下游只能重读文件甚至信息丢失；本地陷阱——超过 12000 字符会静默截断，且本地另有「failed 依赖钉死」的结构性陷阱（见维度 2）。

→ 判定：`tradeoff`。

---

## 维度 6：上限与背压

**上游做法**：显式容量模型——每模型槽位默认并发 5（`task.default_concurrency` 可调，0=无限），超出者 FIFO 排队；默认 64 节点/run、16 run/会话（`references/planning.md:64,95`）；槽位无法释放时节点以 `residency_denied` **失败**而不是无限等待（`dag/scheduler.ts:603`；`lifecycle/residency.ts:18-39`）；恢复重入上限 3（`dag/recovery.ts:33-35`）。另有一套 team_mode 子系统（8 成员/4 并行 + 消息字节/墙钟/轮次上限），但那是**另一套机制**，不是 DAG 引擎。
**本地做法**：`maxMembers: 16` + `memberMaxDepth: 1`（`cordis.patch.yml:207-208`）；每成员一个未完成任务、captain 一次接管（`tools.js:161-166,1240-1256`）；每成员串行队列（`scheduler.js:225-240`）；依赖输出 2000/12000 上限；persona 协议 400 字符（`members.js:27`）。`kickTeam` 对**每个成员都 kick**，没有槽位限制器（`scheduler.js:250-254`）；没有墙钟上限、没有 run 级节点上限、没有消息字节上限。

**上游优势**：可配置容量 + 明确的过载失败语义 + 恢复预算，运维上可解释。
**本地优势**：更少的旋钮、更少的失败模式；16 成员上限以内够用。
**风险**：16 个成员同时 idle 时本地会连续派 16 份 assignment，没有任何「慢下来」的信号，背压完全交给 harness 自身的 subagent residency；也没有墙钟/轮次上限来兜住「跑不完的会话」。

→ 判定：`upstream-better`（OPT-5）。

---

## 维度 7：人会话与人工介入

**上游做法**：没有审批门。lead（主会话）在 eval cell 里定义 run、`start`、通过 mid-run wake 监督；干预动词是 `retry/send/amend`；人看 `/dag`；run 支持 pause/resume/cancel（`SKILL.md:48-64,66-86,90,95`）。mass-ulw 只在用户点名时激活（`SKILL.md:10`）；兄弟特性 team_mode 默认关闭（`features/team-mode/AGENTS.md:7`）。
**本地做法**：staged 计划 + Web 审批（`tools.js:546-714` 创建、`:839-870` approve），批准前不生成任何成员；staged 期内可 `edit_plan` 原子修计划（`:715-838`）；有 halt/resume/delete；`canDeclareDelivery` 作为交付门在 status 里可见（`:1861-1875`）；DAG 之前还有 REQUIREMENTS CONFERENCE（`presets/mpd/agent.cordis.yml:104-114`）。

**上游优势**：中途纠偏不需要审批往返；单节点 `retry/amend` 粒度细。
**本地优势**：人类审批 + **机器可校验的交付门**（没有 passing review 不能交付、failed 质量任务需要 repair、变更路径必须落在 inScope），这是上游完全没有的可执行闸门；需求会议也写进了流程。
**风险**：本地两道门（审批 + 交付）都可能阻塞，而**交付门现在会报 blocked 却无法解除失败依赖的死锁**（维度 2）；上游的风险则是「没有机械门，只有规划纪律」。

→ 判定：`tradeoff`。

---

## 建议优化清单（按收益/代价排序）

### 本波就应修的缺陷

**OPT-1 修复「失败依赖永久钉死下游」**（收益最高、代价最低）
- 改什么：给 failed 任务一条显式释放路径。最小形态二选一——(a) 在派工路径上把 failed 任务的 **pending** 下游级联为 cancelled（复用 `state.js:186-224` 的 cancelled 级联写法，调用点放在 `scheduler.js:291-295` 旁边）；(b) 新增 captain 动词「释放某 failed 任务的下游」，把每个 pending 下游的依赖表去掉该 id 并记录原因。
- 收益：解开当前真实盘面（t5/t6/t7/t9）；消灭一整类静默悬挂；让 `canDeclareDelivery` 的「failed 需要 follow-up repair」流程真正可达。
- 代价：低——一个 state helper + 一个调用点 + 单测。
- 风险：级联必须**响亮**（reason + status 可见 blocker），否则会掩盖真实失败。
- 可证伪断言：盘面 `{A failed, B 仅依赖 A}` 在一次派工后 B 要么 cancelled、要么已去掉 A 成为可领，**绝不保持 pending**；把 A 换成 completed 时 B 可领。

**OPT-2 让规模判断先于建队 + 自动建队残留回收**（与用户「agent-teams 不再默认」的要求同源）
- 改什么：取消 session-start 的无条件 provision（或把默认翻成 off/instruct），团队只在触发条件满足后创建；对「staged 且 0 任务且长期无活动」的自动团队做**归档**（可恢复，不删除）。
- 收益：顺序缺陷消失；22 个残留不再增长；`.mpd/team` 扫描面不再无限膨胀。
- 代价：触发条件必须由需求冻结；机械保证被有意放弃。
- 风险：触发若只写在提示词里，可能悄悄退回「单人会话」——这正是当初做机械策略要防的事。
- 可证伪断言：trivial headless 会话不产生任何 `.mpd/team` 记录；带触发词的会话恰好产生一个 staged 团队。

### 下一波输入（不在本波实施）

1. **OPT-3 批准后最小化重规划**（代价最高、收益也高）：任务定义摘要 + 刻意作废「单任务 + 传递下游」，未变的 completed 任务保留输出；**不要**让终态任务被隐式重跑。
   可证伪断言：改一个任务的 objective，只有它和传递下游代数递增，非下游 completed 任务的 attempt/output 不变。
2. **OPT-4 停滞探测**：任务级 `lastTransitionAt/lastError` + 成员活动记录（turns/最后一行），经 `agent_teams_status`/面板暴露；同时解决会话事件词表问题（用 harness 的 `ignorable` 标记保留事件，或明确文档化为磁盘权威）。
   可证伪断言：故意挂住的成员显示陈旧 lastTransitionAt/lastError，正常成员的数值在推进；持久日志能读回 agent-teams 事件（或文档明确为 disk-only）。
3. **OPT-5 背压**：`maxConcurrentMembers`（默认 4）+ 可选墙钟/尝试上限；注意 mailbox-first 分支必须排在槽位检查之前。
   可证伪断言：`maxConcurrentMembers=2` + 5 个 ready 任务时，同时最多 2 个成员 working，其余随槽位释放逐个派发。
4. **OPT-6 跨会话团队身份（可选）**：`agent_teams_create` 支持显式 team key 复用未归档团队；不要为此引入定义指纹。
5. **OPT-7 依赖产物**：任务契约增加可选 bounded artifact path，prompt 同时给摘要与路径，避免 20000/12000 截断悬崖。

### 明确不在本波范围

- 移植上游 DAG 引擎本体（wave/journal/WAL/lease/RPC）：本地是**持久成员**模型而非「每节点一个子任务」模型，移植等于替换被采纳插件的架构。
- 采纳 `definitionFingerprint` 作为身份：它被钉在 waveAdmission/failurePolicy/dependencyData 的调度语义上，无法脱离引擎单独搬用。
- team_mode 子系统的上限（成员并行/消息字节/墙钟/轮次）：那是另一套机制，不属于 DAG 引擎对照面。
- `packages/**`、`presets/**`、`scripts/**`、`skills/**`、`docs/**`、`AGENTS.md`、`VENDOR_LOCK.json`：本任务只读。

---

## 不确定项

| 项 | 原因 | 如何澄清 |
|---|---|---|
| 本机 harness 是否有可用的 `ignorable` 写入面 | `known-event-types.js` 头部把 `ignorable` 信封标记说成兼容机制，但本次只读调研没有实际调用写入 API；且集合内 `agent-teams/*` 条目为 0 | 隔离 DSH_HOME 的挂载式 boot：发一条 agent-teams 事件后把持久会话日志读回来 |
| 上游 `dependencyData:"filesystem-only"` 是刻意设计还是已知限制 | 协议与 skill 都陈述了行为、指纹也钉住了它，但本次阅读范围内没有找到决策记录 | 在上游 docs/notes 里找调度器身份决策记录；不影响本地决策 |
| t12 连续三次失败的根因 | 超出本任务范围；此处只把该事故作为「失败依赖死锁可达且已被触发」的证据 | 读 `.mpd/team/mpd-default-db53f0d4/team.json` 里 t12 的 output |

---

## 需要用户拍板的问题

1. 「agent-teams 不再默认」具体取哪种形态：完全 off（对齐 OMO）/ 仅 instruct 提示 / 触发式自动建队？触发词是什么？
2. OPT-1（失败依赖释放）是否按「级联 cancelled」的保守形态在本波修？还是希望「去掉失败依赖、保留下游可跑」的更激进形态？
3. OPT-3（批准后重规划）要不要做？它是本清单里唯一需要新状态机语义的改动。
4. OPT-5 是否需要一个板级并发上限（默认 4）？这会改变多成员同时开工的手感。
5. 25 个残留团队目录（其中 22 个 staged/0 任务）是按 OPT-2 归档回收，还是保留现状？
