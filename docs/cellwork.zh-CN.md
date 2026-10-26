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
   作答。
2. **split（切分）**——切分器通过 `cellwork_split {action:"submit"}` 提交任务图。插件校验它（每个任务都
   声明依赖答案、图无环、写作用域有序、计划中的验证者与写作者不同），并针对模型预算逐任务计价；只有被接受
   的图才能作为 `cellwork_activate` 的输入。拒绝时会返回逐任务明细，告诉切分器还需要砍多少。
3. **executing（执行）**——`cellwork_activate` 把切分结果里的成员与任务加进**活跃** team 记录，为每个代码
   任务写一份冻结合约，并在派发**之前**为每个代码任务打开一条验证循环，然后派发。成员的人格文本会注入成
   员提示词——team 本身不提供名册人格。队长在每次唤醒时巡检。
4. **re-split（重切分）**——`cellwork_requirements {action:"update"}` 提升需求修订号并把切分标记为过期。规划器
   重新谈定变化的部分，切分器重新提交一个修订，`cellwork_activate` 只把新增或有变化的工作**追加**到同一个
   team：team id 与 cell id 都不变，新修订中被去掉的工作标记为 `cancelled`（绝不删除），切分任务会被重新
   派发而不是被复制。用过期切分激活会被**拒绝**，除非调用者显式指定修订号。

### 重切分的细节

一个修订不是把 team 重写一遍，而是在活跃记录上打一个增量：

- **同修订号的激活会被拒绝。** 激活 cell 已记录的修订号是一次空操作请求，会被直接拒绝；每次提交的修订号
  都必须**大于**已记录的修订号——修订只能向前。
- **保留下来的行会被复用，合约不会被重写。** 跨修订存活的任务保留它在看板上的行，以及验证循环打开时冻结的
  合约——验证者仍然按工作开始前冻结的验收标准裁决。
- **被去掉的行标记为 `cancelled`，绝不删除。** 它们作为历史留在 cell 记录里，派发会跳过它们。
- **切分器保留可被重新派发的活行。** 激活会关闭它消费掉的那个切分任务；需求再次变化时会开出一行**替代的**
  切分器行，因此切分工作是通过看板重新派发，而不是复制出第二个切分任务。

team id 与 cell id 都不变，因此 cell 的 journal、邮件与看板始终是一段连续的历史。

## 工具面

| 工具 | 调用者 | 作用 |
|---|---|---|
| （`/cellwork` 命令） | 你 | 写入那一份 cell 记录，并提交那一条激活指令 |
| `cellwork_start` | 队长 | 打开活跃 cell 的需求阶段：校验 cell 与调用者、写入 `startedAt`、记入 journal |
| `cellwork_status` | 队长、成员 | 阶段、目标、队长、需求/切分修订号、成员及其模式、已注入的检查点、活跃 team 计数、调用者自己的座位与磁盘路径 |
| `cellwork_requirements` | 规划器 | `finalize` 需求文档，或 `update` 它——update 会提升修订号并把切分标记为过期 |
| `cellwork_recon` | 规划器、副队长 | 一次性**只读**咨询（Explorer/Researcher）：走直接启动路径，以角色名作为标签，并给出显式的绝对深度上限，因此这次咨询是一个只读叶子；报告会返回并记入 journal |
| `cellwork_split` | 切分器 | `submit` 任务图让插件度量，或 `show` 上一次的裁定 |
| `cellwork_activate` | 队长 | 把被接受的切分物化到活跃 team 记录、写合约、打开验证循环、派发 |
| `cellwork_dispatch` | 队长 | 在 team 看板上做一次「仅声明所有者」的派发 |
| `cellwork_supervise` | 队长 | 只读巡检：待处理的检查点、压缩、晋升、过期切分、未读邮件，以及每一条**未投递**的邮件行 |
| `cellwork_context` | 成员 | 调用者自己的实时占用、度量所用的窗口，以及该窗口的来源 |
| `cellwork_handoff` | 成员 | 写入并校验检查点交接文档；把检查点标记为就绪 |
| `cellwork_subteam` | 已晋升的副队长 | 登记子 cell、执行深度上限、返回副队长指令 |
| `cellwork_send` | 任意 cell 智能体 | 感知 cell 的寻址（成员、队长、另一个子 cell），并完成传输投递与 journal 记录 |
| `cellwork_inbox` | 任意 cell 智能体 | 读取并确认调用者的未读 cell 邮件 |
| `cellwork_stop` | 队长 | 结束模式：归档 cell（不删除）、清除守卫、交还工具；只要还有看板任务处于 `claimed`/`in_progress` 就**拒绝**，除非 `force:true`，且强制停止会如实记入 journal |

旁观者一眼看全局用 `cellwork_status`；其余工具要么修改 cell 记录，要么对它返回一份裁定。

## 四种守卫模式

每个插件只安装**一个** `tools.guard` 谓词。它解析调用者的 session，并在活跃 cell 树里查它：不属于任何 cell
的 session 完全不受影响——这正是模式关闭时零成本的原因。谓词只在**派发**时刻生效。

| 调用者 | 放行 | 拒绝 |
|---|---|---|
| 队长 | 除 `cellwork_handoff` 之外的 `cellwork_*`，加上 `agent_teams_*`、`ask_user_question`、`todo_write`、`mpd_memory_*` | 其余全部——不改文件、不跑 shell、不 `read`/`grep`/`glob`、不做验证 |
| 验证者 | `read`、`grep`、`glob`、`bash`（跑关卡）、`mpd_verify_*` | `write`、`edit`、`mpd_hashline_edit`、`mcp__ast_grep__rewrite`、`mcp__ast_grep__scan`、`mcp__lsp__rename_symbol`、`mcp__lsp__rename_symbol_strict` |
| 处于上下文检查点的成员 | `cellwork_handoff`、`cellwork_context`、`cellwork_status` | 其余全部——即使它无视书面说明，也无法继续干活 |
| 副队长 | 队长白名单**去掉** `cellwork_start` / `cellwork_stop`，**加上** `cellwork_subteam`、`cellwork_activate`、`cellwork_dispatch`、`cellwork_supervise` | 一切文件工作工具：副队长是迷你队长，只做调度，不做实现 |
| 普通成员 | 干活所需的一切 | 没有——它就是普通工作者 |

每次拒绝都是**一整段教学式说明**：点名被拒的调用、可替代的调用，以及作为出路的 `cellwork_stop`。cell 停止
后座位消失，同一个 session 立刻恢复不受限。

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

**本波次交付的表面是 TUI。** 面板在它的字符网格里画出这些盒子——第二套单格字形家族、横跨内部各行的帧框、到达边画
端口而穿过的边画交叉、分组命中身份，以及"宁可折叠也不半画"的宽度守卫
（`packages/mpd-tui-plugin/README.md` 的 "Nested groups: subcells as boxes"）。web DAG 的分组帧**不属于**本次交付；
"声明边界"一节对此有明确交代。

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

## 磁盘状态

一切都在 workspace 之下、属于被 gitignore 的运行时状态：

`<workspace>/.mpd/cellwork/<cell-id>/`

| 路径 | 内容 |
|---|---|
| `state.json` | cell 记录：阶段、队长 session、深度、父 cell、team id、规划器/切分器 handle、成员及其模式、切分修订号、检查点、journal 游标 |
| `journal.jsonl` | 只追加的迁移：阶段、派发、检查点、压缩、晋升、拒绝 |
| `mail.jsonl` | 本 cell 自己的邮件行——同 cell 发送，或跨 cell 发往本 cell 的邮件；由发送方写入、本 cell 的 `cellwork_inbox` 读取 |
| `requirements.md` | 经校验的需求文档，带修订号；一次变更会提升修订号并把切分标记为过期 |
| `split/<rev>.json` | 切分器的提案，加上插件的实测估算与接受/拒绝裁定 |
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
- **打包闭合尚未变绿。** 在 Wave-5 重新打包之前，`verify-pack-closure` 保持红色（`PACKED-MISSING`）：
  打包产物还没有刷新到包含新包。
- **不宣称做过真·LLM 端到端 cell 运行。** 单元测试用假上下文证明命令面、各模式下守卫的判定、状态存储、
  估算算术与协议逻辑；Wave-3 的 QA 用例证明命令已注册、其处理函数确实提交了指令，并复现挂载。两者都不是
  模型驱动的运行。
- **邮件唤醒是尽力而为。** 投递是持久的：成员 → 队长的行会留在 journal 里，直到队长轮询 `cellwork_inbox`。
  只有持有可执行 handle 的收件人才能被唤醒。
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
- **WEB 端的嵌套帧在本波次不交付。** team 记录、共享模型与 TUI 都带上了嵌套分组（见"嵌套 DAG：子单元画成分组
  盒子"）；web DAG 的分组帧、它的递归几何与它的 client 重建都是**后续工作**，补丁计划冻结在
  `.mpd/plans/cellwork-w4-t7-plan.md`。本文档没有任何一句声称 web 表面会画盒子，读者也不得把 TUI 的词汇当成 web
  的能力。
- **「盲」始终是书面约定**，与本仓库其它地方一致：cellwork 接好合约、循环与裁决，但不假装能观测到验证者
  读过什么。

## 测试与证据

- `bun test packages/mpd-cellwork-plugin`——离线、无 harness、无网络；每条用例都走宿主实际使用的 adapter
  入口（`apply`、捕获到的命令定义、捕获到的工具定义，以及那**唯一一个**守卫谓词），并在全新的临时 workspace
  里运行。
- 挂载证明、能力尖刺与各波次的裁定都在 `evidence/cellwork/` 下——每个目录带自己的 `result.json` 以及
  该条线自己的产物：只读尖刺是一份报告，一次运行则是一批日志。
- `bun run verify:docs`、`bun run verify:rows`、`bun run verify:manifest` 与
  `node scripts/verify-dist-fresh.ts` 是任何 cellwork 变更都必须保持绿色的关卡。

精确的工具参数、拒绝文案与逐条用例清单，以本包的 README 对为准；模式的设计与每一波交付了什么，见仓库
`.mpd/plans/` 下的计划与契约。
