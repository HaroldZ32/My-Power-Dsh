# Cell-work 模式（`/cellwork`）

**中文** | [English](./cellwork.md)

Cell-work 是**由命令触发的「队长只做调度」模式**。一个会话会变成一个小型交付组织：规划器与你把需求谈定，
切分器把工作切成任务、并按执行模型自己的上下文窗口逐条计价，工作者在冻结的验收合约下执行，而验证者永远
不是写作者、只读那份合约——队长则只负责调度、转达、记录与停止。

bundle 里除了 `/cellwork` 命令之外没有任何入口能启动这个模式：没有工具、没有事件手势、没有 preset 开关。
其它所有面（工具、监听器、行）在命令运行、cell 存在之前都是惰性的。

每个工具的确切行为、守卫表与配置旋钮，以
[`mpd-cellwork-plugin` README](../packages/mpd-cellwork-plugin/README.zh-CN.md) 为准。本页是面向使用者的
说明：怎么驱动这个模式、它度量了什么、以及它**不**承诺什么。

## 唯一触发方式

- `/cellwork <objective>` 通过 adapter 注册为 `cellwork`——没有别名、没有第二种拼写，也不会被别的命令名
  替代。
- 处理函数只写入**一份** cell 记录——`<workspace>/.mpd/cellwork/cell-<UTC 时刻>/state.json`，phase 为
  `requirements`，带队长本人的 session id——随后把**恰好一条**激活指令作为发起该命令的 agent 自己的下一条
  用户消息提交（producer tag `mpd-cellwork`）。这条指令启动需求阶段；命令本身不驱动各阶段。
- 参数为空或只有空白时返回用法错误，并且**完全不写**任何 cell 状态。
- 同一 workspace 已有活跃 cell 时，第二个 `/cellwork` 会被**拒绝**，拒绝信息点名那个活跃 cell 的 id：
  一次只能有一个 cell，两个 cell 会争抢同一块 team 看板。要开新的，先用 `cellwork_stop` 停掉当前的。
- 组合环境没有可用的投递面时不会留下「半启动」的 cell：命令刚写入的记录会立即归档，并带上
  `stopReason: "no-live-turn-surface"`，也不会有任何 session 被围栏。

## 四个阶段

1. **requirements（需求）**——`cellwork_start` 打开当前活跃 cell 的需求阶段（它绝不创建 cell）。规划器
   运行苏格拉底式流程：它把结构化问题信封邮件发给队长，队长在主页面调用 `ask_user_question` 并把答案邮件
   回传，规划器如此往复直到满意；随后写出 `requirements.md` 并调用
   `cellwork_requirements {action:"finalize"}`。**只有**规划器塑造需求；队长只做转达，从不撰写，也不代用户
   作答。计划阶段的侦察同样是委派的：规划器对源码路径的 `read`/`grep`/`glob` 会被拒绝（可读带见下一节），
   它通过 `cellwork_recon` 或 `mpd_role_spawn` 工作。一个章节的正文一直延伸到**同级或更高级**的下一个标题，
   因此 `###` 子标题及其内容属于父章节、不会截断它；正文只有空白的章节仍按"缺失或为空"拒绝。
2. **split（切分）**——切分器通过 `cellwork_split {action:"submit"}` 提交任务图。插件校验它（每个任务都
   声明依赖答案、图无环、写作用域有序、计划中的验证者与写作者不同），并针对模型预算逐任务计价；只有被接受
   的图才能作为 `cellwork_activate` 的输入。拒绝时会返回逐任务明细，告诉切分器还需要砍多少，并把完整
   finding 列表持久化到 `split/<修订>.refused.json`（在被接受记录旁边、绝不覆盖它），同时把 findings 记在
   `split-refused` journal 行上——因此每一次拒绝在磁盘上都有产物。
   每个任务还可以声明 `member`，即它要拉起的看板成员；省略时成员名**就是** `ownerRole`。多个任务可以共用
   一个成员，多个成员也可以共用一个 owner role——这正是同一个 role 获得真正并行座位的方式，因为激活对每个
   不同的 `member` **只拉起一个**成员。不可用的名字按 `member-invalid` 拒绝（为空、超过 64 字符、或含控制
   字符/路径分隔符）；同一成员被两个**不同** owner role 声明会按 `member-role-conflict` 拒绝；`self-review`
   规则在双方都声明成员时比较**解析后的**成员名（否则退回比较 owner role）。
3. **executing（执行）**——`cellwork_activate` 把切分结果里的成员与任务加进**活跃** team 记录，为每个代码
   任务写一份冻结合约，并在派发**之前**为每个代码任务打开一条验证循环，然后派发。成员的人格文本会注入成
   员提示词——team 本身不提供名册人格。队长在每次唤醒时巡检。中途失败不会把 cell 卡死：已创建的产物会被检查点
   记录，阶段保持原样——从 `split` 发起的激活仍是 `split`，对已在执行的 cell 做局部重切分则仍是 `executing`
   ——用**同一个**被接受的修订号即可续做（见下）。
4. **re-split（重切分）**——`cellwork_requirements {action:"update"}` 提升需求修订号并把切分标记为过期。规划器
   重新谈定变化的部分，切分器重新提交一个修订，`cellwork_activate` 只把新增或有变化的工作**追加**到同一个
   team：team id 与 cell id 都不变，新修订中被去掉的工作标记为 `cancelled`（绝不删除），切分任务会被重新
   派发而不是被复制。用过期切分激活会被**拒绝**，除非调用者显式指定修订号。

### 激活中途失败可以续做

激活是一串变更，而不是一次事务：合约、成员、看板任务、验证循环，最后是派发。每个产物一创建就立即检查点——
在飞修订号（`activationInFlight`）、已拉起的成员、已铸出的看板 id 与已打开的循环 id——阶段保持原样：从
`split` 发起的激活仍为 `split`，而对已在执行的 cell 的局部重切分会保持 `executing`——阶段绝不回退。因此
中途失败的一轮是**可续做**的，而不是一次卡死。每份冻结合约同时点名 owner role 与解析后的看板成员
（`Owner: **<role>** (member `<name>`)`），并且激活对每个不同的 `member` 只拉起一个成员——同一个 role 的
十二个任务不再排在单个 session 后面。

一趟激活的 journal 是**紧凑**的，并且共用这一趟自己的时刻。每个产物创建时只加**一条**
`cell-activation-progress` 行（stage、key、ordinal、total）；完整快照只在这一趟失败时**持久化一次**——即
`cell-activation-partial` 行——而且同一趟的每一行都带同一个不递减的时间戳，因此 journal 是单调的。VEdit 的
journal 说明了旧形状的代价：119 份完整快照、约占 490 KB journal 的 40%，而最后一行的戳比它上面的行还早。

用**同一个**被接受的修订号重试，会从这份记录续做：成员按名字与活跃 team 名册对账（名册上已有的名字直接复用，
不再重复拉起）、每个切分键复用已记录的看板 id、并为**每个**还没有循环的代码任务补开验证循环——不只是这次重试
新创建的任务。早于这条规则激活的 cell 里，保留下来的任务在 `activatedLoops` 中没有条目，因此一份已经写明循环 id
的冻结合约会被视为已武装：该任务跳过，合约**不会**被重写（只有真正没有循环、或合约仍带着开环前占位句的任务才会
新开一条）。只有在派发成功之后才写入 `activatedRevision`，所以再次失败仍会留下新的可续做记录。

**更新的**被接受修订号会**取代**更旧的在飞部分激活：这一趟会记入 journal（`activation-in-flight-superseded`，
点名两个修订号并说明更旧的部分产物被放弃），而新切分的物化会核对已记录的行——保留下来的键复用其看板 id，被去掉
的工作按重切分规则标记 `cancelled`——因此旧产物既不会重复，也不会丢失。只有**低于**在飞修订号的被接受修订号会被
拒绝（更低的修订号无法取代），使用既有教学式错误；激活已物化的修订号与激活过期切分同样被拒绝。

### 重切分的细节

一个修订不是把 team 重写一遍，而是在活跃记录上打一个增量：

- **同修订号的激活会被拒绝。** 激活 cell 已记录的修订号是一次空操作请求，会被直接拒绝；每次提交的修订号
  都必须**大于**已记录的修订号——修订只能向前。
- **保留下来的行会被复用，合约不会被重写。** 跨修订存活的任务保留它在看板上的行，以及验证循环打开时冻结的
  合约——验证者仍然按工作开始前冻结的验收标准裁决。
- **被去掉的行标记为 `cancelled`，绝不删除。** 它们作为历史留在 cell 记录里，派发会跳过它们。
- **切分器保留可被重新派发的活行。** 激活会关闭它消费掉的那个切分任务；需求再次变化时会开出一行**替代的**
  切分器行，因此切分工作是通过看板重新派发，而不是复制出第二个切分任务。
- **切分票按记录的 id 查找，丢失的所有者会被修复。** staging 把被 stage 的切分票的**看板 id** 记在 cell
  记录上（`splitTaskId`），之后每次查找都先试这个 id、再退回按 owner 匹配——因此一次需求变更既能找到切分
  票、把它标记为过期，又能重新派发**同一行**。切分票缺失或没有 owner 是一个硬错误，错误里点名修复方式；
  staging 自己会通过把该行 claim 给 `cell-splitter`
  （`agent_teams_task {action:"claim", claimant:"cell-splitter"}`）来修复丢失的 owner，而不是铸出一个重复票。

team id 与 cell id 都不变，因此 cell 的 journal、邮件与看板始终是一段连续的历史。

## 被围栏的成员与改派

成员可能进入一种「绝不能被唤醒」的状态：它记录里的 `mode` 是 `checkpoint`，或它写下的交接仍在等待压缩屏障，
或屏障在重试预算（`compactionRetries`）用完后放弃并把它标记为 `fenced: true` 加 `fencedReason`。**一个**谓词
读取这三个信号，被围栏的成员绝不会被发消息。

- **派发跳过被围栏的 owner，并让任务保持待派发。** 跳过原因点名成员、原因与修复方式；绝不替换成别的成员。
- **`cellwork_dispatch {reassign:[{task_id, owner}]}` 就是修复。** 对每一对，在派发**之前**先把该行在看板上
  claim 给那个成员、记 `task-reassigned`（from → to），然后把正常的派发消息投递给它。每个结果都会如实报告
  （`reassigned`，以及 `reassignInvalid` 里逐条无法读取的输入），绝不抛错。终态行绝不重开、未知成员绝不替换、
  被围栏的**目标**直接拒绝——请挑一个未被围栏的成员。
- **一次改派会改变同一趟派发的报告。** 目标成员现在**拥有**一个在飞任务，所以同一趟会把它的**其它**就绪行
  报告为 BUSY（每个成员每趟只派一个任务），而不是排队。这是既有的派发规则，不是回归：稍后再跑一趟。
- **第一份交接仍在等待屏障时，第二份会被拒绝。** `cellwork_handoff` 的答复是「结束本回合」：屏障只读最新的
  ordinal，因此第二份文档是在消耗连续性、而不是保住它（VEdit 的活锁在 7 分钟内写了三份）。
- **屏障放弃时会记录后果。** 该成员得到 `fenced: true` + `fencedReason`，journal 得到一条点名修复方式的
  `checkpoint-unrecoverable` 行，而 `cellwork_supervise` 会列出每个被围栏成员以及它仍然拥有的**未关闭**看板行。

**通用 team 动词带着一个 cell 模式已经消除的危险。** `agent_teams_dispatch` 会把就绪任务配给声明的 owner，但当
该 owner 忙时会**退回按名册顺序**配对。就在本波次里，它把一条 **REVIEW** 任务交给了**写过被审泳道**的成员；
队长立即释放了配对、把该行恢复给独立评审者，而那位写作者披露：在被叫停之前它只跑了 `git diff --stat`、一次
标记 grep 和一次目录列表——没有产生任何裁决，因此没有被污染的判断被采用。`cellwork_dispatch` 是**仅声明
owner**、绝不替换的；在 cell 模式之外，**等声明的 owner 空出来，或刻意改派**（先
`agent_teams_task {action:"release"}`，再重新配对），绝不要把「写者自审」当成只是理论风险。

## 工具面

| 工具 | 调用者 | 作用 |
|---|---|---|
| （`/cellwork` 命令） | 你 | 写入那一份 cell 记录，并提交那一条激活指令 |
| `cellwork_start` | 队长 | 打开活跃 cell 的需求阶段：校验 cell 与调用者、写入 `startedAt`、记入 journal |
| `cellwork_status` | 队长、成员 | 阶段、目标、队长、需求/切分修订号、成员及其模式、已注入的检查点、活跃 team 计数、已记录的切分票看板 id、cell 记录与活跃名册的成员差异（`missingFromCell` / `missingFromTeam` / `inSync`）、调用者自己的座位与磁盘路径 |
| `cellwork_requirements` | 规划器 | `finalize` 需求文档，或 `update` 它——update 会提升修订号并把切分标记为过期；章节正文延伸到同级或更高级的下一个标题，因此 `###` 子标题留在父章节内 |
| `cellwork_recon` | 规划器、副队长 | 一次性**只读**咨询（Explorer/Researcher）：走直接启动路径，以角色名作为标签，并给出显式的绝对深度上限，因此这次咨询是一个只读叶子；报告会返回并记入 journal |
| `cellwork_split` | 切分器 | `submit` 任务图让插件度量（每个任务可声明自己的看板 `member`），或 `show` 上一次的裁定；每次拒绝都把 findings 持久化到 `split/<修订>.refused.json` |
| `cellwork_activate` | 队长 | 把被接受的切分物化到活跃 team 记录、写合约（同时点名 owner role 与成员）、对每个不同的 `member` 只拉起一个成员、打开验证循环、派发；中途失败的一轮会被检查点记录，同一个修订号可以续做，而更新的被接受修订号会取代更旧的在飞部分激活；返回的 `reused` 列出从 cell 记录或活跃名册解析（而不是新拉起）的成员名 |
| `cellwork_dispatch` | 队长 | 在 team 看板上做一次「仅声明所有者」的派发；owner 忙、缺席或被围栏时如实报告、任务保持待派发；`reassign` 先把点名的行交给另一个成员（看板 claim → `task-reassigned` journal → 投递），这是被围栏 owner 的修复手段 |
| `cellwork_supervise` | 队长 | 只读巡检：待处理的检查点、压缩、晋升、过期切分、未读邮件、每一条**未投递**的邮件行，以及每个被围栏成员与其仍拥有的未关闭行；每个投影都是无损 JSON，没有 `undefined` 自有键 |
| `cellwork_context` | 成员 | 调用者自己的实时占用、度量所用的窗口，以及该窗口的来源 |
| `cellwork_handoff` | 成员 | 写入并校验检查点交接文档；把检查点标记为就绪；第一份仍在等待屏障时，**第二份**会被拒绝 |
| `cellwork_subteam` | 已晋升的副队长 | 登记子 cell、执行深度上限、返回副队长指令 |
| `cellwork_send` | 任意 cell 智能体 | 感知 cell 的寻址（成员、队长、另一个子 cell），并完成传输投递与 journal 记录——持久行先落盘，唤醒尝试作为单独的 `wake` 记录追加在其后 |
| `cellwork_inbox` | 任意 cell 智能体 | 读取并确认调用者的未读 cell 邮件 |
| `cellwork_stop` | 队长 | 结束模式：归档 cell（不删除）、清除守卫、交还工具；只要还有看板任务处于 `claimed`/`in_progress` 就**拒绝**，除非 `force:true`，且强制停止会如实记入 journal |

旁观者一眼看全局用 `cellwork_status`；其余工具要么修改 cell 记录，要么对它返回一份裁定。

## 守卫模式

每个插件只安装**一个** `tools.guard` 谓词。它解析调用者的 session，并在活跃 cell 树里查它：不属于任何 cell
的 session 完全不受影响——这正是模式关闭时零成本的原因。谓词只在**派发**时刻生效。

| 调用者 | 放行 | 拒绝 |
|---|---|---|
| 队长 | 除 `cellwork_handoff` 之外的 `cellwork_*`，加上 `agent_teams_*`、`ask_user_question`、`todo_write`、`mpd_memory_*`，以及**唯一**的循环开启器 `mpd_verify_open`（仅精确名字） | 其余全部——不改文件、不跑 shell、不 `read`/`grep`/`glob`，且除开循环之外不做任何验证：绑座位、记录裁决、取证与 escape 仍被拒绝 |
| 验证者 | `read`、`grep`、`glob`、`bash`（跑关卡）、`mpd_verify_*` | `write`、`edit`、`mpd_hashline_edit`、`mcp__ast_grep__rewrite`、`mcp__ast_grep__scan`、`mcp__lsp__rename_symbol`、`mcp__lsp__rename_symbol_strict` |
| 处于上下文检查点的成员 | `cellwork_handoff`、`cellwork_context`、`cellwork_status` | 其余全部——即使它无视书面说明，也无法继续干活 |
| 副队长 | 队长白名单**去掉** `cellwork_start` / `cellwork_stop`，**加上** `cellwork_subteam`、`cellwork_activate`、`cellwork_dispatch`、`cellwork_supervise` | 一切文件工作工具：副队长是迷你队长，只做调度，不做实现 |
| 规划器（`cell-planner`） | 文档带内的 `read`/`grep`/`glob`：`.mpd/**`、`docs/**`、`evidence/**`、`agent-references/**`；任何**按 basename** 命中的 `AGENT.md`/`AGENTS.md`/`CLAUDE.md`（任意深度，workspace 根之外也算）；以及 workspace 根上仅 `README.md`、`README.zh-CN.md`、`CHANGELOG.md`、`LICENSE*.md` | **源码**路径——拒绝信息点名两条委派路线（`cellwork_recon` 配 `Explorer`/`Researcher`，`mpd_role_spawn` 配只读名册角色），并说明理由。路径按**拼写**判定（绝不解析符号链接），`..` 段**只**允许出现在指令文件名的拼写里 |
| 普通成员 | 干活所需的一切 | 没有——它就是普通工作者 |

每次拒绝都是**一整段教学式说明**：点名被拒的调用、可替代的调用，以及作为出路的 `cellwork_stop`。cell 停止
后座位消失，同一个 session 立刻恢复不受限。

其中两行属于本仓库自己的侦察规则，而不是 cellwork 的发明。规划器的可读带**就是**顶层 `mpd` 队长保留的那条
带，而且有一条 parity 测试同时导入两份清单，因此二者不可能漂移。cell 之内，规划器的侦察是**委派**的：
`cellwork_recon` 会传绝对深度上限，`mpd_role_spawn` 会把调用者自己记录的委派深度 + 1 传下去，因此嵌套咨询是
**叶子**，而不是被一个它看不见的宿主深度默认值拒绝。cell 队长站在另一端——它的读取面只有通过这些工具访问
cell 记录——而在 cell 模式**之外**，`mpd` 队长的可读带如今在任意深度承认
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`（包括兄弟项目的），同时仍然拒绝一切源码路径。

## 上下文预算：实测算出，绝不猜

这个模式对上下文有两条不同的承诺，用的也是两个不同的分数：

- **切分时**——任何任务的估算都不得超过它将要运行的那个窗口的 **1/4**（`windowFraction`，默认 `0.25`）。
- **运行时**——活跃成员一旦达到其**观测**窗口的 **1/2**（`checkpointRatio`，默认 `0.5`），就在下一个步骤边界
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

因此模型窗口变大时，切分预算与检查点触发线都会自动抬高——不用改代码，也不用改配置。

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

「抓真实数据、在程序里算」这条规则就落在第二行：一个声明了 2 MB 文件的任务会被**带着数字**拒绝——
`file X = 2,097,152 bytes ≈ 699,051 tokens > budget 250,000`——而不是含糊带过；被接受的任务则是按真正
`stat` 过的文件计价的。

第二条接受条件为模型的最大输出与宿主的压缩预留（默认 65,536 token）留出空间，因此一个被接受的任务不会
仅因为输出就把宿主拖进任务中途的压缩。

### 这些数字的可信度

1/4 规则是一份**经认证的估算，不是测量**。它声明的误差界是**英文散文 ±25%**；CJK 刻意从严计价（约每个
UTF-8 字符 3 字节、按每字符 1 token），因此中文密集的任务只会被切得更小，绝不会被放大。每份切分裁定都
标注 `estimate`，读不到窗口的 route 则如实标注 `uncertified`。

## 检查点 → 交接 → 压缩 → 晋升

到达检查点比例的成员不是「试着写简洁点」；模式会收回它的工具，把工作交给继任者。整个序列是机械的：

1. **检测**——宿主平面那一行的 `agent/pre-step` 监听器解析调用中的 agent、读取上下文压力；对一个达到或超过
   `checkpointRatio` 的活跃 cell 成员，它记录 `checkpoint injected`，并返回一个 `enter` 决定，附带一条额外
   消息：`[mpd-cellwork] CONTEXT CHECKPOINT … stop work, call cellwork_handoff, end your turn`。
2. **停机**——同一个模式切换把该 session 置为 `checkpoint`，守卫随即拒绝除 `cellwork_handoff`、
   `cellwork_context`、`cellwork_status` 之外的全部工具。书面说明是解释，守卫才是执行。
3. **交接**——`cellwork_handoff` 校验必需章节（任务、状态、决策、产物、已验证事实、未决问题、下一步），写出
   `handoff/<member>-<n>.md`、记入 journal，并把检查点标记为 `handoff-ready`。指令要求该 agent 结束本回合，
   别的什么都不要做。
4. **压缩**——在 `agent/turn-stopping` 时，插件安排一道屏障：等该 agent 空闲下来（`compactionRetries` 次有界
   重试，间隔 `idleBarrierDelayMs`），然后带真实的 `AbortController` 信号调用它自己的压缩引擎。结果会被分类
   并记入 journal：`null`（没有安全可用的区间）、`busy`（agent 忙碌）与 `error` 全都会被记录，因此重试预算
   用完绝不是一次静默的空操作。
5. **晋升或重种**——压缩成功时，该 session 的模式变为 `subcaptain`，并收到晋升指令（深度 + 1、从交接文档
   继承剩余范围、子 team 协议）。若没有安全区间或压缩失败，则释放该激活，用交接文本作为提示词启动一个新的
   子代理，并同样种入晋升指令。
6. **子 team**——被晋升的 agent 用 `cellwork_subteam` 登记自己的子 cell，并领导自己的计划。当
   `depth + 1 > depthMax`（默认 3）时 `cellwork_subteam` 会拒绝，并返回确切的边界；直接启动路径把同一个深度
   作为绝对值 `maxDepth` 传下去，因此宿主上限与 cell 上限一致。子 team 运行完全相同的阶段与规则，
   `cellwork_supervise` 会巡检整棵 cell 树。

队长不是成员，在 v1 中永远不会被检查点。

## 嵌套 DAG：子单元画成分组盒子

被晋升的副队长会拉起子 team，而共享图把那个子单元画成一个**盒子**，盒子内部就是该子单元自己的 DAG。这条规则
住在模型里（`packages/mpd-graph-core`，它的 README 双语对完整陈述了它）；本节记录 cellwork 对它承诺了什么，以及
读者可以期待看到什么。

- **每个子单元一个盒子。** 盒子是**父帧**里的一个节点——它的 id 就是子 team 的 id，它的 `dependencies` 是附着到
  它边框上的阻断者——而盒子内部装着子 team 自己的任务，按它们自己的模型排序。
- **外部边附着到帧上。** 一端在盒子内、另一端在盒子外的依赖，会被重锚到盒子上（盒子即包含内侧端点的最内层帧）；
  因此一条线永远不会逃出盒子。完全落在内部的边保留它原来的两个任务，两个盒子之间的边变成 box→box，而盒子的派生
  边是由拉起该子单元的那个任务**推导**出来的，不是在哪儿手写的。
- **递归属于模型，而不是第二套概念。** 一个子单元还可以包含子单元：每一帧各自排序，嵌套一直重复到上面的深度围栏。
  id 必须在整棵树内唯一，因为 id 是两个渲染方共同依赖的连接键——团队平面对被复用的任务编号使用的写法是
  `<teamId>::<taskId>`。

**这条缝是隐式推导，并且没有一个可以被忘记的参数。** `cellwork_subteam` 把父 cell 的**实时** team id 写到新 cell
的 `CellState.parentTeamId` 上，并把 `subcell-created` 连同它写进 journal；子 team 本身在登记时**不传**
`parent_team_id`。团队平面在**批准时**从父 team 自己的名册推导这条链接（`deriveParentTeam`），因为登记子 team 的
那个 session 本身就是父 team 的成员——记录本来就知道。正因如此，嵌套不会漂移：没有第二个值需要保持同步。同一段
代码会拒绝一个不把该 session 记作 Lead 或成员的父亲，也会拒绝一条绕回自身的 `parentTeamId` 链，所以投影
（`mpdTeams.graph(workspace, teamId)`）可以顺着 `parentTeamId` 递归合并成嵌套分组而不担心成环。

**本波次两个表面都画这些盒子。** 面板在它的字符网格里画出它们——第二套单格字形家族、横跨内部各行的帧框、
到达边画端口而穿过的边画交叉、分组命中身份，以及"宁可折叠也不半画"的宽度守卫
（`packages/mpd-tui-plugin/README.md` 的 "Nested groups: subcells as boxes"）。web DAG 通过帧通道画同一
套模型：边与卡片之间的 `.mpd-dag-group` 层、每个分组一帧并发布矩形（`data-mpd-group`）、每个盒子内部在
**绝对画布坐标**上递归规划自己的 DAG（盒子尺寸 = 内部 + padding）、框→框或框→任务的边终止在帧的边框端口、
按帧的重叠审计取并集、内部卡片走 `data-mpd-cards` 层。构建后的 `client.js` 携带这条通道，平铺板仍走未改
动的平铺路径（由构造保证字节恒等）。三条 web 边界见"声明边界"。

## 感知 cell 的邮件

cell 内的智能体可以互相通信，不经过用户界面，也不经过队长：

- **team 内**邮件就是既有的 `agent_teams_mail`（成员 ↔ 成员，队长不在路径上）。
- **成员 ↔ 队长、跨 cell** 的邮件由 `cellwork_send` 负责。它在 cell 树里解析收件人——成员名、字面量
  `captain`，或跨 cell 形式 `"<cellId>/<captain|member>"`，其中 `<cellId>` 必须是**本** cell 登记过的子 cell
  或本 cell 的父 cell（`cell.subcellIds` / `cell.parentCellId`），其它一律以 `"not in this cell's tree"` 拒绝。
  一次发送会把该行追加到**目标 cell** 的 `mail.jsonl`——跨 cell 发送时就是**收件方 cell** 的文件，该 cell 的
  `cellwork_inbox` 从这里读取——而**发送方**的 journal 会以 `cell:<cellId>` 戳并带 `toCell:<target>` 记录这次
  发送。
- 邮件**先落盘（持久），唤醒尽力而为**。唤醒从未发出的行会保持**未投递**状态（`unreadMail` 加上
  `wakeFailures[]` 行，每行 `{id,to,subject,reason}`）；`cellwork_inbox` 读取并确认未读行，
  `cellwork_supervise` 会同时呈现未读计数与每一条未投递行——不只是待办看板。跨 cell 的行只做持久投递
  （跨 cell 不尝试唤醒），并出现在收件方 cell 的巡检里。成员 → 队长的行由队长的收件箱读取，因为队长不是
  mailbox 成员，Lead 的 handle 也无法被直接唤醒。
- **日志格式变了，而且是单向兼容。** `send` 行如今总是带 `wakeSent: false`，唤醒结果作为一条单独的
  `wake` 记录（`t:"wake"`、`sent`、`reason?`、`at`）追加在它**之后**，于是"先落盘、后唤醒"在日志里可以
  直接看到，而不是靠推断。本构建能正确折叠**更旧**的日志（`wake` 之前的行保留自己的 `wakeSent`），但来自
  **旧构建**的读者会把新行读成"未唤醒"。如实写明，不要藏起来。

## 磁盘状态

一切都在 workspace 之下、属于被 gitignore 的运行时状态：

`<workspace>/.mpd/cellwork/<cell-id>/`

| 路径 | 内容 |
|---|---|
| `state.json` | cell 记录：阶段、队长 session、深度、父 cell、team id、规划器/切分器 handle、被 stage 的切分票看板 id（`splitTaskId`）、成员及其模式（含可选的 `fenced`/`fencedReason` 标记）、切分修订号、检查点、journal 游标，以及两个可选的「在飞激活」字段——`activationInFlight`（正在物化的被接受修订号）与 `activatedLoops`（切分键 → 验证循环 id） |
| `journal.jsonl` | 只追加的迁移：阶段、派发、检查点、压缩、晋升、拒绝，以及取代行（`split-superseded`、`activation-in-flight-superseded`）；一趟激活每个产物写一条紧凑的 `cell-activation-progress` 行、失败时只写一条完整的 `cell-activation-partial` 行，修复行是 `task-reassigned`、`dispatch-reassign` 与 `checkpoint-unrecoverable` |
| `mail.jsonl` | 本 cell 自己的邮件行——同 cell 发送，或跨 cell 发往本 cell 的邮件；由发送方写入、本 cell 的 `cellwork_inbox` 读取；`send` 行之后跟着一条单独的 `wake` 记录，说明唤醒尝试的结果 |
| `requirements.md` | 经校验的需求文档，带修订号；一次变更会提升修订号并把切分标记为过期 |
| `split/<rev>.json` | 切分器的提案，加上插件的实测估算与接受/拒绝裁定 |
| `split/<rev>.refused.json` | 该修订号下一次**被拒绝**提交的完整 finding 列表；写在被接受记录旁边，绝不覆盖它 |
| `contracts/<taskKey>.md` | 交给验证者的冻结验收合约 |
| `handoff/<member>-<n>.md` | 结构化交接文档，每个检查点一份 |

cell id 形如 `cell-<UTC 时刻>`；子 cell 会记录 `parentCellId` 与 `depth`。根目录每次调用都经
`dsh.workspaceRoot(exec)` 解析——绝不使用 `process.cwd()`，也绝不缓存成常量——写入先落到同目录下的临时文件
再 rename，因此读者要么看到旧记录、要么看到新记录，永远看不到写了一半的文件。

记录是**带版本**的。损坏、无法解析或版本高于本构建的状态一律是**点名绝对路径的拒绝**——绝不静默重置，
也绝不覆盖。停止即归档：目录保留、记录标记 `stopped`，之后再次 `/cellwork` 会得到一个全新的 cell id。

## 配置

每个数字都是 `cellwork.<key>` 旋钮。**优先级为项目文件 > 行配置 > 随包发布的默认值**：
`<workspace>/.mpd/mpd.jsonc` 优先于 bundle patch 的 `config:` 块，后者优先于文档默认值。不是有限数字或超出
取值规则的声明会被替换为默认值，并在该行的日志里报告（`<workspace>/.mpd/logs/mpd-cellwork.log`）。

`depthMax` 3 · `checkpointRatio` 0.5 · `windowFraction` 0.25 · `fixedOverheadTokens` 32000 ·
`fixedOverheadByRoute` {} · `toolSchemaChars` 0 · `outputReserveTokens` 8192 ·
`compactionHeadroomTokens` 65536 · `compactionRetries` 3 · `idleBarrierDelayMs` 200 ·
`asciiCharsPerToken` 3 · `cjkCharsPerToken` 1 · `contractGates` [] · `windowOverride` null。

模型自身的上下文窗口**不是**旋钮：切分时从模型目录读取，运行时从观测到的 token 计量读取，并记录来源。
`windowOverride` 只用于让「窗口读不到的 route」被显式认证，并且会记录为 override。

## 声明边界

- **守卫是进程级、且只在派发时刻生效。** 它看不见意图，无法阻止模型去「尝试」某个被禁的名字，也覆盖不到
  绕过工具直接调用 service 的代码行。读不出来的 cell 记录会放行所有调用者——守卫无法执行一个它看不见的
  模式——此时拒绝会带着记录路径出现在命令与 `cellwork_status` 上。
- **1/4 预算是估算**，带声明的英文 ±25% 误差界，且对 CJK 刻意从严；它不是对模型分词器的测量，因为部署里
  根本没有分词器。
- **挂载由 overlay 证明。** 在这台机器上，普通的 link-profile 启动仍会解析到一个陈旧的 `@mpd-dsh/mpd` 包，
  所以挂载证明用 `--patch` overlay 以绝对模块路径提供这一行，并在真实隔离启动下证明该行**能被应用**。
  bundle 接线——即随包 patch 层是这一行的来源——由 `verify:rows` 与 `verify:manifest` 证明，而不是由那次
  启动证明。
- **打包闭合已由 Wave-5 重打包关闭。** `verify-pack-closure --require-packed` 报告 622/622 个内容文件
  字节一致、0 漂移（打包戳 2026-10-26T12:23:55Z），打包产物已包含新包。
- **并发子会话由 harness 设上限。** `maxActiveSubagents`（subagent 插件的设置字段，默认 8，无上限）
  限制同时驻留的成员会话数，超过上限的 cell 无法一次全部拉起。用 cellwork 时建议在
  **Settings → Subagent limits** 调到 **32–64**（它会写进当前 profile 的 Cordis patch）；随包无法替你
  设置——随包 patch 行绝不能 id-target 宿主行——而 agent 沙箱对 `~/.dsh` 只读，所以这是一次性的用户操作。
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
- **通用 team 动词就是 cell 模式消除的危险。** `agent_teams_dispatch` 会把就绪任务配给声明的 owner，但当
  owner 忙时会**退回按名册顺序**配对；本波次中它把一条 REVIEW 任务交给了写过被审泳道的成员（配对立即释放，
  没有记录任何裁决）。cell 派发是仅声明 owner、绝不替换的——在 cell 模式之外，等声明的 owner，或先释放再
  刻意改派。写者自审不是理论风险。
- **重种是尽力而为。** 原生后端不暴露已落地激活的 dispose，因此旧子代理只做尽力中断，新 handle 记录在
  cell 上。
- **检查点需要观测到的窗口。** 没有观测就没有检查点：比例绝不会施加在猜测的窗口上。
- **取消记在 cell 记录上，而不是团队平面。** 团队平面没有取消动词：被后续切分修订去掉的任务会在 cell 记录里
  标记为 `cancelled`（`state.json: cancelledTasks`，key → 看板 id），它的看板行仍然**可见**。派发之所以跳过
  它，只是因为 cellwork 自己的派发会读取 cell 记录——单看看板仍然能看到这一行。
- **深度围栏默认三层。** 被晋升的副队长可以拉起子 team，`cellwork_subteam` 在超过 `depthMax` 时拒绝；
  嵌套能力本身依赖 adapter 的直接启动路径与显式的绝对 `maxDepth`，这一点在能力尖刺
  （`evidence/cellwork/capability-spike/`）中作为源码阅读记录在案。
- **`parent_team_id` 是隐式推导，不是旋钮。** 子 team 的父级由团队平面在批准时从父 team 的名册推导
  （`deriveParentTeam`）；`cellwork_subteam` 把推导出来的父 team id 记在 cell 记录上，全程不传任何父级 id，因此
  没有调用方可以搞错的参数——也没有办法把子 team 指向一个不把该 session 记作成成员的 team。
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
  这个比较是**字符串**比较——它让规则有意义，但从不保证不可伪造。
- **续做不是事务。** 逐产物检查点把残余窗口缩到一次看板/验证调用加一次 cell 记录写入。只有当任务已创建、而
  它的检查点写入失败时，才可能出现重复的看板行；这是可检出但不可删除的——团队平面没有取消动词。
- **「盲」始终是书面约定**，与本仓库其它地方一致：cellwork 接好合约、循环与裁决，但不假装能观测到验证者
  读过什么。

## 测试与证据

- `bun test packages/mpd-cellwork-plugin`——离线、无 harness、无网络；每条用例都走宿主实际使用的 adapter
  入口（`apply`、捕获到的命令定义、捕获到的工具定义，以及那**唯一一个**守卫谓词），并在全新的临时 workspace
  里运行。测试套件还覆盖激活续做：分别在第二个成员、第二个任务、第二个循环之后以及派发时注入失败，再重试并
  确认复用了已记录的产物。
- 本波次的缺陷臂各自成文件：`activate-resume-e2e`（五个阶段**各自**失败一次，随后收敛且无重复）、
  `split-refused`、`requirements-subheadings`、`dispatch-fenced`、`dispatch-reassign`、`mail-order`、
  `planner-guard`、`band-parity`、`split-task-owner` 与 `status-reconcile`；验证侧新增 `gates-project` 与
  `open-writer-id`，名册侧新增 `captain-instruction-files` 与 `role-spawn-maxdepth`。
- 挂载证明、能力尖刺与各波次的裁定都在 `evidence/cellwork/` 下——每个目录带自己的 `result.json` 以及
  该条线自己的产物：只读尖刺是一份报告，一次运行则是一批日志。
- `bun run verify:docs`、`bun run verify:rows`、`bun run verify:manifest` 与
  `node scripts/verify-dist-fresh.ts` 是任何 cellwork 变更都必须保持绿色的关卡。

精确的工具参数、拒绝文案与逐条用例清单，以本包的 README 对为准；模式的设计与每一波交付了什么，见仓库
`.mpd/plans/` 下的计划与契约。
