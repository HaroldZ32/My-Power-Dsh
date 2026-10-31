# mpd-mail-protocol

[English](./README.md) | **简体中文**

邮件平面的共享零依赖词汇表：`message` / `question` / `answer` 信封、让回答**逐字**复述所提供标签的纯校验器、
append-only 邮箱日志的宽容 fold，以及两个平面都需要的扇出与线程辅助函数。

它是库，不是插件。没有 cordis 行、没有 patch 条目、没有运行时依赖。团队邮箱与 cellwork 视图直接从源码引入这些
规则，所以整个工作区对“什么是合法的问题或回答”只有一份定义。

## 这个包为什么存在

2026-10-31 的一次真实 cell 运行测到了这个包要消除的转述缺陷。`ask_user_question` 的回答只带标签、不带序号，
而 cellwork 邮件是自由文本，于是每一层转述里的“选项编号”都由模型自行编造——编号在提问者、面板与回答之间漂移，
最终被当成已选项的报告是错的。

修复是结构性的，而不是再写一句更强的提示词。**任何地方都没有 index 字段。** 问题的标签唯一、各自携带稳定的序号
（`A. …`、`B. …` 或 `1) …`），回答重复所提供标签的**字符串本身**。不匹配就是字符串不匹配，因此可以被机械地拒绝
——而且拒绝会带回完整合法标签列表，不需要发送者去猜。

## 信封

```ts
type MailKind = "message" | "question" | "answer"

interface MailOption   { label: string; description?: string }
interface MailQuestion { questionId: string; header?: string; question: string;
                         options: MailOption[]; multiSelect?: boolean }
interface MailAnswer   { questionId: string; answerTo: string; selected: string[]; custom?: string }
interface MailEnvelope { kind: MailKind; replyTo?: string; threadId?: string;
                         question?: MailQuestion; answer?: MailAnswer }
```

`questionId` 在广播扇出中保持不变，所以回答只需指认问题、不必指认某一行。本协议之前写下的行没有 `kind`，
fold 会把它读作 `"message"`。

## 八条不变量（I1–I8）

| 规则 | 这个包强制的内容 |
|---|---|
| I1 | 任何载荷都不携带 index 形状的字段。编译期由 `MAIL_PAYLOADS_CARRY_NO_INDEX` 证明（覆盖 envelope、option、question、answer、send 记录与 fold 后消息等形状），运行期由 `findIndexFields` 按**枚举**黑名单扫描：`index`、`indexes`、`indices`、`optionIndex`、`optionIndices`、`selectedIndex`、`selectedIndices`、`optionNumber`、`optionNumbers`。**边界（R1 后修订）：** 换一种拼写的定位字段（`position`、`choice`、`idx`）不会被该扫描发现；兜底来自 fold 的字段白名单与邮件工具 schema 的 `additionalProperties: false`，扫描本身不是绝对证明。`selected` 只装标签字符串。 |
| I2 | 问题至少有一个选项，每个标签非空且在同一问题内唯一，且 `questionId` 非空——它是每个回答都要复制的关联键。序号前缀是文档约定，不是被强制的形状。 |
| I3 | 单选回答恰好选择一个标签，**或者**只给 `custom`；标签加 `custom` 会被拒绝。多选回答至少选择一个标签，可以附带 `custom`。 |
| I4 | 每个 selected 字符串都必须与所提供标签**完全**一致（不裁剪、不做大小写折叠）。不匹配会被拒绝，并带回完整合法标签列表。 |
| I5 | `replyTo` / `answerTo` 必须引用同一 fold 邮箱中的消息 id；回答的目标必须是 `question` 行；回答的 `questionId` 必须非空且**等于**该问题的 `questionId`（R1 后修订：否则错误的关联键会通过所有规则并让回答作废）。当被引用的 `question` 行**没有载荷**（fold 会保留这样一行并报告该异常）时，回答仍会被**拒绝**：缺失载荷报告为 `question-payload-missing`，并同时执行与上下文无关的回答规则——该分支绝不允许短路成 `ok`（R1 的 F3）。 |
| I6 | 广播是**扇出**：`fanOutTargets` 每行只返回一个收件人（排除发送者、按 id 去重）；不存在多收件人行，所以逐收件人 ack 与未投递上限仍然诚实。 |
| I7 | 线程 id 是其第一条消息 id；没有 `threadId` 的回复继承其 `replyTo` 的线程，由 fold 一趟解析完成。显式 `threadId` 若指向不存在的已 fold 消息（且不是本行自己的 id），按声明保留并**报告**（R1 后修订）。 |
| I8 | fold 报告每一处它能看见的容忍异常：无法解析的 `replyTo`、没有根的显式线程 id、重复的 send id（**先写者胜**，已声明），以及每个被丢弃/种类不匹配的载荷。校验器在一次拒绝中返回**完整**问题列表。 |

## 公开 API

- `validateEnvelope(envelope)` —— I1 加上结构性一致（`kind` 与其携带的载荷匹配）。
- `validateQuestion(question)` —— I2，包括非空关联键。
- `validateAnswer(answer, question?)` —— I1/I3/I4 与关联键；不传问题时仍执行无需上下文的规则（非空
  `questionId`/`answerTo`、至少一个标签或 `custom`、以及零标签零 custom 的拒绝）。
- `validateReferences(envelope, messages)` —— I5，并在引用的问题解析出来后再次执行 I4、R1 F1 要求的回答
  `questionId` 与问题 `questionId` 相等，以及 F3 的「无载荷目标」（报告 `question-payload-missing` 并执行与
  上下文无关的回答规则，绝不静默返回 `ok`）。
- `foldMail(records)` —— 宽容 fold：旧行 `kind` 默认、I7 线程解析、投递/已读状态、未知记录种类忽略、坏行跳过并
  报告、无法解析的 `replyTo` 与显式 `threadId` 报告、重复 send id 保留**先写**并报告，永不抛错。
- `fanOutTargets(senderId, targets)` —— I6 的收件人计划。
- `inheritedThreadId(envelope, byId)` —— I7 规则作为独立辅助函数；它不校验显式 id，因为只有 fold 能看见整个邮箱。
- `findIndexFields(value)`、`labelsOf(question)` —— I1 扫描与 I4 的标签列表。
- `ordinalPrefix(index)`、`withOrdinal(index, text)` —— 规范标签拼写（`A.` … `Z.`，之后改用从一开始的编号），
  提问者不必手写序号。

每个校验器都返回 `MailCheck`：`{ ok: true }` 或 `{ ok: false, problems }`，每个 problem 带稳定 `code`，
I4 的 problem 还带 `labels` 列表。一次拒绝会列出它发现的**每一个**问题——一次往返，而不是一次只报一个。

## 构建与测试

从仓库根目录、用固定工具链构建，提交的产物才会与新鲜度门重建的结果一致：

```
.toolchain/node_modules/.bin/bun build packages/mpd-mail-protocol/src/index.ts \
  --target node --format esm --outfile packages/mpd-mail-protocol/dist/index.js
bun test packages/mpd-mail-protocol
node scripts/verify-dist-fresh.ts
```

单元测试逐条钉住 I1–I8：编译期与运行期的无 index 证明、标签唯一、逐字复述（包括拒绝时的标签列表）、单选与多选的
基数（包括单选「标签加 custom」的拒绝）、关联键相等、扇出行数、线程继承、fold 声明的先写者胜策略，以及面对垃圾行、
撕裂行、无法解析的引用和外来记录种类时的 fold 容错。
