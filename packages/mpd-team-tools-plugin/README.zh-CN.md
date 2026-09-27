# mpd-team-tools-plugin

[English](./README.md) | **简体中文**

官方 Agent Teams 运行时之外的**工作流**。Harness 0.1.7-rc.2 的官方插件只管团队本身——名册、共享看板、信箱、
可续接的队友——别的都没有。而被退役的自研体还带有队长真正要用的那些评审点：一支在**任何人存在之前**就能被阅读、
编辑、批准的暂存计划，认领时冻结的任务契约，暂停，以及归档。这些东西现在住在这里。

名册与看板**绝不**复制：它们始终属于官方服务，经 `mpd-dsh-adapter` 读写。本插件只保存官方服务没有字段承载的
东西，位置是 `<workspace>/.mpd/team/`。

## 工具

| 工具 | 输入 | 结果 |
|---|---|---|
| `agent_teams_create` | `name`、`description?`、`approval?`、`replace?` | 为本会话暂存一份计划；**不创建任何东西** |
| `agent_teams_add_member` | `name`、`prompt`、`description?`、`role?` | 往暂存计划里追加一名队友 |
| `agent_teams_create_task` | `subject`、`description`、`blocked_by?`、`write_scopes?`、`owner?` | 往暂存计划里追加一个共享任务 |
| `agent_teams_edit_plan` | `members?`、`tasks?`、`description?` | 读回计划，或原子地替换它的两个列表 |
| `agent_teams_approve` | `dry_run?` | **执行**它：用 `spawn_teammate` 逐个起成员、把每个任务投到官方看板、指派负责人 |
| `agent_teams_delete` | — | 归档优先：把计划移到 `.mpd/team/archive/<planId>/` |
| `agent_teams_claim_task` | `task_id`、`claimant?` | 在官方看板上认领，**并**冻结契约，带单调递增的 `attempt` |
| `agent_teams_task_contract` | `task_id?` | 一份冻结契约，或全部契约（按认领时间倒序） |
| `agent_teams_halt` | `reason` | 记下一次暂停：新派工停止，团队与成员都还活着 |
| `agent_teams_resume` | — | 解除暂停 |
| `agent_teams_status` | — | 把暂存计划与暂停**并排**放在官方名册和看板旁边 |

`/agent-teams <这支团队是干什么的>` 会按当前目标暂存一份计划。

## 语义

- **计划是评审点，不是队列。** `agent_teams_create` 只写计划就返回；唯一能造出队友的动作是 `agent_teams_approve`。
  `dry_run: true` 会如实报告批准将要做什么，但什么都不做。
- **每个会话只有一份暂存计划。** 再次暂存会替换未批准的那份（旧的进归档）；替换**已批准**的计划需要
  `replace: true`，因为那是一个刻意的动作。
- **批准的"报告"是事务性的，"效果"不是。** 先起成员，再投任务，其中 `blocked_by` 由计划里的主题解析为已投任务的
  id，`owner` 由暂存成员名解析为已生成的 id。失败即停下并指明停在哪一步——已完成的部分保留并上报，**绝不回滚**，
  因为已经起来的队友无法"取消生成"。
- **契约是任务被认领那一刻的"含义"。** `attempt` 按任务单调递增，是"这是 t4 的第几次尝试"唯一的答案：官方看板的
  `revision` 会因任何改动而前进，因此不能替代 attempt。
- **暂停不是结束。** 它只记录一次 hold；不打断任何成员，也不归档任何东西。
- **一切按工作区定位**，经 `dsh.workspaceRoot(exec)`，绝不用进程 cwd。

## 配置

无。本插件只声明 `tools` 与 `commands`，并全部经 adapter 解析。

## 已知边界

- 暂停是一条**记录**，不是调度器：本插件没有派工循环，所以 `agent_teams_halt` 停住的是"队长或调度 lane 读到它
  之后不去派工"这件事，不能推断出别的。
- `agent_teams_approve` 无法回滚。
- 信箱没有未读数：官方收件箱不暴露已读状态，硬造一个只会报错数。
