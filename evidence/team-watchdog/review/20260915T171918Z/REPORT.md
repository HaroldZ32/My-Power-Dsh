# t70 — w11 correctness + fail-safe review of the watchdog

**Verdict: `needs_revision`** — one MEDIUM finding in the machine's core keying (reachable, reproduced),
one LOW observation, and everything else I attacked held. Raw outputs: `raw/{machine-probe.log,verify.log}`.

Revision judged: this tree, `bun test packages/mpd-team-watchdog-plugin` **55 pass / 0 fail**,
`bun run typecheck` clean, `node scripts/verify-vendor.mjs` PASS (`raw/verify.log`).

## 1. THE MACHINE — attacked; ONE defect falsified

### W11-1 (MEDIUM) — the streak key omits `teamId`, so two teams' tasks share one streak

`packages/mpd-team-watchdog-plugin/src/machine.ts:163-166`

```js
/** The streak key: per task AND per attempt, so a retry starts clean. */
export function streakKey(taskId: string, attemptId: string): string {
  return taskId + "\u0000" + attemptId
}
```

The key is used for the streak map, the `escalated` set, `clear()` and `hasEscalated()`
(`machine.ts:177-181, 195, 209, 214, 229, 241-250`). Nothing in it identifies the TEAM, so a
machine's isolation between teams rests **entirely** on `attemptId` being globally unique. Task ids are
per-team (`t1`, `t2`, … — `tools.js:2582` maps `profile.tasks` with `id: "t" + (index+1)`), so they
cannot provide that isolation.

**Reproduced** (`raw/machine-probe.mjs`, driving the REAL exported machine):

```
two teams, tasks both id "t1", attemptId "" — each team observed ONCE per tick:
  tick 0: teamA -> warn:1        teamB -> warn:2
  tick 1: teamA -> escalate:3:teamA   teamB -> []
  tick 2: teamA -> []            teamB -> []
  escalated = ["t1\0"]
```

Three single-tick WARNs across TWO different teams summed into an ESCALATE attributed to `teamA`,
while `teamB` — whose own task had been observed exactly once — received nothing. A per-team machine
would never have escalated either team. Consequence in production: a **spurious HOLD** (a real
interruption of a healthy team, the opposite of the design's "preserving pause") plus a silent second
team.

**The empty-attempt shape is reachable, not theoretical.** `candidateFor` substitutes an empty attempt
id when a task has none — `machine.ts:268 const attemptId = task.attemptId ?? ""` — and an assignee
WITHOUT an attempt id is producible by the adopted plugin's own amend path:
`packages/mpd-agent-teams-plugin/lib/tools.js:388-396`

```js
388  if (task.status !== 'pending' || (task.attempt ?? 0) !== 0) {
389      throw new Error(`task "${task.id}" has already started and cannot be edited`);
...
396  task.assignee = trimmedOptional(mutation.assignee);
```

A `pending`, attempt-0 task is given an `assignee` and no `attemptId`. `candidateFor` skips only terminal
tasks and tasks with no assignee (`machine.ts:266`), so such a task becomes a candidate with
`attemptId = ""`. It still needs `stampedThisGeneration`, and the stamp filter is by **task id only**
(`machine.ts:270`), so stamps left by an earlier generation of the same task id satisfy it.

**Required fix:** key on the team as well — `streakKey(teamId, taskId, attemptId)` returning
`teamId + "\0" + taskId + "\0" + attemptId` — and thread the team id through `clear`, `hasEscalated`,
`snapshot` and their callers (`engine.ts`), plus the machine tests (`test/machine.test.ts` already
builds candidates with a `teamId`, so the fixture change is small).

### W11-2 (LOW) — the stamp filter ignores the stamp's attempt

`machine.ts:270` `const forTask = stamps.filter((stamp) => stamp.taskId === task.id)` — a stamp written
by an earlier attempt of the same task keeps the CURRENT attempt's `lastSeen` fresh. The direction is
fail-safe (it suppresses a WARN rather than causing a false one), but the docstring's "stamped this task
at least once **in this generation**" (`machine.ts:20`) is stronger than what the code checks. Fix:
filter on the stamp's attempt id when the stamp carries one, or correct the comment.

### Everything else in the machine HELD (probed, not read)

| attack | result |
|---|---|
| exactly one ESCALATE per key, no fourth WARN | `warn:1, warn:2, escalate:3, [], []`; `escalated=["t1\0attempt-1"]` ✓ |
| a retry with a NEW attemptId starts clean | attempt-1 → `warn:1`; attempt-2 → `warn:1` (no carry-over) ✓ |
| flapping WARN/recovery | `warn, none` × 6, `escalated=[]` — never escalates ✓ |
| the FROZEN thresholds really used (not a scaled shortcut) | `warnSilenceMs 90000`, `warnStreakToEscalate 3`; silence **== 90000 → no WARN**, **90001 → WARN**; ESCALATE only at the 3rd observation ✓ |
| a task that never stamped | one `never-started`, no escalation, and reported once ✓ |
| an ESCALATE for an ALREADY-held team | idempotent: `src/actions.ts:58-66` re-reads the existing hold (`id: existing?.id ?? randomUUID()`, `since: existing?.since ?? Date.now()`), so no second hold and no re-interrupt ✓ |

## 2. FAIL-SAFE — measured by the plugin's own suite, which I re-ran

`bun test packages/mpd-team-watchdog-plugin` → **55 pass / 0 fail**. The instruments are real, not
comments:

| property | instrument |
|---|---|
| a throwing tick body is CAUGHT and COUNTED | `test/failsafe.test.ts:47-60` forces `engine.knownRoots = () => { throw new Error("boom") }` and asserts `tickErrors === 1` + `lastError === "boom"`, with `console.warn` captured ✓ |
| no write loop | `test/failsafe.test.ts:110` "a tick with no state change writes nothing" ✓ |
| an UNWRITABLE HEARTBEAT location degrades | `test/failsafe.test.ts:136` occupies `watchdog/heartbeat` with a FILE → real `ENOTDIR` ✓ |
| an UNWRITABLE SCENE location degrades | `test/scene.test.ts:174` + `:188` "Occupy the scene directory's place with a FILE: mkdir then fails ENOTDIR" ✓ |
| hostile hold path | `test/holds.test.ts:143` (`watchdog/hold` occupied by a file) ✓ |

## 3. FAIL-OPEN COMPOSITION — checked at the gate members

`test/holds.test.ts:137` "never throws on a hostile path: the gates call it on every dispatch" covers the
gate members directly (the dispatch-level behaviour was already proven by w8's E1). With no
`mpdWatchdog` service the members return without throwing, so the watchdog's absence cannot block a
mounted host ✓ — this is the same surface the holds test exercises.

## 4. THE KNOB CLAMP — documented AND tested, consequence stated

- Code: `machine.ts:99-111` clamps `tickIntervalMs >= warnSilenceMs` to `max(1, floor(warnSilenceMs/3))`
  and records a `KnobIssue` (`watchdog.tickIntervalMs`, "must be < watchdog.warnSilenceMs (N); clamped").
- **Documented in BOTH languages**: `README.md:109` ("tick cadence; **clamped** when `>= warnSilenceMs`")
  and `README.zh-CN.md:96` ("`>= warnSilenceMs` 时会被**收敛**") — the pair is in sync.
- **Tested**: `test/machine.test.ts:43` "a cadence at or beyond the silence threshold is clamped loudly,
  not thrown" ✓.
- Consequence is user-visible and stated: a low silence threshold silently shrinks the tick to a third of
  it (w4 measured 15000→4115 at a 12345 threshold; the config lane measured 40000→10000), and the clamp
  surfaces as a knob issue in the front doors rather than failing the row.

## 5. HONEST LIMITS — audited, nothing dishonest

Carried from t68 (`evidence/team-watchdog/live/20260915T171438Z/`), where I audited all five lanes'
NOT-CLAIMED lists item by item: **nothing marked not-claimed is in fact witnessed, and nothing claimed is
in fact unwitnessed**; synthetic layers are disclosed wherever they exist, and the front doors' own
limitations (no browser render, no TTY keystroke drive) are stated by the lanes that own those surfaces.
The pre-fix RED runs kept beside the green ones (`evidence/team-watchdog/lanes/*/…-heartbeat`, `-fault`,
`-scene` with `ok=false`) are the negative-control history, not current results.

## 6. What I could NOT verify here

- **No live model turn and no real provider wedge** (no model credentials): the W-3 class stays
  unwitnessed; every case injects silence.
- The cross-team defect was reproduced **in-process against the real machine**, not by running two live
  teams on a host — the reachability argument rests on `tools.js:388-396` + `machine.ts:266-270`, both
  quoted above.
- I did not mutate any lane or package (forbidden here): falsification of expectations rests on the
  suite's own assertions/negative runs plus t68's re-run self-tests.

## 7. Summary of findings

| id | severity | file:line | problem | required fix |
|---|---|---|---|---|
| W11-1 | medium | `packages/mpd-team-watchdog-plugin/src/machine.ts:164-166` | the streak key omits the team id, so two teams' same-numbered tasks share one streak and can escalate on summed arithmetic (reproduced: `escalate:3:teamA` from three single-tick WARNs across two teams) → a spurious HOLD | key on `teamId\0taskId\0attemptId`; thread the team id through `clear`/`hasEscalated`/`snapshot` and their callers/tests |
| W11-2 | low | `packages/mpd-team-watchdog-plugin/src/machine.ts:270` | the stamp filter ignores the stamp's attempt, so the "stamped this generation" guarantee is weaker than the docstring claims (fail-safe direction) | filter on the stamp's attempt when present, or correct the comment |
