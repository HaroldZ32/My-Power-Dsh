## English

### What this fixes

The team plane's **preserving hold did not gate dispatch**. The watchdog filed its hold under the
OFFICIAL team identity (the Lead Session id, from `dsh.teamLiveTeams()` → `team.ts#projectTeamView`),
while `agent_teams_dispatch` asked for it under the MPD id minted by `team-store.ts#newTeamId`
(`team-<stamp>`). Two id spaces, one lookup — the lookup missed, `readWatchdogHold` answered
`{ state: "free" }`, and a pass dispatched into a team the watchdog had deliberately parked. That is
exactly what a preserving hold exists to prevent, and the code's own comment claimed both holds stop a
pass.

It could ship because the unit double was **argument-blind**: `isHeld: () => ({...})` answered `held`
to whatever id it was handed, so no test could observe the drift.

**The coupled design decision.** The MPD team record is the AUTHORITATIVE team plane (AGENTS.md §1).
`team.ts#readTeams` now reads `mpdTeams.list(workspace)` first and keeps `dsh.teamLiveTeams()` as the
fallback — deliberately NOT unioned, because one team present on both planes would be reported twice
under two ids. `projectMpdTeam` sets the record's `id` to the mpd `teamId`, so the id a hold is FILED
under is the same id the gate ASKS about.

The same root made **two shipped features inert on the default (native) executor**: the adapter's
`teamExecutor()` selects `native` by default, a native team is never registered with the official
service, so the official-only fold returned `[]` — the watchdog's whole WARN → ESCALATE → hold ladder
and the compaction pass iterated over **zero teams**. Both now read the mpd record.

### Findings (7)

| # | Severity | Defect |
|---|---|---|
| T1 | **high** | the hold's two id spaces — the preserving hold was invisible to the dispatcher |
| T2 | med | `agent_teams_dispatch` rewrote the whole team record from a stale snapshot, no CAS — a concurrent claim was silently reverted |
| T3 | med | the watchdog watched the official plane only → inert on the native default |
| T4 | med | compaction was blind for the same reason → it could never fire |
| T5 | med (security) | `plan-store.ts#stagingPath`/`#contractPath` concatenated an unsanitised id, and `sessionId` arrives from the web route's query string — a traversal-shaped id escaped `.mpd/team` on READ and WRITE |
| T6 | low | a non-finite watermark was persisted as `null` |
| T7 | med | **found by this branch's own review, not in the original 23** — the dispatch LEDGER had T2's mechanism 60 lines away in the same file |

T7 is included on the captain's ruling: fixing T2 in one file while leaving an identical race in the
same file would not survive review. It is **contract-preserving** — the tool's output shape is
unchanged; the final ledger write became a merge against a fresh read, and `writeLedger` became atomic.

### Measured evidence

`evidence/review/defect-wave-20261006/team-plane/VERIFICATION.md`, re-measured on the branch tip
**after** the writers stopped:

| Check | Observed |
|---|---|
| `bun test packages/mpd-team-core-plugin` | **124 pass / 0 fail** |
| `bun test packages/mpd-team-watchdog-plugin` | **152 pass / 0 fail** |
| `bun test packages/mpd-team-compact-plugin` | **23 pass / 0 fail** |
| `node scripts/verify-dist-fresh.ts` | `ok: 29/29 targets fresh (rebuilt twice, byte-identical)` |
| `bun run verify:comments` | `VERDICT: PASS` (395 files, 32 406 declarations) |
| `node scripts/verify-rows-parity.ts` | `ok: 33 row ids` |
| `bun run verify:docs` | `failed=0 violations=0` PASS |
| `bun run typecheck` | **0 errors added** — the 4 in `skills/programming/**` are pre-existing (branch 3) |

Every fix was driven **PIN → RED → GREEN**, with the failing assertion quoted before the fix — e.g. T7:
`expect(Object.keys(ledger).sort()).toEqual(["T3"])` → `Received ["T1","T3"]`, with the two preceding
assertions already green, which is what proves the concurrent release landed INSIDE the await.

### Honest bounds

- **T4 runtime residual**: compaction of a *native* teammate depends on `dsh.liveAgent(executorRef)`
  resolving the continuable child id. Not verified here — it degrades honestly to `skipped-not-live`.
- **T7 residual**: cross-PROCESS last-writer-wins on `.mpd/team/dispatch.json` is not covered; T7
  closes the in-process async window only.
- `bun run verify:gates` is red **only** on `verify-vendor`, which needs an upstream checkout
  (`MPD_UPSTREAM_ROOT`) that does not exist on this machine. That is an environment prerequisite, not a
  code defect, and it is the only member that reddens the aggregate here.
- **Build trap worth knowing**: `verify-dist-fresh.ts` compares against the PINNED toolchain. PATH bun
  here is **1.4.2** and renders the committed dists STALE; the pinned **1.4.0** lives at
  `.toolchain/bun/bin/bun`. Every rebuild used it — that is why `29/29` is the reading.

### Notes for the reviewer

- No adapter edit was needed, so there is **no dist fan-out**: nothing imports this package's `src`
  at runtime.
- README pairs (EN + zh-CN) were updated where behaviour changed.

---

## 简体中文

### 本 PR 修了什么

**团队平面的 preserving hold 实际上没有拦住派发。** watchdog 把 hold 记在 OFFICIAL 团队标识下（Lead Session id，来自
`dsh.teamLiveTeams()` → `team.ts#projectTeamView`），而 `agent_teams_dispatch` 用 `team-store.ts#newTeamId`
铸造的 MPD 标识（`team-<stamp>`）去查。两个 id 空间、一次查找：查找落空，`readWatchdogHold` 答 `{ state: "free" }`，
于是派发照样进了那个 watchdog 已经停住的团队——这正是 preserving hold 存在的意义，而代码自己的注释还声称两个 hold
都能拦住一次派发。

它能上线，是因为单测替身是**盲的**：`isHeld: () => ({...})` 对任何 id 都答 `held`，没有测试能观察到这个漂移。

**耦合的设计决定。** MPD 团队记录才是权威团队平面（AGENTS.md §1）。`team.ts#readTeams` 现在优先读
`mpdTeams.list(workspace)`，保留 `dsh.teamLiveTeams()` 作为回退——刻意**不**取并集，否则同时在两个平面上的同一支团队会
以两个 id 被报告两次。`projectMpdTeam` 把记录的 `id` 设为 mpd 的 `teamId`，于是 hold **写入**用的 id 与闸门**查询**用的 id
终于一致。

同一根因还让**默认（native）执行器下两个已交付功能完全空转**：adapter 的 `teamExecutor()` 默认选 `native`，native 团队从不注册到
official 服务，因此只看 official 的折叠返回 `[]`——watchdog 的 WARN → ESCALATE → hold 整条阶梯、以及压缩 pass，都在**零支团队**
上迭代。现在两者都读 mpd 记录。

### 缺陷清单（7 条）

| # | 级别 | 缺陷 |
|---|---|---|
| T1 | **high** | hold 的两个 id 空间——preserving hold 对派发方不可见 |
| T2 | med | `agent_teams_dispatch` 用旧快照整体回写团队记录，无 CAS——并发 claim 被静默回滚 |
| T3 | med | watchdog 只读 official 平面 → 在 native 默认执行器下空转 |
| T4 | med | 压缩同一原因变盲 → 永远不可能触发 |
| T5 | med（安全） | `plan-store.ts#stagingPath`/`#contractPath` 拼接未净化的 id，而 `sessionId` 来自 web 路由 query string——构造遍历形状的 id 可在**读**与**写**两侧逃出 `.mpd/team` |
| T6 | low | 非有限 watermark 被持久化成 `null` |
| T7 | med | **本分支自查发现，不在原 23 条内**——派发 LEDGER 在同一文件 60 行外有 T2 同款竞态 |

T7 由 captain 裁定纳入：在同一个文件里修掉 T2 却留着同款竞态，过不了评审。它**不改变契约**——工具输出形状不变，最终 ledger
写入改为对一次新读的合并，`writeLedger` 改为原子写。

### 实测证据

`evidence/review/defect-wave-20261006/team-plane/VERIFICATION.md`，**在写手停止之后**由 captain 在分支尖端重新测量：

| 检查 | 实测 |
|---|---|
| `bun test packages/mpd-team-core-plugin` | **124 pass / 0 fail** |
| `bun test packages/mpd-team-watchdog-plugin` | **152 pass / 0 fail** |
| `bun test packages/mpd-team-compact-plugin` | **23 pass / 0 fail** |
| `node scripts/verify-dist-fresh.ts` | `ok: 29/29 targets fresh`（各重建两次，字节一致） |
| `bun run verify:comments` | `VERDICT: PASS`（395 文件 / 32,406 声明） |
| `node scripts/verify-rows-parity.ts` | `ok: 33 row ids` |
| `bun run verify:docs` | `failed=0 violations=0` PASS |
| `bun run typecheck` | **新增 0 个错误**——`skills/programming/**` 的 4 个是既有问题（在分支 3 修） |

每条修复都走 **PIN → RED → GREEN**，并在修复前引用了失败断言。例如 T7：
`expect(Object.keys(ledger).sort()).toEqual(["T3"])` → `Received ["T1","T3"]`，且其前两条断言已经为绿——这正是
「并发 release 确实落在了 await 之内」的证明。

### 诚实的边界

- **T4 运行时残留**：native teammate 的压缩依赖 `dsh.liveAgent(executorRef)` 能否解析到 continuable 子 id。此处**未验证**——
  它会诚实地退化为 `skipped-not-live`。
- **T7 残留**：`.mpd/team/dispatch.json` 的**跨进程** last-writer-wins 未覆盖；T7 只关掉了进程内的 async 窗口。
- 本机 `bun run verify:gates` 只因 `verify-vendor` 红——它需要一台 `MPD_UPSTREAM_ROOT` upstream checkout，这台机器上没有。
  那是环境前置条件，不是代码缺陷，也是这里唯一让聚合门变红的成员。
- **值得知道的构建陷阱**：`verify-dist-fresh.ts` 与**钉住的**工具链比对。本机 PATH 上的 bun 是 **1.4.2**，会把已提交的 dist 判为
  STALE；钉住的 **1.4.0** 在 `.toolchain/bun/bin/bun`。本次全部重建都用了它——`29/29` 就是这么来的。

### 给评审的说明

- 不需要改 adapter，因此**没有 dist 扇出**：运行时没有任何东西 import 本包的 `src`。
- 行为有变的地方，README 中英双语成对更新。
