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

- **`mpd_verify_open`** —— 开一个「委派 + 验证」loop。`writer:"self"`（被计数的路径：没有 `self_write_reason` 且没有一个**不同的** `verifier` 就会拒绝）或 `writer:"delegate"`（由成员来写）。`scope` 为空表示覆盖整个工作区。可选参数 **`contract`** 点名本波自己的冻结契约（工作区相对路径）并被**记录到该 loop 上**；不传时 loop 保留一个**已声明**的默认值（`AGENTS.md`），**绝不会是别的波次的计划文件**。
- **`mpd_verify_escape`** —— **被计数的**逃生口：一行 JSONL、一行启动日志、一次允许的写入。`reason` 为空会拒绝；日志写不下去时不发放任何额度。
- **`mpd_verify_seat`** —— 把调用方 session 绑定为某 loop 的 **verifier**。幂等；当调用方就是该 loop 的 writer 时拒绝。该席位的冻结文档就是**这个 loop 自己的 `contract`**，由**同一个函数**解析，席位与记录都调它，因此一份裁决的 `docPaths` 与它的 `basis.frozenContract` **不可能对不上**。
- **`mpd_verify_evidence`** —— `kind:"gate"` 只跑固定表里的一个 id（`gates`、`tests`、`typecheck`、`docs`、`manifest`、`comments`、`rows`、`vendor`、`dist`、`pack`）并写日志；`kind:"probe"` 对每个路径返回 `{path, exists, bytes, sha256, mtime}`，**绝不返回内容**。
- **`mpd_verify_record`** —— 通过校验器记录裁决。**PASS** 必须给出所依据的文档、至少一项 gate 证据，以及可证明的 blind basis；**FAIL** 必须给出 finding（每条都要有证明它的 `doc_source`），并会开出 repair 任务、解锁诊断读取。**盲性按观察日志判定，而不是按解锁标志**：记过 FAIL 的席位，只要日志里**没有「被准入的」实现读取**，仍然可以记 PASS；反之则以 `blind-spent` 拒绝并**点名那条路径**。只有**被准入**的读取才耗尽基础，被信封**拒绝**的尝试不耗尽——这正是让"证明该带拒读 `src/**`"不会花掉 PASS 所需基础的原因。

## 两道守卫

队长规则对本工作区的**顶层** mpd agent 拦截 `write`、`edit`、`mpd_hashline_edit`、`mcp__ast_grep__rewrite` 和 `mcp__ast_grep__scan`。以下路径**无需任何 loop** 即可写：`*.md`、`LICENSE*`，以及 `.mpd/`、`docs/`、`evidence/`、`agent-references/` 之下——手册、PR 正文和验证记录**绝不能**被拦住。其余一律视为**代码**（fail-closed：未识别的扩展名算代码，工作区之外的绝对路径也算）。

代码写入只能通过三种途径之一被允许：已 armed 的 loop、被计数的 escape、或一次委派。**子 session**（成员、subagent、workflow worker、ralph 轮次）永远不是队长：代码本来就该由它们来写。

同一处安装还让 AGENTS.md §5 的**「唯一 git 写者」**规则变成机械的：不是本工作区顶层队长的 session，不得执行 git **写**命令（`commit`、`add`、`rm`、`mv`、`checkout`、`switch`、`restore`、`reset`、`stash`、`merge`、`branch`、`rebase`、`tag`、`cherry-pick`、`revert`、`clean`、`apply`、`am`、`update-index`、`worktree`、`init`、`clone`、`push`、`fetch`、`pull`、`reflog`）。只读 git（`status`、`log`、`diff`、`show`、`grep`、`ls-files`、`rev-parse`、`merge-base`、`describe`、`blame` 等）对所有人开放；只是**提到** git 的命令——提交信息 heredoc、`echo "git commit"`、对字符串做 `grep`——都不会被拒。**明示边界**：匹配器读的是命令字符串，因此被混淆的调用（`g"it" commit`、`sh -c "$X"`）可以绕过；它是让规则在日常使用中真正生效的减速带，绝不是沙箱。

verifier 信封直接拒绝 shell、会回传源码的工具以及一切看板变更，把写入限制在 `.mpd/verify/**`，并在 seat 仍处于 blind 阶段时把 `read`/`glob`/`grep` 限制在冻结文档、`.mpd/plans/`、`docs/`、`agent-references/` 与 `.mpd/verify/` 之内。已记录的 **FAIL** 会为诊断解锁实现读取，且**计入计数**。

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
2. 插件若通过自己的私有路径拉起 delegate，则不会被自动 armed——队长的写入仍然被拒。
3. gate 的 `tail` 可能打印源码片段：那是**受控的黑盒证据**，不是「什么都没读」的证明。blind 与否由插件自身的观测日志证明。
4. 队长仍可通过被计数的 escape 或 self-writer loop 写代码。两者都会被记录、被计数——这正是「被计数」的含义。
5. `.mpd/**` 永远可写，因此代码形状的内容可以藏在里面——此边界受限于 `.mpd/` 是被 gitignore 的运行时状态、不可能发布出去。
6. **观察日志是按进程的。** 它在内存里，而席位的 `unlocked` 标志是持久化的；因此在**更早的进程**里做过的一次读取**无法**阻止后来的 PASS。上面那条规则的作用域正是"按进程"，且这条边界写在法条**自己的源码正文**里，而不是靠暗示。
7. **绑定验证员在盲态下可以读 `evidence/**` 与每个 `packages/*/README.md`（含 `.zh-CN` 对照）** —— 这两处在修好之前是被拒的，导致裁决只能依赖产物的存在/size/sha256 而不是内容。该可读带**仍然**拒绝 `packages/*/src/**`、`packages/*/test/**` 以及任何含 `..` 的拼写。`evidence/**` 里的产物**可能内嵌源码帧**（闸门日志尾部），所以读它是**受控黑盒证据**——这正是边界 3 已经写明的那件事。
