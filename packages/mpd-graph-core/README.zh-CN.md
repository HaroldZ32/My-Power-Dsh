# mpd-graph-core

[English](./README.md) | **简体中文**

`living-graph` 波次的共享 plan→graph 核心：一份对外导出的 rank 推导、一个宽容的任务计划解析器、一个确定的合并模型，
以及一个去抖的文件监听器；TUI 与 Web 两个平面共同消费它。

它是库，不是插件。没有 cordis 行、没有 patch 条目、没有运行时依赖。两个平面通过 `bun build` 把它**内联**进各自的
产物，所以下面每一条规则都只有一份实现。面向浏览器的产物应直接引用所需模块（`./rank.ts`、`./types.ts`）而不是
barrel，因为 barrel 还带着两个 `node:fs` 模块；两条路径是同一份代码。

## 这个包为什么存在

在这个包之前，TUI 在 `mpd-tui-plugin/src/graph.ts` 的一个私有函数里推导看板的 rank，Web 平面又在
`team-view.ts` 的工厂体里**再推导一遍**。同一个推导的两份实现、都不导出：修好一份传不到另一个平面，测试也只能
各自钉住自己那份。

用户的要求——任务计划驱动的实时图、Web 与 TUI 共用基础设施、由代码绘制而绝不由模型绘制——就是这个包，加上消费它的
两个投影。

## 模型

`buildModel({ board, plan })` 把**实时看板**（`.mpd/team/teams/<id>.json`）与解析后的任务计划 Markdown 合并，
返回一个确定的、可序列化的模型。

看板是实时状态的权威，计划是看板可能还没承载的意图。两者冲突时，模型把冲突**画出来并报告出来**，绝不静默地替谁
做决定：

| 情形 | 模型行为 |
|---|---|
| 看板有、计划无的 id | 从看板绘制；`report.boardOnly` |
| 计划有、看板无的 id | 画成 GHOST（`planned: true`、`visual: "planned"`），绝不丢弃；`report.planOnly` |
| 只在计划里声明的边 | 以 `source: "plan"` 绘制；`report.edgePlanOnly` |
| 只在看板上的边 | 以 `source: "board"` 绘制；`report.edgeBoardOnly` |
| 两边一致 | 普通边，`source: "both"`，两个报告列表都不列它 |
| 无法解析的计划行 | `report.planProblems`，每行一条，永不抛错 |

形状（全部是纯 JSON——没有 `Map`、没有 `Set`、没有类实例、没有函数）：

```
GraphModel  = { nodes, edges, ranks, cycles, report, groups? }
GraphNode   = { id, subject, kind?, visual, assignee?, dependencies, depth, planned, title?, status?, group? }
GraphEdge   = { from, to, source: "board" | "plan" | "both" | "derived" }
GraphReport = { boardOnly, planOnly, edgePlanOnly, edgeBoardOnly,
                planProblems, unresolved, ranksDerived }
GraphGroup  = { id, label, parentId, memberIds, depth, originTaskId? }
GraphGroupInput = { id, label, originTaskId?, board?, plan?, groups? }
```

节点上的 `depth` 是**已解析的列**（从阻断图推导，或报告会说明的 served-depth 回退），所以消费方不再自行分桶。
`planned` 恰好对 GHOST 为 `true`；ghost 同时带这个布尔和 `visual: "planned"` 是刻意的：消费方看布尔，渲染方看字符串。

**确定性。** 同样的看板与同样的计划产生逐字节相同的模型。节点、rank 桶和两个 id 列表都按数字 id 比较器排序
（`T2` 在 `T10` 之前）；边按（`from`、再 `to`）排序；计划问题按源行号、再按文本排序。任何进入绘制的集合都不会因为
`Map`/`Set` 的插入顺序而变。`JSON.stringify` 能原样往返：缺省的可选字段就是**缺键**，从不是 `undefined` 值。

**环与扁平看板都如实绘制。** 依赖环让每个 rank 保持有限，并列进 `cycles`；所有 `blockedBy` 都是 `[]` 的看板就画成
扁平的——一个 rank、没有边——那是真实的画面，不是缺陷。

## 分组（嵌套子单元）

一个子单元就是一个**分组**：一个盒子，盒子的内部就是这个子单元自己的依赖图。`buildModel` 以**树**的形式接收
分组输入，返回一个模型，盒子和任务都能从它抵达：

```ts
buildModel({
  board, plan,                        // 根帧：调用方自己的任务
  groups: [{
    id: "teamB", label: "Subcell B",
    originTaskId: "T2",               // 派生出它的那个任务（已知时）
    board, plan,                      // teamB 自己的内部输入
    groups: [ /* … 递归 … */ ],
  }],
})
```

**附着规则（强制）。** 一条边一端在分组 G 内部、另一端在外部，就**重锚到 G 的帧**（G 是包含内侧端点的最内层
分组）；完全落在一个分组内部的边保留它原来的两个任务；两个分组之间的边变成 group→group；分组的派生边由
`originTaskId` **推导**（`source: "derived"`），调用方永不手写。两次声明重锚到同一对端点时，只画**一个**端口。

**盒子本身也是节点。** 每个分组都画成父帧里的一个伪节点：`id` = 分组 id、`subject` = 它的标签、`visual` =
`"group"`、`dependencies` = 重锚后附着到它边框上的阻断者。`ranks` 仍然只为**根帧**分桶（它自己的任务加上顶层
盒子），而每个节点的 `depth` 是它**在自己帧内**的列——这正是渲染方能够递归的依据。

**排序。** 外层模型对**分组伪节点**排序，所以外部列是对的；每个分组的内部则按它自己的模型排序：内部对帧外任务的
引用在帧内解析不到，而那正是依赖附着到边框的位置。

**哪个字段对什么权威。** `edges` 是**画出来的结构**，并且是 `ranks`、每个节点的 `depth` 与 `cycles` 的**唯一**
输入：跨越帧边界的引用会被画成连到（或来自）该帧某个盒子的线，所以列和查环都跟着这条线走。节点的 `dependencies`
是**手写的原文**，逐字保留（含帧外与解析不到的引用），让读者看到调用方究竟写了什么——永远不要从它推导结构。
盒子是唯一一种 `dependencies` 本身就是画出内容的节点，因为盒子没有自己的手写原文。

**纯 JSON 与确定性。** `groups` 按（`depth`、再 `id`）排序，父在子前；`memberIds` 按 id 比较器排序；
`JSON.parse(JSON.stringify(model))` 往返后与原模型深等。

**向后保证。** 不提供任何分组时，结果与引入分组之前的扁平模型**逐字节相同**：没有 `groups` 键、节点上没有
`group`、同样的 rank、同样的序列化字节。包内测试用一段固定的 JSON 钉住它，`verify-graph-model` 门禁还会再查一遍
扁平模型不携带 `groups` 键。

**id 必须在整棵树内唯一。** id 是两个平面绘制时共用的连接键，所以一棵树里两个帧复用同一个 id——或某个分组 id 与
任务 id 相同——会被**拒绝**并抛出一个同时点名两个帧的 `Error`，因为静默地留下其中一个，画出的就是没人声明过的树。
团队各自复用 `T<n>` 编号空间的调用方，应当在构建前给内部 id 加上限定前缀（团队平面自己的写法是
`<teamId>::<taskId>`）。`originTaskId` 指不到任何节点时记入 `report.unresolved`；指到它自己内部的任务时不推导任何
边，因为盒子不能被自己的内部阻塞。

## 任务计划 Markdown 子集

下面是解析器接受的精确语法。手写的 fixture 就照这份清单写。

**标题（heading）。** 两个二级标题开启被跟踪的小节：`## TODOs` 与 `## Final Verification Wave`（大小写不敏感，
允许尾部 `#`）。任何其它一、二级标题都会关闭当前小节；三级及更深不会。围栏代码块（``` 或 ~~~）被整体忽略，所以
引用语法的示例不会声明任何任务。

**任务 id。** id 来自条目自己的标记，绝不来自散文：TODO 的序号 `N` 变成 `T<N>`，最终验证的 `F<N>` 变成 `F<N>`。

**任务条目形式**（只认第 0 列——缩进行是续行，绝不是任务）：

```
1. 标题                       - 1. 标题
- [ ] 1. 标题                 - [x] 1. 标题
F1. 标题                      - F1. 标题                  - [ ] F1. 标题
```

**标题文本。** 标记之后的文本，**只有在该 lane 表真的声明了该键时**才去掉开头的 lane 标记：`A. Core work`、
`C — parser work`、`P0 · contract work`、`Lane B (Senior Engineer) — panel work` 都会得到一个 lane 键
（`A`、`C`、`P0`、`B`），并留下标记之后真正的标题——前提是文档声明了这些 lane。标记后面必须是分隔符
（`.`、`—`、`–`、`·`、`:`、`(`）或文本结束，因此普通散文不会被误认为 lane。形似标记、但键**未被** lane 表声明的
前缀会记成一条问题，标题原样保留——宽容解析器绝不能吃掉真实标题的第一个词。标题只取第一行；更深的续行被忽略而不会
报成问题。

**Lane 表（owner 来源）。** 任何表头同时含 `Lane` 与 `Owner` 两个单元格的 Markdown 表都提供 owner，位置与所属标题
不限。同一个键的第一行生效。owner 取第二个单元格，去掉强调标记并切掉尾部的限定语（`Junior Engineer (after C)` 变成
`Junior Engineer`）。任务的 owner 是与其标题 lane 键匹配的那一行；没有 lane 标记的任务没有计划 owner。

**显式声明的边。** 一行可以用两种方式之一声明阻断：

- 括号形式：`(blocked by 1, 2)`、`(blocked_by Lane A)`——大小写不限，词之间可以是 `-`、`_` 或空格；
- 冒号标签形式：`blocked_by: 2, F1`、`blocked-by: 2`、`blocked by: 2`、`depends on: T3`。

引用之间用逗号、`+`、`&` 或 `and` 分隔。单个引用可以是 `T<n>`、`F<n>`、裸数字（等价 `T<n>`），或 lane 引用
（`Lane A`，或计划已声明的裸 lane 键）。lane 引用会阻断该 lane 声明的每一个任务，但排除任务自身。`blocked by`
之后的普通散文不声明任何边。

**什么样的行算问题。** 永不抛错：每条问题都带 1 起的行号、原文和原因，按文档顺序报告。被跟踪小节内的一行是
**候选行**——第 0 列以列表符号、裸 `N.` 或 `F<N>.` 开头——却不满足该小节的语法时（半途输入的 `- [ ] 2`、游离的
列表项、`## TODOs` 下的 `F` 条目），它就是问题。另外三种也是问题：lane 表行没有 lane 键或没有 owner、声明的阻断
引用既不是 id 也不是已声明 lane、以及重复的任务 id（第一个生效且仍被解析）。散文、空行、标题、表格行和缩进续行都
**不是**问题。

## 计划文件解析顺序

`resolvePlanFile(workspaceRoot)` 是两个消费方共用的**唯一**解析，因此两个平面不可能监听两个不同的文件：

1. **Beacon** —— `<workspace>/.mpd/boulder.json` 中**活动** boulder 工作的计划：`active_work_id` 指向的工作状态
   为 `active`，且其文件仍存在。终态（例如 `completed`）的工作刻意**不是** beacon：它的计划是历史，跟随它会把实时
   画面钉在一个已结束的波次上。beacon 的文件不存在时同样落空。
2. **最新** —— `<workspace>/.mpd/plans/` 下按修改时间最新的 `*.md`；时间相同时按文件名（因此同一毫秒写入的两个
   文件在每次运行中都解析到同一个）。`*.zh-CN.md` 双胞胎永远不是候选。
3. **没有** —— `undefined`，每个调用方都必须把它当作"没有计划"，而不是错误。

`readPlanFile(path)` 宽容地读取：`undefined` 得到空计划且**没有**问题（没有计划的工作区是正常状态），读不到的路径
得到一条行号为 `0` 的问题，而不是抛错。

## 监听输入

`watchGraph({ boardDir?, planFile?, plansDir? }, { debounceMs?, onChange?, onError? })` 返回**一个**监听器，
所有消费方订阅同一个——在一个文件上挂两个监听器，正是选择事件驱动刷新时要避免的资源浪费。

```ts
GraphWatcher = {
  subscribe(listener): () => void     // 追加一个批次监听器，返回移除它的函数
  poll(): boolean                     // 手动重同步：立刻比较，有变化就投递
  close(): void                       // 关闭所有句柄，清空监听器
  readonly watching: boolean          // 至少挂上一个目录句柄
  readonly closed: boolean
  readonly sequence: number           // 已投递的批次总数
  readonly coalesced: number          // 这些批次累计吸收的原始通知数
}
GraphChangeEvent = { paths, manual, sequence, coalesced }
```

**它为什么在真实文件系统上仍然正确。** 监听器盯着每个目标**所在的目录**——从目标路径向上走到最近一个真实存在的
目录，因此尚不存在的目标在创建时也能被发现——并用它自己计算的签名（每个文件的 inode、mtime、ctime 与大小）判断
是否有变化。重命名、替换、删除、创建都只是"签名动了"，所以一次 rename 不会把监听留在没人再写的 inode 上。文件或
目录缺失都能存活；每次去抖后都会重新挂载一遍，并记录该目录的身份。监听会在**平台 `close` 或 `error`**、
**目录自身事件**（有些运行时把目录被删除或被改名报成一个以目录名命名的通知，根本不发 `close`）或**有界定时器**这
三种信号之一下重新挂载，并且同时比较 **inode 与 birthtime**：`rm -rf` 之后再 `mkdir` 可能复用同一个 inode，只有
birthtime 能区分新目录与监听刚死掉的那个。每次重新挂载还会**立刻比较目标签名**——仅当已有去抖定时器在等待时跳过，
因为那个定时器会负责投递——因此监听死亡期间落下的写入（它根本没有产生任何通知）仍会被投递，而不是等到某个无关事件。
因此同一路径上被**替换**的目录会被重新挂载——inotify 跟随的是 inode 而不是路径，"看起来已经挂上"的监听会静默地不再
报告新目录里的文件。重试是**有界**的：三次全部失败后监听保持死亡，调度本身不再投递任何批次，但**被拒绝的那次尝试**
仍会经 `onError` 报告——"什么都没发生"与"失败了并且已经告诉你"必须可区分。

**新出现的计划也是一次变化。** `plansDir` 把计划目录当作**集合**来听：它的签名是每一个候选计划文件（`*.md`，
绝不含 `*.zh-CN.md`），所以在原本没有计划的地方创建一个计划、或创建一个更新的计划从而改变 `resolvePlanFile` 的
答案，都会投递一个批次——即使原先监听的那个文件根本没变。没有它，"改计划就重绘"就会静默地漏掉"新建计划"。

**去抖是可观察的。** 同一窗口内的多次变化合并成**一个**批次，其 `coalesced` 说明吸收了多少条原始通知，监听器另带
累计总数。因此静默吞掉事件不可能被忽略：`sequence === 1` 且 `coalesced === 2` 就是一次被证明的合并，而 `poll()`
是使用同一套比较的重同步路径。抛错的监听器会经 `onError` 报告，且不能中断批次。

## 公开 API

```ts
// rank.ts —— 从 TUI 模块逐字搬来并对外导出的推导
deriveRanks(tasks, byId): Map<string, number>
servedRank(task): number
bucketRanks(tasks, rankOf): T[][]
rankPlan(tasks, served?): RankPlan<T>
cycleIds(tasks): string[]
ID_ORDER: Intl.Collator

// plan.ts —— 宽容解析器
parsePlanMarkdown(text): PlanDocument

// resolve.ts —— 选哪个文件、宽容读取，以及监听器必须点名的目录
plansDirectory(workspaceRoot): string
resolvePlanFile(workspaceRoot): string | undefined
readPlanFile(path): PlanDocument

// model.ts —— 唯一的模型
buildModel({ board?, plan?, groups? }): GraphModel

// watch.ts —— 唯一的监听器
watchGraph(targets, options?): GraphWatcher
```

`rankPlan(tasks, served?)` 接受任何结构兼容的行（`{ id, dependencies, depth }`），并原样返回调用方自己的行类型。
传入 `served` 时，它套用别处已算好的 rank（`derived: false`，`rankOf` 就是那张表），同时仍跑同一套未解析引用扫描；
不传时它自己推导。这正是 TUI 的路径：宿主已经算过一次模型，布局直接套用那些列，而不是自行重建一份 rank plan。
`RankPlan` 持有查询用的 `Map`；它刻意**不**属于 `GraphModel`，后者才是要跨进程传递的值。

`watchGraph` 的选项里有 `createWatch?: GraphWatchFactory`，它是一个**测试缝**：默认值是 `fs.watch`，存在的理由
是某些平台根本不发出目录死亡的信号（Bun 对被删除或被改名的目录不发 `close`），所以"close 恢复"这条用例无法被
证明。任何产品调用方都不传它。

## 构建与测试

从**仓库根目录**用固定工具链构建，让提交的产物与新鲜度门禁重建出的字节一致：

```
.toolchain/node_modules/.bin/bun build packages/mpd-graph-core/src/index.ts \
  --target node --format esm --outfile packages/mpd-graph-core/dist/index.js
bun test packages/mpd-graph-core
```

独立于实现的"画面对输入"门禁在仓库根目录，它是唯一拿模型去对**契约**（而不是对它自己）的命令：

```
node scripts/verify-graph-model.ts              # 扁平 fixture，输出与引入分组前逐字节一致
node scripts/verify-graph-model.ts --grouped    # 分组用例：内置的嵌套 fixture
node scripts/verify-graph-model.ts --self-test  # 正反两个方向、分组的用例与各种路径形式
```

`--seed-wrong-edge`（扁平）与 `--seed-wrong-anchor`（分组）是播种负例：每一个都必须以非零退出，并打印一条**点名**
它所破坏那条边的 FAIL 行，而 `--self-test` 正是这样断言的——所以绿灯意味着门禁真的能分辨，而不是仅仅跑过。

本包交付 `src/index.ts`（barrel）、这份中英 README 对，以及上面命令产出的 `dist/index.js`。它不声明任何依赖。
