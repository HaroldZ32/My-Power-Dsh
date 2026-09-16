# t74 — review round 2: the W11-1 / W11-2 repair, judged on the fixed revision

**Verdict: PASS** — both findings are fixed and I re-falsified them in both directions; everything else I
attacked still holds; one LOW doc/code mismatch found (a stale comment in the file that was just repaired).
No blocker, no high.

Revision judged (SETTLED — hashes identical before and after my run, `raw/hashes-{before,after}.txt`):

| file | sha256 (prefix) |
|---|---|
| `packages/mpd-team-watchdog-plugin/src/machine.ts` | `a46225cf18771ead…` |
| `packages/mpd-team-watchdog-plugin/dist/index.js` | `293d6cc2c94edb59…` |

Gates: `bun test packages/mpd-team-watchdog-plugin` → **59 pass / 0 fail** (was 55; +4 with the fixes) ·
`bun run typecheck` → clean · `node scripts/verify-vendor.mjs` → **PASS** (`raw/verify2.log`).

## 1. W11-1 (streak key) — FIXED, re-falsified on the REAL pipeline

`machine.ts:186 export function streakKey(teamId, taskId, attemptId) → teamId + "\0" + taskId + "\0" + attemptId`,
threaded through `observe` (`:217`, from `candidate.teamId`), `clear` (`:273`) and `hasEscalated` (`:280`),
with the consequence I flagged also handled in `scene.ts:143` (the per-task `streak` lookup uses the same
3-part key).

My own probe shape, driven through the real derivation (`candidateFor` + `WatchdogMachine`), two teams with
the same task id `t1` and **empty** attempt ids, each observed once per tick (`raw/round2-probe.mjs`):

```
keys: team-a\0t1\0  and  team-b\0t1\0            (3-part, team-scoped)
tick0  A warn:1:team-a    B warn:1:team-b          ← each its OWN first warn (was: A1/B2 summed)
tick1  A warn:2:team-a    B warn:2:team-b
tick2  A escalate:3:team-a  B escalate:3:team-b    ← each on its OWN third consecutive warn
tick3  (nothing further for either)
escalated = ["team-a\0t1\0", "team-b\0t1\0"]       ← TWO distinct keys
```

Contrast with the t70 model of the removed keying (`teamA escalate:3` after only 2 of its own warns while
`teamB` was never observed again): the arithmetic is per-team now, so the spurious-HOLD path is closed.
A regression test pins exactly this shape: `test/machine.test.ts:138` "W11-1 REGRESSION (the Reviewer's
exact probe shape): two teams, both tasks t1, BOTH with an empty attemptId, each observed once per tick" ✓

## 2. W11-2 (stamp generation) — FIXED, the stronger option

`machine.ts:307-312` now filters on the stamp's attempt when the stamp carries one:

```js
const forTask = stamps.filter((stamp) => {
  if (stamp.taskId !== task.id) return false
  const stampAttempt = stamp.attemptId
  if (stampAttempt === undefined || stampAttempt === null || stampAttempt === "") return true
  return stampAttempt === taskAttempt
})
```

Measured on a task whose attempt is `att-2` (`raw/round2-probe.mjs`):

| stamp | `lastSeen` | `everStampedForTask` | reading |
|---|---|---|---|
| names `att-1` (earlier generation) | **null** | **false** | correctly does NOT satisfy this generation → the task reports `never-started`, not "silent but started" ✓ |
| names `att-2` | 222 | true | satisfies ✓ |
| carries no attempt | 333 | true | kept, as documented ("cannot contradict this generation") ✓ |

## 3. A THIRD guard landed between t70 and t74 — attacked, holds

The machine now reads `lastKind` (`machine.ts:224`, T69-ESCALATE-1): a newest `turn-end` stamp is a healthy
between-turns member, so the observation is withheld **and the streak reset** (no stale streak can be spent
later). Probe: a `turn-end` newest stamp → **no decision across 4 consecutive silent ticks and no escalation** ✓
(`raw/round2-probe.log` `turnEnd`). Note for future reviewers: the candidate shape changed
(`stampedThisGeneration` → `everStampedForTask` + `lastKind`), so the t70 probe file would mis-drive if
reused verbatim; my round-2 probe builds candidates through the real `candidateFor`.

## 4. The five original attacks, re-run on the fixed revision

| attack | result |
|---|---|
| exactly one ESCALATE per key, no fourth WARN | `warn:1, warn:2, escalate:3, [], []` ✓ |
| a retry with a NEW attemptId starts clean | attempt-1 → `warn:1`; attempt-2 → `warn:1` (no carry-over) ✓ |
| flapping WARN/recovery | `warn, none` ×6, `escalated = []` ✓ |
| the FROZEN thresholds really used | at 90 000 → **no** decision; at 90 001 → WARN; ESCALATE only at the 3rd observation ✓ |
| a task that never stamped | `lastSeen null` / `everStampedForTask false` → one `never-started`, then silence ✓ |

## 5. Carried and unchanged (not re-litigated, re-run green)

AC-15 fail-safe is still measured by the plugin's own suite, now inside the 59/0: throwing tick body caught
and counted (`failsafe.test.ts:47-60`), no write loop (`:110`), unwritable heartbeat (`:136`), unwritable
**scene** (`scene.test.ts:174`+`:188`), hostile hold path (`holds.test.ts:143`); fail-open at the gate
members (`holds.test.ts:137`); the knob clamp documented in BOTH READMEs (`README.md:109`,
`README.zh-CN.md:96`) and tested (`machine.test.ts:43`). The honest-limits audit is carried from t68
(`evidence/team-watchdog/live/20260915T171438Z/`): all five lanes' NOT-CLAIMED lists hold.

## 6. Finding (LOW) — the repaired file's own comment is stale

`packages/mpd-team-watchdog-plugin/src/machine.ts:198`

```js
/** Consecutive WARN counts, keyed `taskId\0attemptId`. */
private readonly streaks = new Map<string, number>()
```

The map is keyed `teamId\0taskId\0attemptId` since this repair (the function's own doc at `:180-184` says so).
It is the same doc/code-mismatch class as W11-2 — harmless to behaviour, but it is exactly the kind of line a
future reader trusts. Required fix: update the comment (one line).

## 7. What I could NOT verify

- No live model turn and no real provider wedge (no model credentials): every case injects silence.
- Both fixes were re-falsified **in-process** against the real modules, not by running two live teams on a
  host; the reachability arguments remained the quoted code paths (`tools.js:388-396`,
  `machine.ts:296-312`).
- I did not mutate any lane or package (forbidden): expectation-falsification rests on the suite's own
  assertions/negative runs plus the two probe runs (t70 red-capable shape, t74 fixed shape).

**What this PASS does NOT cover:** the live-host end-to-end path (no credentials), the front doors' rendered
surfaces (audited as honest-by-disclosure in t68, not re-rendered here), and the LOW comment nit above.
