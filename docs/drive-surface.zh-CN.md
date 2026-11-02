# 驱动面

**中文** | [English](drive-surface.md)

**驱动面**指的是这一组接缝：让「不是一次模型回合」的东西也能推动本包——一部手机、一段脚本、一个面板，
或者一条 curl。在这一波之前，本包只能从对话内部被驱动：计划批准与派发只有两个团队工具的处理函数能发起，
而 `ask_user_question` 只能由已经实现了宿主提问界面的表层来回答。三组接缝补上了这段空白，它们共享同一个
性质：**其中没有任何一环需要一次仍在进行中的工具调用**。

本仓库的整体装配见 [`design.md`](design.md)；这些路由沿用的是本包最早的那条可变路由——团队看门狗的
暂停/恢复对——的纪律。

## 1. 调用方必须提供什么

所有接缝都以**会话 id** 寻址，因为本包的状态根是按会话解析的（`会话头 cwd → DSH_WORKSPACE_ROOT →
process.cwd()`）。**团队动作**那两条路由把它放在 `?sessionId=` 查询参数里——绝不放在请求体字段里，这样一个
请求就无法夹带自己的作用域。**提问中继**是例外，而且是刻意放宽的：它的 `GET` 把 `sessionId` 当作**可选
过滤条件**（不传就列出整个队列），它的回答路由完全不需要会话——那个不透明的暂存问题 id 已经指向一个属于
提问会话的请求。把团队动作的规则套到中继上的客户端，会拒掉合法的中继调用。

第二样东西是**活跃 agent**。批准计划要拉起子 agent，派发一轮要发送消息，两者都得把宿主里真实的
`Agent` 对象交下去，而光有会话 id 是产生不出这个对象的。因此路由从宿主的活跃注册表里解析它；会话不活跃
时返回 `409`，而不是靠猜。**这个拒绝发生在第一次写入之前**：不建团队记录、不 spawn、不发消息、不开派发
窗口。

## 2. 团队动作平面

### 服务

`mpd-team-core` 这一行发布 `mpdTeamActions`，承担原先由工具独占的两个动作：

| 成员 | 输入 | 成功 |
|---|---|---|
| `approve` | `{ sessionId }` | `{ ok: true, plan, team, created }` —— 当有阻塞项没有指名任务时，`created.unresolved` 会带上它 |
| `dispatch` | `{ sessionId, limit?, dryRun? }` | `{ ok: true, pairs, skipped }` |

函数体就是工具处理函数原本的函数体，整体搬进了免 exec 的模块：同样的校验顺序、同样的存储写入、同样的
spawn/发送/写入/归档次序。工具处理函数现在从自己的工具调用上下文里拼出调用方再委托过去，所以工具调用方
看到的仍然是一模一样的回包。唯一允许的差异就是上面那个拒绝。

### 两条路由

| 路由 | 请求体 | 窄回包 |
|---|---|---|
| `POST /plugins/mpd-team/approve` | 解析后忽略 | `{ ok: true, team: { id, name, memberCount, taskCount }, created: string[] }` |
| `POST /plugins/mpd-team/dispatch` | `{ limit?: number, dryRun?: boolean }` | `{ ok: true, pairs: [{ taskId, memberId, memberName }], skipped: [...] }` |

守卫次序是本包一贯的那一套，没有商量余地：宿主围栏（`dsh.webRequestRejection`）**第一**，然后是路由自己
的 `405`（带 `allow` 头），然后是**在解析之前**执行的 64 KiB 字节上限（`413`），然后是在边界处做一次
JSON 解析（`400`），然后是会话及其活跃性（`400`/`409`），最后才执行动作。回包从不携带存储对象，也从不
携带文件系统路径；意外抛出会变成笼统的 `500`，细节只进这一行的日志。

## 3. 提问中继

### 为什么需要有中继

`ask_user_question` 抵达的是宿主的 `userQuestions` 服务，它派发一个 waterfall 事件。在桌面上这个
waterfall 由终端界面回答；在手机上根本没有这样的客户端，于是问题以 `NO_PROVIDER` 失败，这一轮什么也没
学到。`mpd-roles` 这一行现在多注册**一个**回答者，并把没人认领的问题暂存下来。

### 挂载门

中继先调用下一个回答者，只在收到 `NO_PROVIDER` 拒绝时才动手——所以已经自己回答了问题的桌面保有它，中继
永远不抢问题。两条约束让它在无人值守的引擎上也安全：

- 只有当客户端最近轮询过（15 秒窗口）它才暂存，因此没打开面板的引擎会立刻重新抛出 `NO_PROVIDER`，而不
  是把一轮挂住两分钟；
- 暂存的问题 120 秒后过期，过期时**重新抛出原始错误**，而不是编一个答案。问题永远不会被沉默回答。

答案按**选项标签**匹配，绝不按序号：一个会重排按钮的界面不可能答错项。未知标签一律拒绝，问题保持暂存。

### 两条路由

| 路由 | 用途 |
|---|---|
| `GET /plugins/mpd-roles/questions?sessionId=` | `{ ok: true, pending: [{ id, sessionId?, createdAt, questions }] }`——正是这次轮询让客户端挂上 |
| `POST /plugins/mpd-roles/questions/answer` | `{ id, answers: [{ id, selected: [标签], custom? }] }` → `{ ok: true, answered: true }` |

`404` 表示 id 未知或已过期，`400` 表示请求体不合法或标签未知，`413` 表示请求体超过 64 KiB。同样是围栏
先行，并且这个 `GET` 也带自己的 `405` 守卫，和本包其他每一条路由一样。

## 4. DSH Go 原生界面

### 清单

根包声明了一份 DSH Go 协议 1 的清单（`dshGo`：`v: 1`、`wants: ["message"]`），贡献**两个面板**——`mpd`
（工作台）与 `mpd-team`（团队看板），两者都出现在 `session.tab`、`features` 与 `chat.panel`——外加一条
**composer strip**（`mpd-status`）、两个 **composer 动作**（`mpd-dispatch`、`mpd-board`）与两个
**message 动作**（`mpd-save-memory`、`mpd-copy-reply`）。每个面板还在 `dsh-go/views/` 下带一份手写的**静态**
兜底视图。清单是声明式的：App 用自己的渲染器画那棵 JSON 组件树，不执行本包的任何代码。整块远低于 16 KiB 上限，
而 `node scripts/verify-dshgo-views.ts` 是那道门：id 唯一、每个插槽的数量合法、每份声明的视图都存在、可解析、
且在面板预算之内。

### 两个面板

`mpd` 有四个 Tab。**总览**展示团队计数、完成度进度条、第一条需要注意的事、就绪行与动作。**问题**只显示**第一条**
暂存问题、它的选项按钮与一个自由文本表单。**工作伙伴**以只读方式列出库内容——面板绝不初始化、重命名或删除实例。
**记忆**展示最近十条与反思计数，从工作区存储读取。

`mpd-team` 有四个 Tab。**看板**每个任务一行且可点（点击携带 `select` 与该行 id，详情 Tab 随之切换）。**成员**
每人一行：首字母 badge、名称、模式与 handoff 文字。**详情**是选中任务的合同。**看门狗**是生效中的判据、保活暂停
与最近的事件。

宿主侧（`mpd-bundle-plugin`）在 DSH Go 桥接服务绑定之后经由适配器注册每个面板，以 0.5 Hz（协议上限）轮询，并且
只在模型发生变化时推送一份收窄后的数据：id、名称、状态、计数、问题自身的文本与任务标题——绝不含文件系统路径、
token 或凭据。`view` 是对同一批服务的**实时读取**而不是读推送缓存，因为 App 会**先**取视图**再**订阅。只有**结构性**
签名变化（暂存问题的身份，或看板的 id/状态集合）才会重新取视图；仅文本变化走数据推送。

点击只回 effect，永不 reject。工作台面板发布 `approve`、`dispatch`、`refresh`、`answer:<n>` 与 `answer-custom`；
团队面板发布 `select`、`back` 与 `refresh`——**刻意不含任何会改数据**的动作。面板点击是匿名的（不带 agent），
因此结算类点击永远无法拥有看板行，看门狗类点击也无法指认会话的工作区根；两者要么每次都失败，要么写进错误的存储。
结算一行、暂停一个团队因此留在有身份的地方：拥有该行的成员的 `agent_teams_task`，以及队长的看门狗工具。详情 Tab 与
看门狗 Tab 会把这一点**说明白**，而不是给出一个按不动的按钮。回答类点击作用于**视图渲染时捕获**
的那份身份（停放 id、条目 id、原始选项标签），绝不作用于点击当下队列里的内容：已经离开队列的问题会回
「That question is gone」并请求刷新，而不是去结算替身。App 只在点击后三秒内收到 effect 时才执行，因此慢服务会先立刻
用协议的**延后**形状确认——`{ pending: { label, timeoutMs }, result }`——真正的 effect 由 `result` 送达，最长到协议
的 60 秒。

### 视觉语言

面板是 view v2，并且跟随 App 的主题。两个根都由适配器的 `panelView()` 构建，它在**唯一一处**写入 `v: 2` 与
`accent: "app"`，因此命名色或十六进制 accent 根本无法表达。每个 Tab 恰好一个 `tinted` hero（App 把主题色叠在内容
背景上——那就是带主题的磨砂框），数字是 v2 `grid` 里的 `metric` 磁贴，数据区块是带标题与 `divider` 的 `surface`，
空 Tab 是设计过的 `emptyState` 而不是空白。状态是**带文字**的 `badge`/`tone`，颜色绝不是唯一载体；成员首字母用
`badge`（`avatar` 是图片节点）；长文本设置 `maxLines`。视图里不出现圆角、尺寸、透明度、渐变、阴影或颜色字面量：
那些由 App 决定，kit 的 builder 会直接拒绝。

较老的 App 拿到的是**同一棵树**经 `adaptView` 降级后的形状：tabs 变成带标题的 stack，grid 变成 list，badge 变文本，
`divider`/`spacer` 消失，所有 `style`/`accent` 被剥掉。metric 的标签**与数值**都能在这一重写中保留。一个 builder
产出两种形状，因此兜底不会与它来源的那棵树漂移。

### Strip、composer 与 message 动作

Strip 是**一行、最多 24 字符**，按 App 的语言选择（`3 ready · 1 active` / `3 就绪 · 1 进行`），有问题停放时前缀 `❓`，
计划等待审批时着色为 `warn`；只在整行变化时发射，点它打开工作台面板。`mpd-dispatch` 对当前团队跑一次派活。
`mpd-save-memory` 写**一条**记忆条目，其描述是回复的第一行。`mpd-copy-reply` 把回复放进剪贴板。`mpd-board` 不需要
处理函数：它的 `open panel:mpd-team` effect 静态写在清单里。每个处理函数都退化为一条 toast——服务缺失、会话缺失或
被拒绝，都不会以异常形式抵达桥。

### 工具卡片

团队、名册、工作伙伴、记忆、验证、boulder 与看门狗这些工具带有用适配器 `toolCard()` 构建的
`output.presentationMeta`：一张 v1 卡片，含标题、指标与至多一个表格或键值块，没有数据绑定也没有按钮。该 builder
**绝不**抛错，也绝不发出 App 画不出来的卡片——超出工具卡预算（8 KiB、40 节点、深度 6）或含任何 v2 专属组件时降级
为 `{}`，App 随后渲染它自己的通用工具行。每个工具原有的 `render` 保持不变，因此没有 DSH Go 的宿主不损失任何东西。

### 在哪里能用

这类插槽是 DSH Go App 的**本机引擎**能力：桥接随 App 自己的运行时安装，中转不放行它的 `/dsh-go/*` 命名空间，
SSH 支持在上游仍被推迟。没有桥接的宿主上，面板与 strip 保持沉默——一行日志，不注册——读者看到的是那些静态视图
文件。**工具卡片是中继安全的那一半**：它们随普通的工具结果走，因此远端宿主仍然能渲染。

## 5. 诚实边界

- **本工作区里没有 Flutter App。** 原生这一半是拿上游协议 schema、视图预算规则（节点数、深度、子节点数、
  字节数）、DSH Go 清单门禁和服务替身证明的。真机安装是读者自己的检查，不是这里被断言的结果。
- **路由守卫是在宿主围栏之后由单元测试证明的。** 围栏会先于裸请求抵达路由自己的 `405`/`400`/`413` 分支，
  因此这些分支是对着服务器替身跑的，和看门狗那两条路由完全一样。
- **中继不会夺取真实回答者已经认领的请求。** 桌面回答时的行为是已验证的；桌面与手机同时挂载时「桌面优先」
  是构造决定的。
- **面板动作需要活跃会话。** 没有会话时点按就是一条 toast，不会排队成意图。
- **仓库门禁检查的不是 v2 实时树。** `verify-dshgo-views.ts` 检查的是**声明的**静态视图；面板在运行时构建的 v2 树由
  该包的单元测试覆盖（两种版本模式下的 `lintDesign` 加预算走查），不由那道门覆盖。
- **渲染观感在本工作区未证明。** 这里没有 Flutter App，也没有设备：协议形状、预算、主题 token 规则与清单是已验证的；
  像素效果是读者自己的检查。

## 6. 细节在哪里

- `mpd-team-core-plugin` —— 动作平面、它的路由与状态映射。
- `mpd-roles-plugin` —— 中继、它的挂载门与路由。
- `mpd-bundle-plugin` —— 两个面板、strip 与菜单处理函数（`dshgo-panel.ts`、`dshgo-team-panel.ts`、
  `dshgo-surfaces.ts`），它们的纯视图构建器（`dshgo-views.ts`）与双语文案（`dshgo-copy.ts`）。
- `mpd-dsh-adapter-plugin` —— dshGo 接缝与视图套件（`src/dshgo-view.ts`）：组件 builder、`measureView` /
  `fitsBudget`、`adaptView`、`lintDesign` 与 `toolCard`。

代码旁的每个包 README 才是契约，这一页只是地图。仓库通则、门禁与 git 模型见
[`../AGENTS.md`](../AGENTS.md)，命令见 [`development.md`](development.md)。
