# mpd-goal-plugin
**中文** | [English](./README.md)

C8 —— 把持久化 GOAL 作为持续化执行的依据。

Harness 本身已经交付了完整的 goal 域：`@deepseek-ai/dsh-goal`（每会话状态机）、
`@deepseek-ai/dsh-tool-goal`（`get_goal` / `create_goal` / `update_goal`）与
`@deepseek-ai/dsh-goal-round-driver`（自动续行轮次），`mpd` preset 也挂了 goal 工具与 `/goal`
命令行。缺的是**没有任何一行去调用它们**：一次长时间 mpd 运行在一个 turn 内结束，没有留下任何
能让 driver 继续下去的持久状态。

本行补上这一环：它增加一组面向模型的工具与一个服务，并让长任务**自动**anchor 一个 goal，于是
"做到目标真正达成为止"成为 harness 的职责，而不再需要用户再发一次指令。

## 工具

| Tool | Purpose |
|---|---|
| `mpd_goal_status` | 读取当前会话的 goal（id、revision、objective、phase、已用/上限轮次、activation、anchor）。无需 driver。 |
| `mpd_goal_anchor` | 为长目标建立持久化 goal。若已有未完成的 goal，则**保留它**，绝不替换。 |
| `mpd_goal_finish` | 将当前 goal 标记完成（或尝试标记阻塞）并停用自动续行。 |

## `mpdGoal` 服务（由 `mpd-ulw` 与 `mpd-boulder` 消费）

`available()` / `autoAnchor()` / `status(exec)` / `anchor(exec, {objective, source, maxRounds?})` /
`finish(exec, {outcome, source, reason?})`。两个消费方都用 `ctx.get("mpdGoal")` 惰性解析，因此
没有本行的组合只是"没有持久 goal"，其余功能照常。

## 自动 anchor 契约

| 触发 | 行为 |
|---|---|
| `mpd_ultrawork` 且 `tier=heavy` 或 `plan=true` | 为该次运行的目标 anchor 一个 goal；goal id 写入本次运行的 `state.json`。 |
| `mpd_boulder_start`（绑定 plan 的工作） | anchor 一个以 plan 与 work id 命名的 goal。 |
| 运行以 `complete` 结束 | 完成该 goal（anchor 记录随即删除）。 |
| 运行以 `blocked` 结束 | **尝试** `blocked`；harness 可能因其连续轮次阈值而拒绝，拒绝只记日志、绝不致命。 |
| 运行以 `max-rounds` 结束 | goal **故意保持启用**：这正是 goal 存在的场景 —— turn 内的引擎停了，由轮次 driver 接着推进。 |
| 不是本行 anchor 的 goal | 永不 complete、永不 block：归属按会话记录在 `<workspace>/.mpd/goal/anchors.json`。 |

## 配置（`mpd.jsonc` 的 `goal` 块；row config 为兜底）

| Key | Default | Meaning |
|---|---|---|
| `goal.enabled` | `true` | 总开关；`false` 时工具与服务都失效。 |
| `goal.autoAnchor` | `true` | 长任务是否自行 anchor goal。 |
| `goal.autoRounds` | `32` | 自动 anchor 的 goal 使用的轮次上限。 |

## 策略属于 harness，不属于本行

所有变更都走 goal **工具**。域的授权就在那里 —— `create` / `edit` / `pause` / `resume` 需要
顶层 agent 上的直接人类轮次，`blocked` 需要配置的连续轮次数，且每次调用都要求精确的活跃调用
agent 处于活动 driver 之内。直接写 `ctx.goals` 的行可以武装一个连模型自己都无法建立的 goal，
因此本插件**刻意做不到**：它的 adapter seam 只暴露读与工具。

## 降级

`capabilities().goals`（持久读）与 `capabilities().goalTools`（写路径）分别上报，每个入口都降级
而不抛异常：服务缺失则尝试工具读；工具缺失则 `mpd_goal_anchor` 明确报告 goal 面未挂载；harness
的拒绝（策略拒绝、过期 revision、无 goal）以 `ok:false` 返回并携带 harness 自己的文案。

## 构建 / 测试

```sh
bun build packages/mpd-goal-plugin/src/index.ts --target node --format esm --outfile packages/mpd-goal-plugin/dist/index.js
bun test
```
