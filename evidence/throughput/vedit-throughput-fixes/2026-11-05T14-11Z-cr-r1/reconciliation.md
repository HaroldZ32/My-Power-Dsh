## CodeRabbit round 1 — reconciliation (all 14 findings) / 第一轮逐条对账

Every finding was verified against the current code: **14 / 14 are STILL VALID and FIXED**, none stale,
none declined. Repair commit: `ccec1861`. Both languages below; the table is language-neutral.

| # | File:line | Severity | Status | What changed (symbol) |
|---|---|---|---|---|
| 1 | `packages/mpd-autoproject-plugin/src/engine.ts:90` | Major | **FIXED** | `consult()` now treats the roster supervisor as the ONE deadline owner: when `slotBoundMs` fires it asks `mpd_role_consult {action:"list"}`; a running consult of the role means the supervisor still owns the child (it may be exempting an open bash), so the engine re-arms instead of aborting. `autoproject.slotBoundMs` changes the CHECK interval, never the child's deadline. New test proves a supervised child is not aborted; README (EN+zh) describes the contract. |
| 2 | `packages/mpd-dsh-adapter-plugin/src/index.ts:493` | Trivial | **FIXED** | `DshAsyncAgent` / `spawnAgentAsync` doc comments: a child failure remains a REJECTED result propagated after activation disposal; only teardown failures are swallowed. |
| 3 | `packages/mpd-dsh-adapter-plugin/src/index.ts:3814` | Major | **FIXED** | `activationHandleOf(raw, subagents, parent)` — both call sites pass `spec.parent`; the interrupt sends `{kind:"ancestor", agent:parent}` and falls back to `raw.abort()` on a throw, an async rejection, a missing seam, or no child id. Three new tests. |
| 4 | `packages/mpd-roles-plugin/README.md:353` | Trivial | **FIXED** | "eight-name" → "ten-name" and the boot-line example `deny=8` → `deny=10`, in both README files. |
| 5 | `packages/mpd-roles-plugin/src/complexity-gate.ts:1111` | Minor | **FIXED** | `writeReTeamState` writes a UUID-named temp file in the destination directory and renames it over the target; the injected `opts.writeFile` seam is untouched; a failed write unlinks the temp and returns false through the existing catch. |
| 6 | `packages/mpd-roles-plugin/src/index.ts:1099` | Trivial | **FIXED** | The blocking `mpd_role_spawn` releases its supervisor record after the report (or the settle error) via `try/finally` + `consultSupervisor.collect`; running consults stay listed until settled. |
| 7 | `packages/mpd-roles-plugin/src/session-gate.ts:329` | Minor | **FIXED** | `reTeamStates` is now `Map<string, Promise<ReTeamState>>`; the in-flight load promise is stored before the first await and `saveReTeamState` stores `Promise.resolve(state)`, so concurrent callers share one mutable record. |
| 8 | `packages/mpd-roles-plugin/src/session-gate.ts:789` | Major | **FIXED** | The settled/bound check now requires ownership: `teamIdAtFire` matches a terminal team, or a terminal record's `endedAt` is after `lastFiredAt` (new `terminalEndedAt` plumbed through `readLeadingTeam`). Two tests: a stale ended sibling keeps the session settled; a post-fire ending re-arms. |
| 9 | `packages/mpd-roles-plugin/src/session-gate.ts:859` | Minor | **FIXED** | The staging path re-checks `firing.has(stateKey)` synchronously immediately before `firing.add`; `fireReTeam` acquires the guard before its first await and holds it across stage+settlement+notice in one `try/finally`. |
| 10 | `packages/mpd-roles-plugin/src/spawn-async.ts:326` | Minor | **FIXED** | `ConsultRecord.held` (false at creation, true right after `acquire()`); `finish`/`failRecord` release only when `held && !released`. New cap-1 test: cancelling a queued consult starts no new child. |
| 11 | `packages/mpd-roles-plugin/src/spawn-async.ts:543` | Trivial | **FIXED** | `wait` now carries `error: record.failure` in both failed branches; return type widened to include `ConsultOutcome`. New test asserts `wait` and `collect` return the same failure text. |
| 12 | `packages/mpd-team-core-plugin/src/team-actions.ts:2094` | Minor (**security**) | **FIXED** | `forceWedgedTask` refuses a caller that is not the team lead via `recordNamesLead(record, [caller.sessionId, ...caller.lineage])`, before any write or interrupt; the missing-record handling is unchanged. New test: a non-lead live session is refused. |
| 13 | `packages/mpd-team-core-plugin/src/team-actions.ts:2181` | Major | **FIXED** | Re-read before the interrupt (row must still be `in_progress`, same owner via `memberNamedBy`, `attemptId` must equal the row revision when present), and re-read AFTER the interrupt so `updateTeamTask` receives the fresh record. Two concurrency tests (reassigned row not forced; a write during the interrupt survives). |
| 14 | `packages/mpd-team-watchdog-plugin/src/machine.ts:681` | Minor | **FIXED** | The already-forced branch in `observeWedge` now returns false, so the WARN/ESCALATE/hold ladder runs after a non-retryable force failure; successful forces (new revision) and retryable failures (key removed) are unchanged. Two new tests. |

### Gates after the repairs (observed)

`bun test packages` **3607 pass / 0 fail** · `bun run typecheck` exit 0 · `verify:dist-fresh` **34/34
fresh** · `verify:comments` PASS · `verify:docs` PASS (55 pairs, 0 dead links) · `verify:rows` ok 36 ·
`verify:manifest` PASS · `verify:vendor` PASS · `verify:no-host-override` PASS · `verify:manual-paths`
PASS · `preset-conformance --self-test` ok (32 rows, controls 4/4) · `test:qa` all self-tests passed.

### Declared bounds of the repairs

- **[1]** If the roster registry keeps reporting a running consult while its supervision is actually
  dead (e.g. `startActivation` never resolves, so no deadman was armed), the engine defers instead of
  killing. The "no supervision at all" case is still killed at the bound. The registry exposes no
  per-call identity, so a same-role sibling delays a backstop kill — it never aborts a supervised child.
- **[3]** A host that RESOLVES an interrupt without acting is beyond observation; no fallback can
  detect it.
- **[6]** has no dedicated tool-layer test (the supervisor-level behaviour is unchanged and tested).
- **[8]** A clean-terminal record with no `endedAt` yet (auto-end pending) clears the settlement on the
  following pre-step, once the auto-end's `endedAt` exists — deliberate, and the alternative is the
  stale-record re-arm this finding reports.

---

中文摘要：本轮 14 条发现逐条核对，**全部仍然成立、全部已修**，无一条判为过期或拒绝。修复提交
`ccec1861`；修复后本地全门禁重跑（测试 3607 通过 / 0 失败、dist 34/34 新鲜、docs 55 对 0 死链）。
四条 Major 分别是：autoproject 的定时器不再抢在咨询监管者之前中止子代理（监管者成为唯一的截止期
所有者）、adapter 的异步句柄中断改带祖先权限并在失败时回退 `abort`、D1 的结算只在"归属本会话"的终态
团队上解除武装、team-core 的强制动作改为**校验呼叫者是否本队 lead**并做"读—校验—中断—再读"。
