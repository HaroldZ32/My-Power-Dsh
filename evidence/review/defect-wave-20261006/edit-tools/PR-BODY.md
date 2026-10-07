## English

### What this fixes

Eight defects in the tool/state plane. The two that matter most are both **silent in both directions**,
which is why they survived every gate:

**E1 — the write guard probed the wrong root.** `packages/mpd-tools-plugin/src/index.ts#apply` ran
`existsSync`/`readFileSync` on the model-supplied `file_path` with no resolution, i.e. against the dsh
**process cwd** instead of the calling session's workspace. Launch dsh from a directory that is not the
session workspace and a clobber the guard exists to prevent goes through, while an honest CREATE is
denied with *"target file already exists with different content"* — and both look like normal
behaviour. The sibling `mpd-hashline` guard was already repaired for exactly this class and pinned by
its own test; `mpd-tools` never was.

**E2 — the truncation budget could INFLATE the output.** `text.slice(-Math.floor(budget * 0.3))` returns
**the entire input** when the tail length floors to 0, because `-0 === 0` makes it `slice(0)`. A 74-char
banner puts the window at `truncateMaxBytes` 75–77, so a 100 000-char result came back as ~100 074 chars
for a 77-char budget — the token-budget protection the row exists to provide, defeated by a
user-settable config value. The package's own test asserted the exact invariant that broke but sampled
only 128/256/512/1024/4096.

### Findings (8)

| # | Severity | Defect |
|---|---|---|
| E1 | med | the write guard resolved a relative `file_path` against the process cwd, not the session workspace |
| E2 | med | the truncation tail slice could return the whole input (`-0 === 0`) |
| E3 | med | the unified-diff hunk header was off by one whenever the hunk included the file's line 0 |
| E4 | low | `mpd_hashline_read`/`_format` counted a line that does not exist, disagreeing with `#editFile` |
| E5 | low | the CRLF/BOM envelope helpers were exported and never called — an anchored edit stripped them |
| E6 | low | `mpd_memory_reflect_complete` had no precondition, so it could strand the reflection counters |
| E7 | low | `mpd_boulder_plan_progress` ignored the session root and answered silent zeros for a bad path |
| E8 | low | the comment-checker's `autoCheck` read a relative path against cwd — E1's class, another row |

### Measured evidence

`evidence/review/defect-wave-20261006/edit-tools/VERIFICATION.md`, re-measured on the branch tip after
the writers stopped:

| Check | Observed |
|---|---|
| `bun test` (tools / hashline / memory / boulder / comment-checker) | **10 / 14 / 5 / 7 / 1 — 37 pass, 0 fail** |
| `node scripts/verify-dist-fresh.ts` | `ok: 29/29 targets fresh (rebuilt twice, byte-identical)` |
| `bun run verify:comments` | `VERDICT: PASS` |
| `node scripts/verify-rows-parity.ts` | `ok: 33 row ids` |
| `bun run verify:docs` | `pairs=45 failed=0 violations=0 dead=0` — PASS |
| `bun run typecheck` | **0 errors added** — the 4 in `skills/programming/**` are pre-existing (branch 3) |

**Every one of E1–E8 was re-proved by temporarily reverting its fix**, capturing the failing assertion,
restoring the fix byte-for-byte (verified with `diff` against a pre-revert snapshot) and re-running to
green. Two representative REDs:

```
E1  Expected to contain: "use the edit tool"   Received: ""          (the clobber passed silently)
E2  maxBytes=75   Expected: <= 75   Received: 100074
```

### Honest bounds

- **E8's second arm is DERIVED, not observed.** The test asserts arm 1 first, so arm 2 is unreachable in
  a failing run; it was driven separately through the real tool path. Recorded as such rather than
  implied green.
- **E5's BOM arm** and **E7's report arm** have the same short-circuit shape and were likewise driven
  through the real tool path with throwaway probes (since removed).
- `verify-vendor` cannot run on this machine (no `MPD_UPSTREAM_ROOT` upstream checkout) — an environment
  prerequisite, not a code defect.
- **Toolchain note**: `verify-dist-fresh.ts` compares against the PINNED toolchain. PATH bun here is
  **1.4.2** and renders the committed dists STALE; the pinned **1.4.0** is `.toolchain/bun/bin/bun`.
  Every rebuild used it.

### Process notes, stated plainly

- A **previous writer was interrupted mid-run**; its edits were already on disk when the verifying writer
  started. They were treated as claims, not facts: every fix was reverted and re-proved from scratch.
  That writer's diff is preserved as `interrupted-run.patch` beside the record.
- That run left `bun run verify:comments` — a standing, user-mandated gate — **RED with 6 violations**,
  all in its own new tests. The verifying writer completed them; the gate is green on this commit.
- `skills/**` was not touched, no adapter change was needed, and the test file set is exactly the
  interrupted patch's plus the evidence record.

---

## 简体中文

### 本 PR 修了什么

工具/状态平面的 8 个缺陷。最要命的两个都是**两个方向都静默**，所以它们躲过了此前所有闸门：

**E1——写保护探测了错误的根。** `packages/mpd-tools-plugin/src/index.ts#apply` 对模型给的 `file_path` 直接
`existsSync`/`readFileSync`，即按 dsh **进程 cwd** 而不是调用会话的 workspace 解析。只要从一个不等于会话 workspace
的目录启动 dsh，保护本该拦下的覆盖就会放行；而一次诚实的 CREATE 会被以「目标文件已存在且内容不同」拒绝——两个方向看起来
都像正常行为。姊妹行 `mpd-hashline` 早就为同一类问题修好并有测试钉住，`mpd-tools` 一直没修。

**E2——截断预算反而把输出放大。** `text.slice(-Math.floor(budget * 0.3))`：当尾部长度向下取整为 0 时 `-0 === 0`，
于是变成 `slice(0)`——**整个输入**。74 字符的 banner 会把窗口落在 `truncateMaxBytes` 75–77：一个 100,000 字符的结果
在 77 字符预算下返回约 100,074 字符。这行存在的意义就是 token 预算保护，却被一个用户可改的配置值打穿。包自己的测试断言的
正是这条被破坏的不变量，但只采样了 128/256/512/1024/4096。

### 缺陷清单（8 条）

| # | 级别 | 缺陷 |
|---|---|---|
| E1 | med | 写保护按进程 cwd 而非会话 workspace 解析相对 `file_path` |
| E2 | med | 截断尾切片可能返回整个输入（`-0 === 0`） |
| E3 | med | 当 hunk 覆盖文件第 0 行时，unified-diff 头偏移一行 |
| E4 | low | `mpd_hashline_read`/`_format` 多算一行，与 `#editFile` 不一致 |
| E5 | low | CRLF/BOM 信封函数导出却从未调用——anchored edit 把它们剥掉了 |
| E6 | low | `mpd_memory_reflect_complete` 无前置条件，可能把反思计数器卡死 |
| E7 | low | `mpd_boulder_plan_progress` 忽略会话根，坏路径答静默零 |
| E8 | low | comment-checker 的 `autoCheck` 按 cwd 读相对路径——E1 同类，另一行 |

### 实测证据

`evidence/review/defect-wave-20261006/edit-tools/VERIFICATION.md`，写手停止后在分支尖端重新测量：

| 检查 | 实测 |
|---|---|
| `bun test`（tools / hashline / memory / boulder / comment-checker） | **10 / 14 / 5 / 7 / 1 —— 37 pass，0 fail** |
| `node scripts/verify-dist-fresh.ts` | `ok: 29/29 targets fresh`（各重建两次，字节一致） |
| `bun run verify:comments` | `VERDICT: PASS` |
| `node scripts/verify-rows-parity.ts` | `ok: 33 row ids` |
| `bun run verify:docs` | `pairs=45 failed=0 violations=0 dead=0` PASS |
| `bun run typecheck` | **新增 0 个错误**——`skills/programming/**` 的 4 个是既有问题（在分支 3 修） |

**E1–E8 每一条都通过「临时回退该修复」重新证明过**：抓到失败断言、把修复逐字节还原（用 `diff` 对照回退前快照验证）、
再跑一次到绿。两条代表性的 RED：

```
E1  Expected to contain: "use the edit tool"   Received: ""          （覆盖被静默放行）
E2  maxBytes=75   Expected: <= 75   Received: 100074
```

### 诚实的边界

- **E8 的第二条 arm 是「推导」而非「观测」**：测试先断言 arm 1，失败运行时 arm 2 根本到不了；它是另外通过真实工具路径驱动的。
  已如实记录，而不是当成绿的。
- **E5 的 BOM arm** 与 **E7 的 report arm** 有同样短路形状，也各自通过真实工具路径以一次性探针驱动（已清理）。
- 本机无法运行 `verify-vendor`（没有 `MPD_UPSTREAM_ROOT` upstream checkout）——环境前置条件，不是代码缺陷。
- **工具链提醒**：`verify-dist-fresh.ts` 与**钉住的**工具链比对。本机 PATH 的 bun 是 **1.4.2**，会把已提交的 dist 判为 STALE；
  钉住的 **1.4.0** 在 `.toolchain/bun/bin/bun`。本次全部重建都用了它。

### 过程说明（直说）

- **前一个写手被中途打断**，验证写手接手时它的改动已在磁盘上。这些改动被当作「待验证的主张」而非事实：每条修复都回退并从零重证。
  那份 diff 以 `interrupted-run.patch` 保留在证据记录旁。
- 那次中断留下 `bun run verify:comments`——一条长期、用户指定的闸门——**红灯 6 处违规**，全部在它自己新增的测试里。
  验证写手补齐了；本提交上该闸门为绿。
- 未触碰 `skills/**`，无需改 adapter；测试文件集恰为中断补丁的文件集加上证据记录。
