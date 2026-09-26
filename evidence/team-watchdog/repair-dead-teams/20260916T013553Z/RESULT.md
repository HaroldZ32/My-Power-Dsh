# t81 (r4) — the dead-team NEVER-STARTED flood is stopped

- **Task**: t81 (r4), attempt 1, attempt_id `9dce2234-476c-41a7-9258-3b8cefdede5b`
- **Evidence**: this directory. `.mpd/**` was **not written**: the real record set was measured on a
  byte-copy (see below), and no adopted file was touched (`--check` exit 0, 53 regions / 9 files).

## What the user saw, reproduced exactly

Running the pre-fix dist over a byte-copy of this workspace's real `.mpd/team` records (five dead +
the live one) produced **9 never-started observations, 9 incidents and 9 console lines** —
`mpd-default-84e50f06` **8** (t1…t8, phase `staged`, last touched Sep 10) and
`agent-teams-sidebar-migration` **1** (t7, last touched Sep 10). That is the user's own report, line
for line. The live `mpd-default` team contributed **0**.

## The rule, and the signal it uses

**Primary — a LIVE AGENT.** When the process's agent registry can answer (`capabilities().agents`
and at least one live agent), a team is ticked only if its **captain session or one of its member
ids resolves to a live agent** in this process. That is the strongest available signal because it
answers the real question — *can anything dispatch into this team?* — from the same registry the
stamp path already uses. A record whose sessions ended days ago has no live agent, so ticking it can
only manufacture reports about a corpse.

**Fallback — freshness.** When the registry cannot answer (no `agents` seam, or **no live agent at
all** in this process), the team is ticked while its newest record activity (`max(task.updatedAt,
updatedAt, approvedAt, createdAt)`) is within **`deadTeamGraceMs` (default 24 h)**. Without it, the
harness/unit compositions (no live agents) would tick nothing, and a host with no live sessions
would still flood. `deadTeamGraceMs: 0` disables the bound (the pre-r4 behaviour).

**Failure mode (stated):** a team genuinely wedged for longer than the grace window *and* with no
live agent is not reported. That is acceptable by construction — with no live session nothing can
dispatch into it, so there is no dispatch problem to explain — and the skip is visible on the debug
channel with its reason.

**One gate, every path.** The filter sits at the single place the tick enumerates teams
(`tickOnce`'s team loop), so WARN, ESCALATE, the hold and the never-started record are all gated by
the same rule; a dead record cannot leak into any of them. Proven by the falsifier below, not by
inspection.

## Before / after on the REAL record set (`raw/real-set-before.json` / `-after.json`)

| | neverStarted | incidents | console lines | skippedTeams |
|---|---|---|---|---|
| **BEFORE** (dist `275e6afe…`) | **9** | **9** | **9** | 0 |
| **AFTER** (dist `54f1f41c…`) | **0** | **0** | **0** | **5** |

Per team (`raw/real-set-{before,after}.json`):

```
                            BEFORE (obs / console)   AFTER (obs / console)
agent-teams-sidebar-migration      1 / 1                    0 / 0
mpd-default-84e50f06               8 / 8                    0 / 0
mpd-default-d92bc69a               0 / 0                    0 / 0
mpd-default-db53f0d4               0 / 0                    0 / 0
mpd-default-e1f54e18               0 / 0                    0 / 0
mpd-default (LIVE)                 0 / 0                    0 / 0   ← TICKED, not skipped
```

`skippedTeams: 5` in the after run names exactly the five dead records, so the live team was ticked.
The measured reasons (debug channel, invisible to the user, `raw/real-set-after.json`):

```
skipping team agent-teams-sidebar-migration (phase running, 10 task(s)) has NO live agent: neither the captain session nor any of …
skipping team mpd-default-84e50f06 (phase staged, 8 task(s)) has NO live agent: …
skipping team mpd-default-d92bc69a / mpd-default-db53f0d4 / mpd-default-e1f54e18 … (same)
```

**How the measurement stayed read-only:** the six records (and `watchdog/heartbeat/`, so the LIVE
team's stamps are present) were **copied byte-for-byte** into `raw/ws-real-*/`, and the engine was
pointed there. The live registry was modelled from the LIVE record's own ids (12 ids: captain +
members) — which is what a real host's registry holds, since the dead records' session ids are
absent from this process exactly as they would be there. **Nothing under `.mpd/**` was written**;
the junk lines already in the user's `incidents.jsonl` are the captain's to clean, and the count I
observed (9 emitted, 8+1 as reported) is recorded above.

## The live case still works (AC-2 intact)

Harness case `live-team-never-started`: the **same stale record**, but its member resolves to a LIVE
agent ⇒ the team IS ticked (`skippedTeams: 0`) and a claimed task that never stamped is still
recorded **once** as a durable `never-started` incident with its notice (`notices: 1`), with no
WARN/ESCALATE manufactured. The pre-existing `never-started-recorded` case still passes unchanged.

## The dead case, with its own falsifier

Harness case `dead-team-suppressed` (record ten days stale **and** a ten-day-old stamp, so it would
warn if ticked): `decisions: []`, `incidents: []`, `consoleLinesEmitted: []`, `skippedTeams: 1`, and
one debug line naming the grace bound. **Falsifier:** with `deadTeamGraceMs: 0` the SAME record is
ticked and **warns** (`boundDisabledWouldWarn: ["warn"]`, `boundDisabledSkippedTeams: 0`) — so the
silence is the gate's doing, not a vacuous fixture.

Harness total: **14/14 green**, including the ten pre-existing cases.

## Gates

```
$ bun test packages/mpd-team-watchdog-plugin   65 pass / 0 fail
$ bun test packages                            709 pass / 0 fail
$ bun run typecheck                            exit 0
$ node scripts/patch-agent-teams-fixes.mjs --check
        already applied: 53 mpd delta region(s) across 9 adopted file(s)   exit 0
$ bun skills/dsh-qa/scripts/team-watchdog-fault.mjs
        PASS — 11 checks, 0 failed (runs all 14 fixture cases)
```

`skills/**` untouched by this task (`raw/skills-status.log`: only the pre-existing w9 lane files),
so no corpus re-pin is owed.

## Dist rebuild

| | size | sha256 |
|---|---|---|
| before | 116353 | `275e6afe7ade5c22405f3243439a68c1b4105039daf8032495c41bb137f9f7b5` |
| after | 119753 | `54f1f41ce60629651d96320cffe573e5c0079d742f1a024213c07e733681935b` |

## Changed paths

```
packages/mpd-team-watchdog-plugin/src/engine.ts        the per-tick liveness gate + the debug-only skip note + config
packages/mpd-team-watchdog-plugin/src/team.ts          TeamRecord.activityAt (newest record activity)
packages/mpd-team-watchdog-plugin/src/index.ts         Config schema/resolver keys: deadTeamGraceMs, verboseSkips (+ boot line)
packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs  the dead/live liveness pair, a live-registry option, a debug channel
packages/mpd-team-watchdog-plugin/dist/index.js        rebuilt (figures above)
evidence/team-watchdog/repair-dead-teams/20260916T013553Z/
```

## Not claimed / honest limits

- The real-record measurement is a **byte-copy** with a **modelled live registry** (the live
  record's own ids): the record set is the real one, the registry content is reconstructed rather
  than read from a live host boot. No `dsh` process was booted.
- The 24 h grace bound is a **fallback**, not the primary signal; its false-skip risk (a wedged team
  with no live agent and a stale record) is stated above and is visible on the debug channel.
- W-3 stands: no live model turn and no real provider wedge are exercised here.
- The incident junk the user already has on disk was **not** touched; this task only stops new
  emissions.
