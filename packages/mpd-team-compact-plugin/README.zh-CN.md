# mpd-team-compact-plugin

[English](./README.md) | **中文**

面向 **已结束团队** 的上下文压缩：当一个团队的每个任务都已终结、且每位成员都处于空闲时，
`mpd_team_compact_run` 会把成员们的上下文一次性、一起压缩，并把结果记录下来。它存在的意义是让
归档后的团队不再持续占用上下文 —— 由 captain 发起，被压缩的是成员。

## 工具

| 工具 | 输入 | 结果 |
|---|---|---|
| `mpd_team_compact_run` | `team_id?`、`force?` —— 默认处理本工作区内所有已结束团队 | 每个团队一次审计：团队结果以及每位成员的结果。只有在结果**发生变化**时才落盘；`force: true` 可强制写入 |
| `mpd_team_compact_status` | `team_id?` —— 默认处理所有有审计记录的团队 | 只读：已记录的批次（最新在后），包含被跳过的成员及其跳过原因 |

## 语义

- **触发条件** —— 团队中 **每个** 任务都已终结，且 **所有** 成员都空闲。0.1.7：旧的
  `.mpd/team/<teamId>/team.json` 已消失，而官方 Agent Teams 服务同样不提供“团队已结束”判定，因此触发条件
  改为由其实时读数的**两半**推导——每个任务都已终结（`teamListTasks`）**且**没有成员在活动
  （`teamListMembers`）。终结状态词表镜像在 `src/index.ts`（`TERMINAL_TASK_STATUSES`，官方
  `TeamTaskStatus = pending | in_progress | completed | deleted`），因为本仓库无法用裸模块名解析官方包
  （实测 `MODULE_NOT_FOUND`）。
- **对象** —— 只处理成员。captain 永远不会被压缩（那是用户的 `/compact`）。
- **屏障** —— 等待所有成员空闲，然后一起压缩。
- **方式** —— 无条件的显式 `compactNow`。返回 null 表示"没有可安全压缩的区间"，这会作为一条事实
  记录，而不是错误。
- **审计** —— `<工作区>/.mpd/team-compact/<teamId>/`，持续累积、绝不覆盖。它绝不会写到
  `.mpd/team`：那里已不再有任何宿主的团队文件——任务板归宿主所有、存放在 Lead 会话日志中，本插件只通过
  adapter **读**它。
- **静默** —— 只写审计。成员不会被通知；通知会把上下文又推回去。
- **触发器有两个，而只有一个能真正够到成员**：(1) `agent/status`（宿主自己的状态边沿）会重新检查每个已结束团队，但它触发时被释放的成员早已不在；(2) 成员**自己回合的边界**（`agent/turn-stopping`，也就是团队看门狗打 `turn-end` 用的那条边沿），这是可续子代理唯一还驻留的时刻——它的 Activation 是进程内的，结算时即被释放。2026-09-16 实测：235 次状态边沿的尝试产生了 2260 条 `skipped-not-live`，成功为 0，这就是 (2) 存在的原因。已经被释放的成员记为 `skipped-not-live`：够到它就意味着把它重新实体化，而那会把上下文又推回去。

## 设计约束（每一条都经过实测）

- **引擎按成员、通过该成员自己的 scoped context 解析**（`agent.ctx.get("compaction")`），并且只在
  一处实现：适配器的 `compactionEngineForAgent`。宿主面的引擎是**另一个**对象、服务另一个 realm，
  用它驱动成员会压缩错误的历史。
- **`compaction` 刻意不写进 `inject`。** 该服务由 `mpd` preset 组装，未挂载该 preset 的 profile
  根本没有它；而声明了却未注册的服务会让整行停在 `pending (waiting for service: compaction)`，
  这正是契约禁止的失效模式。因此它在驱动时惰性解析，并以警告降级。
- **`inject: ["tools"]` 则是必须的。** Cordis 只暴露该 context 声明过的服务，而适配器要从本行的
  context 读取工具注册表。
- **暂存成员**（`id === ""`）没有活的 Agent，会被显式跳过；captain 已消失的团队会被记作
  `not-live`，而不是被静默忽略。
- **`busy` 不是并发信号**：驱动一个忙成员会抛出 Cordis 生命周期错误（inactive context 中的
  `tokenMeter`），该类别与六种 `ManualCompactionError` 分类处理。
- `parameters` schema **以 object 为根**。实测过 `type: null` 根会让 provider 拒绝挂载会话的每一个
  模型请求，这正是单测与挂载级的 `TOOL_PARAM_SCHEMAS` 探针都要钉住它的原因。

## 状态

| 路径 | 说明 |
|---|---|
| `<工作区>/.mpd/team-compact/<teamId>/` | 审计台账：只在结果**变化**时记录一条，持续累积（完全相同的重复次数记在下一条记录的 `suppressed` 字段里） |

## 关卡

- `bun test packages/mpd-team-compact-plugin` —— 离线单测（`test/compaction.test.ts`）。
- `bun run typecheck`。
- 启动检查：该行必须真正 **apply**（需要挂载证明，绝不能只看 `--dump-config` —— AGENTS.md §4）。

## 相关

- 使用者视角的团队模式：[`../../docs/user-guide.zh-CN.md`](../../docs/user-guide.zh-CN.md) §6。
- 拥有 `.mpd/team` 的插件：[`../mpd-agent-teams-plugin/README.md`](../mpd-agent-teams-plugin/README.md)。
