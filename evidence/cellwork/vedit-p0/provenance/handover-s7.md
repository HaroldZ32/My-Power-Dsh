## 7. MPD 插件告警（下一次开工前必读）

本 cell **两次**撞上插件的 checkpoint/reseed 缺陷：
`the compaction barrier gave up and fenced it (no-engine; the reseed failed: subagent creation requires the exact live parent agent)`。
**se-i18n 与 se-shell 两名成员在写完 handoff 后被 fenced**。已验证可用的修复：

- 被 fenced 成员的任务用 **`cellwork_dispatch {reassign:[{task_id, owner}]}`** 转给存活成员（会先 claim 再投递）。
- **`cellwork_send` 在成员有 8 条未投递消息后会拒发**；此时用官方 **`agent_teams_mail`** 作为 fallback。
- **G7 由三位写者经 handoff 接力完成**（se-i18n → se-shell → dw-rust）：任务测得体量大时，
  直接把“多棒接力”写进计划，别假设一个人扛完。
- **`agent_teams_plan create_task` 不传 `write_scopes` 会生成空 writeScopes 的冻结契约，直接卡死写者**：
  永远显式给 `write_scopes`，或在第一次写之前书面授权。
