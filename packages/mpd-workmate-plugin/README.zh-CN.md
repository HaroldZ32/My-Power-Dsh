# mpd-workmate-plugin

**中文** | [English](./README.md)

位于用户 HOME（`~/.mpd/workmate`）的持久、不断演化的 agent 库。

OMO 名册（roster）专家（`mpd-roles-plugin`）**只是 BASE 模板**。一个 *workmate*（工作伙伴）是带独立名称的实例化副本，它：

- **初始化**自基础专家（base specialist）（`mpd_workmate_init`），将基础 persona 复制到 `~/.mpd/workmate/<name>/`（基础对象保持原样）；
- **在每次工作会话后自总结**（`mpd_workmate_reflect`）：追加一条有界的内存条目（超出上限时逐出最旧的条目），合并一个可选的 persona 修订，并重新生成一张简短的 note 卡片——所有文件都**受大小上限约束**（persona ≤ 8 KiB、memory ≤ 8 KiB、note ≤ 1.5 KiB），以保持生成的上下文有界；
- 通过 **note 匹配**（`mpd_workmate_match`）**复用**：如果最佳 note 分数低于阈值，它会报告 `matched: false`，此时应初始化一个新的 workmate，而不是强行使用弱匹配。

## 库布局

```
~/.mpd/workmate/
  index.json                    # fast library index
  <name>/
    meta.json                   # name, base, provider/model, readonly, uses, lastTask
    persona.md                  # evolving persona (seeded from base)
    memory.md                   # independent memory (append + evict)
    note.md                     # short searchable note card
```

库根目录刻意放在用户的 HOME（跨项目），这是对工作区作用域状态规则（AGENTS.md §6）的、经用户批准的例外。QA 以 `HOME=<sandbox>` 启动，因此测试绝不会触碰真实 home。

## 工具

| Tool | Purpose |
|---|---|
| `mpd_workmate_list` | list instances (name, base, uses, updatedAt, note summary) |
| `mpd_workmate_init` | instantiate a base specialist into an independently-named workmate |
| `mpd_workmate_spawn` | one-shot reuse: subagent with the workmate's persona+memory+note on its own model route (readonly bases deny write tools) |
| `mpd_workmate_reflect` | self-evolve after work: memory append/evict, persona revision merge, note regen |
| `mpd_workmate_match` | rank notes against a task; below threshold → suggest a new init |

同时提供 `mpdWorkmate` 服务（`list` / `get` / `read`）。

## 团队集成（dsh-agent-teams）

`packages/mpd-agent-teams-plugin` 的 `memberPersona()` 被修补（该插件是一等 main 代码），因此名称匹配某个 workmate 实例的成员，其系统提示中会注入该 workmate 的 persona + memory，并且在每项任务结束时注入一条 `mpd_workmate_reflect` 指令——"captain 检查 note，委托给以 workmate 命名的成员"。`mpd` preset 和 roster profile 中的 captain 指南要求：在委托前先查询 `mpd_workmate_match`；弱匹配 → 初始化一个新的 workmate。

## 构建 / 测试

```bash
bun build src/index.ts --target node --format esm --outfile dist/index.js
bun test packages/mpd-workmate-plugin   # offline lifecycle tests (sandbox HOME)
```
