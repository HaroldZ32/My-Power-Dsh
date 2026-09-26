# t71 (repair round 2) — boundary predicate, never-started surfacing, registry note

- **Task**: t71 (repair, round 2), attempt 1, attempt_id `00ca23b9-c954-45c8-ad92-46a3da71f9ff`
- **Source**: t69 (w12) verdict `needs_revision` — findings T69-ESCALATE-1 (high), T69-ESCALATE-2
  (medium), T69-TEST-1 (medium), T69-REGISTRY-1 (low).
- **Evidence**: this directory. The adopted tree is **UNCHANGED** by this task
  (`git diff --numstat packages/mpd-agent-teams-plugin/lib/` is EMPTY; `--check` still 53/9).

## 1. T69-ESCALATE-1 (high) — a COMPLETED turn is no longer treated as a wedge

`packages/mpd-team-watchdog-plugin/src/machine.ts`:

* `SilenceCandidate` now carries **`lastKind`** (the kind of the newest stamp for that task+attempt)
  next to `lastSeen`;
* `observe()` **withholds the observation AND resets the streak** when `lastKind === "turn-end"` —
  the member finished its turn and has simply not been re-dispatched. Escalating that used to hold a
  healthy team ~120 s after every finished turn with no ready task. Resetting (not just skipping) also
  means a stale streak can never be spent on the member's next turn;
* `stampedThisGeneration` is **renamed `everStampedForTask`** and documented for what it always
  meant: ANY stamp ever written for the task+attempt — rotation keeps the last generations, so
  "this generation" was wrong. It is the precondition that separates `never-started` from `silence`.

Unit-level pins added in `test/machine.test.ts`: a turn-end newest stamp never warns or escalates even
at 10×/20× the threshold; and a boundary resets a streak of 2 so the next silent tick is a FIRST warn,
not an escalate.

## 2. T69-ESCALATE-2 (medium) — `never-started` is RECORDED and NOTICED, still never pauses

`packages/mpd-team-watchdog-plugin/src/engine.ts`: a new `recordNeverStarted(...)` path gives the
dispatch problem the same durable treatment as a WARN —

* an **incident record** with `kind: "never-started"`, `scene: null` (nothing to snapshot yet),
  `hold: "not-requested"`, the task and attempt ids. The replay reads it through the existing
  `readIncidents()` + read-watermark path, so it reaches every reader that has not acknowledged it;
* a **notice line** naming the team, task, member and attempt and saying explicitly that it records
  WITHOUT holding or escalating;
* neither a scene nor a hold is written, and the record is byte-identical afterwards (it is a stuck
  DISPATCH, not a wedge — the reviewer's point was that it must not be silent, not that it should pause).

One documented cast marks the boundary: the durable kind union lives in `sidecars.ts`
(`IncidentRecord.kind: "warn" | "escalate"`), which this task's scope does not include, so the value is
added at the single call site with an explicit comment rather than silently editing an out-of-scope type.

## 3. T69-REGISTRY-1 (low) — the non-reproduction is RECORDED, nothing was "fixed"

Recorded in `result.json → registryNonReproduction` and in `output.log`, because a later reader must
not misread a green gate:

> **A green `node scripts/patch-agent-teams-fixes.mjs --check` is NOT a window-integrity proof.** With
> every region present the applier has nothing to heal, so a mutated context window is never consulted;
> `--check` proves the marked regions match the registry bytes, it does not re-derive that each entry's
> context pair is still unique on the region-stripped skeleton. A `--verify-windows` mode that does
> that would be a **NEW capability** and must not be smuggled into `--check`'s semantics. The integrity
> that matters was exercised on the **heal** path instead (t69's re-declaration experiment produced
> loud refusals with the file left byte-untouched).

## 4. T69-TEST-1 (medium) — the two boundary fixtures, falsifiable BOTH ways

Added to the w8 harness (`test/fixtures/inject.mjs`, the t66 deliverable) and run by this task's
runner. The pair differs in ONE field — the kind of the newest stamp — so neither half can pass by
accident:

```
── case never-started-recorded ── ok=true
   claimed task, no heartbeat ever; tick => one never-started decision, recorded once (the second
   tick repeats nothing); durable incident {kind:'never-started', taskId:'t1', scene:null,
   hold:'not-requested'}; a notice line; NO scene, NO hold, record byte-identical
── case completed-turn-idle ── ok=true
   newest stamp = `turn-end`; ticks at 90 001 / 180 001 / 270 001 ms => NO WARN, NO ESCALATE,
   0 scenes, 0 incidents, 0 holds, record byte-identical
── case mid-turn-stall ── ok=true
   the SAME shape with the newest stamp still a `step` => warn, warn, escalate + a hold
```

```
boundaryContrast = {completedTurnEscalated:false, completedTurnWarned:false,
                    completedTurnBeyond2xThreshold:true,
                    midTurnStallEscalated:true, midTurnStallHeld:true, ok:true}
```

The completed-turn case is the one that used to escalate (t69 measured it on the real machine); the
stall case is the fault the wave exists for and still escalates. 10/10 harness cases green.

## The four declared verify commands

```
$ node scripts/patch-agent-teams-fixes.mjs --check
[patch-agent-teams-fixes] already applied: 53 mpd delta region(s) across 9 adopted file(s)
exit=0

$ bun test packages/mpd-agent-teams-plugin
 220 pass   0 fail   Ran 220 tests across 60 files.
exit=0

$ bun test packages
 701 pass   0 fail   Ran 701 tests across 134 files.
exit=0

$ bun run typecheck
$ tsgo --noEmit
exit=0
```

Plus `bun test packages/mpd-team-watchdog-plugin` → **57 pass / 0 fail** (the two new unit tests), and
the harness runner → exit 0 with 10/10 cases.

## Paths changed, and three that were OUTSIDE the literal inScope list

In scope (as listed): `src/machine.ts`, `src/engine.ts`, `evidence/team-watchdog/pause/20260915T172352Z/`.

Outside the literal list, each required by an acceptance item — reported to the captain before doing them:

| Path | Why it could not be avoided |
|---|---|
| `test/machine.test.ts` | the acceptance-1 rename makes the existing suite reference a field that no longer exists; leaving it red also fails the declared verify `bun test packages` |
| `test/fixtures/inject.mjs` | acceptance #4 explicitly requires adding the two boundary fixtures to the w8 harness |
| `dist/index.js` | the mechanical build of the two in-scope src files; the w8 harness mounts the DIST, so the fix is invisible to the lanes without it |

The adopted lib and `mpd-deltas.js` were **not** touched: this repair is entirely inside the watchdog
package, so there is no new delta region and the wave's single `--write-registry` run is untouched.

## Not claimed

- **W-3 stands**: every fault case injects SILENCE (or a missing heartbeat); no case claims a real
  provider wedge was caught.
- The harness is stubbed; this proves plugin behaviour under injected input, not host behaviour.
- The `turn-end` predicate is exercised against the harness's own stamps, not against a live member
  turn; the live-turn lane is w9's.
- No scene/notice/banner is claimed for `never-started` beyond the durable incident record and the
  notice line: the Web banner and TUI row remain other tasks' surfaces (the record is what they read).
- The registry non-reproduction above is a RECORD, not a fix.
