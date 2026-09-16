# t66 (w8) — the fault-injection fixture

- **Task**: t66 (implementation), attempt 1, attempt_id `32e64990-1888-4e46-88db-f8d582af5d66`
- **Deliverable**: `packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs` — the injectable
  fixture the w9 QA lane drives. **This is not the lane** (`skills/**` stays w9's single-writer slot).
- **Evidence**: this directory (`result.json`, `output.log`, `scenario.json`, `raw/<case>.{json,log}`).

## The entry point a lane calls

```js
import { runCase, runAll, CASES, scenarios, CLOCK, FROZEN, NOT_CLAIMED }
  from "../../../packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs"

const one = await runCase("warn-90s")        // { case, ok, observation, lines }
const all = await runAll({ root, print })    // every case, each printing its own observation
```

`ok` is the case's own verdict, `observation` is structured evidence, `lines` is the human-readable
observation (printed by default). Unknown names return `{ok:false, observation:{known}}\)` instead of
throwing, and a case that throws reports `{ok:false, observation:{threw}}` — a lane always *sees* a
failure rather than crashing on it.

## What it drives, and what is injected

| Layer | Real or stub |
|---|---|
| adopted scheduler (`installTeamScheduler`) | **REAL** |
| watchdog engine / machine / store / scene / sidecars | **REAL** (built `dist/index.js`, mounted with `apply()`) |
| the negative control's halt path (`haltTeamWork`) | **REAL** — imported from the adopted lib and **called** |
| harness ctx (services store, agent registry, logger, `subagents.prompt`) | stub (the w7 pattern) |

The fault itself is **written to disk by the fixture** at the documented shapes — the team record,
the heartbeat JSONL stamps, the hold records — and the plugin's own code reacts to it. The injector
never reaches into plugin internals and never weakens a code path.

## The controllable clock

`CLOCK.base = 1_700_000_000_000`; every stamp carries an explicit `at` and every tick is driven with
an explicit `now`, so the **FROZEN** thresholds (`warnSilenceMs 90 000`, `warnStreakToEscalate 3`,
`tickIntervalMs 15 000`) are exercised in milliseconds. Every watchdog case asserts the frozen values
actually ran (`knobs.warnSilenceMs === 90000`), and the emitted scene file name is derived from the
injected clock (`…-20231114T221450Z-warn.json`), not from wall time.

## The cases (7/7 green — `raw/runner.log`, runner exit 0)

```
PASS member-stops-stepping         3 distinct step stamps then no further stamp; silence measured
                                   from the LAST stamp: +89 000 => 0 decisions, +90 001 => 1 WARN
PASS captain-wedge                 agentTurnsDriven 0 (nothing but the process-level tick);
                                   WARN attributed to memberKey 'captain' (task t9, 90 001 ms);
                                   the still-stamping member is NOT flagged; scene 1, incident 1
PASS warn-90s                      below the frozen threshold => 0 decisions; above => exactly ONE
                                   WARN with a scene snapshot (reason 'warn', cause {silence, 90001})
PASS escalate-3x                   kinds ['warn','warn','escalate',''] — exactly one ESCALATE per
                                   task+attempt, NO fourth WARN, both WARN predecessors carry their
                                   snapshot paths, hold applied once; a retry with a NEW attemptId
                                   starts a CLEAN streak (warn streak 1, no escalate)
PASS pause-preserves               hold via the plugin's own action; 0 deliveries while held; two
                                   named declines; sha256(team.json) UNCHANGED across the held kicks;
                                   status/attemptId/attempt/output/handoffId all preserved; after
                                   session-watchdog-resume dispatch resumes (1 delivery)
PASS pause-preserves-halt-control  the SAME fixture, paused by the REAL haltTeamWork:
                                   cancelledTasks 1, t1 in_progress/att-live/'partial result'/
                                   'handoff-1' => cancelled/undefined/'Stopped from the captain chat.'/
                                   undefined, sha256 CHANGED — AC-17 reddens on the wrong mechanism
PASS scene-restore                 scene + hold + 3 incidents read back with plain fs + JSON.parse
                                   (fresh-process shape); latest.team.hold.id matches the hold record
```

The negative control, verbatim from `result.json`:

```
mechanism      : "haltTeamWork (the adopted mass-cancel path), imported from
                  packages/mpd-agent-teams-plugin/lib/tools.js and CALLED — never stubbed"
cancelledTasks : 1        alreadyHalted: false        halted: true
before         : { status: in_progress, attemptId: att-live, output: "partial result", handoffId: handoff-1 }
after          : { status: cancelled,   attemptId: null,      output: "Stopped from the captain chat.", handoffId: null }
sha256Changed  : true     wouldReddenAC17: true
```

## The three declared verify commands

```
$ bun test packages/mpd-team-watchdog-plugin
 55 pass   0 fail   251 expect() calls   Ran 55 tests across 12 files.
exit=0        (the fixture is inert at import: no top-level side effects)

$ bun run typecheck
$ tsgo --noEmit
exit=0

$ bun test packages
 699 pass   0 fail   5080 expect() calls   Ran 699 tests across 134 files.
exit=0
```

## Dependencies (proof in `raw/fixture-imports.log`)

Node builtins (`node:crypto`, `node:fs`, `node:path`, `node:url`, `node:os`) plus exactly three real
modules: the adopted `lib/scheduler.js`, the adopted `lib/tools.js` (for `haltTeamWork`) and the
watchdog `dist/index.js`. **Zero import specifiers touch `skills/**` or `docs/**`**, there is no
credential read, no child process and no `dsh` spawn — so the fixture needs no live host and no model
credential.

## Not claimed (binding, W-3 first)

- **W-3: a GENUINE provider wedge is NOT reproducible here.** Every case injects **silence** (the
  absence of new heartbeats); no case may claim that a real wedge was caught. Each observation
  carries `injected: "silence"`.
- The harness is stubbed (ctx services, agents, `subagents`, logger). The scheduler, the watchdog
  engine/machine/store and the halt path are the REAL modules; the surrounding host is not — so
  "the fixture proves host behaviour" is not claimed, only plugin behaviour under injected input.
- `haltTeamWork` cancels; the fixture does **not** claim the halt path is ever the right mechanism —
  it exists to show AC-17 goes red when the pause is built on it.
- One workspace-resolution detail is stated rather than hidden: the engine resolves the workspaces it
  ticks over per call (`session cwd → DSH_WORKSPACE_ROOT → process.cwd()`) and otherwise learns them
  from stamps it writes itself. Because this fixture injects stamps straight to disk, it sets the
  sanctioned `DSH_WORKSPACE_ROOT` override for the duration of a case and restores it afterwards;
  each watchdog observation prints `rootsTicked` and `heartbeatFiles` so a mis-resolved root is
  visible rather than silent.
- Two fixture-side defects found and fixed while building this (both in my assertions, not in the
  plugin): `TickResult.decisions` is an array (an early check compared it to `0`), and the
  preservation hash was first sampled *after* the resume instead of after the held kicks. Both are
  visible in the raw runner log of the earlier run.
