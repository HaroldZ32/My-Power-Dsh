# mpd-memory-plugin
**中文** | [English](./README.md)

基于 git/svn 的记忆引擎，带一个 reflection（反思）状态机。

**本包是 mpd 自有代码。** 引擎的语义——markdown 记忆文件带 frontmatter（`description`/`kind`/`aliases`/`read_only`）、journal 加 facts 队列（属于已记录的存储布局；目前没有工具写入它）、以及一个按步数计数的 reflection reducer——是依据上游包 `memory-core` 的**已记录行为**（base 8c57e46）在此**重新表达**的。没有翻译任何上游源码，也没有复制任何上游提示词或文本。

**VCS 抽象与 svn 后端是我们自己的，不属于上游。** 上游 `memory-core` 是**仅 Git** 的（`GitMemoryRepo`；并不存在 `SvnMemoryRepo`），因此 `git | svn | both` 模式及其 svn 一侧的全部实现都是本包自己的工作——绝不可把这套框架说成源自上游。

*历史。* reducer 的早期草稿沿用了上游的状态机词汇（`reflected_completed_steps`、`steps_since_last_successful_reflection`、`reservation`，以及某个工具描述里的 `completeTransition`）。**de-omo wave F 已用本包自己的词汇替换之**：`reflectionsCompleted`、`stepsSinceReflection`、`pendingReflection`。

## 两个存储：workspace（默认）与 global（wave W3-D）

引擎用**一套数据形状**服务**两个存储**：

- **workspace**——默认，也是 W3-D 之前的行为：按 agent 隔离，位于
  `<workspace>/<memory.dir 或 ".mpd">/memory/agents/<slug>/{repo,runtime}`；
- **global**——跨所有项目共享，位于
  `<HOME>/.mpd/memory/{repo/memory/*.md, runtime/{journal.jsonl, index.json}}`（`memory.globalDir` 可覆盖根）。

`mpd_memory_write`、`mpd_memory_read`、`mpd_memory_status` 接受 `scope: "workspace" | "global"`，默认
`workspace`，因此**现有调用语义不变**。`mpd_memory_reflect`、`mpd_memory_reflect_complete` 仍只作用于
workspace——reflection 是按 agent 的行为，不是全局行为——所以 **global 写入永不推进 reflection 计数器**
（只报告调用者已有的 claim）。两个存储共用同一套 VCS 语义（`memory.vcs`：默认 `git`，以及 `svn`、`both`），
经由同一个 `ensureVcs`/`commitAll`，且 global 写入的 `committedTo`/`errors` 与 workspace 写入完全一致。
**读取永不创建存储**：`<HOME>/.mpd/memory` 尚不存在时，`scope:"global"` 的读/状态返回空结果，因为创建它
本身就是守卫刻意不覆盖的 HOME 变更。

### HOME 守卫——包含关系在 `$HOME` 之内（wave W0 的共享判据）

`~/.mpd/memory` 是本包唯一写入的 HOME 作用域状态根，因此每一次 **global 变更**都经过适配器共享的 T-43 守卫
（`assertHomeMutationSandboxed`，前缀 `mpd_memory`，覆盖变量 `MPD_DSH_MEMORY_ALLOW_REAL_HOME=1`）。它执行的
规则是**包含在 `$HOME` 之内**，而不只是“这是不是真实的 home”（autoproject 重构计划的前向注记 F1）：当
`DSH_HOME` 标记这是一个隔离的 QA/验证启动时，位于 `$HOME` **之外**的 global 根会被**拒绝**——即使它不是用户
真实的 home。因此隔离启动要写 `memory.globalDir`，该目录必须位于沙箱 `$HOME` 内。拒绝是 `HomeGuardRefusal`
（`code: "real-home-refused"`，`status: 403`），且在**创建任何目录之前**抛出；有意的覆盖就是上面的变量。
读取永不被守卫。

### 项目归档钩子（确定性摘要，无模型调用、无网络）

**一个** post-execute 监听器（`dsh.onPostToolExecute`，由本行的 `ctx.on("dispose")` 清理释放）把**已关闭的
项目**变成一条 global 记忆条目：

| 工具事件 | `projectKey` |
|---|---|
| `mpd_boulder_complete` | 完成的 `workId` |
| `cellwork_stop`（仅限被接受的停止；被拒绝的 `{ok:false}` 不关闭任何项目） | 归档的 `cellId` |
| `agent_teams_plan` 且 `arguments.action === "delete"` 且归档计划带有 `approvedAt`（未批准的计划从未成为项目） | 计划的 `teamId`，否则 `planId` |

条目是一个 `kind:"fact"`、`scope:"global"` 的 markdown 文件，tags 为 `["project","archive",<eventKind>]`，
正文是确定性摘要，固定四节——**What was built**（目标，加上能读到的 plan/team/cell 任务标题）、**Proof**
（最新的 `.mpd/verify` loop id、判定记录与证据路径，加上 `mpd-gates.json` 的 sha256）、**Where**（声明的写入
范围）、**Open**（被阻塞的任务、停止原因、未解决的引用）。无法读取的来源会列在 **Unreadable** 下，**绝不臆造**。
键在 `runtime/index.json` 中以 `<workspace>:<projectKey>` 命名空间化；同一键的第二次事件会**覆盖**已有条目并追加
`superseded` journal 记录——一个项目始终只有**一条**记忆，而第二次关闭这一事实仍然留存。监听器**永远返回**
`undefined`（既不能改写也不能否决工具结果），并把每个失败收敛为 `<workspace>/.mpd/logs/mpd-memory.log` 中的
**一行**；当 `mpdTeams` 服务缺失时，它降级为一次带一行日志的 no-op，而不是写入一条它无法识别的团队条目。

## 持久化状态

状态文件是 `<runtime>/reflection.json`，它是真实的用户数据：wave F 之前写入的记录带有旧字段名，因此读取端**仍然接受**它们并映射为当前字段（`adoptLegacyState`）。该映射只读——下一次 reflection 更新只会持久化当前字段名，不残留任何旧键，因此不需要单独的迁移步骤。仓库中没有其他地方读取这些字段：`skills/dsh-qa` 的 memory smoke 用例只读写入计数器 `steps`。

## VCS 后端（`memory.vcs`: git | svn | both）

- `git`：`repo/.git` 工作副本；每次写记忆即提交。
- `svn`：用 `svnadmin create`（file:// URL）创建 `root/svn-repo`，再检出到 `repo/`；每次写入执行 `svn add --force` + `svn commit`。
- `both`：同时提交到 git 与 svn（svn primaries 位于 svn-repo 之下）。
- svn 依赖 `svn` CLI（安装：Debian/Ubuntu 上 `apt install subversion`，macOS 上 `brew install subversion`，Windows 上使用 TortoiseSVN CLI）。
- **已用真实 svn 1.14.5 验证**：`svnadmin create` → checkout → write → `svn commit` → `svn log` 显示该记忆提交（evidence/plan-c/c6-memory/svn-real）。

## 路径

- workspace 存储：`<workspace>/<memory.dir 或 ".mpd">/memory/agents/<slug>/{repo, runtime/{reflection.json, journal.jsonl}}`
  （slug = `config.agentSlug`，或由 workspace 基线名推导）；
- global 存储：`<HOME>/.mpd/memory/{repo/memory/*.md, runtime/{journal.jsonl, index.json}}`
  （`memory.globalDir` 可覆盖根）。

## 工具

- `mpd_memory_write({title, content, kind?, tags?, readOnly?, scope?})` — 持久化并提交到所指存储
  （默认 `workspace`）；只有 workspace 写入才递增 reflection 步数计数器（跨过 `reflectionEvery` 时给出“到期”提示）。
- `mpd_memory_read({query?, kind?, limit?, offset?, scope?})` — 在某个存储的条目上做子串/别名搜索，**分页**：
  `limit` 限制在 1..50（默认 20），`offset` 指定页起点（默认 0），返回值带 `count`（**匹配总数**）、`offset`、
  `returned` 与 `next_offset`（下一页起点，到尾时为 `null`）。条目按**条目文件名升序**返回——一个不依赖目录枚举
  顺序的稳定顺序——因此沿 `next_offset` 走能恰好一次覆盖每个匹配；`scope` 过滤后在该存储的匹配集上分页。
- `mpd_memory_reflect` / `mpd_memory_reflect_complete` — reflection 状态机（仅 workspace）。
- `mpd_memory_status({scope?})` — vcs 模式、存储根、条目计数、reflection 计数器。

## 构建 / 测试

```sh
bun build packages/mpd-memory-plugin/src/index.ts --target node --format esm --outfile packages/mpd-memory-plugin/dist/index.js
bun test    # workspace + global 存储、HOME 守卫、归档钩子、svn 后端（fake CLI 接线）
```


## 分页与归档钩子的 supersede 规则（波次 W4）

`mpd_memory_read` 支持**分页**：传 `offset`（默认 0）与 `limit`（默认 20，最大 50）；答案携带
`count`（**匹配总数**，不是本页数量）、`offset`、`returned` 与 `next_offset`（到底时为 null），顺序稳定
（按条目文件名升序），因此连续调用会把每个匹配恰好走一遍。

归档钩子为每个项目键写**一条** `kind:"fact"`、`scope:"global"` 条目。同一键的第二次事件会**覆盖**该条目并记
`superseded`（条目自身的计数器记录被后续事件替换了多少次），因此一个已完工项目永远不会长出第二条全局条目。
摘要是**确定性**的 —— 建了什么、证明路径、范围与未完成项 —— 不调用模型、不联网。

## dsh-Go 工具卡片

`mpd_memory_read`、`mpd_memory_write` 与 `mpd_memory_status` 还会通过 `output.presentationMeta` 发布原生
**dsh-Go 工具卡片**：每张卡片都是一棵 v1 视图树（`stack` 标题 → `row` 指标 → `keyValue`/`table`），不带数据
绑定、不带按钮，并在发布前按应用的 8 KiB / 40 节点 / 深度 6 工具卡片预算测量。构建失败的卡片返回 `{}`，
应用于是回退到通用工具行。文本 `render` 与各输出 schema 均未改动。
