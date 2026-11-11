# Cell-work 模式（`/cellwork`）

**中文** | [English](./cellwork.md)

Cell-work 是**由命令触发的「队长只做调度」模式**。一个会话会变成一个小型交付组织：规划器与你把需求谈定，
切分器把工作切成任务、并按执行模型自己的上下文窗口逐条计价，工作者在冻结的验收合约下执行，而验证者永远
不是写作者、只读那份合约：队长则只负责调度、转达、记录与停止。

bundle 里除了 `/cellwork` 命令之外没有任何入口能启动这个模式：没有工具、没有事件手势、没有 preset 开关。
其它所有面（工具、监听器、行）在命令运行、cell 存在之前都是惰性的。

每个工具的确切行为、守卫表与配置旋钮，以
[`mpd-cellwork-plugin` README](../packages/mpd-cellwork-plugin/README.zh-CN.md) 为准。本页是面向使用者的
说明：怎么驱动这个模式、它度量了什么、以及它**不**承诺什么。

## 唯一触发方式

- `/cellwork <objective>` 通过 adapter 注册为 `cellwork`：没有别名、没有第二种拼写，也不会被别的命令名
  替代。
- 处理函数只写入**一份** cell 记录：`<workspace>/.mpd/cellwork/cell-<UTC 时刻>/state.json`，phase 为
  `requirements`，带队长本人的 session id：随后把**恰好一条**激活指令作为发起该命令的 agent 自己的下一条
  用户消息提交（producer tag `mpd-cellwork`）。这条指令启动需求阶段；命令本身不驱动各阶段。
- 参数为空或只有空白时返回用法错误，并且**完全不写**任何 cell 状态。
- 同一 workspace 已有活跃 cell 时，第二个 `/cellwork` 会被**拒绝**，拒绝信息点名那个活跃 cell 的 id：
  一次只能有一个 cell，两个 cell 会争抢同一块 team 看板。要开新的，先用 `cellwork_stop` 停掉当前的。
- 组合环境没有可用的投递面时不会留下「半启动」的 cell：命令刚写入的记录会立即归档，并带上
  `stopReason: "no-live-turn-surface"`，也不会有任何 session 被围栏。

## 四个阶段

1. **requirements（需求）**：`cellwork_start` 打开当前活跃 cell 的需求阶段（它绝不创建 cell）。它暂存
   规划器、切分器**以及分析泳道**：`cellwork.planning.analysts`（默认 2，`0..8`）拉起
   `cell-analyst-1 … K`，交替使用只读名册角色 Explorer 与 Researcher，每席一个 `analysis-<i>` 看板任务，
   责成它侦察并把发现邮件给两个规划座位。切分任务被需求任务**和每一个分析任务**阻塞，因此图建立在证据
   而非切分器猜测之上；`0` 保留最初的两座规划阶段。规划器
   运行苏格拉底式流程：它把结构化问题信封邮件发给队长，队长在主页面调用 `ask_user_question` 并把答案邮件
   回传，规划器如此往复直到满意；随后写出 `requirements.md` 并调用
   `cellwork_requirements {action:"finalize"}`。**只有**规划器塑造需求；队长只做转达，从不撰写，也不代用户
   作答。计划阶段的侦察同样是委派的：规划器对源码路径的 `read`/`grep`/`glob` 会被拒绝（可读带见下一节），
   它通过 `cellwork_recon` 或 `mpd_role_spawn` 工作。一个章节的正文一直延伸到**同级或更高级**的下一个标题，
   因此 `###` 子标题及其内容属于父章节、不会截断它；正文只有空白的章节仍按"缺失或为空"拒绝。
2. **split（切分）**：切分器通过 `cellwork_split {action:"submit"}` 提交任务图。插件校验它（每个任务都
   声明依赖答案、图无环、写作用域有序、计划中的验证者与写作者不同），并针对模型预算逐任务计价；只有被接受
   的图才能作为 `cellwork_activate` 的输入。拒绝时会返回逐任务明细，告诉切分器还需要砍多少，并把完整
   finding 列表持久化到 `split/<修订>.refused.json`（在被接受记录旁边、绝不覆盖它），同时把 findings 记在
   `split-refused` journal 行上，因此每一次拒绝在磁盘上都有产物。
   每个任务还可以声明 `member`，即它要拉起的看板成员；省略时成员名**就是** `ownerRole`。多个任务可以共用
   一个成员，多个成员也可以共用一个 owner role，这正是同一个 role 获得真正并行座位的方式，因为激活对每个
   不同的 `member` **只拉起一个**成员。某个 role 的就绪任务可以同时运行、但它声明的成员名少于这个**就绪
   前沿宽度**时**不会**被拒绝：判定结果会为该 role 带上一条**非致命**的 `seat-width-short` 警告，说明一个
   role 一个座位会把它们**串行化**、点名已声明的成员，并给出修法——`declare \`member\` names "<role>-2",
   "<role>-3", … so each ready task runs on its OWN seat, or add dependency edges if they must not run
   together`。该警告绝不改变 `accepted`。座位的**身份**是一次归一化，而不是原始字符串：**任何文字**的字母与
   数字都保留、大小写折叠、其它字符的连续段折叠成一个 `-`，因此 `"Seat A"` 与 `"seat-a"` 是**一个**座位，
   `"工程师 A"` 与 `"工程师-a"` 是**一个**座位，而 `"工程师甲"` 与 `"工程师乙"` 是**两个**：成员名可以是
   中文（或任何文字），不必是 ASCII。身份为空的名称（纯标点的 `---`、空串）、超过 64 字符的名称、或含控制
   字符/路径分隔符的名称按 `member-invalid` 拒绝；两个任务解析到**同一个**座位却声明了**不同** owner role，按
   `member-role-conflict` 拒绝；`self-review` 在双方都声明成员时比较的就是这同一个身份（否则退回比较 owner
   role）。
3. **executing（执行）**：`cellwork_activate` 把切分结果里的成员与任务加进**活跃** team 记录，为每个代码
   任务写一份冻结合约，并在派发**之前**为每个代码任务打开一条验证循环，然后派发。成员的人格文本会注入成
   员提示词（team 本身不提供名册人格。队长在每次唤醒时巡检。中途失败不会把 cell 卡死：阶段保持原样）从
   `split` 发起的激活仍是 `split`，对已在执行的 cell 做局部重切分则仍是 `executing`，而一次**返回的**失败
   会持久化它已创建的产物，因此用**同一个**被接受的修订号即可续做（确切覆盖范围见下面的边界）。
4. **re-split（重切分）**：`cellwork_requirements {action:"update"}` 提升需求修订号并把切分标记为过期。规划器
   重新谈定变化的部分，切分器重新提交一个修订，`cellwork_activate` 只把新增或有变化的工作**追加**到同一个
   team：team id 与 cell id 都不变，新修订中被去掉的工作标记为 `cancelled`（绝不删除），切分任务会被重新
   派发而不是被复制。用过期切分激活会被**拒绝**，除非调用者显式指定修订号。**重切分是作用域变更，绝不
   重新分座**：座位只为**新**任务拉起，保留下来的键保留它的看板行**和它的 owner**（绝不重写 owner），
   激活 cell 已经物化过的修订号会被拒绝——所以把相同的键重新提交、指望把工作摊到更多座位，对分配是一次
   静默空操作。要加宽**运行中**的看板，请增长座位：派发时的自动弹性增长，或运行中的
   `agent_teams_plan {action:"add_member"}`。

### 激活中途失败可以续做

激活是一串变更，而不是一次事务：合约、成员、看板任务、验证循环，最后是派发；阶段保持原样：从 `split`
发起的激活仍为 `split`，而对已在执行的 cell 的局部重切分会保持 `executing`：阶段绝不回退。每份冻结合约
同时点名 owner role 与解析后的看板成员（`Owner: **<role>** (member `<name>`)`），并且激活对每个不同的
`member` 只拉起一个成员：同一个 role 的十二个任务不再排在单个 session 后面。

**记录了什么、以及什么时候记录**，是读者最不能夸大的部分。一趟激活运行期间，每个产物只往 journal 加
**一条**紧凑的 `cell-activation-progress` 行（stage、key、ordinal、total），仅此而已。累积状态：在飞修订号
（`activationInFlight`）、已拉起的成员、已铸出的看板 id（`activatedTasks`）与已打开的循环 id
（`activatedLoops`）：只在**这一趟失败**时**一次性**写进 `state.json`，即 `cell-activation-partial` 行。
同一趟的每一行都带同一个不递减的时刻，因此 journal 是单调的（VEdit 的旧形状写了 119 份完整快照、约占
490 KB journal 的 40%，而最后一行的戳比它上面的行还早）。

由此得到的**不变量**：一次**返回**失败的激活可以带着已记录的产物续做；而**进程在激活中途死亡**则不能，
这一趟的 id 根本没有进 `state.json`，只有那些紧凑的 journal 行。重试时会按名字与活跃名册对账**成员**
（名册上已有的名字直接复用，绝不重复拉起），而看板任务与验证循环只通过已记录的表获知：死亡那一趟创建的
任务或循环找不到，重试会**再创建一次**。这条重复的看板行/循环可检出但不可删除：团队平面没有取消动词。

一次**返回的失败**之后重试，会从那份记录续做：成员按名字与活跃 team 名册对账（名册上已有的名字直接复用，
不再重复拉起）、每个切分键复用已记录的看板 id、并为**每个**还没有循环的代码任务补开验证循环：不只是这次重试
新创建的任务。早于这条规则激活的 cell 里，保留下来的任务在 `activatedLoops` 中没有条目，因此一份已经写明循环 id
的冻结合约会被视为已武装：该任务跳过，合约**不会**被重写（只有真正没有循环、或合约仍带着开环前占位句的任务才会
新开一条）。只有在派发成功之后才写入 `activatedRevision`，所以再次失败仍会留下新的可续做记录。

**更新的**被接受修订号会**取代**更旧的在飞部分激活：这一趟会记入 journal（`activation-in-flight-superseded`，
点名两个修订号并说明更旧的部分产物被放弃），而新切分的物化会核对已记录的行：保留下来的键复用其看板 id，被去掉
的工作按重切分规则标记 `cancelled`，因此旧产物既不会重复，也不会丢失。只有**低于**在飞修订号的被接受修订号会被
拒绝（更低的修订号无法取代），使用既有教学式错误；激活已物化的修订号与激活过期切分同样被拒绝。

### 重切分的细节

一个修订不是把 team 重写一遍，而是在活跃记录上打一个增量：

- **同修订号的激活会被拒绝。** 激活 cell 已记录的修订号是一次空操作请求，会被直接拒绝；每次提交的修订号
  都必须**大于**已记录的修订号：修订只能向前。
- **重切分不能给保留下来的工作加座位。** 座位只为**新**任务拉起；保留下来的键保留它的看板行**和它的 owner**，
  激活从不改写 owner——所以把同样的键重新分配给更多 `member` 名字，对派发是一次静默空操作。真正能加宽执行
  宽度的两条路径是派发时的自动弹性增长，以及运行中的 `agent_teams_plan {action:"add_member"}`（见
  「成员：暂存的、拉起的与采纳的」）。
- **保留下来的行会被复用，合约不会被重写。** 跨修订存活的任务保留它在看板上的行，以及验证循环打开时冻结的
  合约：验证者仍然按工作开始前冻结的验收标准裁决。
- **激活会说明它保留了什么。** 一次修订保留了任务时，`cellwork_activate` 返回 `notice` —— 刻意写成结果里的
  散文，因为队长不必从计数里自行推断任何一条：多少保留行被复用、它们的冻结合约**不会**被重写（验证者可能正在
  读的字节保持首次冻结的样子）、扩展作用域需要**手工重新冻结**加一个新的验证循环且应落在**新的**切分修订里，
  以及本次激活以**仅声明所有者**的方式派发了多少就绪行。**第 4 阶段例外**写在同一条 notice 里：保留任务的
  循环从未被记录，是保留合约被重建的**唯一**情形——重建会补上验证循环 id，发生时会点名这些键。
- **被去掉的行标记为 `cancelled`，绝不删除。** 它们作为历史留在 cell 记录里，派发会跳过它们。
- **切分器只保留一行可被重新派发的活行。** 需求更新先找**活跃的**切分器行：先按记录的 id，再按
  `cell-splitter` 拥有的任意活行，并把**那一行**随新修订号重新派发；它最终用到的 id 无论如何都会写回 cell
  记录（字段是 `splitTaskId`，答复里报告为 `recordedSplitTaskId`），因此**下一次**更新继续复用它。只有当记录的行已终态且不存在活行时，更新才会
  **追加**一行替代行（同样的 cell role、subject 里带新修订号）：看板没有重开动词，每次提升都追加只会堆出无法
  取消的任务。切分图本身绝不会被复制。
- **切分票按记录的 id 查找，丢失的所有者会被修复。** staging 把被 stage 的切分票的**看板 id** 记在 cell
  记录上（`splitTaskId`），之后每次查找都先试这个 id、再退回按 owner 匹配，因此一次需求变更既能找到切分
  票、把它标记为过期，又能重新派发**同一行**。切分票缺失或没有 owner 是一个硬错误，错误里点名修复方式；
  staging 自己会通过把该行 claim 给 `cell-splitter`
（`agent_teams_task {action:"claim", claimant:"cell-splitter"}`）来修复丢失的 owner，而不是铸出一个重复票。
  **即使这次修复被拒绝，id 依旧会被记录**（journal 在旁边带上 `ownerRepairError`），因此 id 优先的查找继续
  有效，运维读到的是「行已知、owner 仍缺失」而不是让 id 随失败的 claim 一起丢掉；成功的修复记为
  `splitTicketOwnerRepaired`。

team id 与 cell id 都不变，因此 cell 的 journal、邮件与看板始终是一段连续的历史。

## 成员：暂存的、拉起的与采纳的

cell 的 `state.json` 维护一张 `members` 表：每个座位一行，携带 role、session 与 executor handle、模式
（`member` | `checkpoint` | `subcaptain`）、交接计数，以及 `handoffReady` / `fenced` 标志。守卫、
`cellwork_dispatch`、`cellwork_handoff`、`cellwork_context` 与 `agent/pre-step` 检查点监听器读的都是
**同一张表**。

一行有三种进入方式：

- **暂存写进去。** `/cellwork` 暂存规划团队时，planner 与 splitter 自己的行随该团队的批准一起记录
  （`planning-team-staged`），因此在任何 split 出现之前两者就都有座位。
- **激活写进去。** `cellwork_activate` 对每个不同的 `member` 只拉起一个成员——续做的一趟复用活跃名册已经
  认识的行——这正是同一个 role 的多个任务能真正并行、而不是排在一个会话后面的原因。
- **活跃 team 记录借进来。** 激活之后用 `agent_teams_plan {action:"add_member"}` 暂存的成员——或 cell 行
  从未学到的重新拉起/重种座位——在 TEAM 记录里由 `executorRef` 认识，却没有 cell 行。这样的 session 在
  **CELLWORK 动词路径上**解析到本 cell team 的座位时，这一行会在动词执行**之前**被**采纳**，因此
  `cellwork_handoff`、`cellwork_context`、`cellwork_status` 与检查点监听器看到它，就像激活当初创建了它
  一样。触发器就是这些动词本身、`agent/pre-step` 检查点监听器与 `agent/turn-stopping` 屏障监听器；
  **工具守卫刻意不是**其中之一——它的座位解析是只读的，一次仅被放行或拒绝的派发不写任何内容。镜像逐
  字段进行（`name`、`role`、`sessionId` = `executorRef` = team 行的 `executorRef`、`mode: "member"`、
  `handoffReady: false`、`handoffs: 0`、`joinedAt` = 现在），并携带 `adopted: true`；它只持久化一次。
  `member-adopted` journal 行只在记录写入**成功之后**才追加，因此失败的采纳不会为一行从未存在的成员留下历史。
  采纳是**幂等**的：第二次调用经 cell 行解析，不写任何内容。
  记录**无法持久化**的采纳会被如实报告，而不是默认成功：`cellwork_handoff` 在触碰团队平面**之前**就拒绝，
  并点名**哪一半**失败——记录**读不出来**，还是写入没有落地——因此绝不会出现「有团队检查点、却没有被采纳的
  cell 行」。

三条不变量就是全部规则：被采纳的行以 `handoffReady: false` 开始（采纳打开检查点通道，绝不宣称已有
检查点）；镜像绝不携带 `fenced`；采纳本身也**绝不**覆盖已存在的行——被围栏或处于 checkpoint 模式的行保持
原样，动词的表现与采纳出现之前完全一致。`adopted` 是附加字段、读取时会被保留——连屏障自己的行重建也会
带上——因此激活之后出现的行始终能与暂存或激活创建的行区分开（没有该标记就意味着暂存或激活写了这一行）。
**仍然存在的拒绝：** 解析不到本 cell team
任何座位的 session 仍按原样被拒绝——`cellwork_handoff` 的答复是
`this session belongs to no active cell`——什么都不会被采纳；旧的
`"<name>" is not a recorded cell member` 只在「记录点名了座位、但那一行确实缺失」时保留（例如成员键的
拼写与记录的 `name` 不一致，如手工改过或更旧的记录）。边界：采纳只覆盖 TEAM 记录已经认识的成员；team
记录里没有的 session，按设计仍然没有通道。

**弹性执行座位（弹性规划波次）。** 每一趟派发（`cellwork_dispatch` 与激活的首次派发）中，一个**就绪**任务
声明的所有者若是**不空闲**的活跃成员（BUSY，或已被另一个 claim 占着），可以不等待，而是**增长**一个座位：

- 所有者的 **base** 是它的名字去掉结尾的 `-<n>`（`n >= 2`），**role** 是拼写与 base 相等的名册角色
  （大小写/空格/连字符不敏感）；base 不匹配任何名册角色时，该任务的增长被**拒绝**，理由为
  `owner base "<base>" is not a roster role`；
- 已存在同名册角色拥有的、名为 `<base>-<n>`（n 最小）的空闲座位时，**复用**它，不新建；
- 否则通过 `agent_teams_plan {action:"add_member"}` **带着 `role`** 向活跃名册追加一个 `<base>-<n>` 座位，
  写进 cell 记录（`grown: true`），记**一条** `seat-grown` journal 行（task、name、role、reason），并在
  **同一趟**里通过 `agent_teams_dispatch {action:"run", reassign:[…]}` 完成配对——配对是真的，而不是一个
  永远收不到座位的 claim。

上限：每个 base `cellwork.seats.maxPerRole`（默认 8）个座位，每个 cell `cellwork.seats.max`（默认 32）个
执行座位。触顶的任务保持 BUSY 跳过，且理由**必须**点名上限及其数值。**绝不**为以下情形增长：规划座位
（`cell-planner`、`cell-splitter`、`cell-analyst-*`）、纯验证者座位、处于 `checkpoint` 模式或被围栏的
座位、被阻塞的任务、已被 claim 的任务，以及由队长 claim 的行。增长是幂等的：同一看板跑两趟，只要还有空闲
座位就不会建第二个，名册上的名字绝不重复，追加与 cell 记录写入之间崩溃由下一趟采纳活跃名册行来修复。
运行中的 `add_member` **不带 `role`** 是合法的，但答复会**警告**（一句话）：该座位**可能**匹配不到角色路由
（路由解析还会读描述头与成员名，而两者都不保证匹配）——**届时**才继承调用会话的路由；仍建议传 `role`。

## 被围栏的成员、改派与解围杠杆

成员可能进入一种「绝不能被唤醒」的状态：它记录里的 `mode` 是 `checkpoint`，或它写下的交接仍在等待压缩屏障，
或屏障在重试预算（`compactionRetries`）用完后放弃并把它标记为 `fenced: true` 加 `fencedReason`。**一个**谓词
读取这三个信号，被围栏的成员绝不会被发消息。

- **派发跳过被围栏的 owner，并让任务保持待派发。** 跳过原因是**团队平面自己的**那句话：点名成员、原因
  以及平面建议的修复方式——把行 `reassign` 给另一个成员
  （`agent_teams_dispatch {reassign:[{task_id, owner}]}`）。它**不**点名 `unfence`——那是 cellwork 自己
  清除围栏的杠杆（见下）；绝不替换成别的成员。
- **`cellwork_dispatch {reassign:[{task_id, owner}]}` 移动的是行。** 对每一对，在派发**之前**先把该行在
  看板上 claim 给那个成员、记 `task-reassigned`（from → to），然后把正常的派发消息投递给它。每个结果都会
  如实报告（`reassigned`，以及 `reassignInvalid` 里逐条无法读取的输入），绝不抛错。终态行绝不重开、未知
  成员绝不替换、被围栏的**目标**直接拒绝——先解围，或挑一个未被围栏的成员。**启动失败**（FAILED）或仍在
  **启动中**（PROVISIONING）的目标同样拒绝（为它 claim 的行永远不会被接手）；投递使用最新的**非空**
  handle，因此记录里为空的 `executorRef` 会回退到活跃名册的 handle。
- **放弃的围栏有自己的杠杆：`cellwork_dispatch {unfence:[…]}`。** 被围栏的行仍带着 `handoffReady: true`，
  于是 `cellwork_handoff` 以 STILL WAITING for the compaction barrier 拒绝它；另一个清除方式只有又一次
  **成功**的屏障，而被围栏的成员根本无法发起：成员无法靠自救恢复。队长的 `unfence` 列表在派发**之前**运行，
  判断按**记录**分别做出，因为压缩屏障只在一个地方写下放弃的围栏。CELL 行带 `fenced: true` **就是**放弃
  （无论 TEAM 行怎么说）：它**删除** `fenced`/`fencedReason`（键被移除，绝不写 `fenced: false`——normalizer
  禁止这种拼写）、把 `mode` 恢复为 `"member"`、把 `handoffReady` 设为 `false`、保持 `handoffs` 不变，并记
  `member-unfenced`；同时通过团队平面的 `unfence` 接缝重新打开 TEAM 座位（平面把 `mode: "checkpoint"` 也
  视为关闭，该接缝会一并清除）。答复对每个被清除的 CELL 行给一行
  `{member, unfenced: true, plane, planeReason?}`，并把平面那一半如实报告为 `unfenced`、`absent` 或
  `refused`，绝不声称一次没有发生的重开。
- **待处理的检查点不是放弃。** 每次交接都会把 TEAM 行设为 `mode: "checkpoint"`，而压缩屏障仍欠着重新打开，
  这样的一行没有 `fenced` 键。满足以下任一条件，座位就是**归屏障所有**的：CELL 行 `mode` 为 `checkpoint`、
  它的 `handoffReady` 为 `true`、或 TEAM 行为 `mode: "checkpoint"`。**不带** `force` 的解围会答复
  `{member, unfenced: false, reason: "checkpoint-pending", detail}`——那个状态归屏障所有——并且**两个记录
  都不写**，接缝也**不会**被调用；只有 CELL 行显示窗口时也一样（这种情况以前会答复自相矛盾的
  `not-fenced`）。上面的 CELL `fenced` 标记优先：即使 TEAM 行仍写着 `mode: "checkpoint"`，真正的放弃也会被
  恢复。
- **有界的**强制**杠杆：`unfence: [{member, force: true}]`（R4.4，最后手段）。** 裸字符串保持**逐字节**相同的
  非强制行为，因此没有人会误触；对象形式是唯一能请求该杠杆的写法，而且它是**失败即拒绝**的：记录里的 session
  仍是活跃 agent 时**直接拒绝**（`reason: "live-session"`），否则只有达到**写下过的边界**才允许清除——
  `barrierFailures` 达到 `compactionRetries`（reason 为 `retry-budget`），或 `checkpointSince` 早于
  `checkpointPendingMaxMs`（默认 15 分钟，reason 为 `stale`）。时间戳缺失且记录失败数为零**不构成**许可
  （`reason: "force-not-eligible"`）：时间戳可以回退到该 session 最后一条 `checkpoints` 记录，两者都不存在时
  没有资格。获准的清除会删除 `fenced`/`fencedReason`/`barrierFailures`/`checkpointSince`，把 `mode` 恢复为
  `"member"`、`handoffReady: false`，保留 `handoffs`/`joinedAt`/`adopted`，尽力请求平面重开 TEAM 座位，记
  `member-unfenced-forced`（`{member, by: "captain", reason, pendingMs, barrierFailures, sessionId,
  liveness, plane}`），并答复 `{member, unfenced: true, forced: true, alive, liveness, sessionId, bound, pendingMs?,
  plane}`。**它把座位重开是为了重新分配，不是为了工作**：上下文从未被压缩，投递只会重新打开交接文档已经
  描述过的那段上下文。

  **死重种座位由同一个判据覆盖（R5.2）。** 重种会把行写成 `subcaptain` 加 `handoffReady: false`，并把 TEAM
  行重开为 `member`，所以**任何**检查点拼写都不再持有它——而当新子代理已不是活跃 agent 时（`liveness: "dead"`：
  注册表存在、其**队长锚点**可解析、且查不到它），再也不会有回合为它触发。这样的座位**仍然**是被持有的，它的许可是那个**被证明已死**的
  session（`bound: "dead-session"`），但它窗口的**时间戳仍然必需**：没有时间戳就退回重试预算，两者都没有时答复
  `force-not-eligible`。注册表**缺席**（或存在却解析不了队长锚点）是 `unknown`、绝不是「已死」，因此什么都没被证明、也什么都不会被清除。
  **以上每个答案都由同一个判据决定**——`barrierOwned`、死重种形态、活跃否决、时间戳、边界——而
  `cellwork_supervise` 投影的是**同一份**读数，所以巡检宣称可用的杠杆，正好就是该 verb 接受的杠杆（过去这是两个
  各自独立的判据，巡检宣称的杠杆会被 verb 以 `not-fenced` 拒绝）。
- **`not-fenced` 会被如实报告，绝不粉饰。** 两个记录都没有围栏、**且**不带检查点窗口的成员答复
  `{member, unfenced: false, reason: "not-fenced"}`，并且记录**不会**被重写。名字必须
  **无歧义地**解析——先精确的成员键、再精确的显示名、最后才是非空且**恰好只有一个**成员携带的规范化键；
  其余情况（未知，或像 后端1/前端1 下的 `1` 那样有歧义）拒绝**整个**调用，并点名已记录的成员；什么都不会被
  清除、写入或派发，因此拼错一个名字绝不会让清单只生效一半。
- **只有组合暴露接缝时，TEAM 座位才会移动。** `mpdTeamActions.unfence` 会重新打开 team 座位，结果写
  `plane: "unfenced"`（该接缝同时清掉显式围栏与 `mode: "checkpoint"` 窗口）；没有该接缝的组合答复
  `plane: "absent"`，并在 `planeReason` 里说明 TEAM 座位**没有**被重新打开，因此 cell 行的修复照常成立、
  答复绝不假装两边都落地（`plane: "refused"` 会带上团队平面自己的原话）。只存在于 TEAM 记录上的围栏是
  另一种情况：接缝会清掉它，而 CELL 行保持原样，因此结果携带 `cellRow: "untouched"`，`unfenced` 只反映
  平面的那一半。`unfence` 与 `reassign` 可以放在**同一次**调用里——解围先跑，因此这一趟可以把行交给它刚
  重开的成员——两者互不干扰；解围之后的拒绝仍会报告解围改动了什么。杠杆只清记录；它不会重建一个已死的
  session。
- **一次改派会改变同一趟派发的报告。** 目标成员现在**拥有**一个在飞任务，所以同一趟会把它的**其它**就绪行
  报告为 BUSY（每个成员每趟只派一个任务），而不是排队。这是既有的派发规则，不是回归：稍后再跑一趟。
- **第一份交接仍在等待屏障时，第二份会被拒绝。** `cellwork_handoff` 的答复是「结束本回合」：屏障只读最新的
  ordinal，因此第二份文档是在消耗连续性、而不是保住它（VEdit 的活锁在 7 分钟内写了三份）。
- **屏障放弃时会记录后果。** 该成员得到 `fenced: true` + `fencedReason`，journal 得到一条点名修复方式的
  `checkpoint-unrecoverable` 行，而 `cellwork_supervise` 会列出每个**关闭**座位以及它仍然拥有的**未关闭**
  看板行，并标明它是**放弃围栏**（队长该修的）还是**归屏障所有**（待处理检查点窗口）。归屏障所有的座位
  **并非**自动安全：没有任何东西监管屏障——没有定时器、没有队列、没有重试负责人——因此巡检会报告
  `barrierOwned`、`forceEligible` 与 `pendingMs`，并点名有界的强制杠杆，而不是承诺「无需队长动作」。
  上面的解围杠杆就是修复放弃后果的方式。**重试上限**：每一次「没有重开」的屏障运行都会给 CELL 行加一
  `barrierFailures`，达到 `compactionRetries` 的那一次运行会给座位打上围栏，`fencedReason` 里点名计数
  （`N of M consecutive barrier runs did not reopen the seat`）；一次重开（`promoted`）运行会删除
  `barrierFailures` 与 `checkpointSince`。这个上限只覆盖**跨多次运行仍停留在窗口里**的座位——session 已死的
  座位不会再启动运行，由下面的强制杠杆兜底。

**通用 team 动词默认是「仅声明 owner」的；只有它显式的名册模式才带着 cell 模式已经消除的危险。**
`agent_teams_dispatch` 会把就绪任务配给**声明的** owner，而按位置的回退**只**存在于显式的 `mode:"roster"`
参数之后。正是那个模式在现场波次里把一条 **REVIEW** 任务交给了**写过被审泳道**的成员；
队长立即释放了配对、把该行恢复给独立评审者，而那位写作者披露：在被叫停之前它只跑了 `git diff --stat`、一次
标记 grep 和一次目录列表：没有产生任何裁决，因此没有被污染的判断被采用。`cellwork_dispatch` 是**仅声明
owner**、绝不替换的；在 cell 模式之外，**等声明的 owner 空出来，或刻意改派**（先
`agent_teams_task {action:"release"}`，再重新配对），绝不要把「写者自审」当成只是理论风险。

## 工具面

| 工具 | 调用者 | 作用 |
|---|---|---|
|（`/cellwork` 命令） | 你 | 写入那一份 cell 记录，并提交那一条激活指令 |
| `cellwork_start` | 队长 | 打开活跃 cell 的需求阶段：校验 cell 与调用者、写入 `startedAt`、记入 journal |
| `cellwork_status` | 队长、成员 | 阶段、目标、队长、需求/切分修订号、成员及其模式**与座位存活状态**（来自身份注册表的 `liveness: live | dead | unknown`、与强制杠杆共用的 `closed` / `forceEligible` / `forceRefusal` 关闭读数，以及 `suspect` / `deadReseed` / `unverified`）、已注入的检查点、活跃 team 计数、已记录的切分票看板 id、cell 记录与活跃名册的成员差异（`missingFromCell` / `missingFromTeam` / `inSync`）、调用者自己的座位与磁盘路径——它**唯一**的写入是**采纳**本记录从未学到的活跃 team 座位，绝不推进阶段 |
| `cellwork_requirements` | 规划器 | `finalize` 需求文档，或 `update` 它：update 会提升修订号并把切分标记为过期；章节正文延伸到同级或更高级的下一个标题，因此 `###` 子标题留在父章节内 |
| `cellwork_recon` | 规划器、副队长 | **只读**咨询（Explorer/Researcher）：走 `mpdConsults`，由名册行把只读拒绝清单施加到子会话上，并把子会话放在调用者下方一层、作为**叶子**（`cellwork.depthMax` 只数嵌套的 cell，绝不给子会话封顶）；`{role, task}` 返回一份报告（旧有形状），`{role, questions}` 并发跑 1..`cellwork.recon.maxQuestions`（默认 16）个问题、**全部落定后**才返回，每个问题一行；每份报告都记入 journal |
| `cellwork_delegate` | 规划器、副队长、成员 | 一次调用启动 1..`cellwork.delegate.maxTasks`（默认 32）个**后台**咨询并**立即**返回它们的 `consultId`（任何子会话落定之前）；角色可以是**任意**名册角色（写作角色也算），由名册行规范化；校验**全有或全无**（未知角色、空字段或任务数超过该上限则一个都不启动）；超过上限的工作在**唯一**的共享监督器上**排队**（每次启动的预算是 `cellwork.consultMax`，默认 32；显式声明的 `MPD_DSH_CONSULT_MAX` 优先），且队列本身**无长度上限** |
| `cellwork_consult` | 规划器、副队长、成员 | 对本 cell 通过 `cellwork_delegate` 发起的咨询做 `list` / `wait` / `collect` / `cancel`：`list` 只列本 cell 的、监督器仍然记得的 id；`wait` 收敛到 1..60000 ms（默认 30000），超时返回 `state:\"running\"`；`collect` 返回报告并**释放**记录；`cancel` 中断子会话并记 `consult-cancelled`；不是本 cell 发起的 id 会被一句教学式拒绝 |
| `cellwork_split` | 切分器 | `submit` 任务图让插件度量（每个任务可声明自己的看板 `member`），或 `show` 上一次的裁定；每次拒绝都把 findings 持久化到 `split/<修订>.refused.json`；一个**非致命**的 `warnings` 列表按切分键点名每个没有写作用域的 `work`/`repair`/`integration` 任务（`write-scopes-empty`），以及每个就绪前沿宽度超过其已声明 `member` 名的 owner role（`seat-width-short`），且永不改变 `accepted` |
| `cellwork_activate` | 队长 | 把被接受的切分物化到活跃 team 记录、写合约（同时点名 owner role 与成员）、对每个不同的 `member` 只拉起一个成员、打开验证循环、派发；中途失败的一轮会被检查点记录，同一个修订号可以续做，而更新的被接受修订号会取代更旧的在飞部分激活；返回的 `reused` 列出从 cell 记录或活跃名册解析（而不是新拉起）的成员名，而保留了任务的重切分还会返回 `notice`（合约不被重写、扩展作用域需要手工重新冻结加新的验证循环、就绪行按仅声明所有者派发）；成员行的**另外两种**出现方式是暂存与采纳（见「成员：暂存的、拉起的与采纳的」） |
| `cellwork_dispatch` | 队长 | 在 team 看板上做一次「仅声明所有者」的派发；owner 忙、缺席或被围栏时如实报告、任务保持待派发；`reassign` 先把点名的行交给另一个成员（看板 claim → `task-reassigned` journal → 投递），而 `unfence` 在派发**之前**清除点名成员**已放弃**的围栏：CELL 行的 `fenced: true` **就是**放弃（两个键被删除、`mode: member`、`handoffReady: false`、`handoffs` 保留、记 `member-unfenced`），并通过团队平面的 `unfence` 接缝重新打开 TEAM 座位（该接缝也清掉 `mode: checkpoint`；没有接缝时报告 `plane: "absent"` 且不声称已重开）；**待处理**的检查点（CELL 行 `mode: checkpoint` 或 `handoffReady: true`，或 TEAM 行 `mode: checkpoint` 且没有 `fenced` 标志）——以及**死重种**座位（R5.2：`subcaptain`、非交接就绪、记录的 session 被证明已死）——答复 `checkpoint-pending` 且什么都不写，除非条目请求**失败即拒绝**的强制杠杆（`{member, force: true}`：活跃 session 直接拒绝，只有达到重试预算、超过 `checkpointPendingMaxMs`，或凭死重种形态那个**被证明已死**的 session 且记录里有时间戳才允许（`bound: "dead-session"`），并记 `member-unfenced-forced`）；平面那一半若以 `refused` 结束，答复、journal 行与渲染里都会带 `retry`（确切的 `agent_teams_control {action: "unfence", member}` verb）；`not-fenced` 如实回答，未知或有歧义的名字拒绝整个调用，两种形式可以放在同一次调用里；`rebind: [{member, handle}]` 把座位的 TEAM `executorRef` **重新指向**本座位**当前记录**点名的 handle（journal 只作佐证：其最新一条只在两条当前行都不点名任何 handle 时才参与判定），与重种绑定相同的 compare-and-set 与平面回读（窗口内有人提交则答 `team-record-changed`，绝不覆盖），并把该 handle 镜像进 CELL 行（`sessionId`、`executorRef`、`mode: member`、`handoffReady: false`），还会改派旧 handle（或座位自己的名字）名下**非终态**的看板行（`tasksRebound` 计数；`claimed`/`in_progress` 的行**不会被强改**，而是列进 `tasksNeedingRelease` 并给出确切的 `agent_teams_task {action: "release"}` 动词，终态行保留原 owner），记 `member-rebound` 并报告 `rebound`；`handle` 会先 trim、必须是宿主铸造的 UUID 形态，且必须被**当前记录**点名——TEAM `executorRef` 或 CELL 行；记录写入晚于最后一次交接、且自身没有 journal 行时会被接受并标记 `handleRecordCurrent:true`/`journalHandoverOlder:true`（绝不判 `handle-superseded`、绝不反向建议）。只有更早交接行点名的 handle 会拒绝为 `handle-superseded` 并点名取代它的那一行；文案只陈述事实，绝不替操作员选择方向（journal 只追加，旧失败文案仍会引用被后续重种替换的子代理）；当前记录与 journal 最新交接行都不点名的才是 `handle-unevidenced`（归属靠证据，注册表只证明存活）——**唯一的窄例外是被保留的子代理**：`checkpoint-unrecoverable` 行同时带 `orphanChild` 与 `reconcileRequired` 时，即使两条当前行都仍点名旧 handle 也被接受（它必须是 journal 最新一条交接，且记录不能证明写入更晚；结果标 `handleOrphanAdopted`）；每条结果都带 `namedBy`（`team`/`cell`/`journal:<event>`）与 `previousSessionId`/`previousSessionIdLiveness`（`live`/`unproven`/`unknown`），真正落地的重指还会带 `displacedExecutorRef`/`displacedUnproven`，而每一条失败条目（包括参数级拒绝，会记下请求的 `handle`）都会记 `member-rebind-failed`；它不清围栏，而 `unfence` 单独用**永远不会**重新指向 handle。**同一次调用里 `rebind` 先执行：** 它的 `unfence` 一半只在每个 `rebind` 条目都答复 `rebound:true` 且 CELL 镜像确认之后才执行；`rebind` 失败（或镜像未确认）时所有点名围栏保持**关闭**、不执行任何 `unfence`、记 `dispatch-unfence-withheld` 并答复 `unfenceWithheld`（`detail` 写明 `fence stayed closed`，`next` 给出重跑）。落地的重指若 CELL 镜像失败会带 `cellRow:"failed: …"`，**修复未完成**；TEAM 记录缺失或不可读时 `previousSessionId` 这一对会被省略 |
| `cellwork_supervise` | 队长 | 只读巡检：待处理的检查点、压缩、晋升、过期切分、未读邮件、每一条**未投递**的邮件行，以及每个**关闭**座位与其仍拥有的未关闭行——每行标记 `giveUp:true`（任一记录上显式 `fenced:true`，用 `reassign` 加 `unfence` 修复）或 `giveUp:false`（被持有的座位：归屏障所有的窗口，或标了 `deadReseed:true` 的死重种形态），后者还带 `barrierOwned`、`forceEligible` 与 `pendingMs`，并在没有监管者能重开它时点名有界的强制杠杆；`forceEligible` 与 `cellwork_dispatch {unfence:…, force:true}` 用的是**同一个判据**，绝不是第二份拷贝；TEAM 那一半是没有屏障再挂起的 `checkpoint` 的关闭座位会带 `retry`（那个仅队长可用的确切 verb）；只有带时间戳、注册表**存在**、其**队长锚点**可解析、且记录里的 session 查不到时，成员才会标 `suspect:true`（注册表存在却解析不了锚点是 `unknown`，什么都不许可）；`unknown` 的存活状态**绝不**让该行消失——一个离开屏障窗口、session 又无法证明的 `subcaptain` 会以 `unverified:true` 列出，带 `forceEligible:false` 与它自己的 `forceRefusal`，被报告为「未验证」而不是被并进「健康」里；每个投影都是无损 JSON，没有 `undefined` 自有键 |
| `cellwork_context` | 成员 | 调用者自己的实时占用、度量所用的窗口，以及该窗口的来源 |
| `cellwork_handoff` | 成员 | 写入并校验检查点交接文档；把检查点标记为就绪；第一份仍在等待屏障时，**第二份**会被拒绝；只被**活跃** team 记录认识的成员会先被采纳（见「成员：暂存的、拉起的与采纳的」），因此拿到同一条通道 |
| `cellwork_subteam` | 已晋升的副队长 | 登记子 cell、执行深度上限、返回副队长指令 |
| `cellwork_send` | 任意 cell 智能体 | 感知 cell 的寻址（成员、队长、另一个子 cell），并完成传输投递与 journal 记录：持久行先落盘，唤醒尝试作为单独的 `wake` 记录追加在其后 |
| `cellwork_inbox` | 任意 cell 智能体 | 读取并确认调用者的未读 cell 邮件 |
| `cellwork_stop` | 队长 | 结束模式：归档 cell（不删除）、清除守卫、交还工具；只要还有看板任务处于 `claimed`/`in_progress` 就**拒绝**，除非 `force:true`，且强制停止会如实记入 journal |

旁观者一眼看全局用 `cellwork_status`；它绝不推进阶段，其**唯一**的写入就是上面说的采纳（对一个本记录从未
学到的成员，`cellwork_context` 或 `cellwork_handoff` 的第一次写也是同一次采纳）。其余工具要么修改 cell
记录，要么对它返回一份裁定。

## 守卫模式

每个插件只安装**一个** `tools.guard` 谓词。它解析调用者的 session，并在活跃 cell 树里查它：不属于任何 cell
的 session 完全不受影响，这正是模式关闭时零成本的原因。谓词只在**派发**时刻生效。

| 调用者 | 放行 | 拒绝 |
|---|---|---|
| 队长 | 除 `cellwork_handoff`、`cellwork_delegate`、`cellwork_consult` 之外的 `cellwork_*`，加上 `agent_teams_*`、`ask_user_question`、`todo_write`、`mpd_memory_*`，以及**唯一**的循环开启器 `mpd_verify_open`（仅精确名字） | 其余全部：不改文件、不跑 shell、不 `read`/`grep`/`glob`、没有自己的后台咨询（队长只做调度），且除开循环之外不做任何验证：绑座位、记录裁决、取证与 escape 仍被拒绝 |
| 验证者 | `read`、`grep`、`glob`、`bash`（跑关卡）、`mpd_verify_*` | `write`、`edit`、`mpd_hashline_edit`、`mcp__ast_grep__rewrite`、`mcp__ast_grep__scan`、`mcp__lsp__rename_symbol`、`mcp__lsp__rename_symbol_strict`、两个 bundle spawn 工具 `mpd_role_spawn` / `mpd_workmate_spawn`、`mpd_role_spawn_async` / `mpd_role_consult`，以及本包自己的 `cellwork_delegate` / `cellwork_consult`：验证者**绝不委派**：裁决是它自己的活，FAIL 才是把工作退回写作者的通道 |
| 处于上下文检查点的成员 | `cellwork_handoff`、`cellwork_context`、`cellwork_status` | 其余全部：即使它无视书面说明，也无法继续干活 |
| 副队长 | 队长白名单**去掉** `cellwork_start` / `cellwork_stop`，**加上** `cellwork_subteam`、`cellwork_activate`、`cellwork_dispatch`、`cellwork_supervise`、`cellwork_delegate`、`cellwork_consult` | 一切文件工作工具：副队长是迷你队长，只做调度，不做实现 |
| 规划器（`cell-planner`） | 文档带内的 `read`/`grep`/`glob`：`.mpd/**`、`docs/**`、`evidence/**`、`agent-references/**`；任何**按 basename** 命中的 `AGENT.md`/`AGENTS.md`/`CLAUDE.md`（任意深度，workspace 根之外也算）；以及 workspace 根上仅 `README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`LICENSE*.md` | **源码**路径：拒绝信息点名两条委派路线（`cellwork_recon` 配 `Explorer`/`Researcher`，`mpd_role_spawn` 配只读名册角色），并说明理由。路径按**拼写**判定（绝不解析符号链接），`..` 段**只**允许出现在指令文件名的拼写里 |
| 普通成员 | 干活所需的一切，**也包括** `cellwork_delegate` 与 `cellwork_consult` | 没有：它就是普通工作者 |

每次拒绝都是**一整段教学式说明**：点名被拒的调用、可替代的调用，以及作为出路的 `cellwork_stop`。cell 停止
后座位消失，同一个 session 立刻恢复不受限。

其中两行属于本仓库自己的侦察规则，而不是 cellwork 的发明。规划器的可读带**就是**顶层 `mpd` 队长保留的那条
带，而且有一条 parity 测试同时导入两份清单，因此二者不可能漂移。cell 之内，规划器的侦察是**委派**的，而且
一次咨询就是**叶子**：名册的 spawn 工具会把调用者记录的委派深度 + 1 传下去，**并且**在子会话自己的工具作用域
里拒绝两个 spawn 工具，因此子会话绝不可能再次委派；已经处于委派深度 2 或更深的调用者会被那些**工具**拒绝
（在这里干活，或把问题上交）。cellwork 的三个咨询动词不走这条下限：它们经 `mpdConsults` 服务启动，由该服务把
子会话放在调用者深度 + 1——也就是调用者下方一层、一个叶子——并且不传任何绝对上限。
这里有**两套刻度**，不是一套。`cellwork.depthMax`（1..8，默认 3）是 **CELL 树**的刻度：它只数嵌套的 cell 与
team，`cellwork_subteam` 在 `depth + 1 > depthMax` 时拒绝。**智能体委派深度**是另一套由 harness 按 session
记录的刻度：cell 座位就是**团队成员**，因此在随包发布的拓扑里规划器位于委派深度 1，而**嵌套 cell** 的座位比
拉起它的 cell 再深一层。两个数字并不重合，所以 cell 上限绝不会被当作子会话的智能体上限传下去——在合法值
`depthMax: 1` 上，那种传法会让每一次咨询都被拒绝。cell 队长站在另一端
（它的读取面只有通过这些工具访问 cell 记录）而在 cell 模式**之外**，`mpd` 队长的可读带如今在任意深度承认
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`（包括兄弟项目的），同时仍然拒绝一切源码路径。

## 后台委派

cell 的**座位**——规划器、被晋升的副队长、已记录的普通成员——可以把工作派发到**后台**运行，就像顶层队长使用
`mpd_role_spawn_async` + `mpd_role_consult` 那样。cell **队长刻意不能**：它的路线是看板（`cellwork_split` →
`cellwork_activate` → `cellwork_dispatch`），一个能自己拉起咨询的队长就是在干活，而不是在调度。

- `cellwork_delegate {tasks:[{role, task, context?}, …]}` 一趟启动 1..`cellwork.delegate.maxTasks`（默认 32）
  个咨询，**立即**返回
  `{ok, started, consults:[{consultId, role, startedAt}]}`——子会话继续工作，座位继续自己的事。角色是**任意**
  名册角色（写作角色也算），由名册行**自己的**解析器规范化，因此 `DeepWorker`、`deep worker`、`deep-worker`
  与 `Deep Worker` 是**同一个** agent，答复回显名册自己的拼写。校验是**全有或全无**：未知角色、空的
  `role`/`task`、或任务数超过该上限会拒绝整个调用，并且**一个都不启动**。这条规则只管**校验**——部分批次仍
  可能出现：如果某个启动在**已经启动了部分子会话之后**失败，答复是 `ok:false`，并点名**确实已启动**的 id；
  这些子会话继续运行并保持记录（用 `cellwork_consult` 收取）。
- `cellwork_consult {action, consultId?, timeoutMs?}` 结算它们：`list`（只列本 cell 发起、且监督器仍记得的 id）、
  `wait`（1..60000 ms，默认 30000——超时返回 `state:"running"`，绝不抛错）、`collect`（返回报告并**释放**记录）、
  `cancel`（中断子会话并记 `consult-cancelled`）。不是本 cell 发起的 id 会被拒绝，并且句子里说明所有权规则与
  另外两条通道，绝不只是「找不到」。
- 两个动词都走 `mpd-roles` 行在它**唯一**的咨询监督器之上提供的 `mpdConsults` **服务**：一个注册表、一个并发
  上限、一个静默死信器。cellwork 交给**那个**监督器的上限是 `cellwork.consultMax`（默认 32，`1..256`），即
  **每次启动的预算**——显式声明的 `MPD_DSH_CONSULT_MAX` 永远**优先**，两者都没有时行默认值是 8。超上限的工作
  **排队**、绝不拒绝，且**队列本身没有长度上限**：上限只管**活跃**子会话。来自**宿主**的拒绝
  （`ACTIVATION_LIMIT_REACHED`）是**排队**信号而不是失败：MPD 槽位被释放，咨询在**槽位之外**等待有界退避
  （250 ms → 4 s），回到 FIFO 的**队首**，最多重试 8 次；耗尽后以一句点名 **Settings → Subagent limits** 里
  `maxActiveSubagents`（cellwork 建议 32–64）的话落定；`cellwork_consult {action:"list"}` 每行报告
  `hostRetries`。没有那一行的组合会**按名字**
  被拒绝；不存在无监督的回退启动。由于**三个**咨询动词（两个新动词**以及**旧有的 `cellwork_recon {role, task}`
  形态）都走这个服务，只挂 cellwork、**不挂** `mpd-roles` 行的组合连旧有的 recon 形态也会失去；随包发布的
  bundle 同时挂载两行，所以只有手工搭建的组合会受影响。
- `cellwork_recon` 得到同一扇门，外加一个**批量**形态：`{role, questions:[…]}` 问
  1..`cellwork.recon.maxQuestions`（默认 16）个问题，**并发**运行，
  全部落定后才返回（一个问题失败不会取消其它问题——它那一行带上失败文本与 `stopReason:"failed"`）。
  `{role, task}` 保持它原有的字段，而只问一个问题的批量也同时带旧有的 `report`/`stopReason`。

被委派的子会话仍然是**叶子**：名册在每个子会话自己的作用域里拒绝两个 spawn 工具，只读角色（Explorer、
Researcher）另外拿到只读拒绝清单。

### 咨询会出现在 DAG 上

座位发起的咨询在**两个**面上都是一等**节点**——TUI 的 MPD 页与 Web 的 Team 视图——画在发起它的那个 cell 的分组
盒子里，并且落定之后仍留在图上，直到该 cell 结束。

- **它们住在哪里。** 每次启动往该 cell 的 team 记录（`.mpd/team/teams/<id>.json`）写**一行** `running`；共享的图
  模型由这条记录构建、并按变更 feed 的修订号缓存，因此一次咨询是通过看板编辑所用的同一条 写入 → `teamStateChanged`
  → 修订号 路径刷新两个面的。没有第二个 watcher、没有第二个存储、没有新路由。
- **它们不是任务。** 咨询不占 `T<n>`、不被派发、被排除在看板统计、`readyTasks`、干净终止规则与验证者范围之外，
  也**不贡献**任何边与任何 rank：带不带它们，任务画面逐字节相同。它用既有的六态色调绘制（`interrupted` 读作
  `cancelled`），外加一个标记——TUI 卡片上是 `@`，Web 卡片同一个字形——id 是 `C<n>`，在子单元盒子里是
  `<teamId>::C<n>`。
- **落定的咨询不需要座位过问就会被记录。** 名册行的 `mpdConsults.start` 接受可选的 `onSettled` 观察者，在记录离开
  `running` 时触发一次；cellwork 用它写终态行。`wait`/`collect`/`cancel` 的回答作为第二个、幂等的写入源写同一行。
  因此 `cancel` 立刻可见，一个已完成的咨询也不会挂在图上继续自称 running。
- **子单元的咨询画在该子单元的盒子内部**，因为投影把每个存活子级的行交给它自己的帧；丢掉已结束子级的存活过滤
  规则，也一并丢掉它的咨询。
- **`cellwork_stop` 会清掉它们**（强制停止也一样）：行从 team 记录里删除，内存中的 consult book 被丢掉，于是之后
  才落定的子会话无法重新造出一行。
- **声明边界。** 一个永不清停的 cell 会保留它的行，直到它们从留存上限中老化出去（每个 team 50 行，先丢**最旧的
  已结算**行，绝不丢 `running` 行）。cell 还没有活跃 team 时（`teamId` 为空，即从未批准过看板）发起的咨询**什么都
  不记**——唯一痕迹是一行 `consult-unattached` journal，工具回答不变。该记录的读-改-写与所有 team 写入一样有跨进程
  暴露面（没有 compare-and-swap）；进程在落定前死掉时那一行会停在 `running`（没有清扫器，最终由留存上限带走）；
  TUI 的主机子智能体条**不**去重，所以一个运行中的咨询可能出现两次——主机行直到 60 秒宽限到期，以及 DAG 节点，
  后者才是持久的那一面。

## 上下文预算：实测算出，绝不猜

这个模式对上下文有两条不同的承诺，用的也是两个不同的分数：

- **切分时**：任何任务的估算都不得超过它将要运行的那个窗口的 **1/4**（`windowFraction`，默认 `0.25`）。
- **运行时**：活跃成员一旦达到其**观测**窗口的 **1/2**（`checkpointRatio`，默认 `0.5`），就在下一个步骤边界
  被检查点。

两个分数都不是拿字面量去乘：**窗口本身是读出来的**。

### 窗口从模型读取

- **切分时**，插件向 adapter 的模型目录询问该 route 自己的窗口与输出上限
（`resolveModelInfo(provider, model).context.contextWindow` / `maxOutputTokens`），并把来源记为
  `catalog`。
- **运行时**，压力读数来自宿主的 token 计量（`contextPressure`），它报告的是模型在 `request/context` 里
  实际声明的窗口；来源记为 `observed`。
- 窗口读不到的 route 是 **`uncertified`**，绝不拿猜测悄悄预算。要让这种 route 被认证，唯一方式是显式设置
  `windowOverride`，此时裁定记录来源 `override`。

因此模型窗口变大时，切分预算与检查点触发线都会自动抬高：不用改代码，也不用改配置。

### 代价估算与接受规则

部署里没有分词器，所以插件用实测字节与可配置比率算一个刻意保守的估算：

```text
estimate = fixedOverhead[route]                    # 配置项：以一次实测的 28,544 token 会话为种子，随包默认 32,000
         + ceil(asciiChars  / asciiCharsPerToken)  # 英文默认 3 字符/token
         + ceil(cjkChars    / cjkCharsPerToken)    # CJK 1 字符/token
         + 4 * contentBlocks + 4                   # 宿主的框架性开销
         + measuredInputs
         + ceil(toolSchemaChars / asciiCharsPerToken) + 4
         + outputReserveTokens                     # 默认 8,192，模型给出 maxTokens 时取其上界

measuredInputs = 对任务声明的每个输入路径求 Σ
                 stat(path).size，CJK 占比从前 16 KiB 采样
                 tokens = bytes * (1 - cjkRatio) / 3 + bytes * cjkRatio / 3 + 4

accept  iff  estimate <= floor(window * windowFraction)
        and  estimate + modelMaxTokens + compactionHeadroom <= window
```

「抓真实数据、在程序里算」这条规则就落在第二行：一个声明了 2 MB 文件的任务会被**带着数字**拒绝，
`file X = 2,097,152 bytes ≈ 699,051 tokens > budget 250,000`，而不是含糊带过；被接受的任务则是按真正
`stat` 过的文件计价的。

第二条接受条件为模型的最大输出与宿主的压缩预留（默认 65,536 token）留出空间，因此一个被接受的任务不会
仅因为输出就把宿主拖进任务中途的压缩。

### 这些数字的可信度

1/4 规则是一份**经认证的估算，不是测量**。它声明的误差界是**英文散文 ±25%**；CJK 刻意从严计价（约每个
UTF-8 字符 3 字节、按每字符 1 token），因此中文密集的任务只会被切得更小，绝不会被放大。每份切分裁定都
标注 `estimate`，读不到窗口的 route 则如实标注 `uncertified`。

## 检查点 → 交接 → 压缩 → 晋升

到达检查点比例的成员不是「试着写简洁点」；模式会收回它的工具，把工作交给继任者。整个序列是机械的：

1. **检测**：宿主平面那一行的 `agent/pre-step` 监听器解析调用中的 agent、读取上下文压力；对一个达到或超过
   `checkpointRatio` 的活跃 cell 成员，它记录 `checkpoint injected`，并返回一个 `enter` 决定，附带一条额外
   消息：`[mpd-cellwork] CONTEXT CHECKPOINT … stop work, call cellwork_handoff, end your turn`。
2. **停机**：同一个模式切换把该 session 置为 `checkpoint`，守卫随即拒绝除 `cellwork_handoff`、
   `cellwork_context`、`cellwork_status` 之外的全部工具。书面说明是解释，守卫才是执行。
3. **交接**：`cellwork_handoff` 校验必需章节（任务、状态、决策、产物、已验证事实、未决问题、下一步），写出
   `handoff/<member>-<n>.md`、记入 journal，并把检查点标记为 `handoff-ready`。指令要求该 agent 结束本回合，
   别的什么都不要做。
4. **压缩**：在 `agent/turn-stopping` 时，监听器**返回**屏障的 promise，于是宿主的串行派发会 **await** 它，
   而不是与一个已脱离的屏障赛跑。屏障**不会**等待 agent 空闲：它最多做 `compactionRetries` 次尝试，在两次
   之间 sleep `idleBarrierDelayMs`（**第一次**之前没有 sleep），并**在**任何 sleep **之前**、在查注册表**之前**，
   从事件携带的**活跃**成员 handle 解析引擎（`compactionEngineForLiveAgent`），因此一个已从 `ctx.agents`
   脱离的成员仍能到达它自己领域里的引擎；只有该 handle 没带引擎时，才轮到按 id 的
   `compactionEngineForAgent`。引擎带真实的 `AbortController` 信号驱动，结果会被分类并记入 journal：
   `null`（没有安全可用的区间）、`busy`（agent 忙碌）与 `error` 全都会被记录，因此重试预算用完绝不是一次
   静默的空操作。**每次尝试都是 `busy` 是宿主自身的边界，journal 会写明这一点**（R4.0）：引擎的
   `compactNow` 跑在 `agent.runMaintenance` 里，而后者拒绝除 idle 之外的任何阶段；`agent/turn-stopping`
   又是在**回合内部**派发、且监听器会被 await 的——所以在宿主上，原地压缩**无法**在这个事件上运行，等待也
   改变不了它（宿主必须先拿到监听器的 promise，才可能进入 idle）。因此重种是这个事件唯一的出路，reason
   文本会记录这个事实，而不是把 `busy` 留成一句无人解释的话。
5. **晋升或重种**：结果并集恰好是 `promoted | reseeded | refused`。压缩成功时，**同一个**成员原地晋升——不打断、
   不重种——该 session 的模式变为 `subcaptain`，并收到晋升指令（深度 + 1、从交接文档继承剩余范围、子 team
   协议）。若没有安全区间或压缩失败，则**中断**原会话（经它的活跃祖先退役——重种路径**不会** `dispose` 它），用交接文本作为提示词启动一个新的子代理，并同样种入晋升
   指令——但绝不用成员自己那个已死的 Agent 当父级：重种的父级依次是成员记录的 `parentSession`（解析为活跃
   会话）、该 cell 的队长，两者都不活跃时屏障以**独立**原因 `reseed-parent-unavailable` 拒绝。真正用到的
   父级会记入 journal（`parentSource` + `parentSessionId`），因此血缘由可观测取代推断。
   **重种要么把座位绑好，要么明说没绑（R1）。** 拿到子代理 handle 还不等于有了座位。在写入 `reseeded` 之前，
   **三个面**必须都指向新 handle：TEAM 成员行（`executorRef` = 新 handle、`mode` 回到 `member`、交接文档作为历史
   保留）、所有仍以旧 handle **或该座位自己的名字**为 `owner` 的**非终态**看板行（两种拼写是同一个座位）、以及
   屏障自己写的 CELL 行。**终态**行——`completed`、`failed` 或 `cancelled`——记录的是谁真正干了这活，其 `owner`
   绝不重写。任一面拒绝——名册不可读、名册从来没有这个座位、平面读不回刚写的记录——这一轮就是**拒绝**：记
   `checkpoint-unrecoverable`（`surface` 点名失败面、`retry` 给出修复路径）、围栏 CELL 行，并**尝试**通过
   `dispose()` 接缝释放新子代理的激活（没人能寻址的子代理不该占着槽位；该接缝可能**不存在**或**抛错**，
   所以拒绝文案如实报告尝试的结果，而不是声称一次并未发生的释放）。`seat-rebound` 是报告实际落地内容的那一行。**已经落地的写入若在回读
   时被拒绝，会被回滚：** 绑定把 TEAM 行（handle 与 mode）和看板 owner 恢复到绑定前，但**仅当**文件仍逐字节等于
   本次绑定写入的内容；若之后已有别的写入者提交，回滚**拒绝**覆盖那份文档（`rollback: "refused"`），journal 行
   会如实说明；回滚本身写不进去则是 `rollback: "failed"`，原因在 `rollbackReason`。
   **回滚被拒时一律保留子代理（A11；第二轮放宽）。** 此时另一位写入者的文档才是权威，而最常见的并发
   形态——team-core 自己的读-改-写——会**保留本次绑定写入的新 `executorRef`**。释放这个子代理，就会让存活记录指向一个
   已被释放的座位，正是本次修复要消灭的搁浅座位。**回滚被拒并不证明子代理不可绑定，哪怕当时读到的文档点的是另一个
   handle**：`cancelTasks` 同样是读-改-写，它在本次绑定**进行期间**读到的名册完全可能在之后才提交，而那份文档点的正是
   新 handle。所以**任何** `refused` 回滚都保留子代理，只有真正把绑定前行**恢复**（`restored`）的回滚才释放它。回滚本身
   **没写成**（`rollback: "failed"`）是同样的「未证明」状态——它的写入或它自己的回读没有落地，没有任何读者能说记录已经
   不再点这个子代理——因此同样**保留**子代理。本轮以 `orphanChild: "<handle>"` 与 `reconcileRequired: true` 拒绝，文案
   写明 `BINDING KEPT` 并点名这个「待提交写入」的风险，journal 行的 `retry`/`repair` 给出**调和两份记录**的动词：
   `cellwork_dispatch {rebind:[{member, handle}], unfence:[member]}`——`rebind` 重新指向 TEAM 的 `executorRef`
   并把 handle 镜像进 CELL 行，还会改派旧 handle（或座位名字）名下**非终态**的看板行；
   `claimed`/`in_progress` 的行留原样并列进 `tasksNeedingRelease`，因为派发契约要求先
   `agent_teams_task {action: "release"}`；`unfence` 单独用**永远不会碰 handle**，`reassign` 只移动看板行。TEAM 行与看板 owner 通过
   记录文件写入，并用 `mpdTeams` **回读验证**，因为平面没有能重新指向它们的动词——**已声明边界**：等
   `mpdTeamActions` 长出座位重绑动词，这次写入就变成一次委派，路径知识随之消失。

   **同一次调用里 `rebind` 先执行，失败就扣住 `unfence`（第二轮 Major-1）。** 围栏是「放弃」事实，也是把半修复的座位挡在
   派发之外的那道门，所以只有在身份被证明之后才能清：同一调用里的 `unfence` **只在每个** `rebind` 条目都答复
   `rebound:true` **且**它的 CELL 镜像被确认之后才执行。只要有一条 `rebind` 失败、或镜像未确认，本次调用点名的**所有**
   围栏都保持关闭：不执行任何 `unfence`，记 `dispatch-unfence-withheld`，答复 `unfenceWithheld: {reason, members, failed,
   detail, next}`——`detail` 写明 `fence stayed closed`，`next` 给出重跑路径。两半因此有方向：`rebind` 失败就保持座位
   关闭，绝不会把活交给一个死 handle。

   **`rebind` 的 handle 会被校验，它自己的结论也会被记录（R2/R3/M1/N1/F1）。** `rebind` 先 trim `handle`，只接受宿主
   铸造的 session 形态（8-4-4-4-12 十六进制 UUID）；其它任何值都拒绝**整个调用**，绝不让座位半修复，并且参数级
   `member-rebind-failed` 行会记下被拒绝的 `handle`（有长度上限，截断时带 `handleTruncated`），所以拼错或粘贴截断
   都能从 journal 复现。该 handle 还必须被**本座位当前的记录**点名：TEAM 行的 `executorRef` 或 CELL
   成员行——或者，当**两条当前行都没有点名任何 handle** 时，由 journal **最新一条**交接行点名（记录沉默时，
   时间上的最新就是唯一剩下的证据）。**journal 可以为「当前记录没有点名的 handle」提供证据，但永远不会否决「当前记录已经点名的
   handle」**——只要任一当前行点名了请求的 handle 就接受，无论只追加的 journal 说什么。journal 的「最新一条」只在**两条当前行都没有
   点名任何 handle** 时才参与判定；其余情况下它可以解释一次拒绝，但绝不能否决记录点名的 handle。这样，当记录写入发生在最后一次交接**之后**、且它自己没有 journal 行时，更早的
   `compaction`/`seat-rebound`/`member-reseeded`/`reseed-parent`/`member-rebound`/`checkpoint-unrecoverable`
   `orphanChild`/`member-adopted` 旧行就无法否决它——那种答复会把记录当前的 handle 说成过期，并建议**反向**
   重指。当记录点名了请求的 handle、且能证明记录的写入晚于 journal 最后一条交接行时，结果会带
   `handleRecordCurrent:true` 与 `journalHandoverOlder:true`，而不是拒绝。只有更早交接行点名的请求会按条目
   拒绝为 `reason:"handle-superseded"`，其 `supersededBy`（答复、journal 行与渲染都带）点名后来那条事件与
   handle；拒绝文案只说当前记录点名了什么、journal 最后一条交接点名了什么，**绝不替操作员选择方向**——它要求
   先调和两份记录。当前记录与 journal 最新交接行**都**不点名的 handle 才拒绝为 `reason:"handle-unevidenced"`
   （也就是上面那个「记录沉默」的例外：记录里没有任何一行点名时，journal 最新一条交接行才是证据）。
   **唯一的窄例外是被保留的子代理（第三轮 Major-2）：** 同时带 `orphanChild` 与 `reconcileRequired` 的
   `checkpoint-unrecoverable` 行即使两条当前行都仍点名旧 handle 也被接受——它是「本座位启动过该子代理」的唯一
   持久证据；它必须是 journal 最新一条交接、且记录不能证明写入更晚，结果标 `handleOrphanAdopted:true`。
   更晚的记录若点名了别的 handle 仍然压过它（F1）。两种结果都带 `namedBy`——`team`、
   `cell` 或 `journal:<event>`——所以证据来源不会是死字段。**当 TEAM 行可读时**，每条结果还报
   `previousSessionId`/`previousSessionIdLiveness`（只有 `liveAgentExact` 有答复才是 `live`，接缝存在但答复为空是
   `unproven`，组合根本没有接缝是 `unknown`）；**TEAM 记录缺失或不可读时这一对会被省略**，因为那时没有可报告的
   被替换 handle。真正落地且覆盖了另一个 handle 的重指还会带上与重种绑定**相同**的
   `displacedExecutorRef`/`displacedUnproven`（N1），出现在答复、`member-rebound` 行与渲染里——一个仍然存活却被
   替换的子代理始终可追，绝不会悄悄消失。**每一条失败条目**（包括参数级拒绝）都会记 `member-rebind-failed`，让一次
   尝试过的修复不会只存在于答复里。被**重种顶掉**的 handle 同样有记录：当 TEAM 行本来点名了另一个非空
   `executorRef`、且没有任何证据证明它已死（重入守卫在这里按设计是惰性的）时，`compaction`、`seat-rebound`、
   `member-reseeded` 三行都会带 `displacedExecutorRef` 与 `displacedUnproven`，被覆盖的子代理仍然可追。

   **`rebind` 同样改派看板，且绝不强改活跃行（第三轮 Major-1）。** TEAM `executorRef` 重指之后，**同一次**
   compare-and-set 写入还会改派 owner 为旧 handle——或座位自己记录的名字/id（Minor-6 拼写）——的每一条
   **非终态**看板行，规则与重种绑定完全相同。终态行（`completed`/`failed`/`cancelled`）保留真正做事的 owner，
   别的座位的行不受影响，移动了多少行由 `tasksRebound` 计数。`claimed`/`in_progress` 的行**不会**被移动：
   派发契约要求先 release（release 会把行退回 `pending`），所以条目会带
   `tasksNeedingRelease: [{taskId, status, release}]`，其中 `release` 是确切的
   `agent_teams_task {action:"release", task_id:"<id>"}` 动词；先执行它，再
   `cellwork_dispatch {reassign:[...]}`。同样的信息也记在 `member-rebound` 行上，并且**渲染出来的落地行**同样带着它们——
   `; board: N row(s) handed over`、`; M row(s) still need release: <ids> — run agent_teams_task {action:"release", task_id} first`，
   以及被保留的子代理被采纳时的 `; handle adopted from the orphan evidence row`——所以一次仍让活跃行指着死 handle 的修复，
   绝不会被渲染成无条件的成功。**一条写明的限定（NIT-6）：** 当 TEAM 行完全没有点名任何 handle 时，一条看板行都不会被改派——
   包括座位名字持有的行——因为名字持有的行仍能路由到该座位；改派只在身份变化时发生。

   **CELL 镜像没确认，这次 `rebind` 就不算修完（第二轮 minor）。** 一条落地的条目只要 TEAM 行被重指并回读通过就答复
   `rebound:true`；CELL 镜像**是第二次写入**。镜像写入失败时，该条目仍是 `rebound:true`，但会带
   `cellRow:"failed: <原因>"`：TEAM 行点了新 handle，CELL 行没有——**两份记录不一致，修复没有完成**。操作员必须逐条
   **检查 `cellRow`**：只有它**缺席**（journal 行里的 `cellRow:"mirrored"`）才代表两处一致；镜像失败后要修好记录再重跑。
   镜像失败还会扣住同一调用里的 `unfence`。两个动词**职责不同**：`rebind` 修身份（`executorRef` 与 CELL 镜像），
   永远不清围栏；`unfence` 修围栏，永远不碰 handle。谁也代替不了谁。

   **不存在不等于不可读（F1）。** 若 cell 的 workspace 里**根本没有 team 记录**（`.mpd/team/teams/<id>.json` 上的
   `ENOENT`），答复 `plane: "absent"`：没有成员行、没有看板可绑，为一个谁都没创建过的平面去拒绝一个健康的子代理
   才是缺陷，而不是修复。若记录**存在但读不出来**——JSON 损坏、`EACCES`、平面读取抛错，或答复的东西根本不是一条
   记录——那是对立面，这一轮**拒绝**：`checkpoint-unrecoverable` 带 `surface: "team-record-unreadable"`，围栏该
   座位、释放新子代理，并且**不覆盖**那堆读不出来的字节。这个区分重要，是因为「读不到」本身分不清这两件事，而把
   不可读的面当成不存在的面，正是重种在什么都没绑的情况下报告成功的路径。

   **绑定是对记录字节的 compare-and-set（F2）。** 快照取自本函数即将重写的同一个记录文件；在 temp+rename 之前会
   **再读一次**该文件，把两份内容**按完整字节整体比较**：**任何**字节变化都拒绝——不只是绑定碰巧关注的那几个字段。
   字段（`revision`、`updatedAt`、成员行哈希）只用来在 `reason` 文案里**说明是什么变了**，是证据，不是判定依据。
   若有另一个写入者在这个窗口内提交，绑定以 `surface: "team-record-changed"` **拒绝**，并落到同一种失败形状
   （不写 `reseeded`、围栏座位、释放子代理），绝不覆盖别人的写入。读 → 比较 → temp+rename 这一串**按契约必须是一个
   同步块**：`atomicWriteText` 是同步的，所以**本进程内**不可能有别的写入插进来；窗口内也不得引入任何 `await`。

   **CAS 只是收窄窗口，不是消除（F2 的残余）。** 比较与 rename 是两次文件系统调用，因此**另一个进程**若在两者之间
   （比较之后、rename 之前）提交写入，仍会被覆盖：窗口从「整个构建过程」收窄到「相邻两次调用」，并没有关闭。正解是把
   这次写入委派给 team-core 的 seat-rebind 动词——记录归它所有，它能在自己那一侧做成原子的读-改-写；在该动词出现
   之前，这条残余是**已声明**的，不是被抹掉的。

   **新子代理会被告知该做什么（R2）。** 它的第一条提示里已带交接文档加晋升指令，屏障还会通过团队执行器的 `send`
   把同一条指令**投递到新的 handle**；`member-reseeded` 记录 `directiveDelivered`（投不出去时带
   `directiveError`），不把座位的闲置留给推断。

   **没有静默分支（R4）。** 记录重读失败记 `barrier-record-unreadable`；座位交付之后抛出记 `barrier-failed`，
   并按强制杠杆的**书面许可**围栏该座位（`checkpoint` 窗口且 `barrierFailures` 达到重试上限），队长因此既看得
   见、也能用 `cellwork_dispatch {unfence:[{member, force:true}]}` 清掉它；那次抛出还会释放它创建的激活。
   **重读失败分支什么都不写：** 记录读不出来，屏障就没有可信的合并基准，**绝不会**把 await 之前的快照写回去
   （那正是这条分支过去造成的丢失更新）。被拒绝的字节原样保留，journal 行如实报 `fenced: "not-persisted"`、
   `forceEligible: false`，并带一条明确的 `recovery` 说明；它绝不假装写了一个谁也看不见的围栏，修好被点名的
   文件后，屏障会在该成员下一次回合结束时重跑。强制杠杆只在**有条件时**才被点名，因为它有两个前提：本轮没有落下任何
   可清的围栏，且 `cellwork_dispatch {unfence:[{member, force: true}]}` 本身要求一条**书面 bound**
   （`barrierFailures` 达到重试上限，或 `checkpointSince` 早于 `checkpointPendingMaxMs`）才具备资格。
   **恢复路径不会被再次进入。** 某一轮 spawn 成功、但 CELL 行没写成，会留下这样的状态：TEAM 行点名**活着的**新
   handle，而 CELL 行仍点着被替换的旧 session、且仍是 `handoffReady: true`。新子代理自己的回合结束会经由 TEAM 行
   解析回这个座位，因此不做这项检查的屏障会为一个座位再拉起**第二个**子代理。当 TEAM 行已经点名一个身份登记册
   证明为**活着**、且不等于 CELL 行所记 session 的 handle 时，本轮**不 spawn、不改写任何记录**，只记
   `barrier-skipped`，带 `branch: "reseed-already-bound"`、该 handle、所记 session，以及调和两份记录的 `rebind`
   修复。空 session、相同 handle 和已死 handle 都**不会**触发跳过：只有「不同的活 handle」才是恢复态。
   **屏障**欠**这个座位一次重开，这是它的**职责**（R4.1）。** `cellwork_handoff` 在文档落地时把 TEAM 行写成
   `mode: "checkpoint"`，而这个拼写会让守卫和派发都把座位视为关闭。因此只有**落盘那一行确实重开了 CELL 座位**
   （`fenced !== true`）的屏障轮次，才**以队长身份**调用团队平面的 `unfence` 接缝（`{sessionId:
   cell.captainSessionId, member}`——与队长自己的 verb 用的是同一份授权），记 `member-unfenced` 且
   `by: "barrier"`，并把平面那一半完全按该 verb 的方式报告：
   `plane: "unfenced" | "absent" | "refused"`（`planeReason` 带平面自己的原话）。判据是**屏障写下的那一行**，
   绝不是原始结果：到达重试上限的 `reseeded` 轮会在同一轮**围栏** CELL 行、什么都不重开，改记
   `plane-reopen-skipped`，其 `plane: "skipped-fenced"`——屏障 `plane` 枚举的第四个取值（`refused` 轮仍和
   以前一样记 `checkpoint-unrecoverable`）。被**拒绝**的那一半不是死胡同
   （R5.4）：journal 行还会带 `retry`，写明能够重新驱动该接缝的那个**确切的**、仅队长可用的 verb
   ——`agent_teams_control {action: "unfence", member: "<名字>"}`——而 `cellwork_supervise` 对一个
   「没有屏障再为它挂起」的 TEAM `checkpoint`（CELL 行已经离开窗口）也会报出同一个 verb，操作者不必猜。
   晋升后的座位在**两个**记录里都重新打开；**重种**后的座位指向新的子代理，并额外记 `member-reseeded`
   `{previousSessionId, newSessionId, retired, plane}`，让这次交接成为事实而不是推断。原 session 会用宿主的
   `interrupt` 退役：**目标**始终是成员自己的 id（绝不是新子代理），而**授权**来自一个**活跃祖先**（R5.1）
   ——也就是这次重种所用的那个 session：成员的持久父会话（当它活跃时），否则该 cell 的队长——作为 `ancestor`
   授权传进去。成员**自己**的 handle 永远不是授权：宿主用 session id 索引 Agent，所以那个写法**就是**目标，
   `dsh-subagent` 会在祖先检查**之前**以 `UNAUTHORIZED "cannot interrupt itself"` 拒绝它。因此记录写的就是
   宿主真正做过的事：`retired: true` 只在目标被**证明活跃**且宿主接受了打断时出现（`retirement: "accepted"`）；
   身份注册表对记录的 session 给不出活跃 agent 时是 `retirement: "nothing-to-retire"`（死座位形态，也是宿主
   自己文档化的空操作，**绝不**算退役）；宿主拒绝时是 `"refused"`，它自己的原话放在 `retirementReason`；组合
   没有打断接缝或没有身份接缝时是 `"unavailable"`。以上任何一种答案都不会阻止重种，`member-reseeded` 行会在
   `retired` 旁边带上 `retirement`/`retirementReason`。**声明边界：** 如果宿主仍能向已退役的 session 投递，
   它就可以继续收到投递——座位记录指向新的子代理，本 bundle 不会为此发明第二套撤销机制；此外驻留性是通过
   agents 注册表证明的（那正是宿主授权检查所用的身份），所以一个活跃但**非驻留**的外部激活会静默答复并被记成
   `accepted`（本 bundle 只起**本地**可续子代理，因此那是它并不构建的组合的残留边界）。

   **重种**不是**「子代理能工作」的证明（R4.2）。** 拿到 handle 被记为 `reseeded`，它诚实的含义只是「启动了一个
   子代理」：座位保留它的 `checkpointSince` 时钟（只有 `promoted` 结果才会清除它），而
   `cellwork_supervise` 只有在**带时间戳**、活跃注册表**存在**、其**队长锚点**可解析、且记录里的 session
   不被该注册表持有时，才会把座位报告为 `suspect: true`，并带上 `pendingMs` 与 `forceEligible`。当组合里根本
   没有 agents 注册表、或注册表存在却解析不了队长锚点时，答案是 `unknown`，**绝不是**「已死」，也不会仅凭这一点
   把任何座位报成 suspect。session 已死的座位由下面的强制杠杆兜底，而不是由重试计数兜底：
   它不会再启动任何一次屏障运行。

6. **子 team**：被晋升的 agent 用 `cellwork_subteam` 登记自己的子 cell，并领导自己的计划。当
   `depth + 1 > depthMax`（默认 3）时 `cellwork_subteam` 会拒绝并返回确切的边界，父 team 的深度读自
   `mpdTeams.depthBudget`；它**不启动任何 agent** —— 只写子 cell 记录，并回答一条由被晋升成员随后执行的指令。
   深度只有**一种说法**，其中含**两套刻度**：`cellwork.depthMax` 是 **CELL 树**的边界，**绝不**作为任何
   agent 的 `maxDepth` 传下去；一个 agent 的上限永远是**它自己父 session 记录的深度 + 1**（即
   `spawnMaxDepthOf` 规则），这正是每一次咨询、每一次重种都是叶子的原因。子 team 运行完全相同的阶段与规则，
   `cellwork_supervise` 会巡检整棵 cell 树。

队长不是成员，在 v1 中永远不会被检查点。

## 嵌套 DAG：子单元画成分组盒子

被晋升的副队长会拉起子 team，而共享图把那个子单元画成一个**盒子**，盒子内部就是该子单元自己的 DAG。这条规则
住在模型里（`packages/mpd-graph-core`，它的 README 双语对完整陈述了它）；本节记录 cellwork 对它承诺了什么，以及
读者可以期待看到什么。

- **每个子单元一个盒子。** 盒子是**父帧**里的一个节点，它的 id 就是子 team 的 id，它的 `dependencies` 是附着到
  它边框上的阻断者，而盒子内部装着子 team 自己的任务，按它们自己的模型排序。
- **外部边附着到帧上。** 一端在盒子内、另一端在盒子外的依赖，会被重锚到盒子上（盒子即包含内侧端点的最内层帧）；
  因此一条线永远不会逃出盒子。完全落在内部的边保留它原来的两个任务，两个盒子之间的边变成 box→box，而盒子的派生
  边是由拉起该子单元的那个任务**推导**出来的，不是在哪儿手写的。
- **递归属于模型，而不是第二套概念。** 一个子单元还可以包含子单元：每一帧各自排序，嵌套一直重复到上面的深度围栏。
  id 必须在整棵树内唯一，因为 id 是两个渲染方共同依赖的连接键：团队平面对被复用的任务编号使用的写法是
  `<teamId>::<taskId>`。

**这条缝是隐式推导，并且没有一个可以被忘记的参数。** `cellwork_subteam` 把父 cell 的**实时** team id 写到新 cell
的 `CellState.parentTeamId` 上，并把 `subcell-created` 连同它写进 journal；子 team 本身在登记时**不传**
`parent_team_id`。团队平面在**批准时**从父 team 自己的名册推导这条链接（`deriveParentTeam`），因为登记子 team 的
那个 session 本身就是父 team 的成员：记录本来就知道。正因如此，嵌套不会漂移：没有第二个值需要保持同步。同一段
代码会拒绝一个不把该 session 记作 Lead 或成员的父亲，也会拒绝一条绕回自身的 `parentTeamId` 链，所以投影
（`mpdTeams.graph(workspace, teamId)`）可以顺着 `parentTeamId` 递归合并成嵌套分组而不担心成环。

**本波次两个表面都画这些盒子。** 面板在它的字符网格里画出它们：第二套单格字形家族、横跨内部各行的帧框、
到达边画端口而穿过的边画交叉、分组命中身份，以及"宁可折叠也不半画"的宽度守卫
（`packages/mpd-tui-plugin/README.md` 的 "Nested groups: subcells as boxes"）。web DAG 通过帧通道画同一
套模型：边与卡片之间的 `.mpd-dag-group` 层、每个分组一帧并发布矩形（`data-mpd-group`）、每个盒子内部在
**绝对画布坐标**上递归规划自己的 DAG（盒子尺寸 = 内部 + padding）、框→框或框→任务的边终止在帧的边框端口、
按帧的重叠审计取并集、内部卡片走 `data-mpd-cards` 层。构建后的 `client.js` 携带这条通道，平铺板仍走未改
动的平铺路径（由构造保证字节恒等）。三条 web 边界见"声明边界"。

## 感知 cell 的邮件

cell 内的智能体可以互相通信，不经过用户界面，也不经过队长。邮件本身走一条与团队面共享的持久流：
`<workspace>/.mpd/team/mailbox.jsonl`；kind、标签规则、寻址与确认归属只在 [`mail.zh-CN.md`](./mail.zh-CN.md)
里讲一次。

- **`cellwork_send`** 在 cell 树里解析收件人：成员名、字面量 `captain`，或跨 cell 形式
  `"<cellId>/<captain|member>"`，其中 `<cellId>` 必须是**本** cell 登记过的子 cell 或本 cell 的父 cell
（`cell.subcellIds` / `cell.parentCellId`），其它一律以 `"not in this cell's tree"` 拒绝。显式给出的名字既
  不是 `captain`、也不是**目标 cell** 的成员时会被**拒绝**（答复列出该 cell 的成员）绝不会悄悄投进调用者
  自己的收件箱。
- **积压上限是一个 workspace 旋钮，两个邮件工具共用它。** `mail.maxUndelivered`（默认 8，`0` 表示关闭；
  缺失或不可用的值回退到 8）每次调用都在 `cellwork_send` 与 `agent_teams_mail` **共用**的同一条存储路径上
  读取，因此两个工具之间的上限不可能不同。收件人达到上限时会被拒绝，拒绝点名它的名字、当前条数、上限与两条
  恢复路径——确认收件箱（`cellwork_inbox`、`agent_teams_mail {action:"read"}`），或改派它身后的行
  （`cellwork_dispatch {reassign:[…]}`）——并且不写入任何内容。一次确认释放一个槽位，一次投递同样释放一个。
- **行落在哪里。** 落在 workspace 邮箱里，并盖上该 cell 的 `teamId` 与一个附加的 `cellId`（视图按它筛选；
  跨 cell 的发送者还会盖上 `fromCell`）。写入走共享存储的原子扇出，所以所有规则都在第一次追加之前跑完。
  统一之前的 `<cell>/mail.jsonl` 仍然会被读取，并按 `at` 顺序合并进视图；对**那些**行的确认会追加回那个文件，
  而统一之后的行则走共享存储的、带归属检查的确认路径。**发送方**的 journal 会以 `cell:<cellId>` 戳并带
  `toCell:<target>` 记录这次发送。
- **结构化邮件，同一套协议。** `kind`（`message` | `question` | `answer`），省略时从 `options` 或从
  `selected`/`custom` 推断；问题用 `options` + `multiSelect`；`replyTo`（应答的 `answerTo`）；应答用
  `selected`（逐字复制的被提供标签）和/或 `custom`；`questionId`（默认取问题自己的消息 id，或被应答问题的
  key）；`broadcast: true` 表示目标 cell 的每个席位一行，排除发送者。未知标签会被拒绝，并附上完整的合法标签
  列表。
- **先持久，唤醒尽力而为。** 行在任何唤醒尝试**之前**写入，尝试的结果是单独的一条 `wake` 记录
（`{t:"wake", id, sent, reason?, at}`：规范形状与各种原因见 [`mail.zh-CN.md`](./mail.zh-CN.md)）。唤醒
  从未发出的行保持**未投递**，`cellwork_supervise` 会同时呈现未读计数与每一条这样的行（`unreadMail` 加上
  `wakeFailures[]`），不只是待办看板。跨 cell 的行只做持久投递（跨 cell 不尝试唤醒），并出现在收件方 cell 的
  巡检里。成员 → 队长的行由队长的收件箱读取，因为队长不是 mailbox 成员，Lead 的 handle 也无法被直接唤醒。
- **日志格式变了，而且是单向兼容。** `send` 行带着 `wakeSent: false`（旧拼写），唤醒结果作为随后的单独
  `wake` 记录存在，于是"先落盘、后唤醒"在日志里可以直接看到，而不是靠推断。本构建能正确折叠**更旧**的日志
（`wake` 之前的行保留自己的 `wakeSent`），但来自**旧构建**的读者会把新行读成"未唤醒"，而且它在 cell 文件
  里根本找不到新行，因为现在写入的行住在 workspace 邮箱里。如实写明，不要藏起来。

## 磁盘状态

一切都在 workspace 之下、属于被 gitignore 的运行时状态：

`<workspace>/.mpd/cellwork/<cell-id>/`

| 路径 | 内容 |
|---|---|
| `state.json` | cell 记录：阶段、队长 session、深度、父 cell、team id（**执行**看板——两者不同时，暂存 team 保留在 `planningTeamId`）、规划器/切分器 handle、被 stage 的切分票看板 id（`splitTaskId`）、成员及其模式（含可选的 `fenced`/`fencedReason`、`adopted: true` 与 `grown: true` 标记）、切分修订号、检查点、journal 游标，以及两个可选的「在飞激活」字段：`activationInFlight`（正在物化的被接受修订号）与 `activatedLoops`（切分键 → 验证循环 id） |
| `journal.jsonl` | 只追加的迁移：阶段、派发、检查点、压缩、晋升、拒绝，以及取代行（`split-superseded`、`activation-in-flight-superseded`）；一趟激活每个产物写一条紧凑的 `cell-activation-progress` 行、失败时只写一条完整的 `cell-activation-partial` 行，修复行是 `task-reassigned`、`dispatch-reassign`、`checkpoint-unrecoverable`、`member-adopted`、`member-unfenced`、`member-rebound`（`rebind` 修复；带 `previousSessionId`/`previousSessionIdLiveness`、`namedBy`（证据来源：`team`/`cell`/`journal:<event>`），记录压过更早 journal 行时带 F1 来源标记 `handleRecordCurrent`/`journalHandoverOlder`，看板那一半带 `tasksRebound`/`tasksNeedingRelease`，被保留子代理的孤儿行作证时带 `handleOrphanAdopted`，重指覆盖了另一个 handle 时还带 `displacedExecutorRef`/`displacedUnproven`）、`member-rebind-failed`（被拒绝的 `rebind` 条目或参数：`reason`、请求的 `handle`、`namedBy`、`previousSessionId`/`previousSessionIdLiveness`，被后续交接取代时带 `supersededBy`；文案绝不替操作员选择方向）、`seat-rebound`（三面绑定；若绑定覆盖了另一个 handle，它带 `displacedExecutorRef`/`displacedUnproven`）、`barrier-skipped`（`reseed-already-bound` 重入守卫）、`barrier-record-unreadable` 与 `barrier-failed`（过去只会 `warn` 的两条分支），以及 `dispatch-unfence-withheld`（`{rebind, unfence}` 合并调用里 `rebind` 没有完全落地：`reason` = `rebind-failed` or `cell-mirror-unconfirmed`、`members`、`failed:[{member, reason, cellRow?}]`、写明 `fence stayed closed` 的 `detail`，以及重跑用的 `next`） |
| `mail.jsonl`（旧格式） | 统一**之前**的按 cell 邮件日志，仍会被**读取**并合并进视图；新邮件**不再**写在这里：它们住在 workspace 存储 `<workspace>/.mpd/team/mailbox.jsonl`，盖上本 cell 的 `teamId` 与 `cellId`（跨 cell 发送者还会盖上 `fromCell`），由 `cellwork_inbox` 读取，并在那里随后跟一条单独的 `wake` 记录说明唤醒尝试的结果；对**这些**旧格式行的确认会追加回本文件，而统一之后的行则在存储里确认 |
| `requirements.md` | 经校验的需求文档，带修订号；一次变更会提升修订号并把切分标记为过期 |
| `split/<rev>.json` | 切分器的提案，加上插件的实测估算与接受/拒绝裁定 |
| `split/<rev>.refused.json` | 该修订号下一次**被拒绝**提交的完整 finding 列表；写在被接受记录旁边，绝不覆盖它 |
| `contracts/<taskKey>.md` | 交给验证者的冻结验收合约 |
| `handoff/<member>-<n>.md` | 结构化交接文档，每个检查点一份 |

cell id 形如 `cell-<UTC 时刻>`；子 cell 会记录 `parentCellId` 与 `depth`。根目录每次调用都经
`dsh.workspaceRoot(exec)` 解析（绝不使用 `process.cwd()`，也绝不缓存成常量）写入先落到同目录下的临时文件
再 rename，因此读者要么看到旧记录、要么看到新记录，永远看不到写了一半的文件。

记录是**带版本**的。损坏、无法解析或版本高于本构建的状态一律是**点名绝对路径的拒绝**：绝不静默重置，
也绝不覆盖。停止即归档：目录保留、记录标记 `stopped`，之后再次 `/cellwork` 会得到一个全新的 cell id。

## 这个 cell 正在用哪块看板

`state.json` 的 `teamId` 只是一条**快路径**，从不是单独的真相。激活可能把执行看板落到记录从未学到的 team 上
——规划 team 可以先变成 clean-terminal、执行 team 随后才铸出，而这正是本 bundle 的**常态**路径——因此每个
读者都经**同一条**规则解析看板（cellwork 状态模块导出的 `resolveCellTeam`）：

1. 记录的 `teamId`，仅当它的记录携带本 cell `activatedTasks` 里的某个看板 id（或该 cell 还没有已激活 id）时
   才被接受；
2. 否则为**团队平面**就本 cell 的队长 session 给出的解析结果——正是 `cellwork_dispatch` 走的同一条路径；
3. 否则为「看板携带本 cell 已激活任务 id」的那个活跃 team；
4. 否则回退到 `planningTeamId`，即保留的暂存 id（旧 cell 的回退）。

**第五种状态是「未验证」回落，且只有重切分才会走。** 四步解析什么都没找到、而记录的 `teamId` 非空时，重切分
（`activatedTasks` 已带看板 id 的 cell）仍继续使用**记录里的** id——旧 cell 可能指向一个任何接缝都读不到的看板，
拒绝它会搁浅本来可续做的工作——但这个 id 是**被信任**而非被验证的：答复携带 `boardNote` 说明这一点，同一事实
写入 journal（`boardResolution: "unverified"`），note 会打印记录 id，并在解析器看到另一个候选时连那个 id 一起
打印——两个 id 都可见。note 是**提示性的**，不是拒绝：它说明工作只会追加到那条记录上，绝不叫操作者去跑
`cellwork_start`（team id 确实已记录），看到它的操作者也不应新开 cell。**首次**激活绝不走这条路径（它没有已铸出
的 id 可供核对记录），而记录 id 为空的重切分仍以 `cellwork_start` 的指引拒绝。

`cellwork_status`、`cellwork_supervise`、`cellwork_context`、`cellwork_stop` 的活任务守卫、座位解析、本 cell
的需求重切分路径以及激活自己的写入，读的都是**这条解析**，绝不是裸字段。激活还会把执行看板 id **持久化**为
`teamId`，并把暂存 id 保留为 `planningTeamId`，因此**新** cell 的记录在磁盘上就是对的；**旧** cell（包括现场
的 VEdit cell）会被正确显示，**无需迁移、无需重写状态**——解析胜出，过期字段只是快路径。

**分歧会被报告，绝不静默。** 记录的 id 与胜出的解析指向不同 team 时，界面会同时打印**两个** id 以及哪条解析
胜出（若记录的 id 被否决，还会说明其看板不携带本 cell 的任何已激活任务）。`cellwork_stop` 的活任务守卫
针对**解析出的** team 运行，所以那块看板还有活任务时，非强制 stop 会被**拒绝**；而 stop **不会**自己结束
team——**成功** stop 的答复才携带 `teamId`（它留下继续运行的执行 team）与 `endTeamCommand`（精确的重试动词
`agent_teams_control {action:"end", team_id:"<id>"}`），渲染会把两者都打印出来。**被拒绝**的 stop 只回
它那句 error，这是有意为之：任务还在跑时建议“结束该队”会与守卫自身的理由相反。操作者停止 cell 后若想让
agent 退出，必须调用该动词。

## 配置

每个数字都是 `cellwork.<key>` 旋钮。**优先级为项目文件 > 行配置 > 随包发布的默认值**：
`<workspace>/.mpd/mpd.jsonc` 优先于 bundle patch 的 `config:` 块，后者优先于文档默认值。不是有限数字或超出
取值规则的声明会被替换为默认值，并在该行的日志里报告（`<workspace>/.mpd/logs/mpd-cellwork.log`）。

`depthMax` 3 · `checkpointRatio` 0.5 · `windowFraction` 0.25 · `fixedOverheadTokens` 32000 ·
`fixedOverheadByRoute` {} · `toolSchemaChars` 0 · `outputReserveTokens` 8192 ·
`compactionHeadroomTokens` 65536 · `compactionRetries` 3 · `idleBarrierDelayMs` 200 ·
`checkpointPendingMaxMs` 900000 ·
`asciiCharsPerToken` 3 · `cjkCharsPerToken` 1 · `contractGates` [] · `windowOverride` null。

六个**座位与并发**旋钮（弹性规划波次）是：

| 键 | 默认 | 边界 | 含义 |
|---|---|---|---|
| `cellwork.seats.maxPerRole` | `8` | `1..32` | 共用一个 base role（`Senior Engineer`、`Senior Engineer-2`、…）的座位数；`1` 关闭增长 |
| `cellwork.seats.max` | `32` | `1..64` | 一个 cell 的**执行**座位总数（不含规划座位） |
| `cellwork.consultMax` | `32` | `1..256` | 本平面交给**唯一**共享咨询监督器的每次启动预算；显式声明的 `MPD_DSH_CONSULT_MAX` 仍然优先 |
| `cellwork.planning.analysts` | `2` | `0..8` | 额外的规划泳道（`cell-analyst-1 … K`）；`0` 保留两座规划阶段 |
| `cellwork.delegate.maxTasks` | `32` | `1..64` | `cellwork_delegate` 的单次调用上限 |
| `cellwork.recon.maxQuestions` | `16` | `1..64` | `cellwork_recon` 批量形态的单次调用上限 |

`seats.maxPerRole` 与 `seats.max` 是**嵌套**键：在 `mpd.jsonc` 里写成 `cellwork.seats.maxPerRole` /
`cellwork.seats.max`，而行配置既接受嵌套对象、也接受扁平点号键。越界或畸形的值会回退到默认值，并在该行日志里
用**一条**行点名真正的点号路径——绝不因此拒绝一个 cell。

邮件上限是这张表**唯一**的例外：`mail.maxUndelivered`（默认 8，`0` 表示关闭；缺失或不可用的值回退到 8）
放在 `mail.` 前缀下，因为**两个**邮件工具都读它（见「感知 cell 的邮件」）。

模型自身的上下文窗口**不是**旋钮：切分时从模型目录读取，运行时从观测到的 token 计量读取，并记录来源。
`windowOverride` 只用于让「窗口读不到的 route」被显式认证，并且会记录为 override。

## 声明边界

- **守卫是进程级、且只在派发时刻生效。** 它看不见意图，无法阻止模型去「尝试」某个被禁的名字，也覆盖不到
  绕过工具直接调用 service 的代码行。读不出来的 cell 记录会放行所有调用者：守卫无法执行一个它看不见的
  模式：此时拒绝会带着记录路径出现在命令与 `cellwork_status` 上。
- **采纳与解围修复的是记录，不是过去。** 采纳只覆盖 TEAM 记录已经认识的成员；team 记录里没有的 session，
  按设计仍然没有通道。**不带 force** 的 `unfence` 清除 cell 行上的**放弃**围栏，并在组合暴露
  `mpdTeamActions.unfence` 接缝时清除 TEAM 行——绝不碰待处理的检查点（那归屏障所有）。有界的**强制**杠杆
  （`{member, force: true}`）是例外，也就是上面记录的那一个：它只在写下过的许可下重开归屏障所有的窗口或
  死重种座位（重试预算、待处理时限，或被证明已死的 session），并且绝不重开活跃座位。两种形式都不重建已死的
  session，而旧构建已经写下的 cell 行只能经采纳与解围修复：历史不会被改写。
- **1/4 预算是估算**，带声明的英文 ±25% 误差界，且对 CJK 刻意从严；它不是对模型分词器的测量，因为部署里
  根本没有分词器。
- **挂载由 overlay 证明。** 在这台机器上，普通的 link-profile 启动仍会解析到一个陈旧的 `@mpd-dsh/mpd` 包，
  所以挂载证明用 `--patch` overlay 以绝对模块路径提供这一行，并在真实隔离启动下证明该行**能被应用**。
  bundle 接线（即随包 patch 层是这一行的来源）由 `verify:rows` 与 `verify:manifest` 证明，而不是由那次
  启动证明。
- **打包闭合已由 Wave-5 重打包关闭。** `verify-pack-closure --require-packed` 报告 622/622 个内容文件
  字节一致、0 漂移（打包戳 2026-10-26T12:23:55Z），打包产物已包含新包。
- **并发子会话由 harness 设上限。** `maxActiveSubagents`（subagent 插件的设置字段，默认 8，无上限）
  限制同时驻留的成员会话数，超过上限的 cell 无法一次全部拉起。用 cellwork 时建议在
  **Settings → Subagent limits** 调到 **32–64**（它会写进当前 profile 的 Cordis patch）；随包无法替你
  设置（随包 patch 行绝不能 id-target 宿主行）而 agent 沙箱对 `~/.dsh` 只读，所以这是一次性的用户操作。
  来自宿主的槽位拒绝**不是**失败：咨询会释放 MPD 槽位、在**槽位之外**等待有界退避（250 ms → 4 s）、回到
  FIFO 的**队首**，最多重试 8 次，耗尽后以一句点名该设置的话落定——但队列只能继续**询问**，它从不预留槽位。
- **宿主当前的空闲槽位数量无法观测，且队列没有长度上限。** 监督器可以在**我们的**预算上完全正确，却仍然
  猜错宿主剩余容量，这正是「用退避重试」而不是「预留」的原因。`cellwork.consultMax` 只管**活跃**子会话；
  等待队列没有长度上限。
- **`cellwork.seats.max`（32）高于宿主默认的 8。** 增长到该上限的 cell 会一直重试，直到操作者调高
  `maxActiveSubagents`（一次性操作：Settings → Subagent limits，32–64）。这是设计，写在这里而不是藏起来。
- **分析泳道没有自动超时。** 弃用的泳道由队长关闭；一个从不把发现邮件回来的泳道，插件不会重试。
- **只保留一个切分修订。** 多泳道切分不在范围内：重切分是由需求 `update` 喂出一个**新的**被接受修订，
  绝不是两张同时活跃的切分图。
- **不宣称做过真·LLM 端到端 cell 运行。** 单元测试用假上下文证明命令面、各模式下守卫的判定、状态存储、
  估算算术与协议逻辑；Wave-3 的 QA 用例证明命令已注册、其处理函数确实提交了指令，并复现挂载。两者都不是
  模型驱动的运行。
- **邮件唤醒是尽力而为。** 投递是持久的：成员 → 队长的行会留在 journal 里，直到队长轮询 `cellwork_inbox`。
  只有持有可执行 handle 的收件人才能被唤醒。
- **邮件日志格式是单向兼容的。** 正如邮件一节所述：`send` 行如今带 `wakeSent: false`，结果是一条在其后的
  `wake` 记录。本构建能正确折叠更旧的日志；来自**旧构建**的读者会把新行读成"未唤醒"。
- **一次改派会让目标在这趟变成 BUSY。** `cellwork_dispatch {reassign}` 之后，目标成员**拥有**一个在飞
  任务，所以同一趟会把它**其它**就绪行报告为 BUSY（已写明的「每个成员每趟一个任务」规则），而不是排队。
  这是规则、不是回归；等第一个任务完成后再跑一趟。
- **侦察按拼写拒绝，不按解析结果。** captain 与 planner 守卫判定的是工具调用携带的那个字符串：符号链接
  绝不解析，通过 `bash`（`cat`、`rg`）绕到源码路径也不被拦截。`..` 跳转**只**在 basename 是
  `AGENT.md`、`AGENTS.md` 或 `CLAUDE.md` 时放行（读兄弟项目的指令文件正是它存在的理由）；其它任何 `..`
  仍被拒绝。
- **通用 team 动词默认是仅声明 owner 的；只有它显式的名册模式才会替换。** `agent_teams_dispatch` 会把
  就绪任务配给**声明的** owner，按位置的回退需要显式 `mode:"roster"`——正是**那个**模式把一条 REVIEW 任务
  交给了写过被审泳道的成员（配对立即释放，没有记录任何裁决）。cell 派发是仅声明 owner、绝不替换的：在 cell
  模式之外，等声明的 owner，或先释放再刻意改派。写者自审不是理论风险。
- **重种是尽力而为。** 原生后端不暴露**已落地**激活的 dispose，因此旧子代理只做尽力中断；新子代理的激活只在
  无法交付时才**尝试**通过 `dispose()` 接缝释放（没有 child id、某个面拒绝绑定、或 spawn 之后抛出）——这是**尝试**，
  不是保证：接缝不存在或抛错时，答复如实写「未能释放」。这里保证的东西更窄、也更可检查：
  座位没绑好时我们这边绝不声称 `reseeded`，而死掉的座位既看得见、也清得掉。
- **检查点需要观测到的窗口。** 没有观测就没有检查点：比例绝不会施加在猜测的窗口上。
- **取消记在 cell 记录上，而不是团队平面。** 团队平面没有取消动词：被后续切分修订去掉的任务会在 cell 记录里
  标记为 `cancelled`（`state.json: cancelledTasks`，key → 看板 id），它的看板行仍然**可见**。派发之所以跳过
  它，只是因为 cellwork 自己的派发会读取 cell 记录：单看看板仍然能看到这一行。
- **深度围栏默认三层。** 被晋升的副队长可以拉起子 team，`cellwork_subteam` 在超过 `depthMax` 时拒绝；
  登记子 cell **不启动任何 agent**。插件真正启动的每一个 agent 都拿到一个显式的 `maxDepth`，等于
  **它自己父 session 记录的深度 + 1** —— 即 `spawnMaxDepthOf` 规则：咨询时施加于调用者，压缩重种时施加于
  **活跃**父级 —— 绝不是 cell 树那个旋钮，因此两套刻度不会再被混为一谈。嵌套能力与这条推导在能力尖刺
（`evidence/cellwork/capability-spike/`）中作为源码阅读记录在案。
- **`parent_team_id` 是隐式推导，不是旋钮。** 子 team 的父级由团队平面在批准时从父 team 的名册推导
（`deriveParentTeam`）；`cellwork_subteam` 把推导出来的父 team id 记在 cell 记录上，全程不传任何父级 id，因此
  没有调用方可以搞错的参数：也没有办法把子 team 指向一个不把该 session 记作成成员的 team。
- **web 嵌套帧带着三条已声明的边界交付。** (1) 单帧**内部**的循环依赖在 web 画布上不路由：见证记入
  `nestedBackEdges`，平铺路径会把它画在左侧；(2) 嵌套列按秩打包、顶部对齐，不做重心松弛（平铺路径保留
  自己的松弛）；(3) 悬停晕覆盖**根帧**的卡片，内部卡片保留自己的色调。`nestedBackEdges` 的见证列表已接线
  并写入文档，但暂无一条臂真正填充见证：边界是**已声明**的，补一条"循环内部"的臂即可钉死。
- **验证循环的生产者是队长本人活着的 session。** 循环如实记录这个 session；cell id 只作为**数据**留在冻结
  合约上（`producer: cellwork:<cellId>` 一行），绝不伪造 session。`mpd_verify_open` 这个**精确名字**是队长
  白名单上**唯一**的 `mpd_verify_*` 条目：绑座位、记录裁决、取证与 escape 一律仍被拒绝，因此队长打开的
  `writer:"self"` 循环是惰性的（`mpd_verify_seat` 会拒绝该循环自己的写作者）。没有活着的调用方 agent 时，
  激活在写入任何内容之前就拒绝。循环还**点名自己的写作者**：激活把拥有该任务的成员的 session id 作为
  `writer_id` 传入，并把人类可读的名字记为循环 `writer.reason` 里的 `member: <name>`，于是
  `mpd_verify_record` 的 same-agent 拒绝比较的是两个真实的 agent 身份键，而不是 `delegate:pending` 占位符。
  这个比较是**字符串**比较，它让规则有意义，但从不保证不可伪造。
- **续做不是事务，而崩溃也不等于失败的激活。** 一次**返回的失败**会在重试动手之前把完整部分状态写一次，因此
  这条路径的残余窗口是一次看板/验证调用加一次 cell 记录写入。**进程在激活中途死亡**则完全没有部分状态：只有
  那些紧凑的 `cell-activation-progress` 行：死亡那一趟创建的每个看板任务与验证循环对重试都不可见，可能被第二次
  创建。重复可检出、不可删除（团队平面没有取消动词）；成员是例外，因为它们按名字与活跃名册对账。
- **「盲」始终是书面约定**，与本仓库其它地方一致：cellwork 接好合约、循环与裁决，但不假装能观测到验证者
  读过什么。
- **被委派的写作角色在 cell 看板之外工作。** `cellwork_delegate` 不给它冻结合约、不给验证循环、不给看板行：
  它的报告在 `cellwork_consult` 里到达，也没有任何东西把它记成裁决。看板规模的工作仍然属于
  `cellwork_split` + `cellwork_activate`；后台委派是给有边界的副业用的——调研、探针、单文件探查。
- **咨询账本在内存里。** cellwork 用一个进程内映射记住某个 cell 发起过哪些 id（不是第二个存储，不含报告、不含
  上限），与监督器的记录一样是进程内的：重启会同时丢掉两者，之后 `cellwork_consult` 给出说明这一点的拒绝，
  而不是一个过期的 id。座位仍可直接调用 `mpd_role_spawn_async` / `mpd_role_consult`；它那样收走的咨询只是离开
  本 cell 的清单（下一次 `list` 会顺手剪掉）。
- **智能体委派深度与 CELL 树深度是两套不同的刻度。** `cellwork.depthMax`（1..8，默认 3）只约束嵌套的 cell
  与 team——只有 `cellwork_subteam` 执行它——并且**绝不**传给咨询。三个咨询动词经 `mpdConsults` 服务启动，
  子会话的智能体深度交给名册自己的 `spawnMaxDepthOf(exec.agent)` 规则（调用者深度 + 1，一个**叶子**），
  该路径刻意**不**施加名册工具侧的深度下限（处于委派深度 2 或更深的调用者会被**工具**拒绝）。这条豁免今天
  只有**一个**消费者：cellwork，其平面由 `cellwork.depthMax` 约束；第二个消费者必须先论证这次绕过。

## 测试与证据

- `bun test packages/mpd-cellwork-plugin`：离线、无 harness、无网络；每条用例都走宿主实际使用的 adapter
  入口（`apply`、捕获到的命令定义、捕获到的工具定义，以及那**唯一一个**守卫谓词），并在全新的临时 workspace
  里运行。测试套件还覆盖激活续做：分别在第二个成员、第二个任务、第二个循环之后以及派发时注入失败，再重试并
  确认复用了已记录的产物。
- 本波次的缺陷臂各自成文件：`activate-resume-e2e`（五个阶段**各自**失败一次，随后收敛且无重复）、
  `split-refused`、`requirements-subheadings`、`dispatch-fenced`、`dispatch-reassign`、`mail-order`、
  `planner-guard`、`band-parity`、`split-task-owner` 与 `status-reconcile`；验证侧新增 `gates-project` 与
  `open-writer-id`，名册侧新增 `captain-instruction-files` 与 `role-spawn-maxdepth`。
- 挂载证明、能力尖刺与各波次的裁定都在 `evidence/cellwork/` 下：每个目录带自己的 `result.json` 以及
  该条线自己的产物：只读尖刺是一份报告，一次运行则是一批日志。
- `bun run verify:docs`、`bun run verify:rows`、`bun run verify:manifest` 与
  `node scripts/verify-dist-fresh.ts` 是任何 cellwork 变更都必须保持绿色的关卡。

精确的工具参数、拒绝文案与逐条用例清单，以本包的 README 对为准；模式的设计与每一波交付了什么，见仓库
`.mpd/plans/` 下的计划与契约。

## 程序化入口：`cellwork_open`

`cellwork_open {objective, mandate?}` 无需命令即可开启一个 cell。它拒绝**三种**情况：不是 captain 的调用者、
已存在的活动 cell，以及 `mandate` 指向的 `<workspace>/.mpd/autoproject/<runId>/escalation.json` 不在磁盘上。
`/cellwork` 是**同一条**开启路径上的薄处理器，因此命令与工具在行为上不可能分叉。

工具路径无法提交用户轮次（工具没有 `invocation.submit`） 所以它返回激活指令、由调用者自行提交；而命令
会自己提交。这条边界是刻意的，并被明确写出而不是隐藏。

## 它交给团队平面的部分

cell **模式**的引擎（requirements、split、activate、recon、budget）留在本包：它们是**写**看板的工作流层。
**团队级**逻辑属于团队平面，以服务方式访问：没有跨包 import：

| cellwork 接口 | 现在读取 / 写入 |
|---|---|
| `cellwork_dispatch` | 团队记录的派发过程；`reassign` 走团队平面自己的 claim / 记账 / 投递路径 |
| `cellwork_context` | `mpdTeams.memberContext`：与团队工具相同的计量与 provenance，adapter 读取只作为有据可查的降级 |
| `cellwork_subteam` | `mpdTeams.depthBudget`：父链深度与**同一个** `cellwork.depthMax` 上界；服务缺席时回退到 cell 记录 |
| handoff / checkpoint | 团队平面的交接记账与 journal |

值得记住的后果：看板、fence 状态、占用率读数与深度预算都只有**一个**所有者（团队平面）。若 cellwork 保留一份
与之不一致的副本，那就是第二套策略，而这里没有第二套。

## 监督与强制监督器（2026-11-05）

cell 席位**就是**团队成员，因此团队 watchdog 的强制监督器会通过团队记录看到它：先向该席位发一条
**宽限**指令，要求它写出自己的交接文档并结束回合（成员自己写的七段式交接文档会被**采用**）；只有宽限
**过期**才会中断一次，随后重新排队并拆分；`mpd-team-core` **绝不**写 CELL 记录 —— 席位事后通过
`cellwork_dispatch`（`reassign`）或 `cellwork_split` 修复自身。单次 consult 由**静默** consult
deadman 监督：上界按 `consult.forceAfterMs` → `watchdog.forceAfterMs` → 900000 ms 解析（显式 `0`
关闭规则），且未满 `watchdog.toolInFlightMaxMs` 的在途工具、以及任意时长的未关闭 `bash` 调用都算作
活动。verifier 席位被拒绝两个 consult 工具（`mpd_role_spawn_async`、`mpd_role_consult`），因此既
不能委派，也不能取消另一个 consult。re-team 的 volume 计数器会计入 cellwork 自己的 staging 调用，
因为它们以同一 session 执行。
