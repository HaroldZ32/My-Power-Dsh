# P2a docs report — the idle-member guard (T7, docs-qa)

**Contract:** `.mpd/plans/team-idle-member-guard.md` §3.1–3.3, §3.5, §5 (docs), §6 (declared bounds) and
§8 (Amendment 1). Branch `fix/team-idle-member-guard`; no git write of any kind (the captain commits).

**Files changed (2 twins, +79 lines):**

| File | Change |
|---|---|
| `packages/mpd-team-core-plugin/README.md` | New `## The idle-member guard — a member with no board task acts` section (before `## Configuration`): the directive and denial literals, the open-task definition, both-sides re-evaluation, the Lead/control-seat/terminal-record exemptions, the assigned-but-unclaimed asymmetry, the spawn preamble, and the per-agent `agent/pre-step` registration. Three new `## Known limits` bullets (process-local mark; a composition without the row; the one-turn spawn bound). |
| `packages/mpd-team-core-plugin/README.zh-CN.md` | The same section and bullets, mirrored; heading tree identical (`## 空闲成员守卫——没有看板任务的成员不得行动` in the same position). |

No other doc carried the promise the contract names (§5: "a member acts only on its task"): a grep of
`docs/*.md` found no such statement, so the README pair is the whole docs surface. No version bump.

## 1. Re-check against the final implementation (symbols, not line numbers)

| Claim in the twins | Final code (`src/idle-guard.ts`, `src/index.ts`) | Verdict |
|---|---|---|
| ONE directive + one denial, with the literal texts | `IDLE_DIRECTIVE_TEXT`, `IDLE_DENIAL_TEXT`, `IDLE_PREAMBLE_TEXT`; the listener injects the directive; `guardTool` returns the denial for a marked session | matches |
| "No OPEN task" = owner is the member name or its executor handle, status `pending`/`claimed`/`in_progress` | `OPEN_TASK_STATUSES`, `memberForSession` (matches `executorRef`), `memberHasOpenTask` (accepts `task.owner === member.name` or `=== member.executorRef`) | matches |
| Re-evaluated BOTH sides at every pre-step; an open task clears the mark | the `listener` calls `clear(sessionId)` on `memberHasOpenTask`, on a control seat, on the Lead, on no live team | matches |
| A terminal record or a session off the roster clears the mark | `findMemberTeam` filters with `isLiveTeamPhase`; a missing record/team clears | matches |
| The Lead, a control seat, an unreadable/no-team session are never marked | `recordNamesLead`; `registerControlSeat` (an explicit `controlSeats` set, no name prefix); `findMemberTeam` returns undefined | matches |
| An ASSIGNED but unclaimed task keeps the tools open | `pending` is in `OPEN_TASK_STATUSES`; the contract's deliberate asymmetry | matches |
| `completed`/`cancelled`/`failed`-only members are idle | those statuses are not in `OPEN_TASK_STATUSES`; `bun test` arms cover all three | matches |
| A `review` task counts through its own `owner`; the board has no separate verifier field | Amendment A3 dropped the "declared verifier" clause (writer report, A3); `memberHasOpenTask` reads `owner` only | matches |
| The spawn preamble travels with the executor's prompt at both spawn sites | `withIdlePreamble(...)` at `approve` and at the mid-run `add_member` raise (Amendment A6) | matches |
| Registered per agent, re-armed on `agent/created`, released on `agent/disposed`; one directive per turn | `installIdleGuard` registers `registerAgentPreStep` for every `liveAgents()` entry, subscribes both lifecycle events, and gates on `injectedTurns` (one per turn; one per marking when no turn ordinal) | matches |
| A missing registry/bus/guard seam degrades to a reported absence | each seam is wrapped and warning-logged, never thrown | matches |

## 2. Wording decisions made deliberately (accuracy over the draft)

- **The reliable clear is the pre-step re-evaluation, not a dispatch/claim hook.** The contract lists
  three explicit clears, but the shipped row has NO explicit dispatch/claim clear call site: a cellwork
  dispatch reaches the member through `TeamExecutor.send`, which this row never observes, so the next
  pre-step is what clears the mark (Amendment A2). The twins say exactly that instead of promising a
  dispatch-time hook the code does not have.
- **The "declared verifier" clause is NOT documented** (Amendment A3: the board has no such field). The
  twins say a `review` task counts through its own `owner`.
- **Lazy spawn is NOT claimed.** §3.4 was not implemented; the twins state the one-turn, zero-tool spawn
  bound rather than implying the spawn turn is free.
- **The control-seat call sites are P2's.** The twins name `registerControlSeat` as the API a cell
  dispatcher needs and note that the cellwork call sites land with the dispatcher (§3.5/A5).
- **One directive** is described as per turn, with the per-marking fallback, because the code has both.

## 3. Gate

Run from the repo root after the FINAL edit:

`bun run verify:docs` → **exit 0**

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=52 failed=0 violations=0 exempt=24 derived=3 links=471 dead=0 — PASS
```

Full output: `docs.log` in this directory. Heading parity holds: both twins carry the same six `##`
headings in the same order (the new one is the fifth), the switch links are untouched and no link is dead.

## 4. Bounds

- Docs only: no `src/`, `dist/`, test, `skills/**`, row or manifest edit by this lane; no commit/branch.
- The live QA case (`skills/dsh-qa/scripts/team-idle-member-guard.ts`) was NOT run here — it is the
  verifier's live gate (T8), and the writer declares the live behaviour unverified until then.
- `verify-dist-fresh` and the vendor re-pin are red until the captain rebuilds dist and re-pins
  `skills/**` (the writer's log records both); this lane changed neither.
- The twins describe the contract + the final code; they do not claim a live end-to-end run, an explicit
  dispatch-time clear, or lazy spawn.
