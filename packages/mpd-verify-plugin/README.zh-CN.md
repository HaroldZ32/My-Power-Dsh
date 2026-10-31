# mpd-verify-plugin
**中文** | [English](./README.md)

**验证法**，以一个 plugin row 的形式交付。**A** 写出的代码必须由一个**不同的** agent **B** 验证；B 只依据冻结契约与文档工作、**绝不**看实现，**先**记录裁决、**再**读任何实现；一旦 **FAIL**，工作以 repair 任务的形式退回给 writer。

这条法的**保证**在本包内的**记录校验器**：它拒绝没有引用文档、没有 gate 证据、伪造证据 id 或由同一 agent 自审的 PASS —— 这一点从不依赖 hook。曾用于纵深防御的 **tool guard 已在 2026-10-17 由用户决定撤销**（`.mpd/plans/harness-021-rollback.md`，R1）：顶层 agent 重新可以直接写代码，而被绑定的 verifier seat 的边界只是**约定（prose）**，不再是一道栅栏。

## 它是什么

| 部件 | 位置 | 作用 |
| --- | --- | --- |
| 账本 | `<workspace>/.mpd/verify/` | loop、record、evidence、seat、repair 以及只追加的 escape 日志 |
| 运行时 | `mpdVerify` 服务 | escape 额度、诊断期被计数的读取与委派观察器 —— 它的**观测日志由已被撤销的 guard 写入**，因此如今不再观测到任何调用（被绑定的 seat 因此总是读作 `blind`） |
| 工具 | 本 row | `mpd_verify_open` / `_escape` / `_seat` / `_evidence` / `_record` |
| 守卫（2026-10-17 已撤销） | `mpd-roles-plugin/src/verify-guard.ts` | 过去用于拒绝顶层 agent 的代码写入并约束 verifier seat；该模块作为参考实现保留，`mpd-roles` row **不再安装它** |
| 启动标记 | `<workspace>/.mpd/verify/boot.json` | 法一旦生效即关闭 `pre-plugin` 记录豁免 |

## 五个工具

- **`mpd_verify_open`** —— 开一个「委派 + 验证」loop。`writer:"self"`（被计数的路径：没有 `self_write_reason` 且没有一个**不同的** `verifier` 就会拒绝）或 `writer:"delegate"`（由成员来写）。在 `writer:"delegate"` 下还可以**点名写作者**：**`writer_id`**（成员的 agent 身份——它的 session id，trim 后 1..200 字符）成为该 loop 的 `writer.id`，**`writer_reason`**（同样 trim 后 1..200）成为 `writer.reason`，例如 `member: <name>`；不传 `writer_id` 时保留 `delegate:pending` 占位符。两个参数描述的都是**委派**循环，因此在 `writer:"self"` 下用**同一句话**拒绝。`scope` 为空表示覆盖整个工作区。可选参数 **`contract`** 点名本波自己的冻结契约（工作区相对路径）并被**记录到该 loop 上**；不传时 loop 保留一个**已声明**的默认值（`AGENTS.md`），**绝不会是别的波次的计划文件**。该 loop 还**冻结** workspace 的 `mpd-gates.json` 身份——`present` + 字节 sha256，或 `absent`——因此挂在它下面的 gate 运行只能认证那一个确切的文件（见项目 gate 一节）。
- **`mpd_verify_escape`** —— **被计数的**逃生口：一行 JSONL、一行启动日志、一次允许的写入。`reason` 为空会拒绝；日志写不下去时不发放任何额度。
- **`mpd_verify_seat`** —— 把调用方 session 绑定为某 loop 的 **verifier**。幂等；当调用方就是该 loop 的 writer 时拒绝。该席位的冻结文档就是**这个 loop 自己的 `contract`**，由**同一个函数**解析，席位与记录都调它，因此一份裁决的 `docPaths` 与它的 `basis.frozenContract` **不可能对不上**。
- **`mpd_verify_evidence`** —— `kind:"gate"` 跑**一个** id：workspace 自己的 `mpd-gates.json` 声明了该 id 就先用它，否则用固定表（`gates`、`tests`、`typecheck`、`docs`、`manifest`、`comments`、`rows`、`vendor`、`dist`、`pack`）并写日志——当该运行绑定的 loop 所冻结的 gate 文件不再匹配（或该 loop 早于冻结机制）时会**拒绝且不写证据**，结果与证据行都会声明 `gateFreeze:"frozen"|"unfrozen"`；`kind:"probe"` 对每个路径返回 `{path, exists, bytes, sha256, mtime}`，**绝不返回内容**。
- **`mpd_verify_record`** —— 通过校验器记录裁决。**PASS** 必须给出所依据的文档、至少一项 gate 证据，以及一个不是 `unproven` 的基础 —— 盲性只是**声明**，从不被观测，因此未证明的基础一律视为 UNVERIFIED；校验器仍会拒绝没有文档、使用伪造证据 id 或同一 agent 自证的 PASS。**FAIL** 必须给出 finding（每条都要有证明它的 `doc_source`），并会开出 repair 任务、解锁诊断读取。`bind-unproven` 仍会拒绝 basis 被声明为 `unproven` 的 PASS，`blind-spent` 仍会点名一次「被准入的」读取，但没有任何已发布组合会写入观测日志，因此 `blind-spent` 无法被证据触发 —— 需要付出什么代价见文末边界。

## 项目自定义 gate（`mpd-gates.json`）

workspace 可以在**根目录的一个文件**里声明或**覆盖**验证者要跑的 gate。文件从**调用 session 的 workspace**
解析，绝不从进程 cwd。文件只提供它**声明**的 id；它没声明的每个 id 仍保留自己的固定表条目，文件不存在时就是
全部 id。

```jsonc
{ "version": 1, "gates": {
  "lint": { "argv": ["cargo", "clippy", "--", "-D", "warnings"] },
  "tests": { "cmd": "cargo test --all", "argv": ["cargo", "test", "--all"] }
} }
```

- `version` 可选，存在时必须是 `1`；顶层只允许 `version` 与 `gates`，最多声明 **32** 个 gate。
- gate id 匹配 `^[a-z][a-z0-9-]{0,31}$`。
- `argv` **必填**：1..32 个非空字符串，每个最多 4096 字符。`argv[0]` 是**程序**（PATH 名或绝对路径），以
  `shell:false`、`cwd` = workspace、沿用既有 `verify.gateTimeoutMs` 超时启动。`cmd` 是可选标签，最多
  **4096** 字符；不传时默认为 `argv.join(" ")`。
- **优先级：项目条目优先，固定表其次——按 id 逐个判断。** 项目条目**新增**一个 id 或**覆盖**已有 id；项目
  没声明的每个 id（文件不存在时就是全部 id）仍解析到自己的固定表条目。项目文件是扩展点、绝不是替换，
  「文件没有声明这个 id」也**不是**格式错误。
- **文件格式错误会拒绝整次调用，绝不回退。** 一句话同时点明文件与问题（JSON 非法、顶层或条目里有未知键、
  缺少 `gates`、id 非法、`argv` 缺失/非数组/为空、参数或 `cmd` 超长），并且**不写任何证据**。即使请求的 id
  属于**固定表**，这条拒绝同样生效：一个坏掉的项目文件绝不可能悄悄跑一条项目没声明的命令。
- **证据日志点名真正跑了什么。** 日志第一行是
  `# gate <id> cmd: <label JSON> program: <program JSON> argv: <args JSON>`——只有 `cmd` 标签是一个**声明**
  （`cmd:"bun test"` 而 `argv:["true"]` 会认证一条根本没跑过的命令），因此**日志**及其 `logSha256`（哈希
  **含这一行头**的日志）才是权威，证据行的 `cmd` 元数据只是标签。程序完全无法启动时，日志**与** tail 都会追加
  `[spawn-error] <原因>`，让调用方读到原因而不是一行裸头（exit 仍是 `-1` 表示「从未启动」，超时为 `124`）；
  `cmd` 或某个 `argv` 元素里的换行、U+2028/U+2029 行分隔符或 DEL 等控制字符会在单行头里被**转义**，因此项目
  文本永远无法伪造出一行日志。结果携带 `cmd`、`exit`、`logPath`、`logSha256` 与 `gateFreeze`。
- **loop 会冻结它的 gate 文件，文件一变该 loop 的运行就被拒绝。** `mpd_verify_open` 与 observer 的 arm 路径
  都把 workspace `mpd-gates.json` 的身份记在 loop 上（`present` + sha256，或 `absent`）。挂在该 loop 下的 gate
  运行只要发现身份不同——字节变了、文件被删、或在 `absent` 冻结下**出现了**文件——就会被**拒绝**，只回一句
  `gate-freeze:` 且**不写证据**。一个**没有快照**的已知 loop（旧构建打开的）同样拒绝，并给出「开一个**新**
  loop」的修复；observer 的 re-arm 会把冻结**收养**进这种 loop，使它不会永远拒绝。每条 **gate** 证据行都会
  声明 `gateFreeze`：绑定到带快照的 loop 时为 `"frozen"`，只有绑定到**未知** loop 时才为 `"unfrozen"`
  （这样的证据永远不能被真正的 loop 引用）；probe 行不带 gate 冻结。已声明边界：冻结是这一个文件的字节身份，
  不是签名——它约束**何时**允许文件改变，不认证**是谁**写的。
- **文件有多诚实取决于项目自己。** 它可以把某个 gate id 指向任何命令；插件欠你的是**证据点名生效命令**，
  让读者看得到实际跑的是什么。**不要**在本仓库根目录留下 `mpd-gates.json`（测试与探针都在临时目录里创建
  它）：文件从调用 session 的 workspace 解析，一个漏下的文件会悄悄覆盖本仓库自己的 gate。

## 已撤销的两道守卫（记录，而非安装）

本包围绕的两道守卫都装在同一次 `tools.guard` 安装里，而用户 2026-10-17 的裁决把它移除了
（`.mpd/plans/harness-021-rollback.md`，R1）。下面写的是它们**曾经做过**什么，措辞保证没有一句读起来像"仍然生效"：

- **队长的写入门**过去会对**顶层** mpd agent 的 `write`、`edit`、`mpd_hashline_edit`、`mcp__ast_grep__rewrite`
  与 `mcp__ast_grep__scan` 在**代码**路径上拒绝，而 `*.md`、`LICENSE*` 以及 `.mpd/`、`docs/`、`evidence/`、
  `agent-references/` 之下始终可写，好让手册、PR 正文与验证记录永远写得进去。**如今没有任何东西拒绝这次写入**
  —— 队长直接持有整套工具，而 loop / 被计数的 escape / 委派这几条路径保留下来，是**记账**，不是唯一入口。
- **「唯一 git 写者」规则现在只是约定（prose）。** 同一次安装过去会**拒绝**非队长 session 的 git 写命令；
  匹配器随 hook 一起移除，因此下面这份清单是本仓库仍然自我约束的**规则** —— `commit`、`add`、`rm`、
  `mv`、`checkout`、`switch`、`restore`、`reset`、`stash`、`merge`、`branch`、`rebase`、`tag`、
  `cherry-pick`、`revert`、`clean`、`apply`、`am`、`update-index`、`worktree`、`init`、`clone`
  （AGENTS.md §5 写明该规则、实测历史与撤销事实）。只读 git 对所有人开放。它的执行靠**派工契约** ——
  成员改文件、跑 gate，队长提交 —— 加上评审，而不是靠匹配器。
- **verifier 信封同样只是约定（prose）**：不许 shell、不许会回传源码的工具、不许一切看板变更（`mpd_verify_*`
  工具除外 —— 那正是席位的职责），blind 阶段读取被限定在冻结文档与文档带之内，写入限定在 `.mpd/verify/**`，
  已记录的 FAIL 为**诊断**解锁实现读取。`mpd_verify_seat` 仍然**记录**席位、裁决仍然可审计，但没有任何东西
  围栏席位，也没有任何东西**观测**它的读取：观测日志由已被撤销的 guard 写入，因此在所有已发布组合中日志都是空的、
  每个基础都读作 `blind`，`blind-spent` 拒绝也无法被证据触发。未证明的基础一律视为 UNVERIFIED。

## 记录

```jsonc
{ "version": 1, "recordId": "…", "loopId": "…", "taskId": null, "workspace": "…",
  "writerId": "…", "verifierId": "…",
  "basis": { "kind": "blind", "frozenContract": {"path":"…","sha256":"…"}, "docs": [], "probe": [] },
  "sources": [], "gateEvidence": [], "verdict": "PASS", "findings": [],
  "unlockedReads": [], "createdAt": "…" }
```

校验器的每条拒绝都有自己的 reason 字符串：`same-agent`、`no-doc-sources`、`no-gate-evidence`、`forged-evidence`、`bind-unproven`、`fail-without-findings`、`finding-without-basis`、`blind-spent`、`unknown-loop`、`pre-plugin-unlocked`、`pre-plugin-unattested`、`post-install-claim`。

## 配置

通过 config 服务**原样**读取（不走 settings schema——本 row 不应推动被钉住的 knob 计数）：`verify.mode`（默认 `hard` | `advisory` | `off` —— 自 guard 撤销起**失效**：已没有任何东西会拒绝写入，该值只作为启动行的 `mode=` 报告）、`verify.escapeUses`（默认 1）、`verify.loopTtlMs`（默认 24 小时）、`verify.gateTimeoutMs`（默认 15 分钟）、`verify.dir`。

## 边界（明示，而非暗示）

1. 在目前所有已发布的组合中，本 row 都只是**纯记账**，因为该 guard 已被撤销：`mpd-roles` 的启动行报告 `verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)`。缺少 harness 的 `tools.guard` seam 时，退化原因不同、结果一样。**本 row 自己的启动行只报 SEAM，并且行内就把话说清**：它打印 `verifySeam=present|absent`，并附带 `(the harness tools.guard SEAM — NOT an installed gate: the write guard is WITHDRAWN; the mpd-roles row reports its own state)` 这一句，且**绝不**打印 `verifyGate=`。两行度量的是两件不同的事，因此刻意使用两个不同的 token —— 需要 guard 状态就读 `mpd-roles`，只读本行的人也不可能把 seam 误当成安装。
2. 插件若通过自己的私有路径拉起 delegate，本 bundle 不会为它施加 persona 或只读 deny —— 那份纪律如今由插件自己负责。两种情况下都**没有**任何东西拒绝**队长**的写入。
3. gate 的 `tail` 可能打印源码片段：那是**受控的黑盒证据**，不是「什么都没读」的证明。盲性如今**不再被观测** —— 过去证明它的日志由已被撤销的 guard 写入 —— 因此未证明的基础一律视为 UNVERIFIED，而不是既成事实。
4. 队长如今可以**直接**写代码路径（不需要 loop，也不需要 escape）；被计数的 escape 与 self-writer loop 仍然可用，且照样被记录、被计数 —— 这正是「被计数」的含义：它们是记账，不是闸门。
5. `.mpd/**` 永远可写，因此代码形状的内容可以藏在里面——此边界受限于 `.mpd/` 是被 gitignore 的运行时状态、不可能发布出去。
6. **观察日志是按进程的，如今也失效了。** 它在内存里，而席位的 `unlocked` 标志是持久化的，因此在**更早的进程**里做过的一次读取从不可能阻止后来的 PASS。guard 撤销后已没有任何东西写入该日志，所以这条边界属于历史：每个席位都读作 `blind`，任何进程里都没有读取被观测到。
7. **绑定验证员在盲态下可以读 `evidence/**` 与每个 `packages/*/README.md`（含 `.zh-CN` 对照）** —— 这两处在修好之前是被拒的，导致裁决只能依赖产物的存在/size/sha256 而不是内容。该可读带只是**约定（prose），不是栅栏**：没有任何已发布的 row 安装 `installVerifyGuard`，因此没有任何东西拒绝 `packages/*/src/**`、`packages/*/test/**` 或含 `..` 的拼写 —— 席位遵守这条带，是因为纪律如此要求，这正是边界 1 的要旨。`evidence/**` 里的产物**可能内嵌源码帧**（闸门日志尾部），所以读它是**受控黑盒证据**——这正是边界 3 已经写明的那件事。
8. **same-agent 拒绝比较的是字符串。** 当 `writerId === verifierId` 时 `mpd_verify_record` 拒绝；`writer_id` 是调用者写下的值，而它保存的 verifier id 是**调用 session** 的 id。点名真实写作者（cell 里某个成员的 session id）让这条规则在 cell 打开的每条 loop 上真正有意义——但它从不保证不可伪造。
9. **项目声明的 gate 有多诚实，取决于项目的 `mpd-gates.json`。** 该文件可以把某个 gate id 指向任何命令；插件承诺的是**证据点名生效命令**，而不是命令的质量。固定表为文件**没有声明**的每个 id 提供条目——这是**按 id 逐个**的回退，文件不存在时就是全部 id。冻结自身的边界：每条 loop 对一个文件的字节身份，绝不是签名，因此它约束的是**何时**允许文件改变，而不是**谁**写的。
