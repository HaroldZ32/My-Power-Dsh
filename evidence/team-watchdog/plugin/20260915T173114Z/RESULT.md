# t73 (repair round 2) — the TEAM-scoped streak key, and the attempt-aware stamp filter

- **Task**: t73 (repair, round 2), attempt 1, attempt_id `c490b48d-0ed7-4f32-ae9a-b57d922f1ff9`
- **Source**: t70 (w11) verdict `needs_revision` — findings **W11-1** (medium) and **W11-2** (low).
- **Evidence**: this directory. Revision `b53a6515e6fcae95f3fc538f8f223314b4527df7`.
- The adopted tree is **untouched** (`git diff --numstat packages/mpd-agent-teams-plugin/lib/` is
  EMPTY; rows-parity still 25/25), so the wave's single `--write-registry` run stays spent.

## W11-1 (medium) — the streak key now names the TEAM

`streakKey(taskId, attemptId)` → **`streakKey(teamId, taskId, attemptId)`**, i.e.
`teamId + "\0" + taskId + "\0" + attemptId`, threaded through `observe()` (built from
`candidate.teamId`), `clear()`, `hasEscalated()`, `snapshot()`, the engine's scene input
(`this.machine.snapshot().streaks`) and `scene.ts`'s per-task `streak` lookup (`team.id` is part of
the key there too). Task ids are per-team (`t1`, `t2`, … allocated by each team's own `taskSeq`) and
a `pending` task can carry an assignee with NO attemptId, so the old key made two teams share one
streak — three single WARNs spread across two healthy teams summed into one ESCALATE that took a
**spurious HOLD** on one team while the other was silently never observed again.

The probe (`probe.mjs`, part A vs part B) shows the contrast on the SAME observation sequence:

```
NEW (team-scoped)                  OLD key model (taskId\0attemptId)
tick1  A warn:1   B warn:1         tick1  A warn:1   B warn:2      ← the two teams' warns summed
tick2  A warn:2   B warn:2         tick2  A ESCALATE:3              ← escalation after only 2 of
tick3  A escalate:3                tick3  (nothing)                    A's own warns
tick4  B escalate:3                tick4  (nothing)                 ← B never observed again
```

Part B is explicitly **a MODEL of the removed keying** (same observations, same 3-strike rule, the
old 2-part key), not the old code — so the difference is attributable to the keying alone. Part C
drives the **shipped dist** end-to-end over two teams in ONE workspace (both with a `t1` and no
attemptId): one tick ⇒ `[{warn, team-a, streak 1}, {warn, team-b, streak 1}]` and **no hold for
either team**.

A regression test pins it headlessly in `test/machine.test.ts` ("W11-1 REGRESSION: two teams sharing
a task id and an EMPTY attempt id never share a streak"): two warns each with no escalation, then
only the team that reaches its own third consecutive warn escalates, and the escalated set holds TWO
distinct 3-part keys.

## W11-2 (low) — the stamp filter is attempt-aware

`candidateFor()` now keeps a stamp when its `taskId` matches **and** either the stamp carries no
attempt information (`undefined`/`null`/`""`) or its attempt equals the task's:

```js
const taskAttempt = task.attemptId ?? ""
const forTask = stamps.filter((stamp) => {
  if (stamp.taskId !== task.id) return false
  const stampAttempt = stamp.attemptId
  if (stampAttempt === undefined || stampAttempt === null || stampAttempt === "") return true
  return stampAttempt === taskAttempt
})
```

The docstring now states the rule and WHY the permissive half exists (a stamp without attempt
information cannot contradict the current generation). The direction is the safe one — an earlier
generation's stamp no longer makes a task with no current stamp look *silent*; it is reported
`never-started` instead. Probe part D proves both directions on the shipped engine: a task at
`att-2` whose only stamp is `att-1` ⇒ **no WARN** and a durable `never-started` incident
(`{kind:'never-started', attemptId:'att-2', scene:null}`); move the stamp to `att-2` and the SAME
task warns again (streak 1).

**Measured along the way, and worth knowing:** a `never-started` observation is deliberately NOT
pushed into `TickResult.decisions` — the tick records it durably and counts it, then `continue`s
before the WARN/ESCALATE push. So `decisions` stays the WARN/ESCALATE list; a lane that wants the
dispatch observations must read the incident log or `getStats().neverStarted`. The probe asserts on
the artifacts for exactly that reason.

## The five declared verify commands

```
$ bun run typecheck
$ tsgo --noEmit
exit=0

$ bun test packages/mpd-team-watchdog-plugin
 59 pass   0 fail   273 expect() calls   Ran 59 tests across 12 files.
exit=0

$ node scripts/verify-rows-parity.mjs
[verify-rows-parity] ok: 25 row ids match the bundle patch insert list (… mpd-team-watchdog …)
exit=0

$ bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
[bundle-lifecycle] PASS
exit=0        (the mount log carries: [mpd-team-watchdog] applied: … holdService=mpdWatchdog …)

$ node skills/dsh-qa/scripts/preset-conformance.mjs
[preset-conformance] PASS
exit=0
```

Extras: `bun test packages` → **703 pass / 0 fail**; the probe → exit 0 with 9/9 checks.

## Changed paths (all inside the task's inScope)

```
packages/mpd-team-watchdog-plugin/src/machine.ts        the key + the attempt-aware filter
packages/mpd-team-watchdog-plugin/src/scene.ts          the per-task streak lookup uses the team id
packages/mpd-team-watchdog-plugin/test/machine.test.ts  new signatures + the W11-1 regression + W11-2
packages/mpd-team-watchdog-plugin/test/scene.test.ts    the streak fixture uses the 3-part key
packages/mpd-team-watchdog-plugin/dist/index.js         rebuilt from the touched src
evidence/team-watchdog/plugin/20260915T173114Z/         this evidence
```

## Not claimed / honest limits

- **W-3 stands**: no live model turn and no real provider wedge are exercised anywhere here; the
  probe injects silence with an injected clock and drives the real machine/engine directly.
- The cross-team defect is reproduced **in-process against the real machine/engine**, not with two
  live teams on a host; its production reachability is quoted from the code path w11 cited (the
  adopted amend path giving a `pending` task an assignee with no `attemptId`).
- Part B is a **model** of the removed keying, not a run of the old code.
- **A layout consequence this repair does NOT address**: the heartbeat store keys its files by
  MEMBER NAME per workspace, so two teams whose member share a name share one heartbeat file. The
  probe gives the teams distinct member names to keep attribution clean; this is noted, not fixed
  (it is out of scope for W11-1/W11-2, and the shared file's stamps still carry their own `teamId`).
- The `never-started` tick-shape observation above is a measurement, not a claim that the shape is
  optimal; changing `TickResult` was not part of this contract.
