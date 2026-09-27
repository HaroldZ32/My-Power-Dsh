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
| `agent_teams_dispatch` | `dry_run?`、`limit?` | **把就绪任务与空闲成员配对**，并通知每个成员去做自己的任务；一趟一班，且记录在案 |
| `agent_teams_dispatch_release` | `task_id` | 释放一个已派发任务，使其可再次派发 |
| `agent_teams_mail` | `action`、`to?`、`subject?`、`body?`、`member?`、`ids?` | 团队信箱：`send` / `unread` / `read` / `summary` |
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
- **信箱是我们自己的**，因为官方那个答不了队长真正要问的问题。它持久化的只有 `messages` 和 `delivered`，
  "已读"在它那里**无处可观测**，所以"对方到底**看见**没有"没有答案。`agent_teams_mail` 自己拥有
  `sent → delivered → read` 全生命周期：记录写在 `<workspace>/.mpd/team/mailbox.jsonl`（**只追加**，所以崩溃最多丢最后一行、
  绝不丢整个文件），投递仍走官方传输以保证成员真的收到，而 `read` 是接收方的**显式确认**。
- 从官方实现**吸收**的精华（每一条都是在那边吃过亏换来的）：消息**定向**给按名字解析出的活成员；成员不能给自己发；
  成员的**未投递积压有上限**（官方是 `TEAM_MAILBOX_FULL`）；队列保持插入顺序。
- **一切按工作区定位**，经 `dsh.workspaceRoot(exec)`，绝不用进程 cwd。

## 配置

无。本插件只声明 `tools` 与 `commands`，并全部经 adapter 解析。

## 已知边界

- 暂停会**停住派工**（`agent_teams_dispatch` 整趟拒绝并说明原因），别的什么都不做：不打断成员，也不改任务。
- `agent_teams_dispatch` 每趟只把一个任务配给一个成员，并把配对记进 `.mpd/team/dispatch.json`，所以第二趟不可能把同一个
  任务再交给另一个队友——**消息不是台账**。被删除或已在外部完成的任务，其台账条目会先被清理，成员因此永远不会被"永久占用"。
  它由队长或调度 lane 调用时运行，**不是一个后台定时器**。
- `agent_teams_approve` 无法回滚。
- 信箱没有未读数：官方收件箱不暴露已读状态，硬造一个只会报错数。
