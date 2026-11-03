# 邮件面（`agent_teams_mail`、`cellwork_send`）

**中文** | [English](./mail.md)

本 bundle 里所有 agent 与 agent 之间的消息都走**同一条**持久流：`<workspace>/.mpd/team/mailbox.jsonl`。
团队面（`agent_teams_mail`）与 cellwork 视图（`cellwork_send` / `cellwork_inbox`）只是同一条日志上的两个
界面，所以不论哪一侧写入，成员读到邮件的方式都一样。

结构化载荷（`question` / `answer` 信封、校验器与容错折叠）在
[`mpd-mail-protocol`](../packages/mpd-mail-protocol/README.zh-CN.md) 里。本页是使用者视角：一条记录是什么、
谁可以给谁发、谁可以确认哪几条、什么情况下等待才允许阻塞，以及**不**承诺什么。

## 一条流，三种 kind

记录的 `kind` 说明它携带什么；在协议出现之前写入的行根本没有 `kind`，折叠会把它读成 `message`，因此旧
日志依然可读。

| `kind` | 携带内容 | 折叠结果 |
|---|---|---|
| `message` | 只有 subject 与 body | 普通记录 |
| `question` | `question: { questionId, header?, question, options[], multiSelect? }` | 一条必须被应答「逐字回显标签」的记录 |
| `answer` | `answer: { questionId, answerTo, selected[], custom? }` | 应答**某一条** `question` 记录的记录 |

`questionId` 在广播的扇出之间保持不变，所以应答只需要命名问题、不必命名某一行。回复还可以携带 `replyTo`
（它所回复的行）与 `threadId`；折叠会一趟解析线程身份：显式 id 优先，其次 `replyTo` 的线程，否则用该行自己
的 id。

## 为什么只有标签，没有序号

2026-10-31 的一次真实 cell 运行测到了这个设计要消除的缺陷：`ask_user_question` 的答案携带标签而不携带序号，
cellwork 邮件当时是自由文本，于是每一次被转述的「选项编号」都由模型自行编造：编号在提问者、面板与答案之间
漂移，最终被报告成「选择了」的选项是错的。

**任何地方都没有序号字段。** 标签在同一个问题内唯一，并各自携带稳定的序号前缀（`A. …`、`B. …` 或 `1) …`），
而答案重复的是被提供的**标签字符串本身**。不匹配就是字符串不匹配，因此可以被机械地拒绝：拒绝会带上完整的
合法标签列表，包括通过 `wait` 拿到的答案（见下文）。

## 寻址

`agent_teams_mail { action: "send", to: … }` 支持四种写法，均按调用方所属团队的记录解析：

- **成员 id**（`M1`）或**成员名**（`Senior Engineer`），它指向的 roster 行。
- **`captain`** 或 **`lead`**：团队记录的 `leadSessionId`，无论用哪个别名，记录下来的都是
  `toName: "captain"`。未记录 lead 的团队会拒绝这个写法，并列出它实际能寻址的收件人。
- **`"*"`**：广播：每个收件人一条持久记录（全部成员加 lead，排除发送者，去重），共享同一信封与**同一个**
  线程。协议里没有「多收件人行」，这正是按收件人确认与按收件人积压上限得以成立的原因。解析结果为空时会被
  拒绝，而不是回答「已发送 0 条」。

成员不能给自己发信。判断「自己」时会同时比对发送者的**两种写法**：roster id（`fromMemberId`）与 session id
（`fromId`），因为记录按 roster id 寻址，而会话按自己的 session id 命名自己。

## 确认的归属

投递与已读是两件不同的事实，而这个邮箱是唯一记录后者（已读）的地方。

- `send` 记录创建时既是未投递也是未读；传输接受后追加 `delivered`；收件人确认后追加 `read`，并带上 `by`
（确认者的显示名，折叠为 `readBy`）。
- **只有该记录的收件人可以确认它。** 没有管理员后门：指向他人的 id 会被拒绝，拒绝里点名真正的收件人，该行
  保持未读。确认以调用者自己的成员身份做出（其 roster id；没有 roster 行的 lead 则用 session id）。
- 成员的**未投递**积压有上限（每个团队、每个收件人 8 条）：停滞的成员无法悄悄堆积工作，而释放一个槽位的是
  **确认**（ACK），不是投递。
- **后果明说，而不是留给人踩：** 队长**不能**代停滞成员清理积压，它会像任何非收件人一样被拒绝。permit（下文）
  授予的是**等待**，从不是在他人名义下确认。

## permit 授权的有界等待

邮件默认不阻塞。阻塞式等待是一份**被授予的例外**，记录为 `permits.jsonl` 中自己的一行：

```
{ t: "permit", permitId, issuerId, issuerName, holderId, holderName,
  scope: "answer" | "message", ttlMs, expiresAt, questionId?, at }
```

- `agent_teams_mail { action: "permit", holder, scope?, ttlMs?, questionId? }`：**只有该团队的 Lead**
（记录中的 `leadSessionId` 及其历史）可以签发，且只能签给本队成员。TTL 默认 60 秒，上限 600 秒；
  `questionId` 可把授权收窄到单个问题。
- `agent_teams_mail { action: "wait", permitId, messageId, timeoutMs? }`：没有 permit、permit 已过期或属于
  他人、目标不在该 permit 的 scope 内、以及目标**不是该 holder 自己发出的**，都会被拒绝：等待是**提问者**在等
  自己那个问题的回答，所以去回答「发给你的问题」属于 `send` 而不是 wait，而别人的问题会泄露其回答携带的标签。
  每条拒绝都会点出调用者的队长。超时默认 15 秒，上限 60 秒。
- 等待每 50 毫秒轮询一次邮箱，并且被**双重**限界：实际时钟截止点，以及轮询上限
（`ceil(timeoutMs / interval) + 1`），所以即使时钟被注入也不会空转。`timeoutMs: 0` 恰好是一次读取加一次
  超时。调用被取消时返回 `reason: "aborted"`。
- `scope: "answer"` 的授权返回**组装好的答案**（各自带 `questionId`、`answerTo` 与被选标签）；`scope:
  "message"` 返回回复**行**。

## 投递：先持久，唤醒尽力而为

记录在任何唤醒尝试**之前**写入，尝试的结果是独立的一行：

```
{ t: "wake", id, sent: boolean, reason?: string, at }
```

`sent` 为 false 时 `reason` 必填。没有任何 `wake` 记录的行意味着尝试**从未发生**（进程在两次追加之间停止），
读者必须把它当作「未唤醒」，绝不能当作成功。

两侧各自把**自己那次尝试**产生的原因写进同一种形状。cellwork 面会在这些情况下拒绝唤醒：邮件跨 cell 边界
（只做持久投递：本 cell 对另一个 cell 没有 Lead 权限）、收件人是队长（该组合里 Lead 没有 executor handle）、
成员在没有队长 Lead 权限的情况下发送、收件人从未被拉起（没有 handle），以及该组合根本没有暴露团队执行器。
团队面则在收件人是 lead（没有成员行）或没有 handle 时拒绝，并把传输的拒绝原因原样记录。唤醒被拒绝的行仍然是
未读的，因此 `cellwork_supervise` 会把它列进 `wakeFailures[]`，团队面的 `summary` 也会把它计入 `undelivered`
列，而**为什么**，由那条 `wake` 记录说明。

## 磁盘上的日志

`mailbox.jsonl` 是只追加的：一行一条 JSON 记录，永不重写，所以写到一半崩溃只损失最后一行、绝不损失整个文件。

| 记录 | 含义 |
|---|---|
| `send` | 开启一条消息：寻址、`kind`、信封、`teamId`/`cellId` 戳 |
| `delivered` | 传输接受了该行（它仍未读） |
| `read` | 收件人确认了它，并带 `by` |
| `wake` | 一次唤醒尝试，及被拒绝时的原因 |

折叠容忍：被截断的最后一行、没有 `kind` 的旧行、其 `send` 行已丢失的状态行，以及**陌生**的记录类型（cellwork
的 `wake` 行共享同一个文件）；同时它会报告自己能看到的每一种异常：重复的 send id 保留**第一条**写入并写明
这一点。这些报告以折叠状态上的 `problems` 暴露，团队 web 面板会渲染它们。

## cellwork 视图：同一条流上的视图

`cellwork_send` 通过共享存储的原子扇出写入**同一个**日志，盖上该 cell 的 `teamId` 与一个附加的 `cellId`（视图
按它筛选）；跨 cell 的发送者还会盖上 `fromCell`。它的参数是同一协议在 cell 语境下的拼写：`kind`（有问题
`options` 时推断为 question，有 `selected`/`custom` 时推断为 answer）、`options`/`multiSelect`、`replyTo`、
`selected`/`custom`、`questionId`，以及 `broadcast: true`（目标 cell 的每个席位一行，排除发送者）。

统一之前的 `<cell>/mail.jsonl` 仍然会被读取，并按 `at` 顺序合并进视图；对**那些**行的确认会追加回那个文件，
而统一之后的行则走共享存储的、带归属检查的确认路径。这就是单向的迁移边界：新行本版本可读，而**旧版本**的
读者在 cell 文件里根本看不到它。

## 已声明的边界

- **团队工具推断 `kind`。** `agent_teams_mail` 接收 `question` / `answer` 载荷**对象**，并据其推断 kind
（两者都没有则是 `message`），因此载荷与 kind 不可能互相矛盾。没有 `kind` 参数，也没有 `threadId` 参数：
  回复通过 `replyTo` 归入线程，应答则从 `answerTo` 推导。直接构造记录、调用存储 API 的一方仍可显式传入
  `kind` 与 `threadId`（`cellwork_send` 有自己的拼写）。
- **折叠状态上的 `problems` 是可选字段**，这是刻意的、不是疏漏：由调用方构造的、只是消息列表的**视图**（permit/
  wait 路径把 `{ messages }` 直接交给读者）不是折叠结果，不应被迫编造一份诊断列表。补偿性保证是机械的：
  `fold`/`readMailbox` **总是**填充它，`scopeToTeam` 会带着它穿过，并且有两条测试臂断言干净日志得到
  `{ messages: [], problems: [] }`，因此「字段缺失」永远无法掩盖异常。
- **确认身份基于 ROSTER id**（`ownMember.id`；没有 roster 行的 lead 则用会话 id）。在该传 roster id 的地方传了
  session id，会被拒绝，而不是被悄悄匹配。
- **工具表面预算：5,600 → 6,400 字符，实测 6,289**（余量 111），发生在 permit/wait 参数落地之后。这个数字由
  一条测试臂断言，本波次内两次重新定基都把测量值写进测试本身；任何进一步的放宽都必须**先**获得队长的批准。
- **不跨 workspace 发信。** 邮箱严格限定在单个 workspace 内，workspace 之间没有传输。

## 测试与证据

- `packages/mpd-mail-protocol`：信封、I1–I8、折叠的容错，以及「一次拒绝给出完整问题列表」：
  `bun test packages/mpd-mail-protocol`。
- `packages/mpd-team-core-plugin`：存储（上限、归属、唤醒记录、折叠问题）、工具面（寻址、广播扇出、
  permit/wait）以及 web 投影：`bun test packages/mpd-team-core-plugin`。
- `packages/mpd-cellwork-plugin`：cell 视图、旧日志合并与「只确认一次」语义：
  `bun test packages/mpd-cellwork-plugin`。
- 含本页及其英文孪生页的文档一致性：`bun run verify:docs`。
