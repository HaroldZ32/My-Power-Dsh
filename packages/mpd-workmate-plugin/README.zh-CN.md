# mpd-workmate-plugin

**中文** | [English](./README.md)

位于用户 HOME（`~/.mpd/workmate`）的持久、不断演化的 agent 库。

专家名册（roster）中的专家（`mpd-roles-plugin`）**只是 BASE 模板**。一个 *workmate*（工作伙伴）是带独立名称的实例化副本，它：

- **初始化**自基础专家（base specialist）（`mpd_workmate_init`），将基础 persona 复制到 `~/.mpd/workmate/<name>/`（基础对象保持原样）；
- **在每次工作会话后自总结**（`mpd_workmate_reflect`）：追加一条有界的内存条目（超出上限时逐出最旧的条目），合并一个可选的 persona 修订，并重新生成一张简短的 note 卡片——所有文件都**受大小上限约束**（persona ≤ 8 KiB、memory ≤ 8 KiB、note ≤ 1.5 KiB），以保持生成的上下文有界；
- 通过 **note 匹配**（`mpd_workmate_match`）**复用**：如果最佳 note 分数低于阈值，它会报告 `matched: false`，此时应初始化一个新的 workmate，而不是强行使用弱匹配；
- **重命名**（`mpd_workmate_rename`）时是**搬移**其已经演化的身份，而不是重新实例化；**删除**（`mpd_workmate_delete`）默认**先归档**——移出库到 `~/.mpd/workmate/.archive/`，在那里它对 `list`/`match` 不可见但仍可恢复。彻底移除需要显式的 `purge`。

## 库布局

```
~/.mpd/workmate/
  index.json                    # fast library index
  <name>/
    meta.json                   # name, base, provider/model, readonly, uses, lastTask, renamedFrom
    persona.md                  # evolving persona (seeded from base)
    memory.md                   # independent memory (append + evict)
    note.md                     # short searchable note card
  .archive/
    <name>-<stamp>/             # 已归档（已删除）的实例：不在库中，但可恢复
```

## 命名规则（仅 ASCII）

一个 workmate 名称被接受，当且仅当它**已经是自己 sanitize 之后的形式**且非空：仅 ASCII、小写、`[a-z0-9_-]`。`Alice`、CJK 名称、`a/b`、`..` 与 `.archive` 都会在**任何文件系统调用之前**以 `400 invalid-name` 拒绝，因此库根目录永远不会被当作一个实例寻址。Unicode/CJK workmate 名称是刻意延后的（作为列出的后续项，而不是缺陷）。实例键**就是目录名**；`meta.name` 只是一个显示镜像，会在下一次写入时被修复——这正是"重命名被中断也无害"的原因。

库根目录刻意放在用户的 HOME（跨项目），这是对工作区作用域状态规则（AGENTS.md §6）的、经用户批准的例外。QA 以 `HOME=<sandbox>` 启动，因此测试绝不会触碰真实 home。

## 工具

| Tool | Purpose |
|---|---|
| `mpd_workmate_list` | list instances (name, base, uses, updatedAt, note summary) |
| `mpd_workmate_init` | instantiate a base specialist into an independently-named workmate |
| `mpd_workmate_spawn` | one-shot reuse: subagent with the workmate's persona+memory+note on its own model route (readonly bases deny write tools) |
| `mpd_workmate_reflect` | self-evolve after work: memory append/evict, persona revision merge, note regen |
| `mpd_workmate_match` | rank notes against a task; below threshold → suggest a new init |
| `mpd_workmate_rename { name, new_name }` | 重命名实例：搬移目录键 + 元数据 + 索引键 + note 自引用（见下文） |
| `mpd_workmate_delete { name, purge?, confirm? }` | 删除实例：默认先归档；`purge: true` + `confirm: <name>` 才彻底移除 |

同时提供 `mpdWorkmate` 服务（`list` / `get` / `read` / `rename` / `delete`）。
`list` / `get` / `read` 直接由磁盘派生，因此**下一次调用**就会反映变更（无缓存）：重命名后
`get(oldKey)` 为 `null`、`get(newKey)` 为完整详情。`renamedFrom` 携带先前的键，并且**仅作信息
展示**——它从不用于解析名称，因此之后用旧键调用会以 `no workmate named "<oldKey>"` 失败且没有任何
副作用，而不会静默复活旧目录。

## 重命名与删除

**重命名**（`mpd_workmate_rename { name, new_name }` → `{ ok, name, from, renamedFrom }`）
搬移整个已演化的身份，绝不重新实例化：目录键、`meta.name`、`index.json` 键、`note.md`
自引用与 `renamedFrom`（先前名称，去重、上限 10）一起搬移。`persona.md` 与 `memory.md` 的字节、
大小上限、`uses`、`lastTask` 与 `createdAt` 都**逐字节保留**，只有
`updatedAt` 改变；`note.md` **仅**在前缀为 `<baseName>-based workmate "<oldKey>".`（即 `autoNote`
写出的确切文本）时被改写——自定义 note 的字节保持不动。归档的团队记录属于历史，刻意**不**重写。
拒绝情形：`new_name` 非法或含非
ASCII → `400 invalid-name`；重命名到同一个键（仅大小写不同的重命名会 sanitize 成同一个键）
→ `400 invalid-name`；目标已存在 → `409 collision`；该 workmate 正在被使用 → `409 in-use`。

**删除**（`mpd_workmate_delete { name, purge?, confirm? }`）默认**先归档**：实例被移入
`~/.mpd/workmate/.archive/<name>-<compactUtcStamp>/`，并立即从 `list` / `match` / 服务中消失。
点号开头的归档目录不是一个可寻址实例，因此永远不会被列出、匹配或修改。`purge: true` 才真正
移除，并且额外要求 `confirm` 等于确切名称——否则调用以 `400 confirm-required` 被拒绝，什么
都不会被销毁。返回结果：归档为 `{ ok: true, name, archived: "<path>", purged: false }`，
彻底删除为 `{ ok: true, name, archived: null, purged: true }`（工具、服务与 HTTP 响应体三者
形状一致）。两条路径都会删除索引键，不会改变任何其他 workmate 的字节，失败的删除也绝不会
留下一个被部分移除的实例。

**先归档在产品内是单向的**：没有任何工具、路由或 GUI 能恢复已归档实例。恢复方式是把目录手动
搬回库中：

```bash
mv ~/.mpd/workmate/.archive/<name>-<stamp> ~/.mpd/workmate/<name>
```

之后该实例会重新出现在列表并可被寻址（目录名即键）。

### 正在被使用时拒绝

两种变更在该 workmate **正在被使用时都会被拒绝**，且不做任何改动：`409 in-use`，并带一个
`blocking` 列表，逐一列出阻塞的团队 id + 成员。"正在被使用"指二者之一：本进程内有一个正在
进行的 `mpd_workmate_spawn`，或者 `<workspace>/.mpd/team/<teamId>/team.json` 下存在一个未归档
的团队记录、其成员包含它。解除阻塞要等运行中的 spawn 结束，**并且**归档（或退休）那些团队，
然后重试变更。注意其必然结果：若某个团队记录的成员名等于某个 roster 角色名，就会阻塞与之相同
的键——因此只要这类记录存在，把任何东西重命名为 `architect` 都会被拒绝。

### HTTP 路由（web profile）

`POST /plugins/mpd-workmate/rename`（`{ name, new_name }`）与
`POST /plugins/mpd-workmate/delete`（`{ name, purge?, confirm? }`），外加既有的
`GET /list`、`GET /roster`、`GET /get?name=` 与 `POST /init`。每个响应都带
`content-type: application/json; charset=utf-8` 与 `cache-control: no-store`：

| 情形 | 状态 | 响应体 |
|---|---|---|
| 重命名成功 | 200 | `{ ok: true, name: <newKey>, from: <oldKey>, renamedFrom }` |
| 归档式删除成功 | 200 | `{ ok: true, name, archived: "<path>", purged: false }` |
| 彻底删除成功 | 200 | `{ ok: true, name, archived: null, purged: true }` |
| 动词错误 | 405 | `allow: POST` 头，空响应体 |
| JSON 请求体非法 | 400 | `{ error }` |
| 名称非法 / 含非 ASCII / 为空 | 400 | `{ error, reason: "invalid-name" }` |
| 未知 workmate（重复删除亦然） | 404 | `{ error, reason: "unknown" }` |
| 重命名目标已存在 | 409 | `{ error, reason: "collision" }` |
| 因正在被使用而拒绝 | 409 | `{ error, reason: "in-use", blocking: [{ teamId, member }] }` |
| 彻底删除未带 `confirm === name` | 400 | `{ error, reason: "confirm-required" }` |

重复删除刻意返回 `404`，而不是幂等的 `200`。路由注册保持惰性（需要 `webServer`），因此
headless profile 只有工具、没有路由。错误响应体永远不会泄漏绝对 `$HOME` 路径。

## GUI（Workmates 侧边栏 Tab）

Workmates Tab 暴露这两种操作：一个**预填当前键**的重命名字段，以及一个显式的两步删除——第一次
点击只打开确认步骤，归档步骤说明这是先归档且可恢复，彻底删除步骤说明它不可撤销并要求输入确切
名称。重命名成功后会重新选中新键；删除会离开详情面板且绝不重新读取已失效的键。页面主体完全
本地化（zh/en），每种拒绝原因都从词典渲染。侧边栏**标签栏文字**仍是硬编码英文 `Workmates`
——这是有记录的延后项（它在 Tab 注册时解析，那里没有本地化的翻译函数可用，与相邻的 AgentTeams
Tab 完全一致），而不是疏漏。

## 团队集成（dsh-agent-teams）

`packages/mpd-agent-teams-plugin` 的 `memberPersona()` 被修补（该插件是一等 main 代码），因此名称匹配某个 workmate 实例的成员，其系统提示中会注入该 workmate 的 persona + memory，并且在每项任务结束时注入一条 `mpd_workmate_reflect` 指令——"captain 检查 note，委托给以 workmate 命名的成员"。`mpd` preset 和 roster profile 中的 captain 指南要求：在委托前先查询 `mpd_workmate_match`；弱匹配 → 初始化一个新的 workmate。

## 构建 / 测试

```bash
bun build src/index.ts --target node --format esm --outfile dist/index.js
bun test packages/mpd-workmate-plugin   # 离线生命周期测试（沙箱 HOME），含重命名/删除
```

任何内嵌只读 deny 列表的 `dist/index.js` 都必须在同一次改动中重新构建：仓库运行的是 `dist`，
不是 `src`。
